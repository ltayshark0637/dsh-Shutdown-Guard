# dsh-shutdown-panel v1.3

把「所有任务完成后自动关机」做成侧边栏里的一张卡片：位于「技能中心」下方、会话列表上方，随任务状态实时变化。

本插件复刻 `dsh-shutdown-after-task@0.2.0` 的服务端判定逻辑（Windows 关机/取消、空闲判定、出错跳过、后台任务守卫、HTTP 状态轮询），UI 改为客户端插件槽位注册；原件的右下角浮动按钮与 DOM 注入全部移除。

## 功能

- **武装模式**：所有 root 会话结束后触发一次关机倒计时（默认 60 秒）。
- **后台任务守卫**：有 `running` / `stopping` 的后台任务（`ctx.jobs`）时不下达关机指令，等最后一个后台任务结算后再武装；倒计时期间出现新后台任务同样 `shutdown /a` 取消，模式保持武装。
- **倒计时期间新任务开始**：自动 `shutdown /a` 取消，模式保持武装。
- **仅成功时关机**（默认开）：本批次有 root 会话报错时跳过，并记录跳过原因。
- **卡片三态皮肤**（设置里切换，默认 A）：
  - A 警戒带：大字状态 + 底部滚动红黄警戒条
  - B 雷达：同心圆、扫描光束、会话/后台任务圆点（数量变化只增删，不重排）
  - C 终端：命令行摘要 + 6 段判定条件指示灯
- **纵向折叠**：收起后只保留标题与状态标签，点击标题展开；默认折叠可在设置里开启。
- **浅色 / 深色 / 第三方主题自适应**：颜色走 `--dsw-alias-*` token，Claude Style 等主题自动跟随。
- **AFK 自动回答**（默认开）：武装期间 agent 若向你提问，插件替用户作答，告诉 agent 你处于 AFK、先完成已交代的任务、汇总报告落盘，不触碰未交代的分支。返回 `selected: []` + `custom` 说明文本，所以不会替你选中任何选项；关掉后提问照常抛给用户。
- 卡片按钮：武装 / 取消关机 / 解除，每秒刷新状态。

## 配置（`cordis.patch.yml`）

| 键 | 范围 | 默认 | 说明 |
| --- | --- | --- | --- |
| `countdownSec` | 10–600 | 60 | 关机前倒计时秒数（**默认配置固定 60 秒，不可改**） |
| `marginSec` | 0–60 | 5 | 传给 `shutdown /t` 的额外余量 |
| `onlyOnSuccess` | bool | true | 本批次有会话报错时跳过关机 |
| `blockOnJobs` | bool | true | 有运行中的后台任务（`ctx.jobs`）时跳过关机 |
| `afkAutoAnswer` | bool | true | 武装期间替用户回答 agent 提问（AFK 说明） |

卡片外观（A/B/C）与默认折叠存在浏览器 `localStorage`：`dsh-shutdown-panel.variant`、`dsh-shutdown-panel.folded`。

## 安装

插件根目录：`C:\Users\Harness\AppData\Roaming\dsh-desktop\harness\plugins\dsh-shutdown-panel`

推荐：设置 → 插件 → 添加，填上面的本地绝对路径 → 安装 → 重启 DSH。

手工兜底（本机当前采用）：在 `profiles\web` 建立 `node_modules\dsh-shutdown-panel` 软链指向本目录，并在 `profiles\web\package.json` 的 `dependencies`、`pnpm.overrides` 加 `link:` 项、`dsh.profile.bundles` 追加 `dsh-shutdown-panel`，随后重启 DSH。

> 客户端 bundle 只在 DSH 启动时编入模块图：改动 `lib\client.js` 后必须重启 DSH，刷新页面无效。服务端同理（本机 HMR 对本地链接插件不生效）。

## HTTP 前缀（同源轮询）

`/api/dsh-shutdown-panel`

- `GET /state` → `{ armed, state, deadline, countdownSec, erroredCount, lastSkip, runningCount, rootsCount, jobsRunning, jobsTotal }`，`state ∈ idle|countdown|fired`
- `POST /arm` / `POST /disarm` / `POST /cancel`
- 非本机 Origin 的 POST 返回 403；非 POST 返回 405。

## 日志

`<DSH_HOME>\dsh-shutdown-panel.log`（`DSH_HOME` 未设置时落在进程工作目录）。

## 版本

- `v0.1`：侧边栏底部一行 + 弹层面板（基础版，判定逻辑已完整）。
- `v1.0`：卡片迁到 `sidebar.workspaces`，新增三种外观、折叠、设置分区、浅色/第三方主题适配；新增后台任务守卫。

完整变更见 `CHANGELOG.md`。

## 卸载

设置 → 插件 → 卸载 `dsh-shutdown-panel`；手工兜底：从 `profiles\web\package.json` 的 `dependencies` / `dsh.profile.bundles` / `pnpm.overrides` 删除该项，删 `node_modules` 软链后重启。

## 约束

- 仅 Windows：非 win32 平台直接早退，不挂载。
- 零运行时依赖：服务端只用 `node:fs` / `node:path`，浏览器只 `require('react')`。
- 不修改 `app.asar` 与 DSH 源码。
