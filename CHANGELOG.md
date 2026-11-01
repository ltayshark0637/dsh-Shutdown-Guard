# Changelog

## v1.0.0 — 2026-11-02

侧边栏卡片版。

### 新增
- 卡片迁移到 `sidebar.workspaces` 槽（技能中心下方、会话列表上方），替代 v0.1 的底部行 + 弹层；`order: -100` 保证永远排在同类模块之前。
- 三种外观：A 警戒带 / B 雷达 / C 终端，可在 设置 → 插件 → 任务完成后关机 中切换。
- 纵向折叠：只留标题与状态标签，点击标题展开；可设为默认折叠。
- 状态机可视化：未开启 / 待命 / 等待后台任务 / 倒计时 / 已关机，含底部警戒带滚动、倒计时红点脉冲、雷达扫描与圆点、终端条件指示灯。
- 设置分区：外观选择、默认折叠、说明文案。
- 浅色 / 深色 / 第三方主题（如 Claude Style）自适应，颜色统一走 `--dsw-alias-*` token。

### 变更
- 后台任务守卫（v0.1.1 引入）保留：有运行中的后台任务时不武装，倒计时中返回新任务会 `shutdown /a` 并保持武装。
- 卡片外观与折叠状态写入 `localStorage`。

### 移除
- `sidebar.footer.action` 底部行、`shell.overlay` 弹层，以及对应的浮层样式。

## v0.1.0 — 2026-10-21

基础版。

- 复刻 `dsh-shutdown-after-task@0.2.0` 的 Windows 关机/取消、空闲判定、出错跳过与 HTTP 轮询。
- UI：侧边栏底部一行 + 弹层面板（武装 / 取消倒计时 / 解除）。
- 服务端：`/api/dsh-shutdown-panel/{state,arm,disarm,cancel}`，日志写入 `dsh-shutdown-panel.log`。

### v0.1.1
- 新增后台任务守卫：`ctx.jobs` 里存在 `running` / `stopping` 任务时跳过关机（`blockOnJobs`，默认开）；`/state` 增加 `jobsRunning` / `jobsTotal`。
