# 本地开发

> **中文** · [English](DEVELOPING.en.md) · [Русский](DEVELOPING.ru.md)

## 1. 没有构建步骤

源码就是运行时代码：`lib/index.mjs` 是 ESM，由 DSH 直接 `import`；`lib/client.js` 是一个自包含的 bundle，宿主在启动时把它编进模块图。

```
git clone https://github.com/ltayshark0637/dsh-Shutdown-Guard
cd dsh-Shutdown-Guard
node test/host.test.mjs
```

不需要 `npm install`：仓库零运行时依赖，测试也只用 `node:test` 与 `node:assert`。
（跑 npm 相关命令时用 `npm.cmd`，本机 PowerShell 执行策略禁止 `npm.ps1`。）

## 2. 两条测试

```bash
node test/host.test.mjs      # 宿主：mock ctx，不会真的关机
node test/client.test.cjs    # 客户端 bundle smoke，用假 React 跑真 client.js
```

改了 `lib/**` 之后**两条都要跑**；只改文档或截图脚本也要跑 `client.test.cjs`（截图由 `client.js` 的真实 CSS 生成，样式坏了它先报）。

常见断言名与含义：

| 断言 | 守住什么 |
| --- | --- |
| `client-bundle-smoke` | `lib/client.js` 能被 `require` 并渲染 |
| `i18n-coverage-ok` | 三语键集齐平（见第 4 节） |
| `window-page-ok` / `window-tape-ok` | 悬浮窗页面仍然是完整文档、警示带仍跟状态 |
| `window-radar-parity-ok` | 窗口页与侧边栏的计数同源 |
| `radar-dots-*-ok` | 雷达点数的上限、`+N`、aria、root 过滤 |
| `profile-*-ok` | 配置体系：无预生成空槽、记忆上次选择、清理规则 |
| `theme-label-ok` / `builtin-palette-*-ok` | 主题命名与内置 Claude 配色回退 |

## 3. 目录职责

| 路径 | 职责 |
| --- | --- |
| `lib/index.mjs` | 宿主侧：判定闸、倒计时、动作执行、重试与熔断、配置持久化、HTTP 路由、悬浮窗页面 |
| `lib/client.js` | 侧边栏卡片：CSS + React 在同一个文件里 |
| `lib/i18n.mjs` | 三语文案目录与语言解析（`LANGS`、`resolveLang`） |
| `test/` | 两条断言脚本 |
| `scripts/` | 截图、演示页、图标、发布辅助（不是运行时） |
| `docs/` | 面向维护者的文档：ARCHITECTURE、CONFIG、DEVELOPING、BETA、RELEASE-NOTES-STYLE（前四篇另有 `.en.md` 英文版；RELEASE-NOTES-STYLE 只有中文），以及 `screenshots/` 产物 |
| `data/` | 运行时数据：`config.json`、`events.log`、`ui.json` —— 不提交 |

## 4. 三语键集必须齐平

`lib/i18n.mjs` 的 `MESSAGES` 以 `zh` 为基准：每一语都必须定义 `zh` 的**每一个键**，且键数相等。
`host.test.mjs` 的 `i18n-coverage-ok` 断言了三件事：

1. `LANGS` 就是 `['zh', 'en', 'ru']`；
2. `catalogCoverage()` 的 `missing` 为空对象（没有哪份语言漏键）；
3. 每一语的键数 `=== coverage.base.length`（不允许多、也不允许少）。

客户端侧的文案在 `lib/client.js` 的 `MSG` 表里，同样三语齐平；改文案时两边一起改，否则卡片会出现「中文一句、英文一句」。

## 5. 生效链：改完必须重启 DSH

本仓库根就是插件目录，DSH 通过两条链加载它：

1. `harness\profiles\web\package.json` 里的 `link:<本目录绝对路径>`；
2. `harness\profiles\web\node_modules\dsh-shutdown-guard` → 本仓库根。

**客户端 bundle 只在 DSH 启动时编入模块图，刷新页面不会加载新代码。** 改了 `lib/client.js` 却在旧页面上看效果，等于没验证。服务端同理。

