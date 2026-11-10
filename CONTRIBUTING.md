# 贡献指南

> English version: [CONTRIBUTING.en.md](CONTRIBUTING.en.md)

谢谢愿意花时间。这个插件是给「任务跑完了想关机」这个具体场景写的，代码量不大，但有几条硬约束是刻意的 —— 先读完这份再动手，比写完被打回省事。

## 1. 什么样的 PR 受欢迎

**欢迎：**

- **修 bug**，PR 描述里带上复现步骤（哪个状态、点了什么、期望什么、实际什么）。
- **补断言**：现有行为没有测试兜着的，补上就是净收益。
- **文档纠错**：写错了、过期了、例子跑不通，都算。
- **性能与体验改进**：卡片渲染、悬浮窗刷新、设置页交互。
- **新的动作平台适配**：比如某个发行版上更合适的锁屏命令。

**不接受**（会被直接关掉，不是语气的问题）：

- **引入第三方依赖**。这个项目**零运行时依赖**是硬约束：服务端只用 `node:fs` / `node:path` / `node:crypto`，浏览器侧只 `require('react')`。多一个包就破坏了「在任何 DSH 环境里即装即用」这件事。
- **改 `.github/workflows/publish.yml`**。发布链路由维护者负责，外部改动不接。
- **改版本号或 CHANGELOG 的版本段**。版本在发版时统一写，PR 里改会和别人的改动打架。
- **只改文案但不改三语**。缺少语言的 PR 会让某一语显示成另一种语言，比不改更糟。
- **把 `process.exit()` 加进宿主进程**。它会跳过宿主清理、可能损坏正在跑的会话；要退出请走已有的动作路径。

## 2. 先读什么

动手前按需读这三份，能省掉大部分来回：

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— 五道判定闸、状态机、倒计时为什么由插件自己数。
- [`docs/CONFIG.md`](docs/CONFIG.md) —— `data/config.json` 的形状、profile 字段、HTTP 端点、`reason` 枚举。
- [`docs/DEVELOPING.md`](docs/DEVELOPING.md) —— 本地怎么挂载、改完为什么要完整重启 DSH、日志在哪。

## 3. 仓库结构

最容易改错的地方是「以为文案在 i18n 文件里」。三个入口各管什么：

- **`lib/index.mjs`** —— 宿主侧：判定闸、倒计时、动作表、`/state` 与其它 HTTP 端点。
- **`lib/client.js`** —— 客户端 bundle：侧边栏卡片、设置页、悬浮窗。**单文件、手工 bundle、没有构建步骤**，CSS 与 React 都在这一个文件里；改它必须完整重启 DSH 才生效。
- **`lib/i18n.mjs`** —— **宿主**的三语消息目录（事件日志、通知这类服务端发出的文本）。**客户端文案在 `lib/client.js` 的 `MSG` 里，不在这个文件**。

## 4. 环境

- Node **≥ 22.19**（`package.json` 的 `engines` 写死了这个下限）。
- **无第三方依赖**：`npm install` 只是为了跑脚本时依赖树存在，不需要构建步骤，也没有 `dist`。
- 平台：Windows 已完整验证；macOS 已真机验证「关机」（有应用阻止时会被系统拦下）；Linux 只有代码与断言覆盖（见 [`docs/BETA.md`](docs/BETA.md) 的已知限制）。

## 5. 跑测试

两条都要跑，都在仓库根执行，两条都必须 exit 0：

```bash
node test/host.test.mjs     # 宿主断言，mock 掉 ctx，不会真的关机 —— 目前 66 项
node test/client.test.cjs   # 客户端 bundle smoke，用假 React 跑真 client.js —— 目前 15 项
```

`npm test` 把两条串起来跑，等价。改了 `lib/*` 两条都要重跑；只改文档或截图脚本，至少跑 `client.test.cjs`（卡片样式与截图同源）。

顺手会用到的一条（改了卡片样式时）：

```bash
node scripts/gen-gallery.cjs                                              # 生成 docs/screenshots/*.html
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1  # 渲染成 PNG，需要 Edge
```

## 6. 断言要求

这一节最重要，照着做能省一轮返工。

- **新行为必须带断言**。没有断言的 PR 会被要求补上，哪怕功能本身是对的 —— 没有断言的行为，等于下一个人改坏时没人知道。
- **修 bug 必须做反向验证**：把修复改回原样，确认那条断言会红。**PR 描述里贴出「改回去之后红在哪一行、actual / expected 分别是什么」**。这是本项目的既有做法（每次修 bug 都这么验），不是额外加的要求。
- **断言名用 `xxx-ok` 的短横线风格**，一个名字对应一个行为，例如 `parked-clear-ok`、`custom-hidden-without-profiles-ok`。名字要能读出来「这条在保证什么」。
- 断言里的说明写清失败时的实际值，让人不看代码也知道错在哪。

## 7. 三语规则

支持 `zh` / `en` / `ru` 三种语言，**键集必须齐平**：

- 加一条文案，三份一起加；删一条，三份一起删。只加一种语言的 PR 会被打回。
- 宿主目录由 `i18n-coverage-ok` 断言逐语言核对键名与键数（`test/host.test.mjs`），少一个就红。
- 客户端 `MSG` 里的文案由 `test/client.test.cjs` 校验设置页那批标签一个不缺。
- 翻译要像人话，不要机翻腔；同一概念在三种语言里用同一个词，别一处「武装」一处「启动」。

## 8. 提交与分支

- **一次提交只做一件事**。修 bug 和顺手重构分开，评审和回滚都会容易得多。
- **提交信息**：`type(scope): 小写英文描述`，`type` 用 `fix` / `feat` / `docs` / `test` / `chore` / `ci`，`scope` 可选（`client`、`config`、`readme`、`release`…）。例：`fix(client): hide the script rows when custom profiles are off`。
- **不要 `git add .`**。多人协作时它会吞掉别人未提交的改动 —— 本仓库已经踩过两次，现在一律 `git commit -m "…" -- <显式路径>`。
- PR 基于 `main`。大改动（改契约、改状态机、动数据格式）**先开 issue 对齐**，别写完了才发现方向不对。开 issue 时附上：复现步骤、`data/events.log` 的相关片段（脱敏）、`GET /api/dsh-shutdown-guard/state` 的返回、DSH 与插件版本。
- 不顺手格式化无关文件：附带的空行、引号、缩进改动会让 diff 变噪音，评审会要求撤回。

## 9. 评审看什么

- **会不会对用户说错话**：用户可见文本里不允许出现内部 id、状态码、函数名、`[object Object]`。设置页要把协议字符串翻成人话。
- **失败路径是否说明原因**：动作不可用要给出 `reason` 并翻成人话，不能静默失败、也不能只留一个灰按钮。
- **是否只动了该动的文件**：无关的注释、格式化、重排会被要求撤回。
- **测试是否真的能挡住回归**：断言名与内容对得上，反向验证做过。
- 合并后会在 `CHANGELOG.md` 里署名（用你的 GitHub 用户名），这是本仓库的惯例。
