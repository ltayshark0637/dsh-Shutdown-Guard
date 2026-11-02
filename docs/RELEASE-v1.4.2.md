# v1.4.2

「所有任务完成后自动关机」，做成侧边栏里的一张卡片。

![侧边栏卡片](https://raw.githubusercontent.com/USER/dsh-shutdown-guard/v1.4.2/docs/screenshots/01-hero.png)

## 亮点

- **侧边栏卡片**：位于「技能中心」下方、会话列表上方，三种外观（警戒带 / 雷达 / 终端），可折叠，主题自适应。
- **五道判定闸**：已武装 + 无倒计时 + 会话全空闲 + 无后台任务 + 无报错，缺一条都不关，并写清原因。
- **后台任务守卫**：`ctx.jobs` 里有运行中/停止中的任务时不下发关机，等最后一个结算完再算。
- **AFK 三件套**：替你回答 agent 提问（不代选选项）、报错时要求排查并继续、手动终止任务不会误关机。
- **阻断态**：额度/凭证/上下文超限等 `halted` 只有人能处理；限流/5xx/网络等 `waiting` 按策略自动重试。
- **按故障类型分策略**：限流走退避（高频重试会延长限流），瞬时故障走固定间隔，图片卸载只等 5 秒。

## 这个版本

- README 按 v1.4 重写，含六张由真实 CSS 渲染的截图
- 新增 `CONTRIBUTING.md`、`LICENSE`（MIT）
- 新增 `test/`（服务端 27 项断言 + 客户端 smoke）与 `scripts/`（图库生成 + 截图）
- 修 README 早前被写坏的乱码
- 清理过期的 preview 页面与 STATUS.md

## 安装

设置 → 插件 → 添加，填入插件目录的绝对路径 → 安装 → 重启 DSH。

手工兜底见 README 的「安装」一节。

> ⚠️ 客户端 bundle 只在 DSH 启动时编入模块图，改代码后必须重启，刷新页面无效。

## 约束

- 仅 Windows（非 `win32` 平台早退不挂载）
- 零运行时依赖
- 不修改 `app.asar` 或 DSH 源码

## 完整变更

见 [CHANGELOG.md](CHANGELOG.md)。

---

**Full Changelog**: https://github.com/USER/dsh-shutdown-guard/compare/v1.4.1...v1.4.2
