# 阻断态（blocked）设计与归档

> 最后更新：2026-11-02 · v1.4.0

## 一句话

插件原本只会「有错就跳过」或「照常关机」两种反应。当错误来自外部（额度耗尽、限流、凭证失效），
这两种反应都不对：前者把可恢复的问题当成任务失败，后者在半成品上直接关机。
`blocked` 就是在这两者之间插进来的第三态——**认得出是外部原因，就既不注入也不关机。**

## 上线范围

| 级别 | 含义 | 谁解除 | 本版 |
|---|---|---|---|
| `halted` | 重试也不会好，必须改账户/配置 | 人工 | ✅ 已上线 |
| `waiting` | 外部暂时不可用，会自己恢复 | 插件自动 | ✅ 已上线 |
| `stuck` | 长时间无进展，疑似僵死 | 人工判断 | ⏸ 归档，见文末 |

## halted —— 灰蓝 `#7e8aa3`

无自愈可能。继续重试只会把额度烧光，而且会让出错的批次走到关机。

| code | 说明 |
|---|---|
| `QUOTA` | 账户余额或配额耗尽 |
| `ACCOUNT_QUOTA` | 账户级 token 配额耗尽 |
| `INVALID_CREDENTIAL` | 密钥非法（不是缺失） |
| `MISSING_CREDENTIAL` | 未配置密钥 |
| `CONTEXT_WINDOW_EXCEEDED` | 压缩也腾不出空间 |
| `CAPABILITY_UNSUPPORTED` / `UNSUPPORTED_CAPABILITY` | 模型不支持该操作（如读图） |
| `DISK_FULL` / `ENOSPC` | 写盘失败，收尾落盘本身会失败 |

行为：置 `blocked`，不注入、不关机，等人工点「解除并重试」。

## waiting —— 灰绿 `#6f8f7a`，圆点呼吸

供应商侧故障，任务本身没错。

| code | 说明 |
|---|---|
| `RATE_LIMIT` | 被限流 |
| `SERVER` | 服务端 5xx |
| `TRANSPORT` | 网络/代理中断 |
| `EMPTY_RESPONSE` | 返回空内容，重试次数耗尽 |

行为：置 `blocked` 并排定重试；到点后清空 `blocked`，向 agent 注入 `AFK_RETRY_TEXT`
（回顾进度 → 继续原计划 → 报告落盘）。下一次成功运行也会清除等待态。

## 重试节奏：固定间隔 vs 指数退避

### 固定间隔（`delay = base`）

- 可预测：用户看着「30 秒后重试」就知道下一次是什么时候
- 恢复快：服务一恢复，最迟 `base` 秒内就撞上
- 长时间故障时代价高：假设断线 30 分钟、base=30s，就是 60 次无效请求

### 指数退避（`delay = base × 2^n`，封顶）

- 长故障便宜：同样 30 分钟，按 30→60→120→240→300… 只发约 10 次请求，是固定间隔的 1/6
- 恢复延迟变大：封顶 300s 时，最坏情况要等 5 分钟才发现服务回来了
- 依赖 `n` 的存储：进程重启会归零，退避节奏重置（这里是可接受的）

### v1.4.1：按故障类型分别选策略

同一组内的最优节奏并不一样，所以每种 code 指定一个**策略名**，策略本身可配：

| 策略 | 节奏 | 用在哪 | 为什么 |
|---|---|---|---|
| ate-limit | backoff 30→60→120→240→300 封顶 | RATE_LIMIT | 高频重试会**延长**限流 |
| 	ransient | 固定 20 秒 | SERVER / TRANSPORT / TIMEOUT | 几十秒内自愈，退避反而慢 |
| empty | 固定 30 秒 | EMPTY_RESPONSE | 偶发退化，与限流无关 |
| offload | 固定 5 秒 | IMAGE_OFFLOAD_REQUIRED | 本地磁盘操作，立即重试即可 |

IMAGE_OFFLOAD_REQUIRED 的语义（据 dsh-llm/lib/types/error.js）：一条支持图片的请求
要先把最老的若干张图片卸载到磁盘才能发送，error.offloadImages 指出要卸载几张，
dsh-compaction-image-offload 记录 image/offload 选择后由 agent 用新输入重试。
**这是本地磁盘操作，与外部服务无关，所以给最短间隔。**

配置面（cordis.patch.yml，默认值已写在包里）：

