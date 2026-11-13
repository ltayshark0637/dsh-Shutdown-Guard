# 配置字段

> **中文** · [English](CONFIG.en.md) · [Русский](CONFIG.ru.md)

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
  "version": 5,
  "activeProfileId": "default",
  "customEnabled": false,
  "lastCustomProfileId": null,
  "language": "auto",
  "parked": null,
  "scriptSeq": 2,
  "scripts": [ { "id": "s1", "…": "…" } ],
  "profiles": [ { "id": "default", "…": "…" } ]
}
```

| 顶层键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `version` | 数字 | `5` | schema 版本；v1.6.1 从 2 到 4，脚本库把它推到 5 |
| `activeProfileId` | string | `default` | 当前生效的 profile id |
| `customEnabled` | bool | `false` | 是否允许使用自定义 profile |
| `lastCustomProfileId` | string \| null | `null` | 关掉再打开时要回到的那份 |
| `language` | 枚举 `auto` / `zh` / `en` / `ru` | `auto` | 界面语言，`auto` 跟随系统 |
| `parked` | 对象 \| null | `null` | 熔断现场，见本节下面的 `### parked`；唯一写进配置文件的**运行时状态** |
| `scriptSeq` | 数字 | `0` | 脚本 id 的发号器，只增不减；删掉的 id 不会被复用 |
| `scripts` | 数组 | `[]` | **全局共享**的脚本库，每项只存元数据，见 `### scripts[]` |
| `profiles` | 数组 | 一份 `default` | 每份是一个行为快照 |

### `scripts[]`：全局脚本库

脚本从「每份配置一个字段」变成了**顶层共享库**：一份文件在库里只有一条记录，任意多份 profile 通过 `scriptId` 指向它；确认一次，所有指向它的 profile 都算确认过。

```json
{
  "id": "s1",
  "name": "收工清理",
  "ext": "ps1",
  "file": "s1.ps1",
  "bytes": 412,
  "sha256": "9f2c…",
  "savedAt": 1762500000000,
  "ack": { "sha256": "9f2c…", "at": 1762500100000 }
}
```

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `s1` / `s2` … | 由 `scriptSeq` 发号，永不复用；读回时必须是 `^s[1-9][0-9]*$`，否则整条丢弃 |
| `name` | string | 显示名，1–40 字符；只影响界面，不参与拼路径 |
| `ext` | 枚举 `js` / `cmd` / `bat` / `py` / `ps1` | 决定用哪个解释器 |
| `file` | string | **必须**正好是 `<id>.<ext>`，否则整条丢弃 —— 手改配置不能把运行器指向任意路径 |
| `bytes` | 数字 | 文件字节数，仅用于显示 |
| `sha256` | 64 位十六进制 | 入库时的内容哈希，也是确认挂靠的东西 |
| `savedAt` | 数字 | 入库时间戳 |
| `ack` | 对象 \| null | `{ sha256, at }`；`sha256` 与记录不一致时读回即丢弃（视为没确认） |

- 正文**只**在磁盘：`<插件目录>/data/scripts/<scriptId>.<ext>`（即 `DATA_DIR/scripts`），不进 `config.json`、事件日志或 `/state`。**该目录在插件包目录内部**，没被打进 npm 包，但 `npm i` 覆盖升级会替换整个包目录 —— 升级前先备份 `data/config.json` 与 `data/scripts/`。
- 文件被删、被手改成别的字节，记录本身不会自动消失：前者让 `custom` 报 `no-script`，后者让 `custom` 报 `script-not-acknowledged`（见 4.5）。
- 一份 profile 只记 `scriptId`（`null` = 没选脚本）；`script` / `scriptAck` 这两个旧字段**已经不存在**，写它们会被 400 拒绝（见 4.1）。

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

**磁盘上用户存的值永不被改写**，所以母开关来回切不会丢掉用户原来的选择；设置页在母开关关掉时只是把控件变成不可点（值仍然保留）。

## 3. profile 字段

每份 profile 各存一份，互不影响。

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `countdownSec` | 数字 10–600 | `60` | 关机前倒计时秒数。**默认 profile 锁定为 60** |
| `marginSec` | 数字 0–60 | `5` | 命令发出后、卡片切到「已下发」前的额外停留秒数（另加固定 5 秒）；不改变命令发出的时刻，与系统定时器无关，见 ARCHITECTURE 第 3 节。**默认 profile 锁定为 5** |
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
| `scriptId` | string \| null | `null` | 指向顶层 `scripts[]` 里的一条；脚本正文与确认都在那条记录上 |
| `shutdownOnHalt` | bool | `true` | 熔断（`halted`）之后是否仍执行动作 |

