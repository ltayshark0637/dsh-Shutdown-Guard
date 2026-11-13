# 架构与判定

> **中文** · [English](ARCHITECTURE.en.md) · [Русский](ARCHITECTURE.ru.md)

这份文档写给维护者：状态怎么流转、五道闸门怎么判、阻断与重试怎么配合、窗口页为什么必须跟卡片同源。
面向使用者的说明在 [README](../README.md)。

## 1. 三个入口与数据流

本仓库根目录就是插件目录，宿主侧与客户端各占一半：

| 文件 | 职责 |
| --- | --- |
| `lib/index.mjs` | 宿主侧：判定闸、倒计时、`shutdown.exe` 调用、重试与熔断、配置持久化、HTTP 路由、悬浮窗页面生成 |
| `lib/client.js` | 侧边栏卡片：单个 bundle，CSS 与 React 都在里面 |
| `lib/i18n.mjs` | 三语文案与语言解析（`LANGS`、`resolveLang`） |
| `cordis.patch.yml` | 插件包内的出厂 patch（最低优先级） |

数据流是一条单向的拉取链，没有推送：

```
宿主状态（快照 + 事件）
      │  GET /state?since=<ms>（卡片与窗口页各自轮询）
      ├──▶ 侧边栏卡片（lib/client.js）
      └──▶ 悬浮窗页面（lib/index.mjs 的 windowHtml()）
```

`/state` 同时返回 `ui`（variant / theme / lang），窗口页每秒读它重绘，所以设置一改，窗口跟着变，不需要刷新。

`/state` 里脚本相关的字段分两类：权威的在顶层，兼容投影挂在每份 profile 上。

| 字段 | 形状 | 说明 |
| --- | --- | --- |
| `scripts` | `[{ id, name, ext, bytes, sha256, savedAt, ackOk, ackAt, usedBy }]` | 全局脚本库的元数据。**永不含正文**；`usedBy` 是当前有多少份 profile 指向它 |
| `script` | `{ name, ext, bytes, sha256, savedAt } \| null` | 当前 profile 选中那条的元数据 |
| `scriptAckOk` | bool | 当前选中那条是否「确认过、且磁盘上的字节仍然一致」 |
| `profiles[].script` | 同上 / `null` | **兼容投影**：按该 profile 的 `scriptId` 从库里拼出来，便于设置页渲染单行 |
| `profiles[].scriptAck` | `{ sha256, at } \| null` | 同上，兼容投影 |

字节本身只在磁盘：`<DATA_DIR>/scripts/<scriptId>.<ext>`，文件名由宿主按 id 生成，所以配置里写不进任意路径。

## 2. 六种运行状态

| 状态 | 含义 | 卡片**标签** |
| --- | --- | --- |
| `off` | 未开启，什么都不看 | `OFF` |
| `armed` | 已武装、条件已满足，等下一批任务 | `ARMED` |
| `hold` | 等后台任务跑完 | `WAIT` |
| `fire` | 倒计时中，动作**还没发**，到点才发 | `FIRE` |
| `fired` | 动作已发出，不可撤销 | `DONE` |
| `blocked` | 阻断（`halted` 或 `waiting` 两个子态） | `PAUSED` |

迁移：

```
off ──武装──▶ armed ──有后台任务──▶ hold ──任务跑完──▶ armed
                │                                    │
                └──条件满足且无倒计时──▶ fire ──倒计时结束──▶ fired
                │
                └──阻断性错误──▶ blocked ──恢复──▶ armed
```

- 所有动作都是 **inline**：倒计时由插件自己数，到点只发一次、发出去就是立即执行。倒计时期间取消 = **什么都不发**，取消后**仍保持武装**，下一批任务干完照样会执行。
- 代价：倒计时期间 DSH 被杀掉或崩溃，动作**不会**执行。旧实现用系统定时器（`shutdown /t N`），那种情况仍会关；现在是「插件活着才发生」。
- `fired` 之后没有「再次武装」的自动恢复，需要人再点一次。

## 3. 五道判定闸

处于 `blocked` 时直接不下发；其余情况必须五条同时成立才执行动作（默认 `shutdown`，也可能是重启 / 睡眠 / 注销 / 从脚本库里选中的脚本）：

