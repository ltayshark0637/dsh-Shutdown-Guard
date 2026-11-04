# 20 侧边栏界面（sidebar UI）

你负责侧边栏那张守夜卡片的全部可见部分：五态（待命/武装/倒计时/阻断/关闭）、警戒带、雷达、圆环、折叠态、主题适配、三语文案。

## 你拥有

`lib/client.js`（64KB 单文件，CSS 与 React 组件都在里面）、`lib/i18n.mjs`（zh/en/ru）。

## 你不碰

`lib/index.mjs`（10 的，state 与事件由它定义）、`test/**`（30 的）、`README*` 与 `docs/**` 与截图脚本（40 的）、`package.json`（50 的）、`preview/**`（只读参考，不许当产物）。

## 你必须守住的技术事实

- 浏览器侧只 `require('react')`，不引其它运行时依赖。
- CSS 必须写在 `lib/client.js` 内部 —— 因为 README 的图**由这段真实 CSS 生成**，样式挪走等于文档脱节。
- 三语文案全部走 `i18n.mjs` 的 key，不许在组件里写死中文或英文。
- 折叠态、变体、语言三项设置会持久化，改 key 名等于让用户设置丢失，要慎重并知会 50。

## 完成后必须自证

```bash
node test/client.test.cjs
```

只改了可见样式时也要跑（截图脚本吃的是真实 CSS）。若改了配色或布局，还要：

```bash
node scripts/gen-gallery.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1
```

然后**通知 40 重新生成文档图** —— 图不是你交付的，你只交付"CSS 是对的"。

## 跨 Agent 通讯

- **你消费契约，不定义契约。** 卡片要显示的新数据，先向 10 提需求：说出"哪个状态下要显示什么、为空时怎么显示"，由 10 改 `state` 并广播。不许自己在 client 里推算（会与宿主的判定逻辑分叉）。
- 你新增或改动了文案 key → 通知 40，否则三份 README 和 demo 页会指向不存在的 key。
- 你动了卡片尺寸/外观 → 通知 40（图要重生成）、通知 30（若有像素或 DOM 断言）。
- 你发现 `state` 里某字段永远为空或语义不明 → 报 10 与调度台，不要"猜一个默认值"糊过去。

## 常见坑（本仓库真实踩过）

- 圆环/雷达用 `clip-path` 或 `conic-gradient` 时，父容器必须有明确尺寸，否则裁剪出半个环。
- 折叠态高度变化会触发侧边栏重排，动画期间不要改 `height` 的 `auto` 值。
- 语言切换后必须强制重绘一次，否则卡片头部标题会停在旧语言。
- 主题适配不要写死 `#fff/#000`，用宿主暴露的 CSS 变量。

## 禁止

- 在 `lib/client.js` 里读文件、发网络请求、调用 `node:*`。
- 为让某张截图好看而在 CSS 里加只在该截图生效的 hack。
- 手改 `preview/*.png` 或 `docs/screenshots/*`（那是 40 的产物）。