- `scriptId` 只在 `action: custom` 时有意义；指向的条目不存在会被读成 `null`（`no-script`），细节见 4.3。
- `shutdownOnHalt: false` 表示「熔断后不动作」；默认 `true` 与旧行为一致（熔断只是不再等条件，不改变动作本身）。
- 这几项都进 `PROFILE_PATCH_FIELDS`，因此可以按 profile 分别设。注意 `shutdownOnHalt` **不在**默认 profile 的锁定字段里（锁定的是 `countdownSec`、`marginSec`、`onlyOnSuccess`、`blockOnJobs`、`afkAutoAnswer`），所以默认 profile 也能改它。
- `script` 与 `scriptAck` **不再是 profile 字段**：v5 之前它们存在过，迁移时被搬进脚本库（见第 8 节）；现在通过 `patch` 写这两个键一律 400。

## 4. `action`：到点做什么

八个动作 id 都存在，而且**都能用**；菜单里能不能看到，取决于这台机器与开关（见下一段）。

**默认可见范围**：未开启「自定义配置」时，**Windows 上**只有「自定义脚本」需要这个开关 —— 锁屏走 `rundll32 user32.dll,LockWorkStation`、注销走 `shutdown /l`，都是以你自己的权限跑的普通命令，可以直接选；**macOS / Linux 上**锁屏、注销、自定义脚本三项仍由开关控制，因为这三项要借桌面自己的工具（`pmset`、`loginctl`、`osascript`），环境差异太大。开启后「自定义脚本」整块（选择文件、显示名、警示与确认）才出现在设置页；动作没选「自定义脚本」时，这一整块也不出现。

**当前系统做不了的动作不会出现在菜单里**，不会留成一条点不动的条目。只能探测到 `'unknown'` 的动作（macOS / Linux 上的系统动作）仍然可选：能不能执行由系统在那一刻决定，失败了会在卡片上写明原因。若某份配置里存的仍是 `custom` 而开关已经被关掉，下拉顶端会留一条不可选的「自定义脚本（不可用）」占位，改成任一在列动作后自动消失 —— 这样不会出现「下拉空白、什么也不显示」的假象。

| id | win32 | macOS | Linux |
| --- | --- | --- | --- |
| `shutdown` | `shutdown /s /t 0` | `osascript` 关机 | `systemctl poweroff` |
| `restart` | `shutdown /r /t 0` | `osascript` 重启 | `systemctl reboot` |
| `hibernate` | `shutdown /h` | 无用户级休眠命令，**降级为睡眠**（`pmset sleepnow`） | `systemctl hibernate` |
| `sleep` | `rundll32 powrprof.dll,SetSuspendState` | `pmset sleepnow` | `systemctl suspend` |
| `lock` | `rundll32 user32.dll,LockWorkStation` | **不支持**（没有受支持的 CLI） | `loginctl lock-session` |
| `signout` | `shutdown /l` | `osascript` 注销 | `loginctl terminate-user`，**会连带结束 DSH 自己**（DSH 跑在该用户会话里） |
| `restart-dsh` | 结束宿主进程再把它拉起来（桌面端整个应用退出后自己回来） | 同左 | 同左 |
| `custom` | 执行**用户上传的脚本**（见 4.1） | 同左 | 同左 |

- 所有动作都是 **inline**：倒计时由插件自己数，到点**只发一次**、发出去就是立即执行。取消 = 什么都不发。
- 代价：倒计时期间 DSH 被杀掉或崩溃，动作**不会**执行。旧实现用系统定时器（`shutdown /t N`），那种情况仍会关。这是刻意的取舍 —— 宁可漏关，也不错关。
- 未知 `action` 回落 `shutdown`：配置写坏也不会出现「武装着却没有任何动作」的状态。
- **`restart-dsh` 是怎么做的**：插件不调宿主内部接口，而是在插件数据目录写一个一次性的小脚本，先结束宿主进程、再用同一个可执行文件把它拉回来；桌面端是应用整个退出再启动，命令行下就是同一条命令带原来的参数重启。过程写进 `data/restart.log`，结果写进 `data/restart.status`，下次启动读到后会在事件日志里记一条「重启已完成」。本机装了 `dsh-autorestart` 时，重启这件事归它管，本插件不再插手 —— 两个重启器会抢同一个进程。

