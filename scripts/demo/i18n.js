// Demo page copy in three languages.
//
// Loaded twice:
//   - by scripts/gen-demo.cjs (Node, via require) so the build can read the
//     message table and the file text it inlines into docs/demo.html;
//   - by the browser, where it is inlined as a plain <script> right before
//     app.js and installs itself as window.DEMO_I18N.
//
// It stays dependency-free and UMD-shaped on purpose: no bundler, no build
// step, one file that both sides can use.
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.DEMO_I18N = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  var DEMO_LANGS = ['zh', 'en', 'ru']

  var DEMO_LABELS = { zh: '中文', en: 'English', ru: 'Русский' }

  var STORE_KEY = 'dsh-shutdown-guard-demo.lang'

  // Messages may contain inline markup (<b>, <code>, <a>, <span>) because some
  // sentences carry emphasis or a link. Text that must stay verbatim in every
  // language (Holding, Standby, `shutdown --when idle`, `jobs 3 · agent 2`) is
  // kept inside those strings untouched.
  //
  // SYNC CONTRACT — this table is a *copy* of product copy, not the source.
  // The card-facing keys below must match lib/client.js's MSG, which is the
  // single source of truth:
  //
  //   demo key                 ->  lib/client.js key
  //   card.title               ->  app.title
  //   card.arm/cancel/disarm   ->  btn.arm / btn.cancel / btn.disarm
  //   card.retry               ->  hud.retry
  //   card.a.*.big             ->  big.<state>          (off/armed/hold/fire/fired/…)
  //   card.a.*.meta            ->  meta.<state>         + meta.jobs / meta.sessions
  //   card.a.hold.jobs/agents  ->  meta.jobs / meta.sessions
  //   card.a.blocked.*.meta    ->  set.blocked.halted / set.blocked.waiting
  //   card.c.cond              ->  code.gates
  //   card.c.waiting/halted    ->  code.waiting / code.halted
  //   card.hud.retry/manual    ->  hud.retry / hud.manual
  //   card.hud.fired           ->  hud.state.fired
  //   var.A/B/C.name           ->  set.variant.a / b / c
  //   now.*                    ->  meta.* / hud.state.*
  //   log.*                    ->  data/events.log 的 view（宿主 i18n）
  //
  // Change any of those in lib/client.js and the same wording must land here,
  // in all three languages. Page-only keys (hero, a1–a7, try, install, cta,
  // sb.*) have no product counterpart and are free to change.
  var DEMO_MSG = {
    zh: {
      'meta.title': 'Shutdown Guard · 任务完成后自动关机',
      'meta.desc': '任务完成后自动关机 —— 侧边栏守夜卡片。三种外观、六种状态，可在这里直接试。',

      'repo.gh.aria': '在 GitHub 上查看 dsh-shutdown-guard',
      'repo.gh.title': '在 GitHub 上查看',
      'repo.npm.aria': '在 npm 上查看 dsh-shutdown-guard',
      'repo.npm.title': '在 npm 上查看',

      'hero.sub': '任务完成后自动关机<span>·</span>侧边栏守夜卡片',
      'hero.lede': '为 DeepSeek Harness 的侧边栏添加「所有任务完成后自动关机」卡片，拥有更好且多样的<b>视觉效果</b>、<b>判定逻辑</b>与<b>个性化定制</b>。',
      'chip.1': '五道判定闸',
      'chip.2': '三种外观',
      'chip.3': '个性化定制',
      'chip.4': 'AFK 自动接管',
      'chip.5': '阻断态分级',
      'tab.about': '<span class="n">01</span>了解',
      'tab.try': '<span class="n">02</span>试一试',
      'langs.aria': '切换语言',

      'sb.chat': '新会话',
      'sb.board': '工作台',
      'sb.plug': '插件',
      'sb.skill': '技能中心',
      'sb.sess1': '重构关机插件',
      'sb.sess2': '周报数据整理',
      'sb.sess3': 'iOS 构建脚本',
      'sb.sess4': '合同条款比对',
      'sb.t1': '1 分钟',
      'sb.t2': '14 小时',
      'sb.t3': '昨天',
      'sb.t4': '2 天',

      'a1.title': '<span>01</span>为什么需要它',
      'a1.p1': '跑长任务的人常有这个场景：晚上让 agent 把一批活干完，想让它干完就关机，人不在跟前。',
      'a1.p2': '但「任务结束」不等于「可以关机」——后台任务还在跑、会话报错了、agent 在等你回答问题、你在半路手动终止了……这些情况下关机全是事故。这个插件把这些情况逐个挡下来，只有真的可以关的时候才关。',

      'a2.title': '<span>02</span>判定：什么时候才关',
      'a2.p': '处于阻断态时直接不下发；其余五道闸门同时满足才下发 <code>shutdown /s</code>（C 形态那六格灯里，「只算成功」与「正在倒计时」是额外画出的两格，闸门还是五道）：',
      'a2.g1': '<b>已武装</b> —— 你手动点的',
      'a2.g2': '<b>没有倒计时在跑</b> —— 避免重复下发',
      'a2.g3': '<b>所有 root 会话都空闲</b> —— 没有任何 agent 还在干活',
      'a2.g4': '<b>没有运行中 / 停止中的后台任务</b> —— <code>blockOnJobs</code>，默认开',
      'a2.g5': '<b>本批次没有会话报错</b> —— <code>onlyOnSuccess</code>，默认开',

      'a3.title': '<span>03</span>三种外观',
      'a3.cap1': '<b>A · 极简</b>大标题 + 一句话，底部警示带',
      'a3.cap2': '<b>B · 雷达</b>同心圆 + 扫描光束，任务以圆点呈现',
      'a3.cap3': '<b>C · 终端</b>命令行摘要 + 六段判定指示灯',
      'a3.alt1': 'A · 极简：大标题 + 一句话，底部警示带',
      'a3.alt2': 'B · 雷达：同心圆 + 扫描光束，任务以圆点呈现',
      'a3.alt3': 'C · 终端：命令行摘要 + 六段判定指示灯',
      'a3.p1': '雷达里的圆点按数量增删、不重排：数量变化时，你正在看的那几个点不会跳位置。设置里切换，立即生效，无需重启。',
      'a3.p2': '想自己动手试试？打开 <a href="#try">试一试</a> —— 换外观、掷状态、看日志，都是本地随机的，不联网。',

      'a4.title': '<span>04</span>六种运行状态',
      'a4.pillsAria': '用哪种外观预览',
      'a4.p': '倒计时期间随时可取消，<b>取消后仍保持武装</b>——下一批任务干完照样会关。',

      'a5.title': '<span>05</span>阻断态',
      'a5.p': '遇到没法当普通失败处理的错误，插件<b>不解除武装</b>，卡片转色、把原因写出来：',
      'a5.li1': '<em>halted · 灰蓝</em>额度不足、凭证失效、上下文超限、能力不支持、磁盘写满。只有人能处理，点「解除并重试」。',
      'a5.li2': '<em>waiting · 灰绿</em>限流、5xx、网络中断、空响应、超时、图片卸载。按策略自动重试，到点注入「继续原计划」指令。',

      'a6.title': '<span>06</span>AFK 自动接管',
      'a6.p': '人不在跟前时，插件替你顶三件事：',
      'a6.li1': '<em>自动回答提问</em>agent 问你问题时，回复「用户处于 AFK，先完成已交代的任务，汇总报告并落盘」。返回 <code>selected: []</code> + 自定义文本，<b>不会替你选中任何选项</b>；关掉后提问照常抛给你。',
      'a6.li2': '<em>错误恢复</em>会话报错时先要求 agent 排查并继续原计划；同一会话再失败改为「停止重试、写报告收尾」。',
      'a6.li3': '<em>中断保护</em>你在半路手动终止任务，不会触发关机。',

      'a7.title': '<span>07</span>装在哪里',
      'a7.cap1': '武装时：技能中心下方、会话列表上方',
      'a7.cap2': '倒计时：同一位置，整条转红',
      'a7.alt1': '武装时：技能中心下方、会话列表上方',
      'a7.alt2': '倒计时：同一位置，整条转红',
      'a7.p': '卡片固定在侧边栏这个位置；点卡片右上角的窗口按钮，可以把状态面板拉成独立窗口，切到别的会话也看得见。',
      'a7.p2': '悬浮窗默认开启简洁模式：去掉页面边框与统计行，只留卡片。外观、主题、语言跟随设置，切换后约一秒内自动重绘；折叠状态不跟随——悬浮窗始终展开。',

      'install.text': '设置 → 插件 → 添加，填<b>插件目录的绝对路径</b> → 安装 → 重启 DSH。客户端的 bundle 只在启动时编入模块图，改完代码必须重启，刷新页面无效。',
      'install.link': '完整说明在 GitHub →',
      'cta.b': '不想只看图？',
      'cta.span': '左转「试一试」：随机一个场景，亲手点武装、取消、解除，一路看到关机或阻断。',
      'cta.btn': '去试一试',

      'try.appearance': '外观',
      'try.appearanceAria': '外观',
      'try.vA': 'A · 极简',
      'try.vB': 'B · 雷达',
      'try.vC': 'C · 终端',
      'try.scene': '场景',
      'try.roll': '随机一个场景',
      'try.armHint': '去左边点卡片上的「武装」开始检测',
      'try.now': '当前 <b>{state}</b>',
      'try.stop': '解除',
      'try.stopFired': '已下发，无需解除',
      'try.log': '模拟日志',
      'try.logEmpty': '还没有记录',
      'try.tips': '怎么玩',
      'try.tip1': '<b>左边是它真正待的地方</b>：技能中心下方、会话列表上方。点卡片右上角的窗口按钮，还能把它拉成独立窗口（默认简洁模式，只留卡片）。<b>这页的卡片可以点</b>，武装、取消、解除都在左边操作。',
      'try.tip2': '流程：<b>随机场景</b> → 点卡片上的<b>武装</b> → 开始检测 → 后台任务与会话逐个减少 → 全部结束后进入倒计时 → 下发。',
      'try.tip3': '检测途中会有小概率撞上阻断态：<code>halted</code> 要你点「解除并重试」，<code>waiting</code> 过几秒自己恢复。',
      'try.tip4': '倒计时期间你可以随时「取消关机」，模式仍保持武装；也可能撞上阻断。',
      'try.tip5': '真实插件的日志在 <code>设置 → 状态</code>，完整流水写在 <code>data/events.log</code>。这里倒计时用 12 秒，插件默认 60 秒。',

      'colophon.note': '演示页 · 数据全部本地随机，不联网',

      'card.title': '任务完成后关机',
      'card.float': '悬浮窗口',
      'radar.aria': '{total} 个 agent，其中 {running} 个在运行',
      'card.arm': '武装',
      'card.cancel': '取消关机',
      'card.retry': '解除并重试',
      'card.disarm': '解除',
      'card.a.off.big': '未开启',
      'card.a.off.meta': '仅在点击「武装」后才会运行程序',
      'card.a.armed.big': '待命',
      'card.a.armed.meta': '所有任务已结束 · 等待下一次触发',
      'card.a.fired.big': '已下发',
      'card.a.fired.meta': '关机指令已生效，无法取消',
      'card.a.fire.meta': '系统即将关机 · 可撤销',
      'card.a.hold.big': '等待后台任务',
      'card.a.hold.meta': '{bits}，完成后关机',
      'card.a.hold.jobs': '{n} 个后台任务',
      'card.a.hold.agents': '{n} 个会话',
      'card.a.blocked.halted.big': '已暂停',
      'card.a.blocked.halted.meta': '账户额度不足，需充值后解除',
      'card.a.blocked.waiting.big': '等待恢复',
      'card.a.blocked.waiting.meta': '请求过于频繁，稍后自动重试',
      'card.hud.retry': '稍后重试',
      'card.hud.manual': '需人工处理',
      'card.hud.fired': '已下发',
      'card.c.waiting': 'waiting · 自动重试',
      'card.c.halted': 'halted · 需人工处理',
      'card.c.cond': '条件 {n}/6 已满足',

      'state.off.t': '未开启',
      'state.off.d': '什么都没做',
      'state.armed.t': '待命',
      'state.armed.d': '已武装，等任务结束',
      'state.hold.t': '等待后台任务',
      'state.hold.d': '任务还在跑，先不关',
      'state.fire.t': '倒计时',
      'state.fire.d': '已下发，可撤销',
      'state.fired.t': '已下发',
      'state.fired.d': '指令生效，无法取消',
      'state.blocked.t': '阻断',
      'state.blocked.d': '遇到必须人处理的事',

      'now.blocked.halted': '阻断 · 需人工处理',
      'now.blocked.waiting': '阻断 · 等待自动恢复',
      'now.hold': '等待后台任务（{bits}）',
      'now.hold.jobs': '后台任务 {n}',
      'now.hold.agents': '会话 {n}',
      'now.countdown': '倒计时 {sec}',

      'var.A.name': '极简',
      'var.A.desc': '大标题 + 一句话 + 底部警示带',
      'var.B.name': '雷达',
      'var.B.desc': '同心圆 + 扫描光束',
      'var.C.name': '终端',
      'var.C.desc': '命令行摘要 + 六段指示灯',

      'log.boot': '点「随机一个场景」开始',
      'log.rolled': '随机成功：{jobs} 个后台任务、{agent} 个会话在跑',
      'log.hintArm': '点卡片上的「武装」开始检测',
      'log.armFirst': '先点「随机一个场景」',
      'log.float': '真实插件里，这个按钮会把状态面板拉成独立悬浮窗口；演示页不弹新窗口。',
      'log.armed': '已武装，开始检测：等所有任务结束再关机',
      'log.jobDone': '一个后台任务结束，还剩 {n} 个',
      'log.agentDone': '一个会话结束，还剩 {n} 个',
      'log.countdown': '全部任务已结束，开始倒计时 {sec} 秒',
      'log.fired': '倒计时结束，关机指令已下发',
      'log.blockHalted': '阻断：账户额度不足，需人工处理后点「解除并重试」',
      'log.blockWaiting': '阻断：请求过于频繁，4 秒后自动重试',
      'log.retried': '自动重试：继续检测',
      'log.cancelled': '已取消本次倒计时，模式仍保持武装',
      'log.parked': '队列已空，停在待命；点「解除」退出，或重新随机一轮',
      'log.disarmed': '已解除，停止检测',
      'log.retryResumed': '已解除阻断，继续检测',
      'log.variant': '切换外观：{v}',

      'a8.title': '08 设置页',
      'a8.p': '设置页分成四个标签：外观、守夜、通知、状态。外观页一屏五行、没有组标题；守夜页把「自定义配置」单独摆一行，往下才是配置组与守夜行为组。',
      'a8.p2': '新装只有一份「默认配置」，想要第二份时点「＋ 新建」。关掉「自定义配置」再打开，会回到上次用的那份；那份已被删除就停在默认配置。升级时从未动过的空槽会被清掉，改过名或动过任一开关的都会保留。',
      's.head.gh': 'GitHub',
      's.head.npm': 'npm',
      's.tab.look': '外观',
      's.tab.watch': '守夜',
      's.tab.notify': '通知',
      's.tab.status': '状态',
      's.look.a': '极简',
      's.look.b': '雷达',
      's.look.c': '终端',
      's.look.theme': '主题',
      's.theme.auto': '跟随',
      's.theme.dark': '深色',
      's.theme.light': '浅色',
      's.theme.claude': 'Claude',
      's.look.fold': '默认折叠',
      's.look.foldDesc': '折叠后只保留标题和状态。',
      's.look.compact': '悬浮窗简洁模式',
      's.look.compactDesc': '悬浮窗里隐去底部统计与事件，只留卡片。',
      's.look.lang': '语言',
      's.lang.auto': '跟随系统',
      's.lang.zh': '中文',
      's.lang.en': 'English',
      's.lang.ru': 'Русский',
      's.watch.custom': '自定义配置',
      's.watch.customDesc': '正在使用自定义配置，默认配置暂时挂起。',
      's.prof.group': '配置',
      's.prof.pick': '选择配置',
      's.prof.cur': '自定义 3（120 秒）',
      's.prof.default': '默认',
      's.prof.c1': '自定义 1',
      's.prof.setDefault': '设为默认',
      's.prof.rename': '重命名',
      's.prof.del': '删除',
      's.prof.new': '＋ 新建',
      's.watch.group': '守夜行为',
      's.row.sessions': '会话都停下来',
      's.row.sessionsDesc': '底线条件，始终开启。',
      's.always': '总是开启',
      's.row.jobs': '后台任务跑完',
      's.row.jobsDesc': '有后台任务在跑时，先不下发关机指令。',
      's.row.errors': '有会话报错就跳过这一轮',
      's.row.errorsDesc': '只认成功的任务，出过错的批次不关机。',
      's.row.cd': '倒计时时长',
      's.row.cdDesc': '关机前留出的取消时间，10–600 秒。',
      's.cd.30': '30 秒',
      's.cd.60': '60 秒',
      's.cd.90': '90 秒',
      's.cd.120': '2 分钟',
      's.cd.300': '5 分钟',
      's.notify.group': '通知',
      's.notify.master': '状态变化通知',
      's.notify.masterDesc': '进入倒计时、即将关机、首次阻断、阻断恢复时各一条。',
      's.notify.countdown': '进入倒计时',
      's.notify.fired': '即将关机',
      's.notify.blocked': '首次阻断',
      's.notify.recovered': '阻断恢复',
      's.status.group': '状态',
      's.status.blocked': '当前阻断',
      's.status.blockedV': '外部服务暂不可用，插件会自动重试。',
      's.status.last': '上次为什么没关机',
      's.status.lastV': '还有 2 个后台任务在运行，暂不关机。',
      's.status.log': '事件日志',
      's.status.logV': '最近 4 条，完整记录在插件 data/events.log。',
    },

    en: {
      'meta.title': 'Shutdown Guard · shut down when the work is done',
      'meta.desc': 'Shut down automatically once all work is done — a night-watch card in the sidebar. Three looks, six states, try it here.',

      'repo.gh.aria': 'View dsh-shutdown-guard on GitHub',
      'repo.gh.title': 'View on GitHub',
      'repo.npm.aria': 'View dsh-shutdown-guard on npm',
      'repo.npm.title': 'View on npm',

      'hero.sub': 'Shut down when the work is done<span>·</span>a night-watch card in the sidebar',
      'hero.lede': 'Adds a “shut down when every task is done” card to the DeepSeek Harness sidebar, with better and more varied <b>visuals</b>, <b>gating logic</b> and <b>personalisation</b>.',
      'chip.1': 'Five gates',
      'chip.2': 'Three looks',
      'chip.3': 'Personalisation',
      'chip.4': 'AFK auto-handling',
      'chip.5': 'Tiered blocked states',
      'tab.about': '<span class="n">01</span>Overview',
      'tab.try': '<span class="n">02</span>Try it',
      'langs.aria': 'Switch language',

      'sb.chat': 'New chat',
      'sb.board': 'Workbench',
      'sb.plug': 'Plugins',
      'sb.skill': 'Skill Center',
      'sb.sess1': 'Refactor shutdown plugin',
      'sb.sess2': 'Weekly report data',
      'sb.sess3': 'iOS build script',
      'sb.sess4': 'Contract clause diff',
      'sb.t1': '1 min',
      'sb.t2': '14 h',
      'sb.t3': 'Yesterday',
      'sb.t4': '2 days',

      'a1.title': '<span>01</span>Why it exists',
      'a1.p1': 'Anyone running long tasks knows the scene: you let the agent work through a batch overnight and want the machine to shut down when it is done, with nobody around.',
      'a1.p2': 'But “the task is finished” is not the same as “it is safe to shut down” — background jobs may still be running, a session may have errored, the agent may be waiting for your answer, you may have stopped it halfway. Shutting down in any of those cases is an incident. This plugin blocks each case, one by one, and only shuts down when it is genuinely safe.',

      'a2.title': '<span>02</span>The check: when it actually shuts down',
      'a2.p': 'In a blocked state nothing is sent. Otherwise all five gates must pass before <code>shutdown /s</code> is issued (the six blocks in look C also draw "success-only" and "counting down"; those are extra indicators, the gates stay five):',
      'a2.g1': '<b>Armed</b> — you clicked it yourself',
      'a2.g2': '<b>No countdown running</b> — avoids sending twice',
      'a2.g3': '<b>Every root session idle</b> — no agent is still working',
      'a2.g4': '<b>No running or stopping background jobs</b> — <code>blockOnJobs</code>, on by default',
      'a2.g5': '<b>No session errored in this batch</b> — <code>onlyOnSuccess</code>, on by default',

      'a3.title': '<span>03</span>Three looks',
      'a3.cap1': '<b>A · Minimal</b> A big status line, one sentence, hazard tape along the bottom',
      'a3.cap2': '<b>B · Radar</b> Concentric rings and a sweep; work shows up as dots',
      'a3.cap3': '<b>C · Terminal</b> A command-line summary plus six condition blocks',
      'a3.alt1': 'A · Minimal: a big status line, one sentence, hazard tape along the bottom',
      'a3.alt2': 'B · Radar: concentric rings and a sweep, tasks shown as dots',
      'a3.alt3': 'C · Terminal: command-line summary plus six decision LEDs',
      'a3.p1': 'Dots in the radar are added and removed by count, never re-sorted: when the number changes, the dots you are looking at stay put. Switch in settings — it applies immediately, no restart.',
      'a3.p2': 'Want to try it yourself? Open <a href="#try">Try it</a> — change the look, roll a state, watch the log. All local and random, no network.',

      'a4.title': '<span>04</span>Six runtime states',
      'a4.pillsAria': 'Which look to preview',
      'a4.p': 'A countdown can be cancelled at any time, and <b>cancelling keeps it armed</b> — the next batch will still be shut down when it finishes.',

      'a5.title': '<span>05</span>Blocked states',
      'a5.p': 'On an error that cannot be handled as an ordinary failure, the plugin <b>stays armed</b>, recolours the card and writes the reason down:',
      'a5.li1': '<em>halted · slate</em> Out of quota, invalid credentials, context limit, unsupported capability, disk full. Only a human can clear these: click “Clear and retry”.',
      'a5.li2': '<em>waiting · sage</em> Rate limit, 5xx, network drop, empty response, timeout, image unload. Retried automatically by policy; on success the agent is told to “continue the original plan”.',

      'a6.title': '<span>06</span>AFK auto-handling',
      'a6.p': 'When nobody is around, the plugin stands in for you in three places:',
      'a6.li1': '<em>Answering questions</em> When the agent asks something, it replies “The user is AFK. Finish the tasks already assigned, then summarise and write the report to disk.” It returns <code>selected: []</code> plus custom text, so it <b>never picks an option for you</b>; turn this off and questions reach you as usual.',
      'a6.li2': '<em>Error recovery</em> On a session error it first asks the agent to investigate and continue the original plan; a second failure in the same session becomes “stop retrying and close out with a report”.',
      'a6.li3': '<em>Interruption protection</em> If you stop a task halfway yourself, no shutdown is triggered.',

      'a7.title': '<span>07</span>Where it lives',
      'a7.cap1': 'When armed: below Skill Center, above the session list',
      'a7.cap2': 'Countdown: same spot, the whole strip turns red',
      'a7.alt1': 'When armed: below Skill Center, above the session list',
      'a7.alt2': 'Countdown: same spot, the whole strip turns red',
      'a7.p': 'The card lives here in the sidebar; the window button in its top-right corner detaches the status panel into a window of its own, so it stays visible when you switch sessions.',
      'a7.p2': 'The floating window starts in compact mode: page chrome and the stats line are dropped, only the card remains. Look, theme and language follow the settings and repaint within about a second; the folded state does not — a floating window is always expanded.',

      'install.text': 'Settings → Plugins → Add, enter the <b>absolute path to the plugin directory</b> → Install → restart DSH. The client bundle is only wired into the module graph at startup, so code changes need a restart — reloading the page does nothing.',
      'install.link': 'Full instructions on GitHub →',
      'cta.b': 'Rather click than read?',
      'cta.span': 'Head to “Try it”: roll a random scenario, then arm, cancel and clear it yourself, all the way to shutdown or a blocked state.',
      'cta.btn': 'Try it',

      'try.appearance': 'Look',
      'try.appearanceAria': 'Look',
      'try.vA': 'A · Minimal',
      'try.vB': 'B · Radar',
      'try.vC': 'C · Terminal',
      'try.scene': 'Scenario',
      'try.roll': 'Roll a random scenario',
      'try.armHint': 'Click “Arm” on the card on the left to start checking',
      'try.now': 'Now <b>{state}</b>',
      'try.stop': 'Clear',
      'try.stopFired': 'Already fired — nothing to clear',
      'try.log': 'Simulation log',
      'try.logEmpty': 'No entries yet',
      'try.tips': 'How to play',
      'try.tip1': '<b>The left side is where it really lives</b>: below Skill Center, above the session list. The window button in the card\'s top-right corner also detaches it into a window of its own (compact by default, card only). <b>The card on this page is clickable</b> — arm, cancel and clear all happen on the left.',
      'try.tip2': 'Flow: <b>roll a scenario</b> → click <b>Arm</b> on the card → checking starts → background jobs and sessions drain one by one → when all are done a countdown begins → the command is issued.',
      'try.tip3': 'While checking there is a small chance of hitting a blocked state: <code>halted</code> waits for you to click “Clear and retry”, <code>waiting</code> recovers on its own after a few seconds.',
      'try.tip4': 'During the countdown you can “Cancel shutdown” at any time; the mode stays armed. A blocked state can happen here too.',
      'try.tip5': 'The real plugin logs under <code>Settings → Status</code>, with the full stream in <code>data/events.log</code>. The countdown here is 12 seconds; the plugin defaults to 60.',

      'colophon.note': 'Demo page · all data is local and random, no network',

      'card.title': 'Shut down when done',
      'card.float': 'Floating window',
      'radar.aria': '{total} agents, {running} of them running',
      'card.arm': 'Arm',
      'card.cancel': 'Cancel shutdown',
      'card.retry': 'Clear and retry',
      'card.disarm': 'Clear',
      'card.a.off.big': 'Off',
      'card.a.off.meta': 'The program only runs after you click “Arm”',
      'card.a.armed.big': 'Standby',
      'card.a.armed.meta': 'All tasks finished · waiting for the next trigger',
      'card.a.fired.big': 'Fired',
      'card.a.fired.meta': 'Shutdown issued — cannot be cancelled',
      'card.a.fire.meta': 'Shutting down · can be cancelled',
      'card.a.hold.big': 'Waiting',
      'card.a.hold.meta': '{bits} — shuts down when done',
      'card.a.hold.jobs': '{n} background jobs',
      'card.a.hold.agents': '{n} sessions',
      'card.a.blocked.halted.big': 'Paused',
      'card.a.blocked.halted.meta': 'Out of account quota — top up, then clear',
      'card.a.blocked.waiting.big': 'Retrying',
      'card.a.blocked.waiting.meta': 'Too many requests — retrying automatically',
      'card.hud.retry': 'retrying shortly',
      'card.hud.manual': 'needs a human',
      'card.hud.fired': 'sent',
      'card.c.waiting': 'waiting · auto-retry',
      'card.c.halted': 'halted · needs a human',
      'card.c.cond': 'conditions {n}/6 met',

      'state.off.t': 'Off',
      'state.off.d': 'Nothing done yet',
      'state.armed.t': 'Standby',
      'state.armed.d': 'Armed, waiting for the tasks to finish',
      'state.hold.t': 'Waiting',
      'state.hold.d': 'Tasks still running — not shutting down yet',
      'state.fire.t': 'Countdown',
      'state.fire.d': 'Issued, can be cancelled',
      'state.fired.t': 'Fired',
      'state.fired.d': 'Issued and in effect — cannot be cancelled',
      'state.blocked.t': 'Blocked',
      'state.blocked.d': 'Something needs a human',

      'now.blocked.halted': 'Blocked · needs a human',
      'now.blocked.waiting': 'Blocked · waiting to recover',
      'now.hold': 'Now waiting on {bits}',
      'now.hold.jobs': '{n} background jobs',
      'now.hold.agents': '{n} sessions',
      'now.countdown': 'Countdown {sec}',

      'var.A.name': 'Minimal',
      'var.A.desc': 'Big status line + one sentence + hazard tape',
      'var.B.name': 'Radar',
      'var.B.desc': 'Concentric rings + sweep',
      'var.C.name': 'Terminal',
      'var.C.desc': 'CLI summary + six LEDs',

      'log.boot': 'Click “Roll a random scenario” to start',
      'log.rolled': 'Rolled: {jobs} background jobs, {agent} sessions running',
      'log.hintArm': 'Click “Arm” on the card to start checking',
      'log.armFirst': 'Roll a scenario first',
      'log.float': 'In the real plugin this button detaches the status panel into a floating window; this demo does not open one.',
      'log.armed': 'Armed, checking: shut down when every task is done',
      'log.jobDone': 'A background job finished — {n} left',
      'log.agentDone': 'A session finished — {n} left',
      'log.countdown': 'All tasks done — countdown started ({sec}s)',
      'log.fired': 'Countdown over — shutdown issued',
      'log.blockHalted': 'Blocked: out of account quota — clear it by hand, then “Clear and retry”',
      'log.blockWaiting': 'Blocked: too many requests — retrying in 4s',
      'log.retried': 'Auto-retry: checking again',
      'log.cancelled': 'Countdown cancelled — still armed',
      'log.parked': 'Queue is empty — resting in standby. Click “Clear” to exit, or roll again',
      'log.disarmed': 'Cleared — checking stopped',
      'log.retryResumed': 'Block cleared — checking again',
      'log.variant': 'Look changed: {v}',

      'a8.title': '08 Settings',
      'a8.p': 'Settings splits into four tabs: Appearance, Watch, Notifications, Status. Appearance is five rows on one screen with no group headings; Watch puts the custom-profile switch on its own row, then the profiles and the watch rules below it.',
      'a8.p2': 'A fresh install has one profile, Default; press “＋ New” for a second one. Turning the custom-profile switch off and back on returns to the profile you used last — if that one was deleted, you stay on Default. Upgrading prunes slots you never touched; anything you renamed or flipped a switch on is kept.',
      's.head.gh': 'GitHub',
      's.head.npm': 'npm',
      's.tab.look': 'Appearance',
      's.tab.watch': 'Watch',
      's.tab.notify': 'Alerts',
      's.tab.status': 'Status',
      's.look.a': 'Minimal',
      's.look.b': 'Radar',
      's.look.c': 'Terminal',
      's.look.theme': 'Theme',
      's.theme.auto': 'Auto',
      's.theme.dark': 'Dark',
      's.theme.light': 'Light',
      's.theme.claude': 'Claude',
      's.look.fold': 'Collapsed by default',
      's.look.foldDesc': 'Keeps just the title and the state.',
      's.look.compact': 'Compact floating window',
      's.look.compactDesc': 'Hides the stats and the event log, leaving the card alone.',
      's.look.lang': 'Language',
      's.lang.auto': 'Auto',
      's.lang.zh': '中文',
      's.lang.en': 'English',
      's.lang.ru': 'Русский',
      's.watch.custom': 'Custom profile',
      's.watch.customDesc': 'A custom profile is in use; Default is on hold.',
      's.prof.group': 'Profiles',
      's.prof.pick': 'Active profile',
      's.prof.cur': 'Custom 3 (120 s)',
      's.prof.default': 'Default',
      's.prof.c1': 'Custom 1',
      's.prof.setDefault': 'Make default',
      's.prof.rename': 'Rename',
      's.prof.del': 'Delete',
      's.prof.new': '＋ New',
      's.watch.group': 'Watch rules',
      's.row.sessions': 'All sessions stopped',
      's.row.sessionsDesc': 'The floor condition; always on.',
      's.always': 'Always on',
      's.row.jobs': 'Background jobs finished',
      's.row.jobsDesc': 'While a job is running, no shutdown command goes out.',
      's.row.errors': 'Skip a round with errors',
      's.row.errorsDesc': 'Only clean batches count; a batch that errored never shuts down.',
      's.row.cd': 'Countdown',
      's.row.cdDesc': 'Time to cancel before shutdown, 10–600 s.',
      's.cd.30': '30 s',
      's.cd.60': '60 s',
      's.cd.90': '90 s',
      's.cd.120': '2 min',
      's.cd.300': '5 min',
      's.notify.group': 'Alerts',
      's.notify.master': 'Tell me when the state changes',
      's.notify.masterDesc': 'One notice each for the countdown, the last call, the first block and the recovery.',
      's.notify.countdown': 'Countdown starts',
      's.notify.fired': 'About to shut down',
      's.notify.blocked': 'First block',
      's.notify.recovered': 'Block cleared',
      's.status.group': 'Status',
      's.status.blocked': 'Blocked right now',
      's.status.blockedV': 'The external service is down; the plugin retries on its own.',
      's.status.last': 'Why it did not shut down',
      's.status.lastV': 'Two background jobs were still running, so it held off.',
      's.status.log': 'Event log',
      's.status.logV': 'The last four lines; the full log is in the plugin’s data/events.log.',
    },

    ru: {
      'meta.title': 'Shutdown Guard · выключение после завершения задач',
      'meta.desc': 'Автоматическое выключение, когда все задачи готовы, — карточка ночного сторожа в боковой панели. Три вида, шесть состояний, можно попробовать здесь.',

      'repo.gh.aria': 'Открыть dsh-shutdown-guard на GitHub',
      'repo.gh.title': 'Открыть на GitHub',
      'repo.npm.aria': 'Открыть dsh-shutdown-guard на npm',
      'repo.npm.title': 'Открыть на npm',

      'hero.sub': 'Выключение после завершения задач<span>·</span>карточка ночного сторожа в боковой панели',
      'hero.lede': 'Добавляет в боковую панель DeepSeek Harness карточку «выключить, когда всё готово»: более выразительная <b>визуальная часть</b>, продуманная <b>логика проверок</b> и <b>настройка под себя</b>.',
      'chip.1': 'Пять проверок',
      'chip.2': 'Три вида',
      'chip.3': 'Настройка под себя',
      'chip.4': 'Авто-режим AFK',
      'chip.5': 'Уровни блокировки',
      'tab.about': '<span class="n">01</span>Обзор',
      'tab.try': '<span class="n">02</span>Попробовать',
      'langs.aria': 'Сменить язык',

      'sb.chat': 'Новый чат',
      'sb.board': 'Рабочая панель',
      'sb.plug': 'Плагины',
      'sb.skill': 'Центр навыков',
      'sb.sess1': 'Переработка плагина выключения',
      'sb.sess2': 'Данные недельного отчёта',
      'sb.sess3': 'Скрипт сборки iOS',
      'sb.sess4': 'Сравнение пунктов договора',
      'sb.t1': '1 мин',
      'sb.t2': '14 ч',
      'sb.t3': 'Вчера',
      'sb.t4': '2 дня',

      'a1.title': '<span>01</span>Зачем это нужно',
      'a1.p1': 'Кто запускает долгие задачи, знает этот сценарий: вечером отдаёте агенту пачку работы и хотите, чтобы машина выключилась после, когда рядом никого нет.',
      'a1.p2': 'Но «задачи завершены» не значит «можно выключать»: фоновые задачи ещё идут, сессия завершилась с ошибкой, агент ждёт вашего ответа, вы сами остановили его на полпути — в любом из этих случаев выключение становится аварией. Плагин отсекает каждый такой случай и выключает, только когда это действительно безопасно.',

      'a2.title': '<span>02</span>Проверка: когда выключение разрешено',
      'a2.p': 'В состоянии блокировки команда не отправляется. Иначе должны пройти все пять проверок, и только потом отправляется <code>shutdown /s</code> (шесть блоков в виде C дополнительно показывают «только успешные» и «идёт отсчёт» — это индикаторы, а не проверки):',
      'a2.g1': '<b>Режим включён</b> — вы нажали сами',
      'a2.g2': '<b>Нет активного обратного отсчёта</b> — чтобы не отправить дважды',
      'a2.g3': '<b>Все корневые сессии свободны</b> — ни один агент не работает',
      'a2.g4': '<b>Нет выполняющихся или останавливающихся фоновых задач</b> — <code>blockOnJobs</code>, включено по умолчанию',
      'a2.g5': '<b>В этой партии не было ошибок сессий</b> — <code>onlyOnSuccess</code>, включено по умолчанию',

      'a3.title': '<span>03</span>Три вида',
      'a3.cap1': '<b>A · Минимал</b> Крупный заголовок, одна строка, сигнальная лента внизу',
      'a3.cap2': '<b>B · Радар</b> Концентрические круги и луч сканирования, задачи показаны точками',
      'a3.cap3': '<b>C · Терминал</b> Сводка командной строки и шесть индикаторов проверок',
      'a3.alt1': 'A · Минимал: крупный заголовок, одна строка, сигнальная лента внизу',
      'a3.alt2': 'B · Радар: концентрические круги и луч сканирования, задачи точками',
      'a3.alt3': 'C · Терминал: сводка командной строки и шесть индикаторов проверок',
      'a3.p1': 'Точки на радаре добавляются и убираются по количеству, но не пересортировываются: когда число меняется, точки, на которые вы смотрите, остаются на местах. Вид переключается в настройках и применяется сразу, без перезапуска.',
      'a3.p2': 'Хотите попробовать сами? Откройте <a href="#try">«Попробовать»</a> — сменить вид, выбросить состояние, посмотреть журнал. Всё считается локально и случайно, без сети.',

      'a4.title': '<span>04</span>Шесть рабочих состояний',
      'a4.pillsAria': 'Какой вид показывать',
      'a4.p': 'Отсчёт можно отменить в любой момент, и <b>отмена сохраняет режим</b> — следующая партия задач всё равно приведёт к выключению.',

      'a5.title': '<span>05</span>Состояния блокировки',
      'a5.p': 'Если ошибку нельзя обработать как обычный сбой, плагин <b>не снимает режим</b>, меняет цвет карточки и пишет причину:',
      'a5.li1': '<em>halted · серо-синий</em> Кончилась квота, недействительные учётные данные, превышен контекст, возможность не поддерживается, диск заполнен. Справится только человек: нажмите «Снять и повторить».',
      'a5.li2': '<em>waiting · серо-зелёный</em> Ограничение частоты, 5xx, обрыв сети, пустой ответ, таймаут, выгрузка изображения. Повтор по правилам; после успеха агенту передаётся «продолжай по исходному плану».',

      'a6.title': '<span>06</span>Авто-режим AFK',
      'a6.p': 'Когда рядом никого нет, плагин подменяет вас в трёх случаях:',
      'a6.li1': '<em>Ответы на вопросы</em> На вопрос агента он отвечает: «Пользователь в режиме AFK, заверши уже порученные задачи, сведи отчёт и сохрани его на диск». Возвращается <code>selected: []</code> и свой текст, поэтому <b>ни один вариант за вас не выбирается</b>; если выключить, вопросы снова приходят вам.',
      'a6.li2': '<em>Восстановление после ошибок</em> При ошибке сессии агента сначала просят разобраться и продолжить исходный план; повторный сбой в той же сессии превращается в «прекрати повторять и закройся отчётом».',
      'a6.li3': '<em>Защита от прерывания</em> Если вы сами остановили задачу на полпути, выключение не запускается.',

      'a7.title': '<span>07</span>Где он находится',
      'a7.cap1': 'Режим включён: под центром навыков, над списком сессий',
      'a7.cap2': 'Обратный отсчёт: то же место, вся полоса краснеет',
      'a7.alt1': 'Режим включён: под центром навыков, над списком сессий',
      'a7.alt2': 'Обратный отсчёт: то же место, вся полоса краснеет',
      'a7.p': 'Карточка живёт здесь, в боковой панели; кнопка с окном в её правом верхнем углу выносит панель состояния в отдельное окно — оно остаётся на виду, когда вы переключаетесь на другую сессию.',
      'a7.p2': 'Плавающее окно открывается в компактном режиме: рамка страницы и строка статистики убираются, остаётся только карточка. Вид, тема и язык следуют настройкам и перерисовываются примерно за секунду; свёрнутость не переносится — плавающее окно всегда развёрнуто.',

      'install.text': 'Настройки → Плагины → Добавить, укажите <b>абсолютный путь к каталогу плагина</b> → Установить → перезапустите DSH. Клиентский bundle подключается к графу модулей только при старте, поэтому после правок кода нужен перезапуск — обновление страницы не помогает.',
      'install.link': 'Полная инструкция на GitHub →',
      'cta.b': 'Не хотите только смотреть картинки?',
      'cta.span': 'Перейдите в «Попробовать»: выбросите случайный сценарий и сами нажмите включение, отмену и снятие — до выключения или блокировки.',
      'cta.btn': 'Попробовать',

      'try.appearance': 'Вид',
      'try.appearanceAria': 'Вид',
      'try.vA': 'A · Минимал',
      'try.vB': 'B · Радар',
      'try.vC': 'C · Терминал',
      'try.scene': 'Сценарий',
      'try.roll': 'Случайный сценарий',
      'try.armHint': 'Нажмите «Включить» на карточке слева, чтобы начать проверку',
      'try.now': 'Сейчас <b>{state}</b>',
      'try.stop': 'Снять',
      'try.stopFired': 'Уже выключено — снимать нечего',
      'try.log': 'Журнал симуляции',
      'try.logEmpty': 'Записей пока нет',
      'try.tips': 'Как играть',
      'try.tip1': '<b>Слева — её настоящее место</b>: под центром навыков, над списком сессий. Кнопка с окном в правом верхнем углу карточки выносит её в отдельное окно (по умолчанию компактное, только карточка). <b>Карточка на этой странице кликабельна</b> — включение, отмена и снятие делаются слева.',
      'try.tip2': 'Порядок: <b>случайный сценарий</b> → нажмите <b>Включить</b> на карточке → начнётся проверка → фоновые задачи и сессии будут убывать по одной → когда всё закончится, пойдёт отсчёт → команда уйдёт.',
      'try.tip3': 'Во время проверки с небольшой вероятностью срабатывает блокировка: <code>halted</code> ждёт нажатия «Снять и повторить», <code>waiting</code> сама восстанавливается через несколько секунд.',
      'try.tip4': 'Во время отсчёта можно в любой момент нажать «Отменить выключение» — режим останется включённым. Блокировка тоже может случиться.',
      'try.tip5': 'Журнал настоящего плагина — в <code>Настройки → Статус</code>, полный поток пишется в <code>data/events.log</code>. Здесь отсчёт 12 секунд, у плагина по умолчанию 60.',

      'colophon.note': 'Демо-страница · все данные локальны и случайны, без сети',

      'card.title': 'Выключить после задач',
      'card.float': 'Плавающее окно',
      'radar.aria': 'агентов: {total}, из них работают: {running}',
      'card.arm': 'Включить',
      'card.cancel': 'Отменить выключение',
      'card.retry': 'Снять и повторить',
      'card.disarm': 'Снять',
      'card.a.off.big': 'Выключено',
      'card.a.off.meta': 'Программа запускается только после нажатия «Включить»',
      'card.a.armed.big': 'Готов',
      'card.a.armed.meta': 'Все задачи завершены · ждём следующего запуска',
      'card.a.fired.big': 'Выполнено',
      'card.a.fired.meta': 'Команда выключения отправлена, отменить нельзя',
      'card.a.fire.meta': 'Система выключится · можно отменить',
      'card.a.hold.big': 'Ожидание',
      'card.a.hold.meta': '{bits} — выключение после завершения',
      'card.a.hold.jobs': 'фоновых задач: {n}',
      'card.a.hold.agents': 'сессий: {n}',
      'card.a.blocked.halted.big': 'Пауза',
      'card.a.blocked.halted.meta': 'Квота исчерпана — пополните, затем снимите',
      'card.a.blocked.waiting.big': 'Повтор',
      'card.a.blocked.waiting.meta': 'Слишком много запросов — повтор автоматически',
      'card.hud.retry': 'повтор позже',
      'card.hud.manual': 'нужен человек',
      'card.hud.fired': 'отправлено',
      'card.c.waiting': 'waiting · авто-повтор',
      'card.c.halted': 'halted · нужен человек',
      'card.c.cond': 'условий {n}/6 выполнено',

      'state.off.t': 'Выключено',
      'state.off.d': 'Пока ничего не делали',
      'state.armed.t': 'Готов',
      'state.armed.d': 'Режим включён, ждём завершения задач',
      'state.hold.t': 'Ожидание',
      'state.hold.d': 'Задачи ещё идут — не выключаемся',
      'state.fire.t': 'Отсчёт',
      'state.fire.d': 'Отправлено, можно отменить',
      'state.fired.t': 'Выполнено',
      'state.fired.d': 'Команда выполнена, отменить нельзя',
      'state.blocked.t': 'Блокировка',
      'state.blocked.d': 'Нужно вмешательство человека',

      'now.blocked.halted': 'Блокировка · нужен человек',
      'now.blocked.waiting': 'Блокировка · ждём восстановления',
      'now.hold': 'ждём: {bits}',
      'now.hold.jobs': 'задач {n}',
      'now.hold.agents': 'сессий {n}',
      'now.countdown': 'Отсчёт {sec}',

      'var.A.name': 'Минимал',
      'var.A.desc': 'Крупный заголовок + одна строка + сигнальная лента',
      'var.B.name': 'Радар',
      'var.B.desc': 'Круги + луч сканирования',
      'var.C.name': 'Терминал',
      'var.C.desc': 'Сводка CLI + шесть индикаторов',

      'log.boot': 'Нажмите «Случайный сценарий», чтобы начать',
      'log.rolled': 'Сценарий: фоновых задач {jobs}, сессий {agent}',
      'log.hintArm': 'Нажмите «Включить» на карточке, чтобы начать проверку',
      'log.armFirst': 'Сначала выберите сценарий',
      'log.float': 'В настоящем плагине эта кнопка выносит панель состояния в плавающее окно; демо новое окно не открывает.',
      'log.armed': 'Режим включён, проверяем: выключение после завершения всех задач',
      'log.jobDone': 'Фоновая задача завершена, осталось: {n}',
      'log.agentDone': 'Сессия завершена, осталось: {n}',
      'log.countdown': 'Все задачи завершены, начался отсчёт {sec} с',
      'log.fired': 'Отсчёт закончен, команда выключения отправлена',
      'log.blockHalted': 'Блокировка: квота исчерпана — нужно вмешательство, затем «Снять и повторить»',
      'log.blockWaiting': 'Блокировка: слишком много запросов, повтор через 4 с',
      'log.retried': 'Авто-повтор: продолжаем проверку',
      'log.cancelled': 'Отсчёт отменён, режим остаётся включённым',
      'log.parked': 'Очередь пуста, ждём в режиме готовности. «Снять» — выйти, или запустите сценарий заново',
      'log.disarmed': 'Режим снят, проверка остановлена',
      'log.retryResumed': 'Блокировка снята, продолжаем проверку',
      'log.variant': 'Вид изменён: {v}',

      'a8.title': '08 Настройки',
      'a8.p': 'Настройки разложены по четырём вкладкам: Внешний вид, Дежурство, Уведомления, Состояние. На вкладке вида пять строк на один экран и нет заголовков групп; на вкладке дежурства переключатель своей конфигурации стоит отдельной строкой, ниже идут конфигурации и правила дежурства.',
      'a8.p2': 'После установки есть одна конфигурация — «По умолчанию», вторая появляется по «＋ Создать». Если выключить свою конфигурацию и включить снова, вернётся та, которой пользовались в прошлый раз; если её удалили — останется конфигурация по умолчанию. При обновлении пустые, ни разу не тронутые слоты вычищаются, а переименованные или с изменёнными переключателями остаются.',
      's.head.gh': 'GitHub',
      's.head.npm': 'npm',
      's.tab.look': 'Вид',
      's.tab.watch': 'Дежурство',
      's.tab.notify': 'Уведомления',
      's.tab.status': 'Состояние',
      's.look.a': 'Минимал',
      's.look.b': 'Радар',
      's.look.c': 'Терминал',
      's.look.theme': 'Тема',
      's.theme.auto': 'Как в системе',
      's.theme.dark': 'Тёмная',
      's.theme.light': 'Светлая',
      's.theme.claude': 'Claude',
      's.look.fold': 'Свёрнуто по умолчанию',
      's.look.foldDesc': 'Остаются только заголовок и состояние.',
      's.look.compact': 'Компактное плавающее окно',
      's.look.compactDesc': 'Прячет статистику и журнал событий, оставляя карточку.',
      's.look.lang': 'Язык',
      's.lang.auto': 'Как в системе',
      's.lang.zh': '中文',
      's.lang.en': 'English',
      's.lang.ru': 'Русский',
      's.watch.custom': 'Своя конфигурация',
      's.watch.customDesc': 'Сейчас работает своя конфигурация, конфигурация по умолчанию отложена.',
      's.prof.group': 'Конфигурации',
      's.prof.pick': 'Активная конфигурация',
      's.prof.cur': 'Своя 3 (120 с)',
      's.prof.default': 'По умолчанию',
      's.prof.c1': 'Своя 1',
      's.prof.setDefault': 'Сделать основной',
      's.prof.rename': 'Переименовать',
      's.prof.del': 'Удалить',
      's.prof.new': '＋ Создать',
      's.watch.group': 'Правила дежурства',
      's.row.sessions': 'Все сессии остановились',
      's.row.sessionsDesc': 'Базовое условие, включено всегда.',
      's.always': 'Всегда включено',
      's.row.jobs': 'Фоновые задачи завершились',
      's.row.jobsDesc': 'Пока задача идёт, команда на выключение не отправляется.',
      's.row.errors': 'Пропустить раунд с ошибкой',
      's.row.errorsDesc': 'Считаются только чистые партии; партия с ошибкой не выключает.',
      's.row.cd': 'Длительность отсчёта',
      's.row.cdDesc': 'Время на отмену перед выключением, 10–600 с.',
      's.cd.30': '30 с',
      's.cd.60': '60 с',
      's.cd.90': '90 с',
      's.cd.120': '2 мин',
      's.cd.300': '5 мин',
      's.notify.group': 'Уведомления',
      's.notify.master': 'Сообщать об изменении состояния',
      's.notify.masterDesc': 'По одному сообщению на старт отсчёта, последний вызов, первую блокировку и восстановление.',
      's.notify.countdown': 'Начался отсчёт',
      's.notify.fired': 'Скоро выключение',
      's.notify.blocked': 'Первая блокировка',
      's.notify.recovered': 'Блокировка снята',
      's.status.group': 'Состояние',
      's.status.blocked': 'Блокировка сейчас',
      's.status.blockedV': 'Внешний сервис недоступен, плагин повторяет попытки сам.',
      's.status.last': 'Почему не выключилось',
      's.status.lastV': 'Ещё работали две фоновые задачи, поэтому выключение отложено.',
      's.status.log': 'Журнал событий',
      's.status.logV': 'Последние четыре строки; полный журнал — в data/events.log плагина.',
    },
  }

  function normalize(lang) {
    var l = String(lang || '').toLowerCase()
    if (l.indexOf('zh') === 0) return 'zh'
    if (l.indexOf('ru') === 0) return 'ru'
    if (l.indexOf('en') === 0) return 'en'
    return null
  }

  // Translate one key. Unknown language falls back to zh; an unknown key falls
  // back to zh and then to the key itself, so a typo shows up instead of a
  // blank line.
  function dt(lang, key, params) {
    var table = DEMO_MSG[normalize(lang) || 'zh'] || DEMO_MSG.zh
    var msg = table[key]
    if (msg == null) msg = DEMO_MSG.zh[key]
    if (msg == null) return key
    if (!params) return msg
    return String(msg).replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m
    })
  }

  // ------------------------------------------------------------ browser side
  // Everything below is a no-op when the file is require()d by the build, so
  // gen-demo.cjs can reuse the exact same table without a DOM.
  var subscribers = []

  function hasDom() {
    return typeof document !== 'undefined' && !!document.documentElement
  }

  function currentLang() {
    if (typeof window === 'undefined') return 'zh'
    var fromUrl = null
    try {
      fromUrl = normalize(new URLSearchParams(window.location.search).get('lang'))
    } catch (e) { /* no URLSearchParams, or a file:// quirk */ }
    if (fromUrl) return fromUrl

    var stored = null
    try {
      stored = normalize(window.localStorage.getItem(STORE_KEY))
    } catch (e) { /* private mode */ }
    if (stored) return stored

    var nav = null
    try {
      nav = normalize(window.navigator.language || (window.navigator.languages && window.navigator.languages[0]))
    } catch (e) { /* no navigator */ }
    return nav || 'zh'
  }

  // Elements translated once and restored verbatim for zh: the generated zh
  // markup is the source of truth, so switching back cannot drift from it.
  var original = new WeakMap()

  var ATTRS = [
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-titleattr', 'title'],
    ['data-i18n-alt', 'alt'],
    ['data-i18n-content', 'content'],
  ]

  function applyLang(lang) {
    var next = normalize(lang) || 'zh'
    if (!hasDom()) return next

    var html = document.documentElement
    html.setAttribute('data-lang', next)
    html.setAttribute('lang', next === 'zh' ? 'zh-CN' : next)

    var nodes = document.querySelectorAll('[data-i18n]')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      var key = el.getAttribute('data-i18n')
      if (!original.has(el)) original.set(el, el.innerHTML)
      el.innerHTML = next === 'zh' ? original.get(el) : dt(next, key)
    }

    for (var a = 0; a < ATTRS.length; a++) {
      var sel = '[' + ATTRS[a][0] + ']'
      var withAttr = document.querySelectorAll(sel)
      for (var b = 0; b < withAttr.length; b++) {
        var node = withAttr[b]
        var attr = ATTRS[a][1]
        var attrKey = node.getAttribute(ATTRS[a][0])
        var storeKey = '__i18nOrig_' + attr
        if (!(storeKey in node)) node[storeKey] = node.getAttribute(attr)
        node.setAttribute(attr, next === 'zh' ? node[storeKey] : dt(next, attrKey))
      }
    }

    var langs = document.querySelectorAll('.lang-tab')
    for (var c = 0; c < langs.length; c++) {
      var on = langs[c].getAttribute('data-lang-btn') === next
      langs[c].classList.toggle('on', on)
      langs[c].setAttribute('aria-pressed', on ? 'true' : 'false')
    }

    for (var s = 0; s < subscribers.length; s++) {
      try { subscribers[s](next) } catch (e) { /* one bad listener must not break the switch */ }
    }
    return next
  }

  function setLang(lang) {
    var next = normalize(lang)
    if (!next) return false
    try { window.localStorage.setItem(STORE_KEY, next) } catch (e) { /* private mode */ }
    applyLang(next)
    return true
  }

  function onChange(fn) {
    if (typeof fn === 'function') subscribers.push(fn)
  }

  var api = {
    DEMO_LANGS: DEMO_LANGS,
    DEMO_LABELS: DEMO_LABELS,
    DEMO_MSG: DEMO_MSG,
    STORE_KEY: STORE_KEY,
    dt: dt,
    normalize: normalize,
    currentLang: currentLang,
    setLang: setLang,
    applyLang: applyLang,
    onChange: onChange,
  }

  if (hasDom()) {
    var boot = function () { applyLang(currentLang()) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
    else boot()
    // One delegated listener covers the switcher; it lives here so app.js only
    // has to care about its own widgets.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-lang-btn]') : null
      if (btn) setLang(btn.getAttribute('data-lang-btn'))
    })
  }

  return api
})
