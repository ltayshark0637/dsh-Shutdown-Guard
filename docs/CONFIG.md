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
  "version": 4,
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
| `version` | 数字 | `4` | schema 版本；v1.6.1 从 2 升到 4（3 是开发期过渡形状，从未发布） |
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
| `script` | 对象 \| null | `null` | 上传脚本的元数据（`name` / `ext` / `file` / `bytes` / `sha256` / `savedAt`）；正文在磁盘上，不在配置里 |
| `scriptAck` | 对象 \| null | `null` | 用户对**这一份**脚本的确认：`{ sha256, at }` |
| `shutdownOnHalt` | bool | `true` | 熔断（`halted`）之后是否仍执行动作 |

- `script` 与 `scriptAck` 只在 `action: custom` 时有意义；`scriptAck.sha256` 必须等于 `script.sha256`，否则拒绝武装（`script-not-acknowledged`），细节见 4.3。
- `shutdownOnHalt: false` 表示「熔断后不动作」；默认 `true` 与旧行为一致（熔断只是不再等条件，不改变动作本身）。
- 这四项都进 `PROFILE_PATCH_FIELDS`，因此可以按 profile 分别设。注意 `shutdownOnHalt` **不在**默认 profile 的锁定字段里（锁定的是 `countdownSec`、`marginSec`、`onlyOnSuccess`、`blockOnJobs`、`afkAutoAnswer`），所以默认 profile 也能改它。

## 4. `action`：到点做什么

八个 id，**七个可用**；`restart-dsh` 列出但置灰。

| id | win32 | macOS | Linux |
| --- | --- | --- | --- |
| `shutdown` | `shutdown /s /t 0` | `osascript` 关机 | `systemctl poweroff` |
| `restart` | `shutdown /r /t 0` | `osascript` 重启 | `systemctl reboot` |
| `hibernate` | `shutdown /h` | 无用户级休眠命令，**降级为睡眠**（`pmset sleepnow`） | `systemctl hibernate` |
| `sleep` | `rundll32 powrprof.dll,SetSuspendState` | `pmset sleepnow` | `systemctl suspend` |
| `lock` | `rundll32 user32.dll,LockWorkStation` | **不支持**（没有受支持的 CLI） | `loginctl lock-session` |
| `signout` | `shutdown /l` | `osascript` 注销 | `loginctl terminate-user`，**会连带结束 DSH 自己**（DSH 跑在该用户会话里） |
| `restart-dsh` | **列出但当前不可选** | 同左 | 同左 |
| `custom` | 执行**用户上传的脚本**（见 4.1） | 同左 | 同左 |

- 所有动作都是 **inline**：倒计时由插件自己数，到点**只发一次**、发出去就是立即执行。取消 = 什么都不发。
- 代价：倒计时期间 DSH 被杀掉或崩溃，动作**不会**执行。旧实现用系统定时器（`shutdown /t N`），那种情况仍会关。这是刻意的取舍 —— 宁可漏关，也不错关。
- 未知 `action` 回落 `shutdown`：配置写坏也不会出现「武装着却没有任何动作」的状态。
- **`restart-dsh` 为什么置灰**：重启 DSH 要走 `app.relaunch()`，那是 Electron 主进程的能力，插件没有路径够到它；`process.exit()` 会跳过宿主清理、可能损坏正在跑的会话，所以刻意不做。保留这个 id 是为了让配置文件可读、将来宿主开放接口时直接点亮。

### 4.1 自定义动作 = 上传一个脚本文件

`custom` 不再填命令行，**而是上传文件**：

```http
POST /config
{ "putScript": { "profileId": "p1", "name": "收工清理", "ext": "ps1", "content": "<脚本正文>" } }
```

| 字段 | 约束 |
| --- | --- |
| `profileId` | 必须是已存在的 profile |
| `name` | 显示名，去空白后 1–40 字符；随便叫什么都不会变成路径 |
| `ext` | 白名单 `js` / `cmd` / `bat` / `py` / `ps1`，其余 400 |
| `content` | UTF-8 文本，**上限 256 KiB**（按字节算，不是字符）；超限 400 |