### 4.1 自定义动作 = 从脚本库挑一个文件

`custom` 不填命令行，执行的是**脚本库**里的一条。库是全局的：一次上传只有一条记录，很多份 profile 可以各自指向它。

```http
POST /config
{ "putScript": { "name": "收工清理", "ext": "ps1", "content": "<脚本正文>" } }
```

| 字段 | 约束 |
| --- | --- |
| `name` | 显示名，去空白后 1–40 字符；随便叫什么都不会变成路径 |
| `ext` | 白名单 `js` / `cmd` / `bat` / `py` / `ps1`，其余 400 |
| `content` | UTF-8 文本，**上限 256 KiB**（按字节算，不是字符）；超限 400 |
| `profileId` | **可选**。给了就顺手把这条选给该 profile，并把它的 `action` 设成 `custom`；不给就只是入库 |

- **去重**：同 `sha256` 且同 `ext` 的库条目会被复用，响应里带 `reused: true`，**不覆盖**已有条目的 `name`（重复上传不能悄悄给别人改名字）。
- 条目存在但磁盘文件被手改过/删掉了，重传同样的内容会**修复文件**而不是再存一份。
- 存储位置：`<插件目录>/data/scripts/<scriptId>.<ext>`（`PLUGIN_DIR/data/scripts`，`config.json` 与 `events.log` 也在同一个 `data/` 下）。**这里是插件包目录内部**：`data/` 没被打进 npm 包，但覆盖升级会替换整个包目录，所以升级前要先备份。
- 文件名由**宿主**生成（`<scriptId>.<ext>`），用户输入不参与拼路径，规避路径穿越。
- 脚本正文**永不**进 `config.json`、事件日志或 `/state` —— 这些地方只有元数据。
- 整个请求体上限 **1 MiB**（`BODY_LIMIT`）：`/config` 以前只带小补丁时是 8 KiB，脚本走 JSON 文本、转义后体积约翻倍，所以放宽了；超过会直接断开连接而不是返回 413。

库的其余操作都在 `POST /config` 上，一次请求里只处理一个键：

| 键 | 请求体 | 行为 |
| --- | --- | --- |
| `selectScript` | `{ profileId, scriptId }` | 把某条选给该 profile（`scriptId: null` = 取消选择）；选了就会把 `action` 设成 `custom`，未知 id 报 400 `unknown script` |
| `renameScript` | `{ scriptId, name }` | 只改显示名，1–40 字符；不影响 `sha256`，确认继续有效 |
| `deleteScript` | `{ scriptId }` | 删条目与磁盘文件；**允许删还有 profile 在用的**，那些 profile 退回没选脚本，响应里 `affected` 是受影响的 profile 数 |
| `ackScript` | `{ scriptId }` | 记下「我确认过这份内容」，`ack` 由宿主按当前 `sha256` 重算写入 |
| `unackScript` | `{ scriptId }` | 撤回确认 |

条目的形状见第 2 节 `### scripts[]`。profile 里只存 `scriptId`。

### 4.2 执行映射

| `ext` | 实际命令 | 说明 |
| --- | --- | --- |
| `cmd` / `bat` | `cmd /c <path>` | Windows 的 `CreateProcess` 不执行脚本文件，必须套 `cmd` |
| `ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <path>` | 不读用户的 PowerShell profile，策略绕过只作用于这一次 |
| `py` | `python <path>`，回退 `python3` | 两者都找不到 → `missing-interpreter` |
| `js` | `node <path>` | 找不到 node → `missing-interpreter` |

解释器探测复用动作能力探测（`subprocess.resolveExecutable`），结果落进 `/state.actions.custom`。缺解释器或没有脚本时，动作区显示不可用并给出原因，武装会被拒。

### 4.3 确认挂在库里那一条的字节上

确认属于库条目（`scripts[].ack`），不属于 profile：