| # | 闸门 | 字段 | 默认 |
| --- | --- | --- | --- |
| 1 | 已武装（人手动点的） | — | — |
| 2 | 没有倒计时在跑（避免重复下发） | — | — |
| 3 | 所有 root 会话都空闲，没有任何 agent 还在干活 | — | — |
| 4 | 没有运行中 / 停止中的后台任务 | `blockOnJobs` | `true` |
| 5 | 本批次没有会话报错 | `onlyOnSuccess` | `true` |

缺任何一条都不关，并把原因写进卡片与设置页「状态」标签（`data/events.log` 里有完整流水）。

`marginSec`（默认 5 秒）**不参与五道判定**，也与任何系统定时器无关：所有动作都是 inline，命令严格在倒计时结束那一刻发出。它决定的是「卡片还要不要把倒计时态多显示一会儿」——`fired` 状态在 `countdownSec + marginSec + 5` 秒后才置上，那 5 秒是固定值。

这段停留期里点「取消关机」，命令已经出了进程、无法撤回，事件日志会记一条「动作已发出，无法撤回」。

所以 `marginSec` 的作用是给「已发出」这件事留出被看见的时间，不是给命令留缓冲；调大它只会让卡片更晚跳到「已下发」。

## 4. 阻断态

遇到没法当普通失败处理的错误，插件**不解除武装**，只把卡片转色并写明原因：

| 子态 | 颜色 | 触发 | 恢复 |
| --- | --- | --- | --- |
| `halted` | 灰蓝 | 额度不足、凭证失效、上下文超限、能力不支持、磁盘写满 | 只有人能处理：点「解除并重试」 |
| `waiting` | 灰绿，圆点呼吸 | 限流、5xx、网络中断、空响应、超时、图片卸载 | 按策略自动重试，到点注入「继续原计划」指令 |

重试节奏见 [CONFIG](./CONFIG.md#6-重试策略)。

**只有 `halted` 会落盘**（`config.json` 的 `parked`）：`waiting` 有计时器会自愈，存下来会变成「重启之后永远在等」。
清除边界：武装、解除、成功回合、`shutdownOnHalt` 触发时清；重启、切 profile、改语言、改外观时**不清** —— 那些都不改变「这一批已经熔断」的事实。
熔断之后是否仍执行动作，由 `shutdownOnHalt` 决定，有效值还要看母开关 `onlyOnSuccess`（见 [CONFIG](./CONFIG.md) 第 2 节）。

## 5. AFK 自动接管

只在武装期间生效，三件事：

1. **自动回答提问**（`afkAutoAnswer`，默认开）：回复「用户处于 AFK，先完成已交代的任务，汇总报告并落盘，不碰未交代的分支」，返回 `selected: []` + 自定义文本，**不替用户选中任何选项**；关掉后提问照常弹给用户。
2. **错误恢复**：会话报错时先要求 agent 排查并继续原计划；同一会话再次失败改为「停止重试、写报告收尾」。
3. **中断保护**：用户在半路手动终止任务，不会触发关机。

## 6. 悬浮窗与侧边栏：MIRROR CONTRACT

窗口页由宿主侧生成（`lib/index.mjs` 的 `windowHtml()`），卡片在客户端（`lib/client.js`）。
两者是**两份渲染实现**，同一处显示逻辑必须两边同时改。以下是 `lib/index.mjs` 里的原始约束（逐字保留）：

> MIRROR CONTRACT — this page is a *copy* of the card, not a reference to it:
> whenever lib/client.js changes a variant body, a theme token, a state colour
> or a card string, the same change must land here, and the comparison
> screenshots under `_ops/worklog/` must be regenerated. The card settings
> (variant / theme / lang) are held by the host and arrive in every `/state`
> snapshot as `ui`, so the 1s poll repaints this page when they change; the
> same localStorage keys are read once as a first-paint fallback because the
> sidebar and this window can sit in different storage partitions. `folded` is
> ignored on purpose — a floating window is always expanded.
>
> Counters belong to that contract as well: B's run dots (one per live agent, cap
> `DOT_CAP = 12`, `+N` badge, `role="img"` + `radar.aria`) and C's agent counter
> must stay same-source with lib/client.js's `syncDots()` / `unit.agent`. Both
> read `agentRunningTotal` (falling back to `runningCount`), never `runningCount`
> alone — otherwise a Team of subagents shows three dots in the sidebar and one
> here, which is the contradiction a user notices first.

