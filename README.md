# dsh-shutdown-panel

把「所有任务完成后自动关机」放进 DSH 侧边栏底部菜单：一行「任务完成后关机」，与「今日消耗金额 / 移动设备管理 / 设置」同区。

本插件复刻 `dsh-shutdown-after-task@0.2.0` 的服务端判定逻辑（Windows 关机/取消、空闲判定、出错跳过、HTTP 状态轮询），但删掉了原件的右下角浮动按钮与整套 DOM 注入代码，UI 改为客户端插件的槽位注册。

## 功能

- 武装模式：所有 root 会话结束后触发一次关机倒计时。
- 后台任务守卫：有 `running` / `stopping` 的后台任务（`ctx.jobs`）时不下达关机指令；等最后一个后台任务结算后再武装。倒计时期间出现新后台任务同样 `shutdown /a` 取消，模式保持武装。
- 倒计时期间若有新任务开始：自动 `shutdown /a` 取消，模式保持武装。
- `onlyOnSuccess`（默认开）：本批次有 root 会话报错时跳过，并记录跳过原因。
- 侧边栏行：展开态整行显示状态（未开启 / 已武装 / 倒计时 Ns / 已跳过），收起态为 36×36 图标 + 状态色点。
- 点击行打开面板：武装 / 取消倒计时 / 解除，面板每秒刷新状态。

## 配置（`cordis.patch.yml`）

| 键 | 范围 | 默认 | 说明 |
| --- | --- | --- | --- |
| `countdownSec` | 10–600 | 60 | 关机前倒计时秒数 |
| `marginSec` | 0–60 | 5 | 传给 `shutdown /t` 的额外余量 |
| `onlyOnSuccess` | bool | true | 本批次有会话报错时跳过关机 |
| `blockOnJobs` | bool | true | 有运行中的后台任务（`ctx.jobs`）时跳过关机 |

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

## 卸载

设置 → 插件 → 卸载 `dsh-shutdown-panel`；手工兜底：从 `profiles\web\package.json` 的 `dependencies` / `dsh.profile.bundles` / `pnpm.overrides` 删除该项，删 `node_modules` 软链后重启。

## 约束

- 仅 Windows：非 win32 平台直接早退，不挂载。
- 零运行时依赖：服务端只用 `node:fs` / `node:path`，浏览器只 `require('react')`。
- 不修改 `app.asar` 与 DSH 源码。
