# Changelog

## v1.0.3 — 2026-11-02

- 警戒带接缝修好：改为单条 2 倍宽元素（`::before`）承载 `repeating-linear-gradient(115deg)`，用 `translateX(-22.07px)` 平移；周期 20/sin115°≈22.07px，不再按 34px 平铺，斜线连续。
- 卡片颜色不再受宿主主题干预：改用自有调色板 `--dsp-*`（bg/fg/muted/line/accent/danger/track/tape-a/tape-b），只在运行时读取宿主表面亮度（probe `var(--dsw-alias-bg-layer-1)`）决定 `data-lum="light|dark"`，浅色用另一套值；字体仍随宿主。
- 终端屏幕改为固定深色（`#0b0d10` / `#9ef0a8`），不再受主题 token 影响；设置分区保留宿主 token（它位于设置页）。

## v1.0.2 — 2026-11-02

- 警戒带改用固定琥珀 #f0a83a + 主题错误红：此前用 --dsw-alias-button-primary-fill，而当前主题的主按钮填充是近白色，条带成了白红相间。
- 卡片与「技能中心」按钮的点击判定区域对齐：host padding:0 12px 8px 0、卡片内边距 8px，实测卡片与面板按钮同为 x=12、宽 256。
- 未开启状态警戒带保持静止但保留 60% 不透明度，不再灰成一片。

## v1.0.1 — 2026-11-02

修复重启后出现的三个问题。

### 修复
- **会话列表消失**：卡片原先注册在 `sidebar.workspaces`，而该槽是 `single` 槽、已被会话浏览器占用；同优先级注册冲突导致会话浏览器整块不再渲染。卡片改为在侧边栏 `regionArea` 顶部插入独立 DOM 节点（React 不管理它），不再占用任何槽位，会话列表恢复正常。
- **卡片左缘未与「技能中心」对齐**：容器改为 `padding:6px 2px 8px`、卡片 `width:100%;margin:0`，左缘与面板行（`margin:0 2px`）对齐到同一 x。
- **警戒带图案/颜色异常**：去掉 `color-mix(... transparent)`，改为实色 `--dsw-alias-button-primary-fill` 与 `--dsw-alias-state-error-primary`，条带高度 10px、`background-size:34px 100%`，保持自右向左滚动。

### 变更
- 卡片改为纯 DOM 渲染 + 每秒对齐重挂载（侧边栏折叠/重建后会自动插回），只有设置分区仍用 React。
- 旧插件 `dsh-shutdown-after-task` 已从 profile 依赖、`pnpm.overrides`、`generationProjection`、`bundles`、`desired.json`、`node_modules` 软链与 `.generations/live` 目录中移除。

## v1.0.0 — 2026-11-02

侧边栏卡片版。

- 卡片位于「技能中心」下方、会话列表上方。
- 三种外观：A 警戒带 / B 雷达 / C 终端，可在 设置 → 插件 → 任务完成后关机 中切换。
- 纵向折叠：只留标题与状态标签，点击标题展开；可设为默认折叠。
- 状态机可视化：未开启 / 待命 / 等待后台任务 / 倒计时 / 已关机。
- 浅色、深色与第三方主题（如 Claude Style）自适应，颜色统一走 `--dsw-alias-*` token。
- 后台任务守卫（v0.1.1 引入）保留：有运行中的后台任务时不触发；倒计时中出现新任务会 `shutdown /a` 并保持武装。
- 外观与折叠状态写入 `localStorage`。

## v0.1.1 — 2026-10-24

- 新增 `ctx.jobs` 事件订阅：运行中的后台任务会阻止关机；取消倒计时后仍保持武装。

## v0.1.0 — 2026-10-21

- 首个可用版本：复用原插件关机逻辑，UI 为侧边栏底部一行 + `shell.overlay` 弹层。