- **武装前必须满足 `ack.sha256 === 该条目的 sha256`**，否则拒绝武装，原因 `script-not-acknowledged`。
- 条目内容一变（重新上传成不同字节），`sha256` 就变，**此前的确认自动失效**，必须重新确认。只改显示名不影响 `sha256`，确认继续有效。
- 如果磁盘上的文件被手改，字节与记录的 `sha256` 对不上，同样报 `script-not-acknowledged` —— 确认的是内容，不是文件名。
- 确认一次，所有指向这条的 profile 都算确认过；撤回一次，它们全都失去确认。
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
| `no-custom-profile` | 未开启「自定义配置」时不可用：Windows 上只有 `custom` 会命中这条；macOS / Linux 上还包括 `lock` 与 `signout` |
| `no-script` | `action: custom` 但没选脚本，或选中的条目文件已经被删掉 |
| `missing-interpreter` | 脚本在，但 `python` / `python3` / `node` / `powershell` 一个都找不到 |
| `needs-elevation` | 内置动作在非 win32 上就用它：可用性报 `'unknown'`、原因给这个 —— 命令找到了，但 TCC / polkit 可能要求授权。**这是「无法可靠探测时的保守标注，不是检测结果」**：不能读成「需要 sudo」；实测 Ubuntu 24.04.5 LTS 桌面上六个动作都不需要额外提权即可执行 |
| `unsupported-on-platform` | 本平台没有诚实的做法（macOS 的 `lock`） |
| `no-host-restart` | `restart-dsh`：当前环境找不到能安全重启的宿主可执行文件 |
| `host-restart-taken` | `restart-dsh`：本机装了 `dsh-autorestart`，重启归它管，这里不再重复 |
| `script-not-acknowledged` | 没确认过，或确认的字节与当前不一致 —— 包括磁盘文件被手改成别的字节 |
| `no-cli` | 探测阶段找不到可执行文件（`argvReachable` 的失败值；macOS 的图标/路径问题也落这里） |
| `no-session` | 枚举里保留，当前没有任何路径会产出它（会话不可用的旧分支） |

`no-custom-command` 这个旧值已删除（它属于被替换掉的命令行模型，从未发布过）。

`no-custom-profile` 的边界：它只由「自定义配置」这一个开关（加上平台差异）决定，和「有没有配好」无关。Windows 上只有 `custom` 会命中它；macOS / Linux 上还有 `lock` 与 `signout`。`custom` 在开关打开之后、如果还没上传脚本，报的是 `no-script` —— 一个说「这个动作在这台机器上不开放」，一个说「开放了但你还没准备」，两者不能混为一谈。

### 4.6 Windows 上四种脚本各是什么效果

用户只需要上传文件，不写任何路径 —— 路径由宿主生成。

| 上传的扩展名 | 需要机器上有 | 一个典型脚本的效果 |
| --- | --- | --- |
| `.cmd` / `.bat` | 无（`cmd.exe` 一定有） | 关掉浏览器、把日志打包、最后 `shutdown /s /t 0` |
| `.ps1` | PowerShell | 同上，但能直接调 .NET / COM，比如给某个服务发停止信号 |
| `.py` | `python` 或 `python3` | 走 HTTP 通知、清理临时目录 |
| `.js` | `node` | 本地文件整理、调 `fetch` 发消息 |

注意：脚本以**当前用户权限**运行，插件不审查内容，也不对其安全性作担保 —— 这也是为什么武装前必须确认免责文案（见 4.3）。

### 4.7 Linux 上的提权重试

只有 Linux 有这一层。`shutdown` / `restart` / `sleep` / `hibernate` / `lock` / `signout` 之一**首次以非 0 退出**时，宿主会用 `pkexec` 重试**一次**：

- `pkexec` 通过 polkit 申请授权、以 root 身份执行同一条命令，可能弹出认证框；单次等待上限 120 秒（普通动作是 15 秒）。
- 成功的命令（退出码 0）**绝不**重发 —— 一次关机不会被送两遍。
- `custom` 脚本**永不**提权：那是用户自己的脚本，始终以当前用户身份运行。

风险写在明面上：这套重试的前提是「非 0 退出＝没执行成功」。如果某条命令**已经产生了副作用却仍返回非 0**，理论上会被执行两次 —— 极端情况下确实可能重复执行一次关机或注销。之所以接受它，是因为半途失败的关机更需要那次提权尝试，而多送一次关机相比机器永远关不掉，代价更低。

## 5. 端点