- 成功后该 profile 的 `action` **强制设为 `custom`** —— 上传脚本的意图就是用它。
- 删除脚本：把 `script` 置 `null`（`{"profileId":"p1","patch":{"script":null}}`）。
- 存储位置：`<DATA_DIR>/scripts/<profileId>.<ext>`。**不在 npm 包目录**：包目录在升级时会被整体替换、安装后通常不可写；`DATA_DIR` 才是插件的可写目录（`config.json`、`events.log` 也在这里）。
- 文件名由**宿主**生成，用户输入不参与拼路径，规避路径穿越；每个 profile 只留一份，换文件即覆盖。
- 脚本正文**永不**进 `config.json`、事件日志或 `/state` —— 这些地方只有元数据。

脚本在 profile 里的形状：

```json
"script": { "name": "收工清理", "ext": "ps1", "file": "p1.ps1", "bytes": 412, "sha256": "9f2c…", "savedAt": 1762500000000 }
```

没有脚本时为 `null`。

### 4.2 执行映射

| `ext` | 实际命令 | 说明 |
| --- | --- | --- |
| `cmd` / `bat` | `cmd /c <path>` | Windows 的 `CreateProcess` 不执行脚本文件，必须套 `cmd` |
| `ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <path>` | 不读用户的 PowerShell profile，策略绕过只作用于这一次 |
| `py` | `python <path>`，回退 `python3` | 两者都找不到 → `missing-interpreter` |
| `js` | `node <path>` | 找不到 node → `missing-interpreter` |

解释器探测复用动作能力探测（`subprocess.resolveExecutable`），结果落进 `/state.actions.custom`。缺解释器或没有脚本时，动作区显示不可用并给出原因，武装会被拒。

### 4.3 确认绑定到脚本内容

profile 里还有一项 `scriptAck: { "sha256": "9f2c…", "at": 1762500100000 } | null`。

- **武装前必须满足 `scriptAck.sha256 === script.sha256`**，否则拒绝武装，原因是 `script-not-acknowledged`。
- 脚本内容一变（重新上传、换了文件），`sha256` 就变，**此前的确认自动失效**，必须重新勾选。只改显示名不影响 `sha256`，确认继续有效。
- 这条防的是「确认过一次，之后把文件换成别的」—— 只勾一次终身有效的确认，等于没有确认。

### 4.4 能力探测与三态

挂载时探一次，之后只在 `POST /config {recheck:true}` 时重探，**不轮询**。`/state.actions` 的每一项是 `{ available, reason }`：

| `available` | 含义 |
| --- | --- |
| `true` | 命令能解析，且系统后面没有别的否决环节（win32 的 `shutdown` 一类） |
| `false` | 本平台没有诚实的命令、命令不存在、缺少解释器、没有脚本或被确认拦住 |
| `'unknown'` | 命令存在，但 macOS（TCC）或 Linux（polkit）可能在最后一刻拒绝 —— 这时报 `true` 就是撒谎 |

非 win32 上所有可解析的命令一律报 `'unknown'`，不是 `true`。
重测时如果**当前选中的动作**掉成不可用，宿主只打标记（`/state.actionReady === false`，卡片与设置页给出提示），**不改用户选的动作**。

### 4.5 `reason` 枚举

`/state` 只发协议字符串，设置页负责翻成人话。

