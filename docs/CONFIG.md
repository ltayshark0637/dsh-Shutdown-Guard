# 配置字段

面向维护者与想手改配置的人。使用者视角的设置说明在 [README](../README.md)。
判定逻辑与重试的动机见 [ARCHITECTURE](./ARCHITECTURE.md)。

## 1. 三处来源与优先级

从低到高：

1. `cordis.patch.yml` —— 插件包内的出厂 patch
2. `data/config.json` —— 运行时持久化，设置页改的东西落在这里
3. `POST /config`、`POST /ui` —— 运行时改，改动同样落盘

设置页不会绕过第 2 层：它在设置页做的每一次改动都走同一个写盘函数（`saveStore()`）。

## 2. `data/config.json` 的形状

```json
{
  "version": 3,
  "activeProfileId": "default",
  "customEnabled": false,
  "lastCustomProfileId": null,
  "language": "auto",
  "parked": null,
  "profiles": [ { "id": "default", "…": "…" } ]
}
```

| 顶层键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `version` | 数字 | `3` | schema 版本；v1.6.1 从 2 升到 3 |
| `activeProfileId` | string | `default` | 当前生效的 profile id |
| `customEnabled` | bool | `false` | 是否允许使用自定义 profile |
| `lastCustomProfileId` | string \| null | `null` | 关掉再打开时要回到的那份 |
| `language` | 枚举 `auto` / `zh` / `en` / `ru` | `auto` | 界面语言，`auto` 跟随系统 |
| `parked` | 对象 \| null | `null` | 熔断现场，见第 5 节；唯一写进配置文件的**运行时状态** |
| `profiles` | 数组 | 一份 `default` | 每份是一个行为快照 |

界面外观（卡片样式 / 主题 / 折叠 / 悬浮窗简洁模式）**不在**这个文件里，见第 7 节。

### `parked`：唯一写进配置的运行时状态

```json
{ "code": "RATE_LIMIT", "level": "halted", "reasonKey": "halted.RATE_LIMIT", "at": 1762400000000 }
```

- **只有 `halted` 会落盘**。`waiting` 有计时器会自己恢复，存下来会变成「重启之后永远在等」。
- 读回时 `code` 必须在 `HALTED_CODES` 里，否则整条丢弃（`null`）：未知 code 会渲染成空理由，比忘掉它更糟。
- **清除边界**：
  - 清：武装、解除、成功回合、`shutdownOnHalt` 触发。
  - 不清：重启、切 profile、改语言、改外观 —— 这些都不改变「这一批已经熔断」的事实。
- `/state` 的 `parkedAt` 是它的时间戳（没熔断时为 `null`），给界面显示「上次熔断于 3 小时前」。

### `shutdownOnHalt` 的有效值

设置页看到的开关是派生值 `shutdownOnHaltEffective`，母开关是 `onlyOnSuccess`：

| 条件 | 有效值 |
| --- | --- |
| `onlyOnSuccess: false`（母开关关） | 强制 `false` |
| `onlyOnSuccess: true` | 尊重用户存的 `shutdownOnHalt` |

**磁盘上用户存的值永不被改写**，所以母开关来回切不会丢掉用户原来的选择；设置页在母开关关掉时只是把控件置灰。

## 3. profile 字段

每份 profile 各存一份，互不影响。

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `countdownSec` | 数字 10–600 | `60` | 关机前倒计时秒数。**默认 profile 锁定为 60** |
| `marginSec` | 数字 0–60 | `5` | 给 `shutdown /t` 留的额外余量。**默认 profile 锁定为 5** |
| `onlyOnSuccess` | bool | `true` | 本批次有会话报错就跳过。**默认 profile 锁定为 `true`** |
| `blockOnJobs` | bool | `true` | 有运行中后台任务就跳过。**默认 profile 锁定为 `true`** |
| `afkAutoAnswer` | bool | `true` | 武装期间替用户回答提问、做错误恢复。**默认 profile 锁定为 `true`** |
| `notify` | 对象 | 四类全 `true` | `{ countdown, fired, blocked, recovered }`，逐类布尔 |
| `retrySec` | 数字 10–600 | `30` | 未命中具名策略时的兜底重试间隔 |
| `retryPolicies` | 对象 | 见第 6 节 | 策略名 → `{ mode: 'backoff', base, max }` 或 `{ mode: 'fixed', every }` |
| `retryAssign` | 对象 | 见第 6 节 | 错误码 → 策略名 |

**v1.6.1 新增（已落库）**

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `action` | 枚举（8 个 id） | `shutdown` | 任务完成后执行什么动作，见第 4 节 |
| `customArgv` | string 数组 | `[]` | 仅当 `action: custom` 时生效；上限 **16 条 × 每条 256 字符** |
| `shutdownOnHalt` | bool | `true` | 熔断（`halted`）之后是否仍执行动作 |

