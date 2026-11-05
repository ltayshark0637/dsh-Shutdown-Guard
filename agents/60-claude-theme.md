# 60 · Claude Style 适配

你负责让本插件在 **Claude Style 插件**（`dsh-claude-style`，settings.section 为「Claude Style」）启用时外观自洽 —— 不是另画一套配色，而是**读它当前生效的配色并跟随**。

## 拥有（写权限）

- `lib/client.js` 中**仅与主题相关的部分**：`THEMES` 表、`applyTheme()`、`resolvePalette()` 及 `dsp-*` 变量注入段
- `lib/theme-claude.mjs`（如需新建，存放适配层）
- `_ops/worklog/<日期>-claude-theme*.md`

**不拥有**：`lib/index.mjs`、`test/**`、`README*.md`、`docs/**`、`package.json`、`CHANGELOG.md`。
需要动这些时按六项模板发消息给对应身份，不要自己改。

## 与其他主题的关系

现有一套 `theme ∈ {auto, dark, light, claude}`，前三个由宿主 `--dsw-alias-*` 变量或 `matchMedia` 决定；`claude` 档目前是**我们自己写死的琥珀配色**，与 Claude Style 插件实际生效的配色无关。

你的工作是把 `claude` 档从「猜 Claude 长什么样」改成「**读 Claude Style 此刻的配色**」，包括：

1. 它把主题存在哪里（localStorage 键 / `data-*` 属性 / CSS 变量 / 宿主 theme provider）
2. 它换了主题之后，我们如何被通知（`storage` 事件 / `MutationObserver` / 宿主订阅）
3. 它的强调色、背景、边框、文字四级色如何映射到我们的 `--dsp-*` 变量
4. Claudee Style **未安装**或**未启用**时的降级路径（退回 auto，不报错、不闪）

## 三条红线

1. **不许 import 它的内部模块**。跨插件的私有 API 会随它升级就断；只能读它对外暴露的东西（DOM 属性、CSS 变量、localStorage、宿主 API）。
2. **不许把它的色值抄进我们的源码当常量**。抄一次就要跟一辈子；必须是运行时读取。
3. **不许在它没装时崩**。`try/catch` + 降级，且降级后与现在的 auto 表现一致。

## 与宿主的边界

插件只能操作自己注入的 DOM 与 CSS 变量，不能改宿主设置页的样式。若发现 Claude Style 的配色只能通过宿主内部 API 拿到（插件够不着），**停下来报调度台**，不要用 DOM 打补丁硬取 —— 那比不做更脆。

## 交付要求

- 改动前后各出一张对照图（同一条卡片、同一语言、Claude Style 开/关各一张），用 `_ops/render-*.cjs` 的 harness 渲染，**不要用浏览器工具**（会卡死 teammate 会话）。
- 报告里写清：读取的是什么、多久轮询/监听一次、切换主题后多久生效、未安装时的行为。
- 跑 `node test/client.test.cjs` 必须 PASS；`lib/client.js` 的其余部分（卡片布局、文案、设置页）不许动。