| 值 | 什么时候出现 |
| --- | --- |
| `no-script` | `action: custom` 但还没上传脚本 |
| `missing-interpreter` | 脚本在，但 `python` / `python3` / `node` / `powershell` 一个都找不到 |
| `needs-elevation` | 内置动作在非 win32 上就用它：可用性报 `'unknown'`、原因给这个 —— 命令找到了，但 TCC / polkit 可能要求授权 |
| `unsupported-on-platform` | 本平台没有诚实的做法（macOS 的 `lock`） |
| `no-host-restart` | `restart-dsh`：够不着 Electron 的 `app.relaunch()` |
| `script-not-acknowledged` | 脚本的 `sha256` 与 `scriptAck` 不一致，需重新确认 |
| `no-cli` | 探测阶段找不到可执行文件（`argvReachable` 的失败值；macOS 的图标/路径问题也落这里） |
| `no-session` | 枚举里保留，当前没有任何路径会产出它（会话不可用的旧分支） |

`no-custom-command` 这个旧值已删除（它属于被替换掉的命令行模型，从未发布过）。

### 4.6 Windows 上四种脚本各是什么效果

用户只需要上传文件，不写任何路径 —— 路径由宿主生成。

| 上传的扩展名 | 需要机器上有 | 一个典型脚本的效果 |
| --- | --- | --- |
| `.cmd` / `.bat` | 无（`cmd.exe` 一定有） | 关掉浏览器、把日志打包、最后 `shutdown /s /t 0` |
| `.ps1` | PowerShell | 同上，但能直接调 .NET / COM，比如给某个服务发停止信号 |
| `.py` | `python` 或 `python3` | 走 HTTP 通知、清理临时目录 |
| `.js` | `node` | 本地文件整理、调 `fetch` 发消息 |

注意：脚本以**当前用户权限**运行，插件不审查内容，也不对其安全性作担保 —— 这也是为什么武装前必须确认免责文案（见 4.3）。

## 5. 端点

前缀 `/api/dsh-shutdown-guard`，仅本机可用。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/state?since=<ms>` | 完整状态 + 增量事件 |
| GET | `/events?since=&limit=` | 事件流水 |
| POST | `/arm` `/disarm` `/cancel` | 武装 / 解除 / 取消本次倒计时 |
| POST | `/config` | 改**行为**：profile、开关、语言、上传/删除脚本 |
| POST | `/ui` | 改**外观**：卡片样式、主题、语言、悬浮窗简洁模式 |

`/config` 与 `/ui` 是同一条 HTTP 服务上的两个写入口，分工按「行为 / 外观」切，因为两层数据存在不同的文件里、也由不同的界面消费：

- `/config` 写 `data/config.json`。接受 `customEnabled`、`activeProfileId`、`language`、`profileId` + `patch`（以及顶层的 `afkAutoAnswer`），另有 `putScript` 上传脚本与 `recheck:true` 重测动作能力（见 4.1、4.4）。
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

## 8. schema 迁移

- 当前 `CONFIG_VERSION = 4`。读取时先看 `version`：比 4 小的都按旧结构解析，随后写回 `version: 4`。
- v2 → v3 引入了 `parked` 与按 profile 的通知开关；v3 → v4 用**脚本**取代了从未发布过的 `customArgv`（那个字段只在 1.6.1 的在制分支里短暂存在，没有任何已发布版本写过它，所以不做搬运）。
- 旧结构里的 `profiles[]` 原样保留：不改 id、不拆分、不重排，**你手改过的值不会丢**。
- 新增字段（`action`、`script`、`scriptAck`、`shutdownOnHalt`）缺失时按默认值补齐：`shutdown` / `null` / `null` / `true`。
- v2 文件没有 `parked` 字段，读回即 `null`（等价于「没有熔断现场」）；没有需要搬运的旧状态。
- `afkAutoAnswer`、`notify` 这类曾经同时存在于顶层与 profile 的键，以 profile 内的值为准，顶层旧值只在没有 profile 值时才被采用。
- 升级时，从未动过的空 profile 槽会被清理；改过名字或动过任一开关的 profile 一定保留。

## 9. 事件日志

`data/events.log` 是人可读的追加流水，按 `config` / `afk` / `skip` 分类，设置页「状态」标签的「事件日志」读的就是它。进程级日志另在 `<DSH_HOME>\dsh-shutdown-guard.log`。
