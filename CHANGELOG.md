# Changelog

## v1.5.2 — 2026-11-04

- 新增独立悬浮窗口：宿主侧新增 `GET /api/dsh-shutdown-guard/window`，返回一个自包含的只读页面（内联 CSS / JS，除同源 `/state` 外不外联任何资源），侧边栏卡片上多一个入口按钮，点开即得到真正的第二个窗口，可以拖到副屏一直盯着倒计时。页面自带三语文案，不占用宿主目录的键；文案由宿主按当前语言渲染好后直接显示。
- 设置菜单标题跟随宿主语言即时切换：语言一变，设置里的标题立即跟着变，不需要重启 DSH。两条路径都覆盖了——`ctx.locale.register` 注册命名空间（宿主在 locale revision 变化时重读设置台账），以及切换语言后重新注册 `settings.section` 槽位（槽位版本变化时宿主才会重读标签）。语言偏好仍经 `POST /config` 的 `language` 字段写入，权威值落在 `data/config.json`。
- 卡片文案全部走三语目录（100 键 × 3 语，键集齐平）。**中文界面刻意保留一批英文技术词**：状态方块（`OFF` / `ARMED` / `WAIT` / `FIRE` / `DONE` / `PAUSED`）、雷达 HUD 状态词（`Holding` / `Offline` / `Retrying` …）、终端风命令行（`T-minus` / `holding` / `halted` …）、`shutdown --when idle` 这类命令名；其余说明、计数、按钮、设置页全为中文。英文与俄文界面各自完整翻译，不受这条混排约定影响。
- 文档：三份 README 补独立悬浮窗口的说明；`docs/screenshots/` 下 20 张截图与 3 段动画（共 23 个文件）按 v1.5.2 重新生成，截图文案改由 `scripts/gen-gallery.cjs` 直接从 `lib/client.js` 的 MSG 目录与内联 CSS 读取，不再手工同步（出图仍走 `scripts/screenshot.ps1`，不手工 P 图）。
- 图标：新增 `scripts/gen-icon.cjs`，由脚本生成 `assets/` 下的 180px 站点图标与图标集；`package.json` 的 `icon` 字段指向 `assets/icon-shield-2-128.png`（琥珀盾牌 + 30% 透明内层做厚度 + 实心关机符号，36px 档单独绘制），插件列表里不再显示默认齿轮。设置页左侧导航里我们那一行也换成了同一枚盾牌的单色版（`assets/icon-mono-transparent-64.png`，纯 alpha、无颜色），由客户端用 CSS `mask` + `currentColor` 绘制，因此深浅主题自动跟随；这是宿主暂不支持的 DOM 补丁，宿主将来若提供官方图标字段应改用官方字段。
- 测试：新增 `window-page-ok` 断言 —— `/window` 返回 200、`text/html`、完整文档且含产品名；路由清单断言同步加入该路由，宿主断言共 28 项。
- 修复：热重载后侧边栏偶发出现两个卡片（第二个是改动前的旧卡片，文案还是英文）。原因是新的模块实例只认自己内存里的 `host`，旧实例留在 DOM 里的节点和它的轮询定时器都没人管。现在用实例令牌 `window.__dshShutdownGuardOwner` 定主：新实例挂载即接管，旧实例下一拍发现主人不是自己就清掉自己的节点并停手；建 host 前先清掉 `regionArea` 里残留的同类节点；`<style>` 标签同样去重。
- 修复：`recentEvents()` 的两个调用点漏传 `lang`（写成 `recentEvents(since)`），参数错位后语言落到英文兜底、`since` 也一起失效——表现是中文界面里「最近事件」全是英文，且客户端每轮都拿到全量事件。已修正调用（`lib/index.mjs:1264`、`:1438`），事件文本现在按当前语言在出口现渲染，切换语言后同一批历史事件也会跟着变；增量游标恢复生效。
- 中文界面的技术词按既定约定保持英文：`code.waiting` / `code.halted` 渲染为「`waiting` · 自动重试」「`halted` · 需人工处理」——技术词英文、解释中文，与上一栏的混排约定一致。

## v1.5.1 — 2026-11-04

