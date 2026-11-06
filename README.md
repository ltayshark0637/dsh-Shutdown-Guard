# Shutdown Guard · 任务完成后关机
**中文** · [English](README.en.md) · [Русский](README.ru.md)

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/banner.png" width="880" alt="Shutdown Guard — 任务完成后自动关机，侧边栏守夜卡片"></p>

[![version](https://img.shields.io/badge/version-1.5.2-2ea44f)](CHANGELOG.md)
[![demo](https://img.shields.io/badge/%E2%96%B6-%E4%BA%A4%E4%BA%92%E6%BC%94%E7%A4%BA-d97757)](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.5--rc.1-4a90d9)](https://github.com/deepseek-ai)
[![platform](https://img.shields.io/badge/platform-Windows-0078d4)](#约束)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dshbase 实装验证](https://dshbase.com/badges/dsh-shutdown-guard.svg)](https://dshbase.com/plugins/dsh-shutdown-guard/) [![awesome-dsh-plugin 收录](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/ltayshark0637/dsh-Shutdown-Guard/)

为 DeepSeek Harness 中的侧边栏添加「所有任务完成后自动关机」卡片，拥有更好且多样的视觉效果、判定逻辑与个性化定制。位于「技能中心」下方、会话列表上方，随任务状态实时变化。

**▶ [交互演示页](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)** —— 不用装插件，先看它长什么样、它怎么判断。左右两页：**了解**（判定、外观、状态）与 **试一试**（随机一个场景，亲手点武装、取消、解除，一路看到关机或阻断）。数据全部本地随机，不联网。

## 为什么需要它

跑长任务的人常有这个场景：晚上让 agent 把一批活干完，想让它干完就关机，人不在跟前。

但「任务结束」不等于「可以关机」——后台任务还在跑、会话报错了、agent 在等你回答问题、你在半路手动终止了……这些情况下关机全是事故。这个插件把这些情况逐个挡下来，只有真的可以关的时候才关。

## 判定：什么时候才关

处于阻断态（见下文）时直接不下发；其余五道闸门同时满足才下发 `shutdown /s`：

1. **已武装** —— 你手动点的
2. **没有倒计时在跑** —— 避免重复下发
3. **所有 root 会话都空闲** —— 没有任何 agent 还在干活
4. **没有运行中 / 停止中的后台任务** —— `blockOnJobs`，默认开
5. **本批次没有会话报错** —— `onlyOnSuccess`，默认开

缺任何一条都不关，并把原因写在卡片和设置页里。

## 三种外观

同一种外观，浅色与深色各一张；三语版本的截图在 `docs/screenshots/` 里按 `<序号>-armed-<外观>-<语言>-<主题>.png` 命名。

| 极简（浅色）                                                                  | 雷达（浅色）                                                          | 终端（浅色）                                                                                     |
|:------------------------------------------------------------------------------:|:-----------------------------------------------------------------------:|:--------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/01-armed-a-zh-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/07-armed-b-zh-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/13-armed-c-zh-light.png" width="250"> |

| 极简（深色）                                                                  | 雷达（深色）                                                          | 终端（深色）                                                                                     |
|:------------------------------------------------------------------------------:|:-----------------------------------------------------------------------:|:--------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/02-armed-a-zh-dark.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/08-armed-b-zh-dark.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/14-armed-c-zh-dark.png" width="250"> |
| 大标题 + 一句话说明，底部滚动的警示带（待命时红黄）                             | 雷达 + 状态行，会话与后台任务以圆点呈现                                | 三行终端：命令、计数、等待，下面六段判定条件指示灯                                            |

雷达里的圆点按数量增删、不重排：数量变化时，你正在看的那几个点不会跳位置。

卡片和悬浮窗底部的警示带都跟着状态走：默认配色下，未武装或被阻断时是同色相的深浅两档，安静不抢眼；从武装开始，一直到真正执行关机为止，回到经典的红黄斜纹。切换是 280ms 的渐变，不会闪。Claude Style 与 DeepSeek 蓝这两档配色不切红黄，全程跟着各自的主题色走——红黄在它们那儿是撞色。

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/anim-radar.gif" width="330" alt="雷达扫描"></p>

在设置的「外观」标签页里，三张缩略图卡片各代表一种外观，点一下立即生效，无需重启；缩略图会跟着当前界面语言与背景深浅自动换成对应的一张。

## 六种运行状态

| 未开启                                              | 待命                                                  | 等待后台任务                                                           |
|:---------------------------------------------------:|:-----------------------------------------------------:|:----------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/01-off.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/02-armed.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/03-hold.png" width="250"> |

| 倒计时                                               | 已下发                                                                  | 阻断                                                                     |
|:----------------------------------------------------:|:-----------------------------------------------------------------------:|:------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/04-fire.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/05-fired.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/08-blocked-halted.png" width="250"> |

`未开启` → `待命` → `等待后台任务` → `倒计时` → `已下发`；任意阶段遇到阻断性错误会进入 `阻断`。倒计时期间随时可取消，**取消后仍保持武装**——下一批任务干完照样会关。

想在这六种状态之间来回看？演示页「了解」第 04 节右上角有 `A` `B` `C` 三枚胶囊，切换的是当前预览用哪种外观。

## 阻断态

| halted · 需人工处理                                            | waiting · 自动重试                                                                |
|:--------------------------------------------------------------:|:---------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/08-blocked-halted.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/09-blocked-waiting.png" width="250"> |

遇到没法当普通失败处理的错误，插件**不解除武装**，卡片转色、把原因写出来：

- **`halted`**（灰蓝）—— 额度不足、凭证失效、上下文超限、能力不支持、磁盘写满。只有人能处理，点「解除并重试」。
- **`waiting`**（灰绿，圆点呼吸）—— 限流、5xx、网络中断、空响应、超时、图片卸载。按策略自动重试，到点注入「继续原计划」指令。

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/anim-blocked.gif" width="380" alt="等待恢复，状态点呼吸"></p>

重试节奏按故障类型分别配置，见 [重试策略](#重试策略)。

## AFK 自动接管

人不在跟前时，插件替你顶三件事：

- **自动回答提问**（默认开）：agent 问你问题时，回复「用户处于 AFK，先完成已交代的任务，汇总报告并落盘，不碰未交代的分支」。返回 `selected: []` + 自定义文本，**不会替你选中任何选项**；关掉后提问照常抛给你。
- **错误恢复**：会话报错时先要求 agent 排查并继续原计划；同一会话再次失败改为「停止重试、写报告收尾」。
- **中断保护**：你在半路手动终止任务，不会触发关机。

## 装在哪里

| 武装时：技能中心下方、会话列表上方                                                          | 倒计时：同一位置，整条转红                                                              |
|:-------------------------------------------------------------------------------------------:|:---------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/10-sidebar-hold.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/11-sidebar-fire.png" width="250"> |

卡片默认固定在侧边栏的这个位置；点卡头右侧的按钮可拉成独立悬浮窗口，切到别的会话也看得见（见下方「其他」）。

## 其他

- **悬浮窗口**：点卡片右上角按钮可把状态面板拉成独立悬浮窗口，切到别的会话也看得见。设置里的「悬浮窗简洁模式」默认开启，只留状态与倒计时；关掉后显示完整面板。

- **纵向折叠**：收起只留标题和状态，点标题展开。

  <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/16-folded.png" width="250" align="right" alt="折叠态">

- **主题自适应**：卡片自带 `--dsp-*` 调色板，按宿主表面亮度自动取深浅色；也可强制锁定深色 / 浅色 / Claude Style 配色。设置页则始终跟宿主主题走。

- **语言**：默认「跟随系统」，取 `LC_ALL` / `LC_MESSAGES` / `LANG`，再退到 `Intl` 区域设置，最后回落 `en`；也可固定为中文 / English / Русский。语言与主题的「跟随」状态由宿主持有，换设备不会各存一份。

- **事件日志**：设置页里能看最近的事件与「上次为什么没关机」，完整流水在 `data/events.log`。

<br clear="all">

## 设置页

| 深色                                                                                          | 浅色                                                                                           |
|:---------------------------------------------------------------------------------------------:|:----------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/12-settings-dark.png" width="380"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/13-settings-light.png" width="380"> |

分四个标签页：**外观** / **守夜** / **通知** / **状态**。打开时停在外观页，所有开关立即生效。

- **外观**：一页五行，没有组标题——三张带缩略图的卡片样式（极简 / 雷达 / 终端，缩略图随界面语言与宿主背景深浅换图）、主题（跟随 / 深色 / 浅色 / Claude Style）、默认折叠、悬浮窗简洁模式、界面语言。
- **守夜**：最上面是「自定义配置」开关，独立一行、不挂在任何组下；打开后才出现「配置」组，里面是默认配置与各份自定义配置的列表，可切换、设为默认、重命名、删除，末尾是「＋ 新建」。再往下是「守夜行为」组，四行判定闸排在 AFK 之前：「会话都停下来」是底线条件，始终开启，不可关；「后台任务跑完」挡后台任务；「有会话报错就跳过这一轮」挡出错批次；「倒计时时长」仅自定义配置可调。最后是「AFK 自动回答」，说明里写明「回复不会替你选中任何选项，关闭后提问照常弹给你」。
- **通知**：一个组，状态变化通知总开关 + 四类分开关（进入倒计时 / 即将关机 / 首次阻断 / 阻断恢复）；手动武装、解除、取消不提醒。
- **状态**：一个组，当前阻断、上次为什么没关机、最近事件。

## 浅色与第三方主题

| 浅色卡片                                              | Claude Style                                           |
|:-----------------------------------------------------:|:------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/14-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/15-claude.png" width="250"> |

卡片不套用宿主配色，自带调色板；设置页则跟宿主主题走。主题里的 Claude Style 不必先装插件：没装 dsh-claude-style 时用的是内置的近似配色（陶土橙），主题行下面会多一行灰字说明；装上插件后自动跟随它的实时配色，那行说明随即消失。插件装了、但把 palette 设成 host 的，用的是我们自己的琥珀配色，不会是陶土橙。

## 安装

已发布到 npm，推荐：

```bash
dsh plugin --profile web add dsh-shutdown-guard
```

或者直接从 GitHub 装：

```bash
dsh plugin --profile web add github:ltayshark0637/dsh-Shutdown-Guard
```

装完**重启 DSH**。

> ⚠️ **客户端 bundle 只在 DSH 启动时编入模块图**：改 `lib/client.js` 后必须重启，刷新页面无效。服务端同理。

**网络受限时**：GitHub 那条本质是 `pnpm add github:...`，需要 clone。若 clone 不通，优先用 npm 那条（走 registry）；都不通再用本地路径安装——DSH 设置 → 插件 → 添加，填本目录的**绝对路径** → 安装 → 重启。

**手工兜底**：在 `profiles\web` 下建 `node_modules\dsh-shutdown-guard` 软链指向本目录，然后：

- `profiles\web\package.json` 的 `dependencies` 与 `pnpm.overrides` 加 `link:<本目录绝对路径>`
- `dsh.profile.bundles` 追加 `dsh-shutdown-guard`

## 权限与影响

装上之后，这个插件会做以下几件事：

| 影响面 | 具体行为 |
| --- | --- |
| **执行命令** | 经 `subprocess` 调 Windows 的 `shutdown.exe`：`/s /t <秒>` 安排关机、`/a` 取消。**只在武装且五道闸门全满足时才调** |
| **读写文件** | 只在插件目录下的 `data/`：`config.json`（配置）与 `events.log`（事件日志） |
| **监听事件** | `agent/status`、`agent/error`、`session/event`、`user-questions/request` |
| **HTTP 路由** | 本机 DSH Web 服务下 `/api/dsh-shutdown-guard/` 的 `GET /state`、`GET /events`、`POST /arm`、`POST /disarm`、`POST /cancel`、`POST /config`；POST 校验 Origin 必须为 `127.0.0.1` 或 `localhost` |
| **网络** | **不发起任何外部请求**，不收集数据 |
| **平台** | **仅 Windows**。非 `win32` 时插件静默不加载 |

AFK 自动接管开启时，插件会在武装期间替你回答 agent 的提问、并向报错会话注入恢复指令；这个开关在设置里可以随时关掉。

## 配置

配置分两层：**默认配置**一份，**自定义配置**任意多份。每份配置各自带倒计时时长、两条判定开关、AFK 与四类通知开关。

三处来源，优先级从低到高：

1. `cordis.patch.yml`（插件包内的出厂 patch）
2. `data/config.json`（运行时持久化，设置页改的东西落在这里）
3. `POST /config`（运行时改，改动同样落盘）

### 默认配置为什么锁定

默认配置是**所有人的安全底线**：60 秒倒计时、等后台任务、出错跳过，这三条被写死在默认配置里，改不了。理由很实际——

- 60 秒是「看到卡片还能点取消」的最短窗口；调到 10 秒，误关机的代价远大于省下的那一分钟。
- 默认配置被锁死后，你随时可以把它切回来，不用担心自己上一次调过的参数还在生效。
- 想改？可以，但必须显式新建一份自定义配置，改的也是那一份，不污染底线。

### 怎么新建自定义配置

设置页 → **外观** → **配置** → `＋ 新建`：从当前配置复制一份，起个名字（≤24 字），保存即成为当前配置。

- 新装只有一份「默认配置」。要第二份就点 `＋ 新建`，不会再预先塞几个空槽。
- 「自定义配置」关掉再打开，会回到关之前用的那一份；那一份已被删除的话，停在默认配置。
- 升级时，从头到尾没动过的空槽会被清理掉；改过名字、或动过其中任一开关的配置都会保留。
- 每份自定义配置都能「设为默认」（之后新会话默认用它）、「重命名」、「删除」。
- 删除当前正在用的一份会回落到默认配置，删除前会二次确认。
- 「自定义配置」总开关关掉时，所有自定义配置不可用，运行时一律按默认配置走。

### 配置项

以下键在每份配置里各存一份：

| 键              | 范围   | 默认   | 说明                                      |
| --------------- | ------ | ------ | ----------------------------------------- |
| `countdownSec`  | 10–600 | 60     | 关机前倒计时秒数（默认配置固定 60，不可改） |
| `onlyOnSuccess` | bool   | `true` | 本批次有会话报错时跳过关机                |
| `blockOnJobs`   | bool   | `true` | 有运行中的后台任务时跳过关机              |
| `afkAutoAnswer` | bool   | `true` | 武装期间替用户回答提问、做错误恢复        |
| `notify`        | 对象   | 全 `true` | 四类通知开关：`countdown` / `fired` / `blocked` / `recovered` |

全局（不属于某份配置）：

| 键        | 范围   | 默认   | 说明 |
| --------- | ------ | ------ | ---- |
| `language` | 枚举  | `auto` | 界面语言；`auto` 跟随系统语言（`LC_ALL` / `LC_MESSAGES` / `LANG` → `Intl` → `en`），也可固定为 `zh` / `en` / `ru` |
| `customEnabled` | bool | `false` | 是否允许使用自定义配置 |
| `activeProfileId` | string | `default` | 当前生效的配置 id |

此外 `marginSec`（0–60，默认 5）用于给 `shutdown /t` 留额外余量。

### 重试策略

每个错误码分配一个策略名，策略本身可配置：

| 策略         | 默认节奏                               | 分配给                             |
| ------------ | -------------------------------------- | ---------------------------------- |
| `rate-limit` | backoff 30 → 60 → 120 → 240 → 300 封顶 | `RATE_LIMIT`                       |
| `transient`  | 固定 20 秒                             | `SERVER` / `TRANSPORT` / `TIMEOUT` |
| `empty`      | 固定 30 秒                             | `EMPTY_RESPONSE`                   |
| `offload`    | 固定 5 秒                              | `IMAGE_OFFLOAD_REQUIRED`           |

限流用退避而不是固定间隔，是因为对限流服务高频重试**会延长**限流期，而不只是浪费请求。5xx 和网络故障恢复时间可预测，固定间隔反而更快。图片卸载是本地磁盘操作，几乎立刻可重试，所以给 5 秒。

覆盖单个错误码：

```yaml
retryAssign:
  RATE_LIMIT: slow-limit
retryPolicies:
  slow-limit: { mode: backoff, base: 60, max: 900 }
```

未知 `code` 回落 `transient`；形状写错的策略会被丢弃并保留默认值。当前生效的分配可从 `/state` 的 `retryAssign`、`retryPolicies` 读到。

**偏好存在哪**：卡片样式 / 主题 / 折叠属于纯界面偏好，存在浏览器 `localStorage`（`dsh-shutdown-guard.variant` / `.theme` / `.folded`）；悬浮窗简洁模式与四类通知开关由宿主持有（`data/ui.json`）；语言与配置项落在 `data/config.json`。

## HTTP 接口

前缀 `/api/dsh-shutdown-guard`，供卡片自己的同源轮询使用：

| 方法 | 路径                       | 说明                                                                             |
| ---- | -------------------------- | -------------------------------------------------------------------------------- |
| GET  | `/state?since=<ms>`        | 完整状态 + 增量事件                                                              |
| POST | `/arm` `/disarm` `/cancel` | 武装 / 解除 / 取消本次倒计时                                                     |
| POST | `/config`                  | 改配置：`customEnabled`、`activeProfileId`、`profileId`+`patch`、`afkAutoAnswer`、`language` |
| GET  | `/events?since=&limit=`    | 事件流水                                                                         |

非本机 Origin 的 POST 返回 403；非 POST 返回 405。

## 日志

- `<插件目录>\data\events.log` —— 人类可读的事件流水（`config` / `afk` / `skip` 分类），设置页「事件日志」即读它
- `<DSH_HOME>\dsh-shutdown-guard.log` —— 进程级追加日志

## 开发

```bash
node test/host.test.mjs        # 服务端：26 项断言，mock ctx，不真的关机
node test/client.test.cjs      # 客户端 bundle smoke
node scripts/gen-gallery.cjs   # 从 lib/client.js 真实 CSS 生成截图页
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1    # headless Edge 渲染 PNG（透明背景 + 自动裁边）
node scripts/gen-gif.cjs       # 生成 README 里的三张动图
node scripts/gen-banner.cjs    # 生成 1280x640 的社交预览图
node scripts/gen-demo.cjs      # 生成 docs/demo.html（交互演示页）
```

截图全部由 `lib/client.js` 里的真实 CSS 生成，不会与产品脱节。动图同理：把 CSS 动画用 `animation-delay` 冻结在若干时间点逐帧截图，再用内置的 GIF89a 编码器合成——本机不需要 ffmpeg 或 ImageMagick。

演示页面的「了解」部分同样是实时渲染：六种状态用与产品同一套 `card()` 标记现场生成，不是截图。

## 常见问题

**Q：为什么改了设置没反应？**
A：服务端和客户端都得重启 DSH 才加载新代码。本机 HMR 对本地链接插件不生效。

**Q：武装后为什么不关机？**
A：看设置页「上次为什么没关机」，那里写着具体原因（后台任务、报错、未武装等）。

**Q：倒计时期间能反悔吗？**
A：能。卡片上的「取消关机」或直接 `shutdown /a` 都行，取消后仍保持武装，下一个批次继续生效。

**Q：会误关机吗？**
A：默认配置下，插件要看到「所有会话空闲 + 没有后台任务 + 没有报错 + 你手动武装」四条同时成立才动手，其中任何一条被打破都会取消或跳过。手动终止任务也已被识别并排除。

**Q：非 Windows 能用吗？**
A：暂时不能，等待后续开发。

## 约束

- 仅 Windows：非 `win32` 平台早退，不挂载。
- 零运行时依赖：服务端只用 `node:fs` / `node:path` / `node:crypto`，浏览器只 `require('react')`。
- 不修改 `app.asar` 与 DSH 源码。

## 许可

[MIT](LICENSE)