- `customArgv` 直接 `exec` 文件 + 参数，**不经 shell**：没有引号解析、没有管道、没有 `&&`。写进去的字符串原样作为 argv，所以 `["sh", "-c", "…"]` 这种才需要 shell 的事要自己显式写。
- `shutdownOnHalt: false` 表示「熔断后不动作」；默认 `true` 与旧行为一致（熔断只是不再等条件，不改变动作本身）。
- 这三项都进 `PROFILE_PATCH_FIELDS`，因此可以按 profile 分别设。注意 `shutdownOnHalt` **不在**默认 profile 的锁定字段里（锁定的是 `countdownSec`、`marginSec`、`onlyOnSuccess`、`blockOnJobs`、`afkAutoAnswer`），所以默认 profile 也能改它。

## 4. `action` 的八个取值

| id | win32 | macOS | Linux |
| --- | --- | --- | --- |
| `shutdown` | `shutdown /s /t <秒>`，**可取消**（`shutdown /a`） | `osascript` 关机，立即 | `systemctl poweroff`，立即 |
| `restart` | `shutdown /r /t <秒>`，可取消 | `osascript` 重启，立即 | `systemctl reboot`，立即 |
| `hibernate` | `shutdown /h` | 无用户级休眠命令，**降级为睡眠**（`pmset sleepnow`） | `systemctl hibernate` |
| `sleep` | `rundll32 powrprof.dll,SetSuspendState` | `pmset sleepnow` | `systemctl suspend` |
| `lock` | `rundll32 user32.dll,LockWorkStation` | **不支持**（没有受支持的 CLI） | `loginctl lock-session` |
| `signout` | `shutdown /l` | `osascript` 注销 | `loginctl terminate-user`，**会连带结束 DSH 自己**（DSH 跑在该用户会话里） |
| `restart-dsh` | **列出但当前不可选** | 同左 | 同左 |
| `custom` | 执行 `customArgv` | 同左 | 同左 |

- **`restart-dsh` 为什么置灰**：重启 DSH 要走 `app.relaunch()`，那是 Electron 主进程的能力，插件没有路径够到它；`process.exit()` 会跳过宿主清理、可能损坏正在跑的会话，所以刻意不做。它在枚举里保留位置，是为了让配置文件可读、将来宿主开放接口时直接点亮，**选择器里点不动不是 bug**。
- 只有 win32 的 `shutdown` / `restart` 是「先定时、可取消」（`timing: 'defer'`）；其余动作一旦下发就不可撤销。
- 未知 `action` 回落 `shutdown`：配置写坏也不会出现「武装着却没有任何动作」的状态。

**能力探测与三态**：挂载时探一次，之后只在 `POST /config {recheck:true}` 时重探，**不轮询**。每个动作的状态是 `{available, reason}`，`available` 有三态：

| 值 | 含义 |
| --- | --- |
| `true` | 命令能解析、且系统后面没有别的否决环节（win32 的 `shutdown` 一类） |
| `false` | 本平台没有诚实的命令，或命令不存在（macOS 的 `lock`、`restart-dsh`） |
| `'unknown'` | 命令存在，但 macOS（TCC）或 Linux（polkit）可能在最后一刻拒绝 —— 这时报 `true` 就是撒谎 |

非 win32 上所有可解析的命令一律报 `'unknown'`，不是 `true`。
重测时如果**当前选中的动作**掉成不可用，宿主只打标记（`/state.actionReady === false`、卡片与设置页给出提示），**不改用户选的动作**。

## 5. 端点

