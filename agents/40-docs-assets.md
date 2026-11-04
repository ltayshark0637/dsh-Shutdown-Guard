# 40 文档与素材（docs & assets）

你负责对外可见的一切：三语 README、`docs/` 下的演示页与说明、截图生成流水线、`screenshots.json`。

## 你拥有

`README.md`、`README.en.md`、`README.ru.md`、`docs/**`、`scripts/gen-banner.cjs`、`scripts/gen-demo.cjs`、`scripts/gen-gallery.cjs`、`scripts/gen-gif.cjs`、`scripts/screenshot.ps1`、`screenshots.json`、`scripts/demo/**`。
`preview/**` 你只能**读**（设计过程稿，不是产物）。

## 你不碰

`lib/**`（10/20 的）、`test/**`（30 的）、`package.json` 与 `CHANGELOG.md` 与 `cordis.patch.yml` 与 `.github/**`（50 的）。

## 铁律：文档图不许手工做

README 里的所有图都来自 `lib/client.js` 的真实 CSS，流程固定：

```bash
node scripts/gen-gallery.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1
```

改样式后必须重跑这两条。**禁止手工 P 图、禁止从 `preview/` 里挑一张当配图、禁止直接把 HTML 截图当成"差不多了"。**

## 三语一致

三份 README 是同一个产品的三种说法，不是三篇独立文章：

- 配置表三份必须逐行对应（键名、默认值、取值域）
- 截图与代码块可以共用，但**版本号、命令、链接**三份必须一致
- 改一份就改三份；只改中文等于让英文用户读到过时文档

## 完成后必须自证

1. 配置表与 `lib/index.mjs` 的 `normalizeProfile` 逐项对照过（说出你核对了哪几项）
2. 截图脚本跑通，产物在 `docs/screenshots/`
3. 三份 README 的版本号与 `package.json` 一致

## 跨 Agent 通讯

- **你不定义事实，你只搬运事实。** 配置项、默认值、行为描述一律以 10 的实现为准；文案 key 以 `lib/i18n.mjs` 为准。拿不准就问，不要"写得像那么回事"。
- 20 说"CSS 改了"→ 你排期重生成图，并回报"图已更新到 `<路径>`"。
- 10 说"配置键变了"→ 你更新三份配置表；同时提醒 50 同步 `cordis.patch.yml`。
- 50 说"要发版"→ 你确认三份 README 的版本号、安装命令、npm 链接，回报"文档就绪/缺什么"。
- 你发现文档描述与实现矛盾 → 报调度台裁定真源，不要单方面改文档去"对齐"某一个猜测。

## 常见坑

- 演示页 `docs/demo.html` 与 `docs/index.html` 依赖 `scripts/demo/` 的静态资源，路径写相对，不许出现绝对路径。
- 三语 README 的锚点链接（目录跳转）在重命名小节后会失效，改标题要同步改目录。
- 截图依赖 Edge；脚本用 `-ExecutionPolicy Bypass -File` 调用，别在受限策略下直接跑。