## 6. 截图与文档图

所有文档图都由脚本从 `lib/client.js` 的真实 CSS 生成，**不接受手工 P 图**：

```bash
node scripts/gen-gallery.cjs --lang all --matrix   # 18 张主图 + 旧套页面
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1
node scripts/gen-thumbs.cjs                        # 18 张设置页缩略图 + base64
node scripts/gen-demo.cjs                          # docs/demo.html
node scripts/gen-banner.cjs                        # banner.html（再用 Edge 渲 banner.png）
node scripts/gen-gif.cjs                           # README 用的是矩阵图，动图可选
```

`gen-gallery.cjs` 的常用参数：

| 参数 | 作用 |
| --- | --- |
| `--lang zh\|en\|ru\|all` | 语言；`all` 生成三语 |
| `--matrix` | `NN-armed-{a,b,c}-{zh,en,ru}-{light,dark}.png` 这套 18 张 |
| `--thumbs` | 18 张设置页缩略图页面（交给 `gen-thumbs.cjs` 处理） |
| `--only <substr>` | 只生成名字包含该串的页面，改一张图时用 |
| `--state <view>` | 覆盖状态（`off` / `armed` / `hold` / `fire` / `fired` / `blocked`） |

`screenshot.ps1` 的 `-Filter` 收的是文件名通配，只匹配 `.html`。**中间产物 `docs/screenshots/thumb-*.html` 与 `thumb-*.png` 用完要删掉，不要提交。**

演示页的缩略图直接从 `docs/assets/variant-*.png` 取（GitHub Pages 把 `docs/` 当站点根，所以 `assets/` 是站内绝对路径）。改缩略图要同时更新 `assets/` 与 `docs/assets/`。

## 7. 提交纪律

- **不要 `git add`**：本版出过两次暂存区互相吞掉别人的改动。一律显式路径提交：

```bash
git commit -m "docs: …" -- README.md docs/CONFIG.md
git show --stat HEAD          # 每笔提交后复核
```

- 一个文件同一时刻只有一个写者，越界改别人的文件前先沟通。
- 契约变更（state 字段、事件名、配置键、文案 key）要广播给依赖方。
- 不 push、不打 tag，除非明确要求；tag 必须等于 `package.json` 的 `version`。

## 8. 常见坑

| 坑 | 症状 | 做法 |
| --- | --- | --- |
| PowerShell 写 UTF-8 带 BOM | `JSON.parse` 在 BOM 上抛错 | 读前 `strip` BOM；写配置用 `fs.writeFileSync(..., 'utf8')` |
| PS 5.1 按 ANSI 解码无 BOM 脚本 | 中文注释里的反引号吞换行，报 `Unexpected token '}'` | **`scripts/*.ps1` 只写 ASCII 注释** |
| `node -e` 被 PowerShell 先展开 | `${…}`、正则、引号导致 `SyntaxError` 或空输出 | 写临时 `.cjs` 再 `node file.cjs` |
| 本机 `raw.githubusercontent.com` / `api.github.com` / `codeload` 不通 | curl `(28)` 超时 | 读 GitHub 文件用 `https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>` |
| 中文 `.md` 用 `Set-Content -Encoding utf8` 改写 | 整篇乱码、换行被吞 | 用 `edit` 工具或 node `fs` 写；版本号这类改动只做**等长字节替换**以保住 CRLF |
| 截图整张不裁边 | 输出是 Edge 默认底色 | `screenshot.ps1` 只对 `.html` 渲染；`Trim-Png` 只按 `alpha==0` 裁，页面不能有不透明底色 |

## 9. 发版（摘要）

改可见行为 → 同时更新 `CHANGELOG.md` 与 `package.json` 的 `version` → 提交 → `git tag vX.Y.Z` → push tag，`.github/workflows/publish.yml` 在 `windows-latest` 上跑测试后 `npm publish`。
认证走 npm Trusted Publisher（OIDC），仓库里任何时候都不能出现 token。详见仓库 `AGENTS.md`。