补充说明：

- 窗口页多一行统计（侧边栏没有），这是**唯一**允许的差异；`folded` 被有意忽略。
- 悬浮窗的「简洁模式」由宿主持有（`data/ui.json` 的 `compact`，默认开），窗口内没有开关。
- 三档兜底写在页面 markup 里：宿主未挂载 → 占位；`/state` 5xx → 保留上一份快照并显示离线；别处切了语言 → 跟 `state.lang` 重取事件。

## 7. 平台与失败面

- **平台**：win32、macOS、Linux 现在都按同一条路径挂载 —— 动作表为每个平台备好一行，`apply()` 里只剩一条防御性早退（某平台连 `shutdown` 行都没有时才触发，目前不可达，`log.platformUnsupported` 保留在文案目录里）。
- **三档实测程度**：Windows **完整验证，含真实执行**；macOS **关机、重启、睡眠、注销四项已真机验证执行成功**（判定闸 → 定时器/补算 → `spawn` → 系统接受 → 机器实际关机 / 重启 / 睡下 / 结束登录会话；Apple Silicon / macOS 27.2 / DSH Desktop），**前提是没有应用阻止**；macOS **不提供真正的休眠**（没有用户级命令，按睡眠处理）、**锁屏不支持**（无可靠 CLI，见下一条）；Linux **六个动作已真机验证执行成功**（Ubuntu 24.04.5 LTS / 桌面会话；`signout` 结束整个登录会话、DSH 随之退出），真实限流 / 超时下的自动重试与插件重载后的武装状态尚未验证。
- macOS 上被拦不是插件的问题：系统会先看有没有应用声明「我正在忙」，终端跑着前台命令、编辑器有未保存文档时，系统就等确认，与手动点苹果菜单「关机」被拦是同一种情况；把前台应用空出来再跑，就能正常关机或重启。要无条件执行得走 root（`shutdown -h now`），**macOS 上**插件刻意不碰提权 —— 提权只出现在 Linux 那条一次性的 `pkexec` 重试（见 CONFIG 4.7）。
  - macOS `lock` 没有可靠 CLI（`displaysleepnow` 只是熄屏，⌃⌘Q 需要辅助功能权限），明确报 `unsupported-on-platform`，不半锁；macOS `hibernate` 没有用户级命令，降级为 `pmset sleepnow`。
  - Linux `signout` 用 `loginctl terminate-user`，会连带结束 DSH 自己（DSH 跑在该用户会话里）。
  - 非 win32 上凡是能解析到命令的动作，可用性一律报 `'unknown'`：TCC / polkit 可能在最后一刻拒绝，报 `true` 就是撒谎。`actionReadyNow()` 只把 `false` 当不可用，所以 `'unknown'` **是可武装的** —— 它表示「系统仍是否决方」，不是坏了。
- 不修改 `app.asar` 与 DSH 源码，全部通过槽位与事件挂载。
- 零运行时依赖：服务端只用 `node:fs` / `node:path` / `node:crypto`，浏览器侧只 `require('react')`。
- 日志走 `log(message, kind)`，不用 `console.log`。

## 8. 目录职责

```
lib/          源码真相：宿主、卡片、i18n
cordis.patch.yml  出厂 patch
test/         断言（host.test.mjs / client.test.cjs）
scripts/      截图、演示页、图标、发布辅助
docs/         面向维护者的文档：ARCHITECTURE、CONFIG、DEVELOPING、BETA、RELEASE-NOTES-STYLE；前四篇各有中文、`.en.md` 英文版与 `.ru.md` 俄文版（RELEASE-NOTES-STYLE 只有中文）
data/         运行时数据（config.json / ui.json / events.log / scripts/），不提交
```

`data/scripts/` 放全局脚本库里那些文件的正文，文件名是 `<scriptId>.<ext>`，由宿主生成。它就在**插件包目录内部**（`PLUGIN_DIR/data/scripts`，与 `config.json`、`events.log` 同层）：`data/` 没被打进 npm 包，但覆盖升级会替换整个包目录，所以升级前要先备份 —— 这一点与「文件尽量放包外」的初衷相反，是目前已知的取舍。脚本正文不进 `config.json`，库里只留 `sha256`、大小、显示名这些元数据。

`preview/` 是设计过程稿，不是当前实现；`docs/screenshots/` 是脚本产物。