前缀 `/api/dsh-shutdown-guard`，仅本机可用。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/state?since=<ms>` | 完整状态 + 增量事件 |
| GET | `/events?since=&limit=` | 事件流水 |
| POST | `/arm` `/disarm` `/cancel` | 武装 / 解除 / 取消本次倒计时 |
| POST | `/unblock` | 只清除阻断（熔断与等待重试都算），不改变武装状态；无阻断时返回 200 且不写事件 |
| POST | `/config` | 改**行为**：profile、开关、语言、上传/删除脚本 |
| POST | `/ui` | 改**外观**：卡片样式、主题、语言、悬浮窗简洁模式 |

`/config` 与 `/ui` 是同一条 HTTP 服务上的两个写入口，分工按「行为 / 外观」切，因为两层数据存在不同的文件里、也由不同的界面消费：

- `/config` 写 `data/config.json`。接受 `customEnabled`、`activeProfileId`、`language`、`profileId` + `patch`（以及顶层的 `afkAutoAnswer`），另有脚本库一族键：`putScript`、`selectScript`、`renameScript`、`deleteScript`、`ackScript`、`unackScript`（见 4.1），以及 `recheck:true` 重测动作能力（见 4.4）。
- `/ui` 写 `data/ui.json`。接受 `variant`（`A`/`B`/`C`）、`theme`（`auto`/`dark`/`light`/`claude`）、`lang`（`auto`/`zh`/`en`/`ru`）、`compact`（布尔）。
- `/ui` 拒绝 `notify`：通知是行为不是外观，返回 `400 {"error": "notify belongs to the active profile; use /config updateProfile"}`。

**默认 profile 是锁的**。往 `default` 上写下面任一字段会得到 400：

```
{"error": "default profile is locked: <field> cannot change"}
```

`<field>` 取值：`countdownSec`、`marginSec`、`onlyOnSuccess`、`blockOnJobs`、`afkAutoAnswer`。要改这些，先新建一份自定义 profile。

其他错误：非法语言 `400 unknown language`、未知 profile `400 unknown profile`、未知脚本 `400 unknown script`、非本机 Origin 的 POST `403`、非 POST 方法 `405`。

写旧字段会被明确拒绝（而不是静默忽略，否则 beta 客户端会以为自己上传/确认成功了）：

| 写入 | 返回 |
| --- | --- |
| `patch.script` | `400 script must be uploaded through the script library` |
| `patch.scriptAck` | `400 scriptAck can only be written by acknowledging a library script` |

### `/state` 里与动作层相关的字段

| 字段 | 形状 | 说明 |
| --- | --- | --- |
| `actions` | `{ [id]: { available, reason } }` | 8 个 id 全列出，含连字符的 `restart-dsh`；挂载后首次探测前为 `{}` |
| `actionReady` | bool | 当前 profile 的 `action` 是否可用（`available !== false`）；`'unknown'` 视为可用 |
| `script` | 对象 \| null | 当前 profile 选中的那条的元数据（`name` / `ext` / `bytes` / `sha256` / `savedAt`）；**不含正文、不含文件名** |
| `scriptAckOk` | bool | 当前选中的那条是否已确认且字节一致 |
| `scripts` | 数组 | 整个脚本库的元数据，每项 `{ id, name, ext, bytes, sha256, savedAt, ackOk, ackAt, usedBy }`；同样永不含正文 |
| `lastAction` | 对象 \| null | 本进程最后一次真正下发的命令，仅用于诊断；`{ action, at, argv, code, failed, error?, elevated? }` |
| `lastAction.failed` | bool | 那次命令的失败判定：退出码非 0，或 spawn 本身报错。命令「跑了」与「成功」是两回事，这个字段只回答后者 |
| `lastAction.elevated` | bool（可缺省） | 仅当发生了 Linux 上那次 `pkexec` 提权重试时为 `true`；没重试时这个键不出现，不要读成 `false` |
| `parkedAt` | 数字 \| null | 熔断开始时间（`halted` 才有），见第 2 节 |
| `shutdownOnHaltEffective` | bool | 见第 2 节的派生规则 |

`profiles[]` 里的 `script` / `scriptAck` 是**兼容投影**：按该 profile 的 `scriptId` 从库里取出来拼上，方便设置页渲染单行而不必遍历 `scripts[]`；权威数据在顶层 `scripts[]`。

手动重测入口是 `POST /config {"recheck": true}`：立即重跑一次能力探测并刷新 `actions`，**不做轮询**。

### `/arm` 的拒绝契约

动作不可运行时，`POST /arm` **不**先武装再失败，而是直接拒绝，返回 **409**，body 是 `{ error: <reason>, ...statePayload() }` —— 也就是说被拒时你仍然拿到一份完整状态，`armed` 保持 `false`。`error` 的取值来自 `armRefusal()`：

| `error` | 什么时候 |
| --- | --- |
| `no-script` | `action: custom`，但没选脚本或选中的文件已被删掉 |
| `script-not-acknowledged` | 选中的脚本没确认过，或磁盘上的字节与确认的不一致 |
| 该动作的探测 `reason` | 探测阶段就判了不可用（如 `no-script`、`missing-interpreter`、`no-cli`；`no-custom-profile` 只在该动作受开关控制时出现） |
| `action-unavailable` | 兜底：拿不到具体原因，但动作确实不可运行 |

界面侧据此把「拒绝原因」直接显示出来，而不是显示一个假装武装成功的开关。

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

**定时器不可用时不承诺重试**：如果宿主给不出定时能力，`retryAt` 直接置 `0`，事件日志记一条 `log.retryUnavailable`，界面不再显示「N 秒后重试」。宁可显示「不会自动重试」，也不要显示一个永远不会到来的倒计时。

## 7. 界面偏好存在哪

| 偏好 | 存哪 | 键 |
| --- | --- | --- |
| 卡片样式 / 主题 / 折叠 | 浏览器 `localStorage` | `dsh-shutdown-guard.variant` / `.theme` / `.folded` |
| 语言 / 悬浮窗简洁模式 / 四类通知 | 宿主 | `data/ui.json`（`notify` 实际落在 profile 里） |
| profile 相关的全部行为 | 宿主 | `data/config.json` |

`localStorage` 按存储分区隔离（侧边栏与悬浮窗可能不在同一个分区），所以语言、简洁模式这类「两个界面必须一致」的状态由宿主持有，并在每份 `/state` 里以 `ui` 下发；`localStorage` 只在首屏做一次兜底。

## 8. schema 迁移

- 当前 `CONFIG_VERSION = 5`。读取时先看 `version`：比 5 小的都按旧结构解析，随后写回 `version: 5`。
- v2 → v3 引入了 `parked` 与按 profile 的通知开关；v3 → v4 用**脚本**取代了从未发布过的 `customArgv`（那个字段只在 1.6.1 的在制分支里短暂存在，没有任何已发布版本写过它，所以不做搬运）；v4 → v5 把「每份 profile 一个脚本」搬进**顶层共享库**。
- **v4 → v5 的搬迁**（2 / 3 / 4 都能直接升到 5）：
  - 每份 profile 的 `script` 元数据变成库里的一条，文件从 `<profileId>.<ext>` 改名为 `<scriptId>.<ext>`，profile 只留 `scriptId`。
  - **同 `sha256` 且同 `ext` 的旧文件合并成一条**，重复的副本文件删掉；确认状态（`scriptAck`）保留到合并后的那条上。
  - 搬迁完成后**立刻写盘**：`scripts[]` 与改名后的文件必须一起落盘，只等用户下次写操作的话，中途被杀就会留下没人认领的文件。
- 旧结构里的 `profiles[]` 原样保留：不改 id、不拆分、不重排，**你手改过的值不会丢**。
- 新增字段（`action`、`scriptId`、`shutdownOnHalt`、`scripts`、`scriptSeq`）缺失时按默认值补齐：`shutdown` / `null` / `true` / `[]` / `0`。
- v2 文件没有 `parked` 字段，读回即 `null`（等价于「没有熔断现场」）；没有需要搬运的旧状态。
- `afkAutoAnswer`、`notify` 这类曾经同时存在于顶层与 profile 的键，以 profile 内的值为准，顶层旧值只在没有 profile 值时才被采用。
- 升级时，从未动过的空 profile 槽会被清理；改过名字或动过任一开关的 profile 一定保留。
- 迁移是逐字段进行的、可重复：`script` 搬走之后字段就不在了，再读一次不会重复入库。

## 9. 事件日志

`data/events.log` 是人可读的追加流水，按 `config` / `afk` / `skip` 分类，设置页「状态」标签的「事件日志」读的就是它。进程级日志另在 `<DSH_HOME>\dsh-shutdown-guard.log`。