- 三语界面：中文 / English / Русский。宿主侧文案目录 78 键、侧边栏卡片 74 键，三语键集齐平、零缺失；日志与提示全部改走 `t(lang, key)`，`lib/index.mjs` 内已无硬编码中文串。
- 新增语言选择器：设置 → 插件 → 任务完成后关机 → 「语言」，切换即时生效——经 `POST /api/dsh-shutdown-guard/config` 的 `language` 字段落盘，卡片强制重绘，不需要重启 DSH。
- 新增 `language` 配置项：取值 `auto` | `zh` | `en` | `ru`，默认 `auto`（跟随系统语言）。它由 `loadStore`（`lib/index.mjs:283`）读取、经 `POST /config` 在运行时写入；**不是** `normalizeProfile` 字段，三份 README 的配置表已单独为它补一行。
- 语言偏好同时写入宿主配置（`data/config.json`）与浏览器 `localStorage`：前者是权威值，后者让卡片在首帧就按所选语言渲染，重启后不再闪一下中文。
- 文档：新增 `README.en.md`、`README.ru.md`，三份 README 的配置表统一补 `language` 行；演示页改成三语（`scripts/demo/i18n.js`，157 键）。
- 修复：切换语言后，事件日志里切换前的旧行会永久停留在旧语言；现在切换时整环重取（`lib/client.js` `setSnapshot`）。
- 修复：`saveStore()` 在 `apply()` 外引用越界变量，写 `data/config.json` 失败时会抛 `ReferenceError`、`log.configWriteFailed` 提示永远打不出来（`lib/index.mjs:292-295`、`:1039`）。
- 可访问性：设置里 5 个开关补 `aria-label`，屏幕阅读器可读出开关名称（未新增文案键）。
- 测试：新增 i18n 目录断言——`LANGS` 固定为三语、`catalogCoverage().missing` 为空、每语键数与基准一致。
- ⚠️ 升级注意：**已有配置无需任何改动或迁移**。`language` 缺省即 `auto`，与 v1.5.0 的行为一致；升级后若想固定语言，在设置里选一次即可。

## v1.5.0 — 2026-11-02

- 改名：`dsh-shutdown-panel` → **`dsh-shutdown-guard`**（Shutdown Guard）。原名只描述了界面，没表达它真正的特长——关机前逐条排除。`shutdown` 仍在包名第二位，市场按关键词搜索时排序不受影响。
- 同步改名：HTTP 前缀 `/api/dsh-shutdown-guard`、`localStorage` 键前缀、`<style data-dsh-shutdown-guard>`、客户端 bundle id、`cordis.patch.yml` 的行 id。
- ⚠️ 升级注意：旧版写在浏览器 `localStorage` 里的外观偏好（`dsh-shutdown-panel.variant` 等）不会迁移，升级后回到默认 A / 跟随主题 / 不折叠。如需保留，手动在设置里重选一次。

## v1.4.2 — 2026-11-02

- 文档补齐：README 按 v1.4 重写（截图、功能矩阵、重试策略、FAQ），新增 CONTRIBUTING.md、LICENSE。
- 修复 README 早前被 PowerShell 写坏的问题（	ransient 被吞成 ansient，反引号丢失）。
- 新增 	est/（服务端 27 项断言 + 客户端 bundle smoke，路径改为相对插件根）与 scripts/（从真实 CSS 生成图库、headless Edge 截图）。

## v1.4.1 — 2026-11-02

- 重试节奏改为按故障类型分别配置：etryPolicies 定义策略，etryAssign 把错误码映射到策略，两者都可从 cordis.patch.yml 覆盖。
- 默认分配：RATE_LIMIT → ate-limit（backoff 30→300）；SERVER/TRANSPORT/TIMEOUT → 	ransient（固定 20s）；EMPTY_RESPONSE → empty（30s）；IMAGE_OFFLOAD_REQUIRED → offload（5s）。
- WAITING_CODES 增至 6 项，补 TIMEOUT 与 IMAGE_OFFLOAD_REQUIRED。
- 修 bug：setArmed() 只清 locked、没清 etryAttempt/etryAt 也没取消挂起的重试定时器，导致「解除再武装」后新一轮退避直接从第 2 档（60s）开始。

## v1.4.0 — 2026-11-02

- 新增阻断态（blocked），插件不因此解除武装：卡片转色、状态行写原因，三种外观都有对应暂停外观。
- halted（灰蓝）：额度、凭证、上下文超限、能力不支持、磁盘写满 —— 只有人能处理，按钮变「解除并重试」。
- waiting（灰绿、圆点呼吸）：限流、5xx、网络、空响应 —— 到点自动重试，并向会话注入「继续原计划」指令。
- /state 新增 locked、etryAttempt、etryAt；设置页「状态」组新增「当前阻断」行。
- 设计文档 docs/blocked-states.md（分级语义、错误码表、重试节奏分析、stuck 归档理由）。

