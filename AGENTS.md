# 工作方式准则 — dsh-Shutdown-Guard

本文件对本仓库（`C:\Users\Harness\Documents\Harness\dsh-Shutdown-Guard`）的会话生效。
通用层（会话拆分线、上下文提醒、工具与上下文卫生、成本纪律、回复约束、定期自查）以 `$DSH_HOME/AGENTS.md` 为准，本文件不重复；下面只写本仓库的事实、入口与红线。

## 0. 生效自检

若本文件已加载，每次回复第一行输出：`[SDG （角色）Agent 当前在处理：（当前对话的主题）]`
缺这一行说明未加载 —— 先确认当前会话的工作目录是本仓库，再动手。

## 1. 这是什么

DSH 插件 `dsh-shutdown-guard`：任务结束后自动关机，侧边栏守夜卡片。Windows only，ESM，零运行时依赖，已发布 npm。
三个入口，改哪个都要看清：

| 文件            | 角色                                            |
| --------------- | ----------------------------------------------- |
| `lib/index.mjs` | 宿主侧：判定闸、倒计时、关机、retry 策略        |
| `lib/client.js` | 侧边栏卡片（64KB 单文件，CSS + React 都在里面） |
| `lib/i18n.mjs`  | zh/en/ru 文案与语言解析                         |

## 2. 改完的判定标准

两条命令都必须过，都从仓库根跑；改了 `lib/*` 之后必须重跑：

```bash
node test/host.test.mjs     # 宿主断言，mock ctx，不会真关机
node test/client.test.cjs   # 客户端 bundle smoke，用假 React 跑真 client.js
```

只改文档/截图脚本时也要跑 `node test/client.test.cjs`（截图由 client.js 的 CSS 生成，样式坏了测试会先报）。

## 3. 生效链（最常踩的坑）

本仓库根就是插件目录。DSH 通过两条链加载它：

1. `harness\profiles\web\package.json` 里两行 `link:C:/Users/Harness/Documents/Harness/dsh-Shutdown-Guard`
2. `harness\profiles\web\node_modules\dsh-shutdown-guard` 目录联接 → 本仓库根

**改完必须完整退出 DSH 再打开**。客户端 bundle 只在启动时编入模块图，刷新页面不会加载新代码。
动了 `lib/client.js` 却在旧页面上看效果，等于没验证。

## 4. 发版语义

- 改了**可见行为** → 同时更新 `CHANGELOG.md` 与 `package.json` 的 `version`
- 发版 = 提交 + `git tag vX.Y.Z` + push tag；`.github/workflows/publish.yml` 在 `windows-latest` 上跑测试后 `npm publish`
- tag 必须等于 `package.json` 的 version，否则 workflow 直接失败
- 认证走 npm Trusted Publisher（OIDC），**仓库里任何时候都不能出现 token**
- `scripts/push-token.ps1`、`scripts/npm-publish.ps1` 被 `.gitignore` 的 `scripts/push*.ps1` 等规则忽略：不要为了让它们进库去改 `.gitignore`

## 5. 红线

1. **不改 DSH 自身**：不碰 `app.asar`、不改 harness 源码，一律通过槽位与事件挂载。

2. **不引第三方运行时依赖**：服务端只用 `node:fs` / `node:path` / `node:crypto`，浏览器侧只 `require('react')`；日志走 `log(message, kind)`，不用 `console.log`。

3. **文档图只能由脚本生成**：`node scripts/gen-gallery.cjs` → `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1`。禁止手工 P 图，禁止把 `preview/*.png` 直接当 README 配图（那是设计过程稿，不是当前实现）。

4. **`data/` 是运行时会话数据**（`config.json`、`events.log`）：不手改、不提交、不当交付物；排查问题只读片段。

5. **`dist/dsh-shutdown-guard-1.5.0.zip` 是过期的手工产物**：不要当作发布源，也不要据此判断当前版本；当前版本以 `package.json` 为准。

   <!-- 待确认：这个 zip 是否仍要作为 GitHub Release 附件发布；若是，发 1.5.1 时必须重建 -->