前缀 `/api/dsh-shutdown-guard`，仅本机可用。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/state?since=<ms>` | 完整状态 + 增量事件 |
| GET | `/events?since=&limit=` | 事件流水 |
| POST | `/arm` `/disarm` `/cancel` | 武装 / 解除 / 取消本次倒计时 |
| POST | `/config` | 改**行为**：profile、开关、语言 |
| POST | `/ui` | 改**外观**：卡片样式、主题、语言、悬浮窗简洁模式 |

`/config` 与 `/ui` 是同一条 HTTP 服务上的两个写入口，分工按「行为 / 外观」切，因为两层数据存在不同的文件里、也由不同的界面消费：

- `/config` 写 `data/config.json`。接受 `customEnabled`、`activeProfileId`、`language`、`profileId` + `patch`（以及顶层的 `afkAutoAnswer`）。
- `/ui` 写 `data/ui.json`。接受 `variant`（`A`/`B`/`C`）、`theme`（`auto`/`dark`/`light`/`claude`）、`lang`（`auto`/`zh`/`en`/`ru`）、`compact`（布尔）。
- `/ui` 拒绝 `notify`：通知是行为不是外观，返回 `400 {"error": "notify belongs to the active profile; use /config updateProfile"}`。

**默认 profile 是锁的**。往 `default` 上写下面任一字段会得到 400：

```
{"error": "default profile is locked: <field> cannot change"}
```

`<field>` 取值：`countdownSec`、`marginSec`、`onlyOnSuccess`、`blockOnJobs`、`afkAutoAnswer`。要改这些，先新建一份自定义 profile。

其他错误：非法语言 `400 unknown language`、未知 profile `400 unknown profile`、非本机 Origin 的 POST `403`、非 POST 方法 `405`。

### `/state` 里与动作层相关的字段

| 字段 | 形状 | 说明 |
| --- | --- | --- |
| `actions` | `{ [id]: { available, reason } }` | 8 个 id 全列出，含连字符的 `restart-dsh`；挂载后首次探测前为 `{}` |
| `actionReady` | bool | 当前 profile 的 `action` 是否可用（`available !== false`）；`'unknown'` 视为可用 |
| `lastAction` | 对象 \| null | 本进程最后一次真正下发的命令，仅用于诊断 |
| `parkedAt` | 数字 \| null | 熔断开始时间（`halted` 才有），见第 2 节 |
| `shutdownOnHaltEffective` | bool | 见第 2 节的派生规则 |

手动重测入口是 `POST /config {"recheck": true}`：立即重跑一次能力探测并刷新 `actions`，**不做轮询**。

## 6. 重试策略

每个错误码分配一个策略名，策略本身可配置：

| 策略 | 默认节奏 | 分配给 |
| --- | --- | --- |
| `rate-limit` | backoff 30 → 60 → 120 → 240 → 300 封顶 | `RATE_LIMIT` |
| `transient` | 固定 20 秒 | `SERVER` / `TRANSPORT` / `TIMEOUT` |
| `empty` | 固定 30 秒 | `EMPTY_RESPONSE` |
| `offload` | 固定 5 秒 | `IMAGE_OFFLOAD_REQUIRED` |

限流用退避而不是固定间隔，是因为对限流服务高频重试**会延长**限流期，而不只是浪费请求；5xx 与网络故障的恢复时间可预测，固定间隔反而更快；图片卸载是本地磁盘操作，几乎立刻可重试。

覆盖单个错误码：

```yaml
retryAssign:
  RATE_LIMIT: slow-limit
retryPolicies:
  slow-limit: { mode: backoff, base: 60, max: 900 }
```

未知 `code` 回落 `transient`；形状写错的策略会被丢弃并保留默认值。当前生效的分配可从 `/state` 的 `retryAssign`、`retryPolicies` 读到。

## 7. 界面偏好存在哪

| 偏好 | 存哪 | 键 |
| --- | --- | --- |
| 卡片样式 / 主题 / 折叠 | 浏览器 `localStorage` | `dsh-shutdown-guard.variant` / `.theme` / `.folded` |
| 语言 / 悬浮窗简洁模式 / 四类通知 | 宿主 | `data/ui.json`（`notify` 实际落在 profile 里） |
| profile 相关的全部行为 | 宿主 | `data/config.json` |

`localStorage` 按存储分区隔离（侧边栏与悬浮窗可能不在同一个分区），所以语言、简洁模式这类「两个界面必须一致」的状态由宿主持有，并在每份 `/state` 里以 `ui` 下发；`localStorage` 只在首屏做一次兜底。

## 8. schema 2 → 3 的迁移

- 读取时先看 `version`：2 或缺失都按旧结构解析，随后写回 `version: 3`。
- 旧结构里的 `profiles[]` 原样保留：不改 id、不拆分、不重排，**你手改过的值不会丢**。
- 新增字段（`action`、`customArgv`、`shutdownOnHalt`）缺失时按默认值补齐：`shutdown` / `[]` / `true`。
- v2 文件没有 `parked` 字段，读回即 `null`（等价于「没有熔断现场」）；没有需要搬运的旧状态。
- `afkAutoAnswer`、`notify` 这类曾经同时存在于顶层与 profile 的键，以 profile 内的值为准，顶层旧值只在没有 profile 值时才被采用。
- 升级时，从未动过的空 profile 槽会被清理；改过名字或动过任一开关的 profile 一定保留。

## 9. 事件日志

`data/events.log` 是人可读的追加流水，按 `config` / `afk` / `skip` 分类，设置页「状态」标签的「事件日志」读的就是它。进程级日志另在 `<DSH_HOME>\dsh-shutdown-guard.log`。