## v1.3.9 — 2026-11-02

- 修复：在分支对话里手动终止任务仍会触发关机。取消和正常结束都表现为 gent/status = idle，插件此前只看到后者。
- 新增 session/event 监听（宿主签名 (session, event)），按两条独立信号识别中断：	urn/end 带取消原因；或本轮从 	urn/start 到 	urn/end 没追加过任何 ssistant/message。
- 命中中断时不武装，并记「已检测到用户中断，本轮不关机」。

## v1.3.8 — 2026-11-02

- 尝试用 AbortError 拦截用户中断。事后证明打不中 —— 终止不走 gent/error，被 v1.3.9 取代。

## v1.3.7 — 2026-11-02

- 引入 HALTED_CODES：额度、凭证、上下文超限等不可恢复错误不再当成普通失败处理（否则会在用户不在场时照常关机），改为置 locked，并在 	ryArm() 最前面拦截。

## v1.3.6 — 2026-11-02

- 新语义：当「有会话报错就跳过」关闭、且 AFK 自动回答开启时，出错批次不再永久阻止关机。第 1 次报错让 agent 排查，第 2 次下「收尾」指令；收尾那一轮结束后该会话的错误不再计入拦截条件。
- 仅在「报错就跳过」关闭时生效；该开关打开时出错的批次照旧整轮跳过。
- 重试计数与收尾标记都在武装/解除时清零。
## v1.3.5 — 2026-11-02

- 新增调试钩子 POST /api/dsh-shutdown-guard/error-test，仅在 cordis.patch.yml 里设置 debugHooks: true 时注册。它用第一个 root 会话走一遍真实的 AFK 报错恢复链路（注入 + 日志 + 不关机），便于在没有真实崩溃时演练 T4。
- 错误处理逻辑抽成 handleAgentError(agent)，事件监听与调试端点共用同一条代码路径。

## v1.3.4 — 2026-11-02

- AFK 错误恢复：武装且 AFK 开关打开时，root 会话报错不再直接跳过/关机，而是向该会话注入一条恢复指令——先定位并修复报错、按原计划继续；同一会话第二次报错则要求它停止重试、把结果与失败原因写成报告落盘后收尾；第三次不再注入。
- 注入走 `agent.followup(message)`（等价于追加一轮用户消息），失败回落 `agent.steer`，都不可用则只记日志、不触发关机。
- 重试次数只在武装/解除时清空，避免「注入 → 重跑 → 再报错」无限循环。
- 另加一层保险：AFK 开关打开时，只要本批次存在报错会话就不武装关机（即使「有会话报错就跳过」是关的），等恢复成功、报错集合清空后再走正常流程。

## v1.2.0 – v1.3.3（补记）

- 事件与 state 跟随插件：data/events.log、data/config.json，1 个默认档 + 8 个自定义档。
- 设置拆成三组：外观 / 何时关机 / 状态，含事件日志。
- 默认配置倒计时锁 60 秒（countdownLocked），自定义档可调。
- AFK 自动回答：武装时替用户回答提问（user-questions/request，prepend 抢在 Web 回答者之前）。
- 「AFK 自动回答」行下移到「倒计时时长」之后。
## v1.1.1 — 2026-11-02

- 设置页按 Claude Style 的行式布局重做：每行 14px 标题 + 12px 说明，行间 0.5px 分隔线，上下 14px 留白。
- 控件放大：分段按钮 30px 高 / 13px 字，开关 36×20，滑块 16px。
- 卡片字号同步放大：标题 12.5px、说明 11.5px、按钮 30px 高 / 12.5px、主数字 26px。

## v1.1.0 — 2026-11-02

- 折叠态上下内边距 10→6px（高 42→34px）。
- 警戒带 115°→45°，滚动位移改 28.28px。
- 设置页补齐外观/配色/折叠/判定条件/跳过原因/C 模式说明。
- 新增 POST /config（onlyOnSuccess / blockOnJobs），/state 同步返回。
- 修「设置不跟手」：切换后立即重绘，不再等 1s 轮询。

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
