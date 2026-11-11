# Shutdown Guard · 任务完成后关机
**中文** · [English](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/README.en.md) · [Русский](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/README.ru.md)

稳定版 `v1.6.0` · 开发版 `v1.6.1-beta.4` · [更新记录](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CHANGELOG.md)

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/banner.png" width="880" alt="Shutdown Guard — 任务完成后自动关机，侧边栏守夜卡片"></p>

[![DSH](https://img.shields.io/badge/DeepSeek-Harness-blue)](https://github.com/deepseek-ai/deepseek-harness) [![DSH 版本要求](https://img.shields.io/badge/DSH-%E2%89%A50.1.5--rc.1-4a90d9)](https://github.com/deepseek-ai/deepseek-harness) [![license](https://img.shields.io/npm/l/dsh-shutdown-guard.svg)](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/LICENSE) [![downloads](https://img.shields.io/npm/dm/dsh-shutdown-guard.svg)](https://www.npmjs.com/package/dsh-shutdown-guard) [![demo](https://img.shields.io/badge/%E2%96%B6-%E4%BA%A4%E4%BA%92%E6%BC%94%E7%A4%BA-d97757)](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)

[![npm](https://img.shields.io/badge/npm-dsh--shutdown--guard-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-shutdown-guard) [![awesome-dsh-plugin 收录](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/ltayshark0637/dsh-Shutdown-Guard/) [![dsh-plugin.org 收录](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/ltayshark0637/dsh-shutdown-guard) [![dpharness 收录](https://img.shields.io/badge/dpharness-%E6%94%B6%E5%BD%95-6f42c1)](https://dpharness.com/plugin/ltayshark0637/dsh-Shutdown-Guard) [![dshbase 实装验证](https://dshbase.com/badges/dsh-shutdown-guard.svg)](https://dshbase.com/plugins/dsh-shutdown-guard/) [![dsh.so 运行验证](https://cdn.dsh.so/badge/dsh-shutdown-guard.svg)](https://www.dsh.so/artifact/dsh-shutdown-guard/?ref=badge)

为 DeepSeek Harness 的侧边栏加一张「所有任务完成后自动关机」的卡片，就在「技能中心」下方、会话列表上方，随任务状态实时变化。

它不会在任务一结束就关机——后台任务还在跑、某次会话报错、agent 正在等你回答，这些情况都会把它挡下来；只有真的可以关的时候才关，并把原因写在卡片上。

**▶ [交互演示](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)** —— 不用装插件，先看它长什么样、怎么判断。数据全部本地随机，不联网。

## 安装

已发布到 npm，推荐：

```bash
dsh plugin --profile web add dsh-shutdown-guard
```

内测版要显式写版本号，不带版本号装到的仍是稳定版 `1.6.0`：

```bash
dsh plugin --profile web add dsh-shutdown-guard@1.6.1-beta.4
```

或者直接从 GitHub 装：

```bash
dsh plugin --profile web add github:ltayshark0637/dsh-Shutdown-Guard
```

装到 DSH 的插件目录，装完必须完整退出 DSH 再打开（刷新页面不生效）。

> 网络受限时优先用 npm 那条（走 registry）。GitHub 那条本质是 `pnpm add github:...`，需要 clone；都不通就用本地路径安装：DSH 设置 → 插件 → 添加，填本目录的绝对路径 → 安装 → 重启。

## 三种外观

| 极简（浅色） | 雷达（浅色） | 终端（浅色） |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/01-armed-a-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/07-armed-b-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/13-armed-c-zh-light.png" width="250"> |

| 极简（深色） | 雷达（深色） | 终端（深色） |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/02-armed-a-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/08-armed-b-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/14-armed-c-zh-dark.png" width="250"> |

同一张卡片的三种画法：极简只留大标题与一句话，雷达把会话和任务画成不重排的圆点，终端写成三行命令加六段指示灯。在设置的「外观」页点一张缩略图就换过去，立即生效、无需重启；缩略图会跟着界面语言和背景深浅自动换。

卡片和悬浮窗底部的警示带跟着状态走：待命起回到经典红黄斜纹，未武装或被阻断时收成同色相的安静两档；切换是 280ms 的渐变，不会闪。

点卡头右侧的窗口图标，可以把卡片拉成一个独立的悬浮窗，放在屏幕角落一直看着；悬浮窗里的外观、主题、语言都跟着设置走。

## 设置页

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/12-settings-dark.png" width="380" alt="设置页（深色）"></p>

分四个标签页，打开时停在外观页，所有开关立即生效。

- **外观**：卡片样式（三张带缩略图的卡片，缩略图随界面语言与背景深浅换）、主题、默认折叠、悬浮窗简洁模式、界面语言。
- **守夜**：最上面是「自定义配置」开关，打开后才出现配置列表（切换、设为默认、重命名、删除、新建）；再往下是四行判定闸、「AFK 自动回答」，以及**到点做什么**的下拉（关机 / 重启 / 睡眠 / 休眠 / 锁屏 / 注销 / 自定义脚本）。
- **通知**：状态变化总开关 + 四类分开关（进入倒计时、即将关机、首次阻断、阻断恢复）。
- **状态**：当前阻断、上次为什么没关机、最近事件。

## 常见问题

**Q：会误关机吗？**
A：默认配置要求「所有会话空闲 + 没有后台任务 + 没有报错 + 你手动武装」四条同时成立，任何一条被打破都会取消或跳过；手动终止任务也已被识别并排除。

**Q：武装后为什么不关机？**
A：看设置页「上次为什么没关机」，那里写着具体原因（后台任务、报错、未武装等）。

**Q：倒计时期间能反悔吗？**
A：能。点卡片上的「取消关机」即可，取消后这一轮**一条命令都不会发出**，且仍保持武装，下一个批次继续生效；命令一旦发出就无法撤回。

**Q：改了设置没反应？**
A：服务端和客户端都要重启 DSH 才加载新代码，本机 HMR 对本地链接插件不生效。

**Q：支持 macOS 和 Linux 吗？**
A：分平台说，别只看一句话：

- **Windows**：完整验证，包括真实执行关机 / 重启 / 睡眠。
- **macOS**：**「关机」已真机验证能真正执行**（Apple Silicon / macOS 27.2 / DSH Desktop，插件 `1.6.1-beta.3`）：插件发出命令 → 系统接受 → 机器实际关机。**前提是没有应用阻止关机** —— 终端跑着前台命令、编辑器有未保存文档时，macOS 会像手动点苹果菜单「关机」一样拦下并等待确认。重启、注销、睡眠、休眠尚未真机验证。
- **Linux**：只到代码与断言覆盖，**尚未真机实测**。

在 macOS 上，探测阶段报的是 `"unknown"` 而不是 `true`：系统可能在真正执行的那一刻才做决定。`"unknown"` 表示「可以武装，但那一刻由系统拍板」，不是坏了。

## 更多

技术细节单独成文：[架构与判定](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.md) · [配置字段](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/CONFIG.md) · [本地开发](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/DEVELOPING.md) · [内测指南](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/BETA.md) · [贡献指南](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CONTRIBUTING.md)

英文版：[ARCHITECTURE.en.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.en.md) · [CONFIG.en.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/CONFIG.en.md) · [DEVELOPING.en.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/DEVELOPING.en.md) · [BETA.en.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/BETA.en.md) · [CONTRIBUTING.en.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CONTRIBUTING.en.md)

俄文版：[ARCHITECTURE.ru.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.ru.md) · [CONFIG.ru.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/CONFIG.ru.md) · [DEVELOPING.ru.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/DEVELOPING.ru.md) · [BETA.ru.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/BETA.ru.md) · [CONTRIBUTING.ru.md](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CONTRIBUTING.ru.md)

## 许可

[MIT](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/LICENSE)