`yaml
retryPolicies:
  rate-limit: { mode: backoff, base: 30, max: 300 }
  transient:  { mode: fixed, every: 20 }
  empty:      { mode: fixed, every: 30 }
  offload:    { mode: fixed, every: 5 }
retryAssign:
  RATE_LIMIT: rate-limit
  SERVER: transient
  TRANSPORT: transient
  TIMEOUT: transient
  EMPTY_RESPONSE: empty
  IMAGE_OFFLOAD_REQUIRED: offload
`

想给单个 code 特殊待遇，加一行即可（例如让限流等更久）：

`yaml
retryAssign:
  RATE_LIMIT: slow-limit
retryPolicies:
  slow-limit: { mode: backoff, base: 60, max: 900 }
`

未知 code 统一回落 	ransient；策略表里写错的形状会被丢弃并保留默认值。

### 退避的数学

```
delay = min(base × 2^min(attempt, 4), max(base, 300s))
base = retrySec（默认 30，可配 10–600）
```

理由：

1. 指数退避解决的是**成本**问题，而限流/宕机恰恰是成本最敏感的场景——被限流时继续高频请求只会延长限流
2. 封顶 300s 解决的是**恢复延迟**问题，避免 2^n 无限增长导致服务恢复后十几分钟才发现
3. 只翻 4 次（30→60→120→240→300），前 4 次足够快，之后稳定在 5 分钟一探

不适合用指数的场景：`EMPTY_RESPONSE` 这类偶发退化，其实固定 30s 更合适。
但为了一个状态维护两套节奏不值得，统一走退避即可。

### 一个反直觉的细节

`retryAttempt` **不在** `agent/status = running` 时重置，只在武装/解除时清零。
否则「注入 → 重跑 → 又限流」会永远停在第 1 档，退避失去意义。

## 卡片表达

- **优先级最高**：`blocked` 排在 `off/fire/fired/hold/armed` 之前。因为插件并未解除武装，
  若显示「待命」，用户会以为机器马上要关。
- **A 变体**：大字「已暂停」（halted）/「等待恢复」（waiting），副文直接给原因和动作。
- **B 变体**：雷达环降到 30% 并去色，扫描光束隐藏（没东西可扫），HUD 显示 `Paused`/`Retrying`。
- **C 变体**：终端多一行 `error <code>` 与 `shutdown halted|retrying`，LED 只亮 3 段。
- **警戒带**：静止 + 28% 透明 + 去色。还在，但不再「警戒」。
- **按钮**：halted 是「解除并重试」（一次点击完成 disarm + arm），waiting 只有「解除」。
- **设置页**：新增「当前阻断」行，放在「上次为什么没关机」上面（当前态在前，历史在后）。

## 状态字段

`GET /api/dsh-shutdown-panel/state` 新增：

```json
{
  "blocked": "额度不足，已暂停关机（充值后解除再武装）",
  "retryAttempt": 0,
  "retryAt": 0
}
```

`blocked` 为 `null` 表示无阻断。`retryAt > 0` 即 `waiting` 语义。

## stuck —— 归档，本版不做

三种情况插件目前**感知不到**，因为它们不产生 `agent/error`：

1. **审批无人应答**：会话仍是 `running`，但不再产生任何事件
2. **后台任务卡在 `stopping`**：永远不会变成 `settled`，插件永远算它「在跑」
3. **会话状态不刷新**：agent 已死但 `status` 没翻到 `idle`

要做需要：

- 在 `session/event` 上记 `lastActivityAt`（现在只用于中断识别）
- 定一个「多久算卡住」的阈值（10 分钟？）
- 卡片加「强制关机 / 继续等待」二选一

搁置原因：**误伤长任务**。跑 40 分钟的构建、等一次慢测试，都会命中阈值。
阈值定高了形同虚设，定低了天天误报，收益不明确。

### 如果以后要做

```js
// 每收到一个 session/event 就刷新
lastActivityAt.set(sessionId, Date.now())

// 在 tryArm() 之后、状态 payload 里计算
const stalled = [...lastActivityAt].filter(([id, at]) =>
  agentStatus(id) === 'running' && Date.now() - at > STALL_MS)
```

分级建议用灰紫 `#8a7391`（警示但不用红色，因为未确认已死），按钮给「强制关机」。

## Demo

- `preview/blocked-list.html` —— 18 项可切换清单（含归档的 stuck 三项，供以后参考）
- `preview/blocked-demo.html` —— 首批 8 张卡片 + 设置面板两态
- 生成器：`_gen_blocked_list.cjs`、`_gen_blocked_preview.cjs`（从 `lib/client.js` 抽真实 CSS）