## 6. 目录语义与可清理边界

- `lib/` 是唯一的源码真相；`test/` 是断言；`scripts/` 是生成与发布辅助
- `preview/` 是设计过程稿（可归档、不可当文档图）；`docs/screenshots/` 是脚本产物
- `_ops/`、`_archive/`、`session-split-58ed81d0/` 已写进 `.git/info/exclude`（不是 `.gitignore`）：**`git status` 干净不代表它们在版本库里**。删它们不影响 git，但会丢迁移报告与会话拆分证据
- `gcm-diagnose.log`、`*.log` 已被忽略，不要提交日志

## 7. 本机环境坑

- PowerShell 执行策略禁止运行 `npm.ps1`：用 `npm.cmd`（`npm.cmd pack --dry-run`、`npm.cmd view ...`）
- PowerShell 写 JSON/UTF-8 会带 BOM，node 侧 `JSON.parse` 前必须 `strip` BOM
- 插件只在 win32 生效（`lib/index.mjs` 内有 `process.platform` 判断），非 Windows 上跑测试的失败不能当作代码问题
- `raw.githubusercontent.com` / `api.github.com` / `codeload.github.com` 在本机不通（`curl (28)` 超时），`web_fetch` 也打不开 github.com；**GitHub 上的文件正文改用 `cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>`**，页面操作走浏览器通道
- `Invoke-WebRequest` 偶发报「Windows PowerShell 处于非交互模式」：改用 `curl.exe`，或直接在浏览器里取
- 浏览器工具（pi-control-chrome）偶发整体 120 秒超时：先 `browser_status` 看连接，`browser_restart` 常报 `BRIDGE_RESTART_BUSY`，改用 `browser_reload_extension(confirmed:true)` + `browser_status({acknowledgeBrowserId:…})` 可恢复；`BROWSER_OPERATION_UNCERTAIN` 后先读 `location`/`readyState`，不要重放导航

## 8. 角色与调度

本仓库有七个身份：调度台（`agents/00-dispatch.md`）+ 宿主内核（`10`）+ 侧边栏界面（`20`）+ 测试验证（`30`）+ 文档素材（`40`）+ 发布运维（`50`）+ Claude Style 适配（`60`）。
入口见 `agents/README.md`：文件所有权矩阵、六项派活模板、广播表、回执与升级规则。

**编号规则（DSH 里的显示名必须遵守）**

- 身份编号是两位：`00` 调度台、`10`–`60` 执行身份。
- 显示名统一写成 `编号 名称：一句话职责`，例如 `60 Claude Style 适配：跟随 Claude Style 实际配色`。不要写「60 身份：…」这种多一个词的变体，也不要只写名字不带编号 —— DSH 的 agent 列表里靠前缀数字排序和区分。
- **派生 agent 随父姓**：父身份派出的人员/子 agent 用「父编号 + 一位序号」，`20` 派出的第一个是 `21`、第二个是 `22`；`21` 再派出的则是 `211`、`212`。序号在自己这一层内从 1 递增，不复用已用过的号。
- 派生 agent 的显示名同样带编号与职责，并在正文里写明「由 X 派出、负责什么」，便于在列表里一眼看出隶属关系。

- 默认身份是**调度台**：拆活、派活、验收、落盘，不写产品代码。
- 一个文件同一时刻只有一个写者；越界修改前必须先发消息，不许静默改别人的文件。
- 契约（state 字段、事件名、配置键、文案 key）变更必须广播给所有依赖方。

## 9. 交付与汇报

每次改完，回复里必须给出三件事，缺一件视为没交付：

1. 改了哪些文件（给完整路径，不只给文件名）
2. 跑了哪条测试、结果是什么（PASS 列表或失败原文）
3. 是否影响已发布版本 —— npm 包内容 = `package.json` 的 `files` 列表（`lib`、`cordis.patch.yml`、三份 README/CHANGELOG/LICENSE），改了 `lib/` 就必然影响，需不需要发版要说清楚
