# v1.5.0 — 改名 Shutdown Guard

「所有任务完成后自动关机」，做成侧边栏里的一张卡片。

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/anim-radar.gif" width="330" alt="雷达外观，武装状态"></p>

## 亮点

- **侧边栏卡片**：位于「技能中心」下方、会话列表上方，三种外观（警戒带 / 雷达 / 终端），可折叠，主题自适应。
- **五道判定闸**：已武装 + 无倒计时 + 会话全空闲 + 无后台任务 + 无报错，缺一条都不关，并写清原因。
- **后台任务守卫**：`ctx.jobs` 里有运行中/停止中的任务时不下发关机，等最后一个结算完再算。
- **AFK 三件套**：替你回答 agent 提问（不代选选项）、报错时要求排查并继续、手动终止任务不会误关机。
- **阻断态**：额度/凭证/上下文超限等 `halted` 只有人能处理；限流/5xx/网络等 `waiting` 按策略自动重试。
- **按故障类型分策略**：限流走退避（高频重试会延长限流），瞬时故障走固定间隔，图片卸载只等 5 秒。

## 六种状态

| 未开启 | 待命 | 等待后台任务 |
| :---: | :---: | :---: |
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/01-off.png" width="220"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/02-armed.png" width="220"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/03-hold.png" width="220"> |

| 倒计时 | 已下发 | 阻断 |
| :---: | :---: | :---: |
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/04-fire.png" width="220"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/05-fired.png" width="220"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@v1.5.0/docs/screenshots/08-blocked-halted.png" width="220"> |

## 这个版本

- **改名**：`dsh-shutdown-panel` → `dsh-shutdown-guard`，版本跳到 1.5.0
- README 重写，配 16 张透明背景单图 + 3 张动图，全部由 `lib/client.js` 的真实 CSS 渲染
- 新增 `CONTRIBUTING.md`、`LICENSE`（MIT）
- 新增 `test/`（服务端 26 项断言 + 客户端 smoke）与 `scripts/`（图库生成、截图、动图）
- 修 README 早前被写坏的乱码
- 清理过期的 preview 页面与 STATUS.md

## 升级注意

包名变了，`localStorage` 键也跟着变（`dsh-shutdown-guard.variant` / `.theme` / `.folded`）。从旧版升级的话，外观偏好会回到默认 A / 跟随系统 —— 重新选一次即可，不影响任何判定逻辑。

HTTP 前缀也改为 `/api/dsh-shutdown-guard`。

## 安装

设置 → 插件 → 添加，填入插件目录的绝对路径 → 安装 → 重启 DSH。

手工兜底见 README 的「安装」一节。

> ⚠️ 客户端 bundle 只在 DSH 启动时编入模块图，改代码后必须重启，刷新页面无效。
