/* dsh-shutdown-guard — client half (prebuilt bundle, no build step).
 *
 * v1.1: the card is mounted as a DOM node at the top of the sidebar's
 * workspace region (`[class*="regionArea"]`), directly under the panel rows
 * (技能中心) and above the session list. The sidebar exposes only a single
 * `sidebar.workspaces` slot, which the session browser owns, so a slot
 * registration there would shadow the session list; a detached host node
 * leaves React's tree untouched. The appearance section still uses
 * `settings.section`.
 */
;(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-shutdown-guard',
    factory: function (require) {
      var React = require('react')
      if (!React || !React.createElement) return { name: 'dsh-shutdown-guard', apply: function () {}, inject: [] }

      var BASE = '/api/dsh-shutdown-guard'
      var POLL_MS = 1000
      var h = React.createElement
      var VARIANTS = ['A', 'B', 'C']
      var THEMES = ['auto', 'dark', 'light', 'claude']
      var LANGS = ['zh', 'en', 'ru']
      var VAR_KEY = 'dsh-shutdown-guard.variant'
      var FOLD_KEY = 'dsh-shutdown-guard.folded'
      var THEME_KEY = 'dsh-shutdown-guard.theme'
      var LANG_KEY = 'dsh-shutdown-guard.lang'
      // Hot reload can leave several module instances alive in one page: the new
      // one mounts while the old one keeps painting into its own detached tree.
      // A per-instance token on window lets exactly one instance own the card.
      var INSTANCE = {}
      var OWNER_KEY = '__dshShutdownGuardOwner'

      // Settings-nav glyph. This is a HOST DOM PATCH: ui-settings renders nav
      // icons from a hardcoded navIcon(id) map that only knows built-in ids, so
      // our settings.section falls back to the generic gear and no plugin icon
      // field is read. We swap that svg for a masked span. If the host ever
      // accepts an icon field, use it and delete this whole block.
      // Source: assets/icon-mono-transparent-64.png (white glyph, transparent
      // keyline). It is NOT loaded at runtime — the bundle is a single file — so
      // editing the PNG requires re-encoding it into NAV_ICON_B64 or the two
      // artifacts drift apart.
      var NAV_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAC2klEQVR42u2ZsUscQRSHB0UPrCwsJBYKKhaigmKhaBDBRlDEQrSRqBAL6yBaiVZiI4ig5E8QuTKQQiGVthECEgISQgohRAkIgeAXBl6xHDuz453e7N7NBwPHzPu9ffOD3Z29p1QgEAgEAoFAoDiAGuA1sAK8LdNYkWvW+N58B/AZf+hrd/jafAPwDf/oGhp8GLBMelj2YcBBigw48GHAcYlF3wDTMm5KzHWcRQMWIrkWqtGAiUiuiWBAMKCyDbgqwoCrSjFgQ+LPn2DAucxvZN2A/Uh8I/DbwQAd0xhZ28+qAV+AXIFmzMGAsQJNTnJlzoAZg25L1lcjc6syt2XQzGTNgO9AbYymHvggMffAOxn3MqfX6mN0tZIzVQYcWQo6NGh2HO7nHYP20KI58mHArqWgpZh4fS/fORhwV/jsEP2SRbPrw4B1l0NOJH7gCe/1gRi97bC07sOAeUtB4zHxw08wYDhGP26Jn/dhQJ+loLmY+Cbgn8PmdUxTjH7OounzYYC+px8MBW0bNHkHA/IG7bYh/iHumVEuE84MRV0Y4luBn5bN67VWg/bCoDnz+a/wpmUz3QZNO/ApJl7PtRs03ZbrbPo0oNNS2EmCthd4I6M3IfbEcp1O372BS0txs8+Qf9aS/zINnaFFS4F/gMEScg9KDhOLaTAgl/Bg0+f8ySLyTka+EUwPzJxKA8BawqvtEXgPtDjkapHYx4Sca2lqkOYc22R/gVPpKvUDr2T0y9ypxLi0w3IqTUiDo1xMqzTieNIrlbxKK0AzcPuCm9e5m1WaAaYcHmDFoHNOqSwA7L2AAXsqKwB1wMdn3LzOVaeyhPQBrp9h89fRPkHWTGgDfpSwea1tU1kG6AF+FbF5relRlQAwlPBRE/cRNaQqCWDU0QQdM6oqEWAkoTeg10ZUJSP9gVvDKW9AVQNAV0GvT//uUtWEvCK/ymhT1Yh8PDWrQCAQCAQCgUD5+Q+l9tHN84mFxQAAAABJRU5ErkJggg=='
      var NAVICON_CLASS = 'dsp-navicon'

      // ---------------- i18n ----------------
      // The client cannot import local files (only 'react' resolves), so the
      // catalog is inlined. Host-produced strings — log lines, skip reasons,
      // blocked reasons — arrive already translated in /state; this table only
      // covers text the card and the settings section render themselves.

      var MSG = {
        zh: {
          'app.title': '任务完成后关机',
          'app.aria': '任务完成后关机时自动关机',
          'card.float': '悬浮窗口',
          'meta.fire': '系统关机指令已下发',
          'meta.fired': '指令已生效，无法取消',
          'meta.jobs': '{n} 个后台任务',
          'meta.sessions': '{n} 个会话',
          'meta.hold': '{parts}，完成后关机',
          'meta.armed': '所有任务已结束 · 等待下一次触发',
          'meta.off': '仅在点击「武装」后才会运行程序',
          'big.retry': '等待恢复',
          'big.paused': '已暂停',
          'big.fired': '已关机',
          'big.hold': '等待后台任务',
          'big.armed': '待命',
          'big.off': '未开启',
          'btn.arm': '武装',
          'btn.cancel': '取消关机',
          'btn.disarm': '解除',
          'hud.retry': '第 {n} 次重试',
          'hud.manual': '需人工处理',
          'tag.off': 'OFF',
          'tag.armed': 'ARMED',
          'tag.hold': 'WAIT',
          'tag.fire': 'FIRE',
          'tag.fired': 'DONE',
          'tag.blocked': 'PAUSED',
          'hud.state.hold': 'Holding',
          'hud.state.fired': 'Fired',
          'hud.state.off': 'Offline',
          'hud.state.retrying': 'Retrying',
          'hud.state.paused': 'Paused',
          'hud.state.standby': 'Standby',
          'unit.jobs': '{n} 个任务',
          'unit.agent': '{n} 个会话',
          'term.fire': 'T-minus {t}',
          'term.hold': 'holding',
          'term.off': 'offline',
          'term.retry': 'retrying',
          'term.halted': 'halted',
          'term.done': 'done',
          'term.wait': 'waiting',
          'cd.30': '30 秒',
          'cd.60': '60 秒',
          'cd.120': '2 分钟',
          'cd.300': '5 分钟',
          'code.waiting': 'waiting · 自动重试',
          'code.halted': 'halted · 需人工处理',
          'code.gates': '条件 {n}/6 已满足',
          'set.look': '外观',
          'set.variant': '卡片外观',
          'set.variant.desc': '三种外观共用同一套判定逻辑。',
          'set.led': '终端里的 6 个小块',
          'set.led.desc': '从左到右：已开启、只算成功、会话空闲、后台任务清零、没有报错、正在倒计时。亮几个，就是几条已经满足。',
          'set.theme': '配色',
          'set.theme.desc': '跟随系统时按当前主题自动取深色或浅色。',
          'theme.auto': '跟随',
          'theme.dark': '深色',
          'theme.light': '浅色',
          'theme.claude': 'Claude',
          'set.fold': '默认折叠',
          'set.fold.desc': '折叠后只保留标题和状态。',
          'set.lang': '语言',
          'set.lang.desc': '跟随系统会使用操作系统的语言；也可以在这里固定一种。',
          'lang.auto': '跟随系统',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': '何时关机',
          'set.custom': '自定义配置',
          'set.custom.on': '正在使用自定义配置，默认配置暂时挂起。',
          'set.custom.off': '关闭时只使用默认配置。',
          'set.pick': '选择配置',
          'set.pick.cur': '当前：{label}（{sec} 秒）',
          'set.pick.default': '当前：默认配置',
          'set.default': '默认',
          'set.bottom': '会话都停下来',
          'set.bottom.desc': '底线条件，始终开启。',
          'set.always': '总是开启',
          'set.jobs': '后台任务跑完',
          'set.jobs.desc': '有后台任务在跑时，先不下发关机指令。',
          'set.err': '有会话报错就跳过这一轮',
          'set.err.desc': '只认成功的任务，出过错的批次不关机。',
          'set.cd': '倒计时时长',
          'set.cd.locked': '默认配置固定 60 秒，不能修改。切到自定义配置后可以调。',
          'set.cd.desc': '关机前留出的取消时间，10–600 秒。',
          'set.cd.fixed': '60 秒 · 固定',
          'set.afk': 'AFK 自动回答',
          'set.afk.desc': '武装后 agent 若向你提问，自动代为回复：告知你处于 AFK、先完成已交代的任务、汇总报告并落盘，不碰未交代的分支。回复不会替你选中任何选项，关闭后提问照常弹给你。',
          'set.status': '状态',
          'set.blocked': '当前阻断',
          'set.blocked.waiting': '外部服务暂不可用，插件会自动重试，不需要处理。',
          'set.blocked.halted': '阻断期间不会下发关机指令，只有人工能解除。',
          'set.blocked.none': '没有阻断，条件满足就会正常倒计时。',
          'set.none': '无',
          'set.skip': '上次为什么没关机',
          'set.skip.none': '还没发生过',
          'set.events': '事件日志',
          'set.events.desc': '最近 {n} 条，完整记录在插件 data/events.log。',
          'set.events.none': '暂无事件。',
        },
        en: {
          'app.title': 'Auto shutdown',
          'app.aria': 'Shut down when tasks finish',
          'card.float': 'Floating window',
          'meta.fire': 'Shutdown command sent',
          'meta.fired': 'Command is live — no way back',
          'meta.jobs': '{n} background jobs',
          'meta.sessions': '{n} sessions',
          'meta.hold': '{parts}, shutdown after they finish',
          'meta.armed': 'Everything settled · waiting for the next batch',
          'meta.off': 'Nothing runs until you click “Arm”',
          'big.retry': 'Waiting to recover',
          'big.paused': 'Paused',
          'big.fired': 'Shutting down',
          'big.hold': 'Waiting for background jobs',
          'big.armed': 'Armed',
          'big.off': 'Off',
          'btn.arm': 'Arm',
          'btn.cancel': 'Cancel shutdown',
          'btn.disarm': 'Disarm',
          'hud.retry': 'retry {n}',
          'hud.manual': 'needs a human',
          'tag.off': 'OFF',
          'tag.armed': 'ARMED',
          'tag.hold': 'WAIT',
          'tag.fire': 'FIRE',
          'tag.fired': 'DONE',
          'tag.blocked': 'PAUSED',
          'hud.state.hold': 'Holding',
          'hud.state.fired': 'Fired',
          'hud.state.off': 'Offline',
          'hud.state.retrying': 'Retrying',
          'hud.state.paused': 'Paused',
          'hud.state.standby': 'Standby',
          'unit.jobs': '{n} jobs',
          'unit.agent': '{n} agents',
          'term.fire': 'T-minus {t}',
          'term.hold': 'holding',
          'term.off': 'offline',
          'term.retry': 'retrying',
          'term.halted': 'halted',
          'term.done': 'done',
          'term.wait': 'waiting',
          'cd.30': '30s',
          'cd.60': '60s',
          'cd.120': '2min',
          'cd.300': '5min',
          'code.waiting': 'waiting · auto-retry',
          'code.halted': 'halted · needs a human',
          'code.gates': '{n}/6 conditions met',
          'set.look': 'Appearance',
          'set.variant': 'Card skin',
          'set.variant.desc': 'All three skins share the same logic.',
          'set.led': 'The six blocks in the terminal',
          'set.led.desc': 'Left to right: armed, success-only, sessions idle, no background jobs, no errors, counting down. Lit blocks are satisfied conditions.',
          'set.theme': 'Palette',
          'set.theme.desc': '“Follow system” picks dark or light from the current theme.',
          'theme.auto': 'Follow',
          'theme.dark': 'Dark',
          'theme.light': 'Light',
          'theme.claude': 'Claude',
          'set.fold': 'Folded by default',
          'set.fold.desc': 'Folded keeps just the title and the state.',
          'set.lang': 'Language',
          'set.lang.desc': '“Follow system” uses the OS language; you can also pin one here.',
          'lang.auto': 'Follow system',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': 'When to shut down',
          'set.custom': 'Custom profiles',
          'set.custom.on': 'Custom profiles are in use; the default one is on hold.',
          'set.custom.off': 'Off means only the default profile is used.',
          'set.pick': 'Active profile',
          'set.pick.cur': 'Current: {label} ({sec}s)',
          'set.pick.default': 'Current: default',
          'set.default': 'default',
          'set.bottom': 'All sessions idle',
          'set.bottom.desc': 'The floor condition; always on.',
          'set.always': 'Always on',
          'set.jobs': 'Background jobs finished',
          'set.jobs.desc': 'While a background job runs, no shutdown is issued.',
          'set.err': 'Skip a batch that errored',
          'set.err.desc': 'Only successful batches count; a batch with errors never shuts down.',
          'set.cd': 'Countdown',
          'set.cd.locked': 'The default profile is pinned to 60s. Switch to a custom profile to change it.',
          'set.cd.desc': 'Time to cancel before the shutdown, 10–600s.',
          'set.cd.fixed': '60s · pinned',
          'set.afk': 'Answer questions while AFK',
          'set.afk.desc': 'When armed, questions from the agent are answered for you: tell it you are AFK, finish what was already asked, write a report to disk, and leave untouched branches alone. It never picks an option for you; turn it off and questions come to you as usual.',
          'set.status': 'Status',
          'set.blocked': 'Current block',
          'set.blocked.waiting': 'The provider is unavailable; the plugin retries on its own.',
          'set.blocked.halted': 'While blocked no shutdown is issued, and only a human can clear it.',
          'set.blocked.none': 'Nothing blocked; the countdown runs when the conditions hold.',
          'set.none': 'none',
          'set.skip': 'Why the last shutdown was skipped',
          'set.skip.none': 'Has not happened yet',
          'set.events': 'Event log',
          'set.events.desc': 'Latest {n}; the full record lives in the plugin’s data/events.log.',
          'set.events.none': 'No events yet.',
        },
        ru: {
          'app.title': 'Автовыключение',
          'app.aria': 'Выключение после задач',
          'card.float': 'Плавающее окно',
          'meta.fire': 'Команда на выключение отправлена',
          'meta.fired': 'Команда уже действует — отменить нельзя',
          'meta.jobs': 'фоновых задач: {n}',
          'meta.sessions': 'сессий: {n}',
          'meta.hold': '{parts}, выключение после них',
          'meta.armed': 'Всё завершено · ждём следующую партию',
          'meta.off': 'Ничего не запустится, пока вы не нажмёте «Взвести»',
          'big.retry': 'Ждём восстановления',
          'big.paused': 'Приостановлено',
          'big.fired': 'Выключение',
          'big.hold': 'Ждём фоновые задачи',
          'big.armed': 'Взведено',
          'big.off': 'Выключено',
          'btn.arm': 'Взвести',
          'btn.cancel': 'Отменить выключение',
          'btn.disarm': 'Снять',
          'hud.retry': 'попытка {n}',
          'hud.manual': 'нужен человек',
          'tag.off': 'ВЫКЛ',
          'tag.armed': 'ВЗВЕД',
          'tag.hold': 'ОЖИД',
          'tag.fire': 'СТАРТ',
          'tag.fired': 'ГОТОВО',
          'tag.blocked': 'ПАУЗА',
          'hud.state.hold': 'Ожидание',
          'hud.state.fired': 'Выполнено',
          'hud.state.off': 'Офлайн',
          'hud.state.retrying': 'Повтор',
          'hud.state.paused': 'Пауза',
          'hud.state.standby': 'Готов',
          'unit.jobs': '{n} задач',
          'unit.agent': '{n} агентов',
          'term.fire': 'Т-{t}',
          'term.hold': 'ожидание',
          'term.off': 'офлайн',
          'term.retry': 'повтор',
          'term.halted': 'остановлено',
          'term.done': 'готово',
          'term.wait': 'ожидание',
          'cd.30': '30 с',
          'cd.60': '60 с',
          'cd.120': '2 мин',
          'cd.300': '5 мин',
          'code.waiting': 'waiting · автоповтор',
          'code.halted': 'halted · нужен человек',
          'code.gates': 'условий выполнено: {n}/6',
          'set.look': 'Внешний вид',
          'set.variant': 'Оформление карточки',
          'set.variant.desc': 'Все три оформления используют одну и ту же логику.',
          'set.led': 'Шесть блоков в терминале',
          'set.led.desc': 'Слева направо: взведено, только успешные, сессии простаивают, фоновых задач нет, ошибок нет, идёт отсчёт. Сколько горит — столько условий выполнено.',
          'set.theme': 'Палитра',
          'set.theme.desc': '«Как в системе» выбирает тёмную или светлую по текущей теме.',
          'theme.auto': 'Как в системе',
          'theme.dark': 'Тёмная',
          'theme.light': 'Светлая',
          'theme.claude': 'Claude',
          'set.fold': 'Свёрнуто по умолчанию',
          'set.fold.desc': 'В свёрнутом виде остаются только заголовок и состояние.',
          'set.lang': 'Язык',
          'set.lang.desc': '«Как в системе» берёт язык ОС; здесь его можно зафиксировать.',
          'lang.auto': 'Как в системе',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': 'Когда выключать',
          'set.custom': 'Свои профили',
          'set.custom.on': 'Используются свои профили, профиль по умолчанию отложен.',
          'set.custom.off': 'Выключено — используется только профиль по умолчанию.',
          'set.pick': 'Активный профиль',
          'set.pick.cur': 'Сейчас: {label} ({sec} с)',
          'set.pick.default': 'Сейчас: по умолчанию',
          'set.default': 'по умолч.',
          'set.bottom': 'Все сессии простаивают',
          'set.bottom.desc': 'Базовое условие, включено всегда.',
          'set.always': 'Всегда включено',
          'set.jobs': 'Фоновые задачи завершены',
          'set.jobs.desc': 'Пока идёт фоновая задача, выключение не отправляется.',
          'set.err': 'Пропускать партию с ошибкой',
          'set.err.desc': 'Считаются только успешные партии; партия с ошибками не выключает.',
          'set.cd': 'Длительность отсчёта',
          'set.cd.locked': 'Профиль по умолчанию закреплён на 60 с. Переключитесь на свой профиль, чтобы изменить.',
          'set.cd.desc': 'Время на отмену перед выключением, 10–600 с.',
          'set.cd.fixed': '60 с · закреплено',
          'set.afk': 'Отвечать на вопросы в AFK',
          'set.afk.desc': 'Когда взведено, вопросы агента получают ответ за вас: сообщить, что вы AFK, доделать уже порученное, записать отчёт на диск и не трогать незатронутые ветки. За вас никогда не выбирается вариант; выключите — вопросы снова придут вам.',
          'set.status': 'Состояние',
          'set.blocked': 'Текущая блокировка',
          'set.blocked.waiting': 'Провайдер недоступен; плагин повторяет попытки сам.',
          'set.blocked.halted': 'Пока блокировка активна, выключение не отправляется, и снять её может только человек.',
          'set.blocked.none': 'Блокировок нет; отсчёт идёт, когда условия выполнены.',
          'set.none': 'нет',
          'set.skip': 'Почему пропустили прошлое выключение',
          'set.skip.none': 'Пока не случалось',
          'set.events': 'Журнал событий',
          'set.events.desc': 'Последние {n}; полная запись — в data/events.log плагина.',
          'set.events.none': 'Событий пока нет.',
        },
      }

      var FALLBACK_LANG = 'zh'

      function activeLang() {
        var lang = snapshot.lang
        return MSG[lang] ? lang : FALLBACK_LANG
      }

      function tr(key, params) {
        var table = MSG[activeLang()] || MSG[FALLBACK_LANG]
        var text = table[key]
        if (text === undefined) text = MSG[FALLBACK_LANG][key]
        if (text === undefined) return key
        if (!params) return text
        return text.replace(/\{(\w+)\}/g, function (whole, name) {
          return params[name] === undefined ? whole : String(params[name])
        })
      }

      // The settings nav reads this label through resolveSlotLabel() and the
      // host re-reads it whenever the host locale revision changes (the
      // settings ledger caches rows on ctx.locale.getSnapshot().revision). It
      // does NOT re-read it when our own /state poll delivers a new language,
      // so the label resolves the host locale at call time, and the slot is
      // re-registered when our language changes (see relabelSettings).
      function hostLocaleId() {
        try {
          var face = ctxRef && (ctxRef.locale || (typeof ctxRef.get === 'function' ? ctxRef.get('locale') : null))
          if (!face || typeof face.getSnapshot !== 'function') return null
          var loc = face.getSnapshot()
          var id = loc && loc.active
          if (typeof id !== 'string') return null
          if (MSG[id]) return id
          var base = id.split('-')[0].toLowerCase()
          return MSG[base] ? base : null
        } catch (e) { return null }
      }

      function navLabel() {
        var pinned = snapshot.language
        if (pinned && pinned !== 'auto' && MSG[pinned]) return MSG[pinned]['app.title']
        var hostLang = hostLocaleId()
        if (hostLang) return MSG[hostLang]['app.title']
        return tr('app.title')
      }

      // ---------------- store ----------------

      var snapshot = {
        ready: false,
        armed: false,
        state: 'idle',
        deadline: 0,
        countdownSec: 60,
        erroredCount: 0,
        lastSkip: null,
        lang: 'zh',
        language: 'auto',
        runningCount: 0,
        rootsCount: 0,
        jobsRunning: 0,
        jobsTotal: 0,
      }
      var listeners = new Set()
      var pollTimer = null
      var inflight = false
      // Incremental event cursor: /state only returns entries newer than this,
      // so polling once a second does not re-send the whole ring buffer.
      var lastEventAt = 0
      var eventTape = []
      var ui = { variant: 'A', folded: false, theme: 'auto' }
      var uiListeners = new Set()

      function readStored() {
        try {
          // Restore the last chosen language before the first paint: /state still
          // has to be fetched, so without this the card renders one frame in zh.
          // Only concrete LANGS values are accepted ('auto' is resolved by the
          // host and would not map to a MSG table here).
          var l = localStorage.getItem(LANG_KEY)
          if (LANGS.indexOf(l) >= 0) snapshot.lang = l
          var v = localStorage.getItem(VAR_KEY)
          if (VARIANTS.indexOf(v) >= 0) ui.variant = v
          var t = localStorage.getItem(THEME_KEY)
          if (THEMES.indexOf(t) >= 0) ui.theme = t
          ui.folded = localStorage.getItem(FOLD_KEY) === '1'
        } catch (e) { /* ignore */ }
      }
      readStored()

      function emitUi() {
        uiListeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }
      function subscribeUi(fn) {
        uiListeners.add(fn)
        return function () { uiListeners.delete(fn) }
      }
      function getUi() { return ui }
      function setVariant(v) {
        if (VARIANTS.indexOf(v) < 0 || ui.variant === v) return
        ui.variant = v
        try { localStorage.setItem(VAR_KEY, v) } catch (e) { /* ignore */ }
        emitUi()
        paint()
      }
      function setFolded(next) {
        var v = !!next
        if (ui.folded === v) return
        ui.folded = v
        try { localStorage.setItem(FOLD_KEY, v ? '1' : '0') } catch (e) { /* ignore */ }
        emitUi()
        paint()
      }
      function setTheme(t) {
        if (THEMES.indexOf(t) < 0 || ui.theme === t) return
        ui.theme = t
        try { localStorage.setItem(THEME_KEY, t) } catch (e) { /* ignore */ }
        lumAt = 0
        emitUi()
        paint()
      }
      function setLanguage(next) {
        if (next !== 'auto' && LANGS.indexOf(next) < 0) return
        if ((snapshot.language || 'auto') === next) return
        try { localStorage.setItem(LANG_KEY, next) } catch (e) { /* ignore */ }
        void post('/config', { language: next })
      }

      function emit() {
        listeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }

      function subscribe(fn) {
        listeners.add(fn)
        ensurePolling()
        return function () {
          listeners.delete(fn)
          if (listeners.size === 0) stopPolling()
        }
      }

      function getSnapshot() { return snapshot }

      function mergeEvents(list) {
        if (!Array.isArray(list) || list.length === 0) return
        for (var i = 0; i < list.length; i += 1) {
          var e = list[i]
          if (!e || typeof e.at !== 'number') continue
          if (e.at > lastEventAt) lastEventAt = e.at
          eventTape.push(e)
        }
        if (eventTape.length > 200) eventTape = eventTape.slice(-200)
      }

      function normalize(body) {
        mergeEvents(body.events)
        return {
          ready: true,
          armed: body.armed === true,
          state: typeof body.state === 'string' ? body.state : 'idle',
          deadline: Number(body.deadline) || 0,
          countdownSec: Number(body.countdownSec) || 60,
          erroredCount: Number(body.erroredCount) || 0,
          lastSkip: body.lastSkip || null,
          runningCount: Number(body.runningCount) || 0,
          rootsCount: Number(body.rootsCount) || 0,
          jobsRunning: Number(body.jobsRunning) || 0,
          jobsTotal: Number(body.jobsTotal) || 0,
          blockOnJobs: body.blockOnJobs !== false,
          onlyOnSuccess: body.onlyOnSuccess !== false,
          customEnabled: body.customEnabled === true,
          afkAutoAnswer: body.afkAutoAnswer !== false,
          countdownLocked: body.countdownLocked === true,
          blocked: typeof body.blocked === 'string' && body.blocked ? body.blocked : null,
          retryAttempt: Number(body.retryAttempt) || 0,
          retryAt: Number(body.retryAt) || 0,
          activeProfileId: typeof body.activeProfileId === 'string' ? body.activeProfileId : 'default',
          profiles: Array.isArray(body.profiles) ? body.profiles : [],
          lang: LANGS.indexOf(body.lang) >= 0 ? body.lang : 'zh',
          language: body.language === 'auto' || LANGS.indexOf(body.language) >= 0 ? body.language : 'auto',
          events: eventTape.slice(-40),
        }
      }

      function setSnapshot(next) {
        // The host re-translates event text per request, but /state only returns
        // entries newer than `since`; the tape therefore keeps whatever language
        // each cached line was rendered in. On a language switch, drop the tape
        // and rewind the cursor so the whole ring comes back in the new language.
        if (snapshot.ready && next && next.lang !== snapshot.lang) {
          lastEventAt = 0
          eventTape = []
          next.events = []
          // The settings nav only re-reads labels on a host locale revision or a
          // slot version bump; re-register so a card language switch shows up
          // there even when the host locale did not change.
          relabelSettings()
        }
        snapshot = next
        emit()
      }

      function refresh() {
        if (inflight) return Promise.resolve(snapshot)
        inflight = true
        return fetch(BASE + '/state?since=' + lastEventAt, { cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (body) {
            if (body && typeof body === 'object') setSnapshot(normalize(body))
            return snapshot
          })
          .catch(function () { return snapshot })
          .then(function (value) {
            inflight = false
            return value
          })
      }

      function post(path, payload) {
        return fetch(BASE + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
          cache: 'no-store',
        })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (body) {
            if (body && typeof body === 'object') setSnapshot(normalize(body))
            return refresh()
          })
          .catch(function () { return refresh() })
      }

      function ensurePolling() {
        if (pollTimer !== null) return
        refresh()
        pollTimer = setInterval(refresh, POLL_MS)
      }

      function stopPolling() {
        if (pollTimer === null) return
        clearInterval(pollTimer)
        pollTimer = null
      }

      // ---------------- derived ----------------

      function remainingSec(snap) {
        if (snap.state !== 'countdown' || !snap.deadline) return 0
        return Math.max(0, Math.ceil((snap.deadline - Date.now()) / 1000))
      }

      function viewOf(snap) {
        // A blocked plugin never disarms the shutdown, so this outranks every
        // control state: showing "待命" here would make the user think the
        // machine is about to go down.
        if (snap.blocked) return 'blocked'
        if (!snap.armed) return 'off'
        if (snap.state === 'fired') return 'fired'
        if (snap.state === 'countdown') return 'fire'
        if (snap.jobsRunning > 0 || snap.runningCount > 0) return 'hold'
        return 'armed'
      }

      function esc(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      }

      function fmt2(n) { return n > 99 ? '99+' : String(n) }
      function hhmmss(at) {
        var d = new Date(at)
        function p(n) { return (n < 10 ? '0' : '') + n }
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      }
      function mmss(sec) {
        var m = Math.floor(sec / 60)
        var s = Math.max(0, sec % 60)
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
      }

      function metaText(snap, view) {
        if (view === 'blocked') return snap.blocked
        if (view === 'fire') return tr('meta.fire')
        if (view === 'fired') return tr('meta.fired')
        if (view === 'hold') {
          var parts = []
          if (snap.jobsRunning > 0) parts.push(tr('meta.jobs', { n: fmt2(snap.jobsRunning) }))
          if (snap.runningCount > 0) parts.push(tr('meta.sessions', { n: fmt2(snap.runningCount) }))
          return tr('meta.hold', { parts: parts.join(' · ') })
        }
        if (view === 'armed') return tr('meta.armed')
        return tr('meta.off')
      }

      function bigText(snap, view) {
        if (view === 'blocked') return snap.retryAt > 0 ? tr('big.retry') : tr('big.paused')
        if (view === 'fire') return mmss(remainingSec(snap))
        if (view === 'fired') return tr('big.fired')
        if (view === 'hold') return tr('big.hold')
        if (view === 'armed') return tr('big.armed')
        return tr('big.off')
      }

      // The tag, HUD, terminal line and countdown presets are all MSG keys now:
      // each maps a view name to `tr('tag.' + view)` / `tr('hud.state.*')` so a
      // language switch re-renders them with the rest of the card.

      // ---------------- radar dots (stable, incremental) ----------------

      var dotStore = { run: [], job: [] }
      var dotSig = ''

      function sampleDot(taken) {
        // 只在可见面板内撒点：面板 238 x 86，留 4px 边距，半径不超过第 9 环（119）
        var W = 222, H = 78, R = 23, R5 = 71
        for (var guard = 0; guard < 4000; guard++) {
          var x = (Math.random() - .5) * W
          var y = (Math.random() - .5) * H
          var r = Math.sqrt(x * x + y * y)
          if (r < R && Math.random() > 0.05) continue
          if (r > R5 && Math.random() > 1 / 80) continue
          var px = x + W / 2, py = y + H / 2
          if (px < W * 0.78 && py > H * 0.66) continue
          if (r > 108) continue
          var hit = false
          for (var i = 0; i < taken.length; i++) {
            var dx = taken[i].x - x, dy = taken[i].y - y
            if (Math.sqrt(dx * dx + dy * dy) < 8) { hit = true; break }
          }
          if (hit) continue
          return { x: x, y: y }
        }
        return null
      }

      function syncDots(kind, n) {
        var arr = dotStore[kind]
        var cap = Math.min(n, 40)
        while (arr.length > cap) arr.pop()
        while (arr.length < cap) {
          var p = sampleDot(dotStore.run.concat(dotStore.job))
          if (!p) break
          arr.push(p)
        }
      }

      // ---------------- card DOM ----------------

      var host = null
      var card = null
      var builtSig = ''
      var ctxRef = null
      var slotDispose = null
      var SETTINGS_NS = 'dsh-shutdown-guard'

      var CHEV = '<svg class="dsp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
      // Little "open in a window" glyph: a framed screen with a title bar.
      var FLOAT_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>'
      var FLOAT_NAME = 'dsh-shutdown-guard-window'

      function headHtml() {
        // The float button sits beside the fold header, not inside it: nesting a
        // button in a role="button" region would make the header's click target
        // ambiguous for assistive tech.
        return '<div class="dsp-hrow">' +
          '<div class="dsp-chead" role="button" tabindex="0">' +
          '<i class="dsp-live" aria-hidden="true"></i>' +
          '<span class="dsp-ctitle">' + esc(tr('app.title')) + '</span>' +
          '<span class="dsp-tag"></span>' + CHEV + '</div>' +
          '<button type="button" class="dsp-float" title="' + esc(tr('card.float')) + '" aria-label="' + esc(tr('card.float')) + '">' + FLOAT_ICON + '</button>' +
          '</div>'
      }

      function ringsHtml() {
        var out = '<svg class="dsp-radar-svg" viewBox="0 0 238 202" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
        for (var k = 0; k < 9; k++) {
          var op = Math.max(0.14, 0.42 - k * 0.032).toFixed(2)
          out += '<circle cx="119" cy="101" r="' + (23 + k * 12) + '" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="' + op + '"></circle>'
        }
        return out + '</svg>'
      }

      function bodyHtml(variant) {
        if (variant === 'B') {
          return '<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">' +
            '<div class="dsp-sweep"></div><div class="dsp-rings">' + ringsHtml() + '</div>' +
            '<div class="dsp-ping"></div><div class="dsp-dots"></div>' +
            '<div class="dsp-hud"><b></b><span></span></div></div></div>'
        }
        if (variant === 'C') {
          return '<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2"></span></div>' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3"></span><i class="dsp-caret"></i></div>' +
            '</div><div class="dsp-led">' + [0, 1, 2, 3, 4, 5].map(function (i) {
              return '<i class="dsp-led-seg" data-i="' + i + '"></i>'
            }).join('') + '</div><div class="dsp-code"></div></div>'
        }
        return '<div class="dsp-cbody dsp-v-a">' +
          '<div class="dsp-big"></div><div class="dsp-meta"></div></div>'
      }

      function buildCard() {
        card = document.createElement('div')
        card.className = 'dsp-card'
        card.setAttribute('data-variant', ui.variant)
        card.setAttribute('aria-label', tr('app.aria'))
        card.innerHTML = headHtml() +
          (ui.folded ? '' : bodyHtml(ui.variant) +
            '<div class="dsp-cbtns"><button type="button" class="dsp-btn"></button></div>' +
            '<div class="dsp-hazard" aria-hidden="true"></div>')

        var chead = card.querySelector('.dsp-chead')
        chead.addEventListener('click', function () { setFolded(!ui.folded) })
        chead.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFolded(!ui.folded) }
        })
        var btn = card.querySelector('.dsp-btn')
        if (btn) btn.addEventListener('click', function () { void act() })
        var floatBtn = card.querySelector('.dsp-float')
        if (floatBtn) {
          floatBtn.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation()
            openFloat()
          })
        }
      }

      /**
       * The floating window is a host page, not a second card: it keeps its own
       * /state loop and language, so the card only opens it. A fixed window name
       * makes repeated clicks focus the existing window instead of stacking them.
       */
      function openFloat() {
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(BASE + '/window', FLOAT_NAME, 'width=420,height=640')
          }
        } catch (e) { /* popup blocked: the card itself still works */ }
      }

      /**
       * A blocked card offers "解除并重试": clearing the park and re-arming is
       * one intention, so it must not take two clicks. Everything else keeps the
       * single-shot semantics.
       */
      function act() {
        var view = viewOf(snapshot)
        if (view === 'blocked') {
          return post('/disarm').then(function () { return post('/arm') })
        }
        return post(actionPath(view))
      }

      function actionPath(view) {
        if (view === 'off') return '/arm'
        if (view === 'fire') return '/cancel'
        return '/disarm'
      }

      function currentOwner() {
        try { return window[OWNER_KEY] || null } catch (e) { return null }
      }

      function ensureHost() {
        var region = document.querySelector('[class*="regionArea"]')
        if (!region) return null
        var owner = currentOwner()
        if (owner && owner !== INSTANCE) {
          // Another module instance has taken over (hot reload): give up the DOM
          // instead of fighting it. Its paint loop stops on the next tick too.
          if (host) host.remove()
          host = null
          card = null
          builtSig = ''
          return null
        }
        if (!owner) {
          try { window[OWNER_KEY] = INSTANCE } catch (e) { /* ignore */ }
        }
        // Only the owner clears leftovers: stale hosts may belong to an earlier
        // instance whose paint loop is still running.
        var stale = region.querySelectorAll('[data-dsh-shutdown-guard]')
        for (var i = 0; i < stale.length; i++) {
          if (stale[i] !== host) stale[i].remove()
        }
        if (host && host.isConnected) return host
        if (!host) {
          host = document.createElement('div')
          host.className = 'dsp-host'
          host.setAttribute('data-dsh-shutdown-guard', '')
        }
        if (!card) buildCard()
        host.appendChild(card)
        region.insertBefore(host, region.firstChild)
        return host
      }

      // the card carries its own palette; only the luminance of the host surface is borrowed
      var lumAt = 0
      function detectLum() {
        var probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;background:var(--dsw-alias-bg-layer-1, #000)'
        document.body.appendChild(probe)
        var raw = ''
        try { raw = getComputedStyle(probe).backgroundColor } finally { probe.remove() }
        var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw || '')
        if (!m) return 'dark'
        var l = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255
        return l > 0.55 ? 'light' : 'dark'
      }

      function paint() {
        if (!ensureHost() || !card) return
        var snap = snapshot
        var view = viewOf(snap)
        var sec = remainingSec(snap)
        // The active language is part of the signature: a switch re-renders the
        // whole card instead of waiting for a fold/unfold.
        var sig = [ui.variant, ui.folded, view, snap.runningCount, snap.jobsRunning, activeLang()].join('|')
        if (sig !== builtSig) {
          // structure depends on variant / fold; counts only affect dots and hud text
          var needRebuild = builtSig === '' || card.getAttribute('data-variant') !== ui.variant ||
            card.classList.contains('is-folded') !== ui.folded ||
            card.getAttribute('data-lang') !== activeLang()
          if (needRebuild) {
            var parent = card.parentNode
            buildCard()
            if (parent) parent.replaceChild(card, parent.firstChild)
          }
          builtSig = sig
        }

        var title = card.querySelector('.dsp-ctitle')
        if (title && title.textContent !== tr('app.title')) title.textContent = tr('app.title')
        card.setAttribute('aria-label', tr('app.aria'))

        card.setAttribute('data-state', view)
        card.setAttribute('data-lang', activeLang())
        card.classList.toggle('is-folded', ui.folded)
        card.classList.toggle('dsp-claude', ui.theme === 'claude')
        if (ui.theme === 'auto') {
          if (Date.now() - lumAt > 3000) {
            lumAt = Date.now()
            card.setAttribute('data-lum', detectLum())
          }
        } else {
          card.setAttribute('data-lum', ui.theme === 'light' ? 'light' : 'dark')
        }

        var tag = card.querySelector('.dsp-tag')
        if (tag) tag.textContent = tr('tag.' + view)
        var floatLabel = card.querySelector('.dsp-float')
        if (floatLabel) {
          var fl = tr('card.float')
          if (floatLabel.getAttribute('aria-label') !== fl) {
            floatLabel.setAttribute('aria-label', fl)
            floatLabel.setAttribute('title', fl)
          }
        }
        var chev = card.querySelector('.dsp-chev')
        if (chev) chev.classList.toggle('is-folded', ui.folded)

        var btn = card.querySelector('.dsp-btn')
        if (btn) {
          var isOff = view === 'off'
          var isFire = view === 'fire'
          btn.textContent = isOff ? tr('btn.arm') : isFire ? tr('btn.cancel') : tr('btn.disarm')
          btn.className = isOff ? 'dsp-btn dsp-btn-primary' : 'dsp-btn dsp-btn-danger'
        }

        var big = card.querySelector('.dsp-big')
        if (big) big.textContent = bigText(snap, view)
        var meta = card.querySelector('.dsp-meta')
        if (meta) meta.textContent = metaText(snap, view)

        card.setAttribute('data-retry', view === 'blocked' && snap.retryAt > 0 ? '1' : '0')

        var hud = card.querySelector('.dsp-hud')
        if (hud) {
          var hudKey = view === 'hold' ? 'hud.state.hold'
            : view === 'fired' ? 'hud.state.fired'
              : view === 'off' ? 'hud.state.off'
                : view === 'blocked' ? (snap.retryAt > 0 ? 'hud.state.retrying' : 'hud.state.paused') : 'hud.state.standby'
          hud.querySelector('b').textContent = view === 'fire' ? mmss(sec) : tr(hudKey)
          hud.querySelector('span').textContent = view === 'blocked'
            ? (snap.retryAt > 0 ? tr('hud.retry', { n: snap.retryAttempt }) : tr('hud.manual'))
            : tr('unit.jobs', { n: fmt2(snap.jobsRunning) }) + ' · ' + tr('unit.agent', { n: fmt2(snap.runningCount) })
        }

        var dots = card.querySelector('.dsp-dots')
        if (dots) {
          syncDots('run', snap.runningCount)
          syncDots('job', snap.jobsRunning)
          var html = ''
          dotStore.run.forEach(function (p) {
            html += '<i class="dsp-rdot dsp-rdot-run" style="left:calc(50% + ' + p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
          })
          dotStore.job.forEach(function (p) {
            html += '<i class="dsp-rdot dsp-rdot-job" style="left:calc(50% + ' + p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
          })
          if (dots.innerHTML !== html) dots.innerHTML = html
        }

        var l2 = card.querySelector('.dsp-l2')
        if (l2) l2.textContent = tr('unit.jobs', { n: fmt2(snap.jobsRunning) }) + ' · ' + tr('unit.agent', { n: fmt2(snap.runningCount) })
        var l3 = card.querySelector('.dsp-l3')
        if (l3) {
          var l3Key = view === 'hold' ? 'term.hold'
            : view === 'off' ? 'term.off'
              : view === 'blocked' ? (snap.retryAt > 0 ? 'term.retry' : 'term.halted')
                : view === 'fired' ? 'term.done' : 'term.wait'
          l3.textContent = view === 'fire' ? tr('term.fire', { t: mmss(sec) }) : tr(l3Key)
        }
        var led = [view !== 'off', true, snap.runningCount === 0, snap.jobsRunning === 0, snap.erroredCount === 0, view === 'fire']
        var segs = card.querySelectorAll('.dsp-led-seg')
        for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', !!led[i])
        var code = card.querySelector('.dsp-code')
        if (code) {
          code.textContent = view === 'blocked'
            ? (snap.retryAt > 0 ? tr('code.waiting') : tr('code.halted'))
            : tr('code.gates', { n: led.filter(Boolean).length })
        }
      }

      // ---------------- settings section ----------------

      function settingsRow(key, title, desc, control, extraClass) {
        return h('div', { key: key, className: 'dsp-srow' + (extraClass ? ' ' + extraClass : '') },
          h('div', { className: 'dsp-srow-text' },
            h('span', { className: 'dsp-stitle' }, title),
            desc ? h('span', { className: 'dsp-sdesc' }, desc) : null),
          control)
      }

      function settingsGroup(key, title, note) {
        return h('div', { key: key, className: 'dsp-sgroup' }, title, note ? h('span', { className: 'dsp-sgroup-note' }, note) : null)
      }

      function seg(items, current, onPick) {
        return h('div', { className: 'dsp-seg' }, items.map(function (pair) {
          return h('button', {
            key: pair[0],
            type: 'button',
            className: 'dsp-segbtn' + (current === pair[0] ? ' on' : ''),
            onClick: function () { onPick(pair[0]) },
          }, pair[1])
        }))
      }

      function toggle(on, onPick, disabled, label) {
        var attrs = {
          type: 'button',
          className: 'dsp-switch' + (on ? ' on' : ''),
          'aria-pressed': !!on,
          disabled: !!disabled,
          onClick: function () { if (!disabled) onPick(!on) },
        }
        // A switch has no text of its own; without a name a screen reader only
        // announces "button". Reuse the row title so no extra MSG key is needed.
        if (label) attrs['aria-label'] = label
        return h('button', attrs, h('i', null))
      }

      function SettingsSection() {
        var uiState = React.useSyncExternalStore(subscribeUi, getUi)
        var snap = React.useSyncExternalStore(subscribe, getSnapshot)
        var skip = snap.lastSkip
        var profiles = Array.isArray(snap.profiles) ? snap.profiles : []
        var active = snap.activeProfileId || 'default'
        var customOn = snap.customEnabled === true
        var activeProfile = null
        for (var pi = 0; pi < profiles.length; pi += 1) {
          if (profiles[pi].id === active) { activeProfile = profiles[pi]; break }
        }
        var groups = []

        // 1) 外观
        var look = [settingsGroup('look-g', tr('set.look'))]
        look.push(settingsRow('look', tr('set.variant'), tr('set.variant.desc'),
          seg(VARIANTS.map(function (v) { return [v, v] }), uiState.variant, setVariant)))
        if (uiState.variant === 'C') {
          look.push(settingsRow('led', tr('set.led'),
            tr('set.led.desc'),
            null, 'dsp-srow-stack'))
        }
        look.push(settingsRow('theme', tr('set.theme'), tr('set.theme.desc'),
          seg([['auto', tr('theme.auto')], ['dark', tr('theme.dark')], ['light', tr('theme.light')], ['claude', tr('theme.claude')]], uiState.theme, setTheme)))
        look.push(settingsRow('fold', tr('set.fold'), tr('set.fold.desc'),
          toggle(uiState.folded, setFolded, false, tr('set.fold'))))
        look.push(settingsRow('lang', tr('set.lang'), tr('set.lang.desc'),
          seg([
            ['auto', tr('lang.auto')],
            ['zh', tr('lang.zh')],
            ['en', tr('lang.en')],
            ['ru', tr('lang.ru')],
          ], snap.language || 'auto', setLanguage)))
        groups.push(h('div', { key: 'g-look', className: 'dsp-sgroup-box' }, look))

        // 2) 关卡：一个默认 + 8 个自定义
        var rules = [settingsGroup('rule-g', tr('set.when'))]
        rules.push(settingsRow('custom', tr('set.custom'),
          customOn ? tr('set.custom.on') : tr('set.custom.off'),
          toggle(customOn, function (next) { void post('/config', { customEnabled: next }) }, false, tr('set.custom'))))
        rules.push(settingsRow('slots', tr('set.pick'),
          activeProfile
            ? tr('set.pick.cur', { label: activeProfile.label, sec: activeProfile.countdownSec })
            : tr('set.pick.default'),
          h('div', { className: 'dsp-slotbar' }, profiles.map(function (p) {
            var isDefault = p.id === 'default'
            var locked = !isDefault && !customOn
            return h('button', {
              key: p.id,
              type: 'button',
              title: p.label,
              disabled: locked,
              className: 'dsp-slotbtn' + (p.id === active ? ' on' : '') + (locked ? ' locked' : ''),
              onClick: function () { void post('/config', { activeProfileId: p.id }) },
            }, isDefault ? tr('set.default') : p.id.replace('c', ''))
          }))))
        rules.push(settingsRow('c3', tr('set.bottom'), tr('set.bottom.desc'),
          h('span', { className: 'dsp-sval' }, tr('set.always')), 'dsp-srow-ro'))
        var editable = activeProfile && (customOn || active === 'default')
        var cur = activeProfile || { countdownSec: 60, onlyOnSuccess: true, blockOnJobs: true }
        rules.push(settingsRow('c2', tr('set.jobs'), tr('set.jobs.desc'),
          toggle(cur.blockOnJobs, function (next) {
            void post('/config', { profileId: active, patch: { blockOnJobs: next } })
          }, !editable, tr('set.jobs'))))
        rules.push(settingsRow('c1', tr('set.err'), tr('set.err.desc'),
          toggle(cur.onlyOnSuccess, function (next) {
            void post('/config', { profileId: active, patch: { onlyOnSuccess: next } })
          }, !editable, tr('set.err'))))
        rules.push(settingsRow('cd', tr('set.cd'),
          snap.countdownLocked
            ? tr('set.cd.locked')
            : tr('set.cd.desc'),
          snap.countdownLocked
            ? h('span', { className: 'dsp-sval' }, tr('set.cd.fixed'))
            : seg([[30, tr('cd.30')], [60, tr('cd.60')], [120, tr('cd.120')], [300, tr('cd.300')]], cur.countdownSec, function (v) {
              void post('/config', { profileId: active, patch: { countdownSec: v } })
            })))
        rules.push(settingsRow('afk', tr('set.afk'),
          tr('set.afk.desc'),
          toggle(snap.afkAutoAnswer !== false, function (next) {
            void post('/config', { afkAutoAnswer: next })
          }, false, tr('set.afk'))))
        groups.push(h('div', { key: 'g-rule', className: 'dsp-sgroup-box' }, rules))

        // 3) 状态与日志
        var status = [settingsGroup('st-g', tr('set.status'))]
        status.push(settingsRow('blocked', tr('set.blocked'), snap.blocked
          ? (snap.retryAt > 0 ? tr('set.blocked.waiting') : tr('set.blocked.halted'))
          : tr('set.blocked.none'),
          h('span', {
            className: 'dsp-sval' + (snap.blocked ? '' : ' dsp-sval-dim'),
            style: snap.blocked ? { color: snap.retryAt > 0 ? '#6f8f7a' : '#7e8aa3', maxWidth: 300, textAlign: 'right' } : undefined,
          }, snap.blocked || tr('set.none'))))
        status.push(settingsRow('skip', tr('set.skip'), null,
          h('span', { className: 'dsp-sval' + (skip && skip.reason ? '' : ' dsp-sval-dim') },
            skip && skip.reason ? skip.reason : tr('set.skip.none')), 'dsp-srow-stack'))
        var evs = Array.isArray(snap.events) ? snap.events.slice(-12) : []
        status.push(settingsRow('events', tr('set.events'), evs.length ? tr('set.events.desc', { n: evs.length }) : tr('set.events.none'),
          h('div', { className: 'dsp-evlog' }, evs.length === 0
            ? h('span', { className: 'dsp-ev-empty' }, '—')
            : evs.map(function (e, i) {
              return h('div', { key: i, className: 'dsp-ev dsp-ev-' + (e.kind || 'info') },
                h('span', { className: 'dsp-ev-time' }, hhmmss(e.at)),
                h('span', { className: 'dsp-ev-text' }, e.text))
            })), 'dsp-srow-stack'))
        groups.push(h('div', { key: 'g-st', className: 'dsp-sgroup-box' }, status))

        return h('div', { className: 'dsp-settings' }, groups)
      }
      // ---------------- css ----------------

      var CSS = [
        // host: matches the panel row hit area (button x=12, width=256 in a 280px sidebar)
        '.dsp-host{flex:0 0 auto;padding:0 12px 8px 0;min-width:0}',
        // own palette: the card does not follow the host theme's alias tokens
        '.dsp-card{--dsp-bg:#1c1e22;--dsp-fg:#f3f4f6;--dsp-muted:#a7abb4;--dsp-line:rgba(255,255,255,.14);',
        '--dsp-accent:#f0a83a;--dsp-danger:#ef5350;--dsp-track:rgba(255,255,255,.16);',
        '--dsp-tape-a:#f2b13c;--dsp-tape-b:#e8453c}',
        '.dsp-card.dsp-claude{--dsp-bg:#1f1d1a;--dsp-fg:#f5f1ea;--dsp-muted:#b3a99c;--dsp-line:rgba(255,255,255,.12);--dsp-accent:#d97757;--dsp-danger:#e5674f;--dsp-tape-a:#e08a5f;--dsp-tape-b:#b8483a}',
        '.dsp-card[data-lum="light"]{--dsp-bg:#ffffff;--dsp-fg:#1b2030;--dsp-muted:#5b6472;--dsp-line:rgba(0,0,0,.15);',
        '--dsp-accent:#e08f13;--dsp-danger:#d92d20;--dsp-track:rgba(0,0,0,.13);--dsp-tape-a:#f0b03a;--dsp-tape-b:#e0483c}',
        '.dsp-card{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:178px;margin:0;padding:10px 12px 0;border-radius:12px;overflow:hidden;',
        'border:1px solid var(--dsp-line);background:var(--dsp-bg);color:var(--dsp-fg);',
        'font-family:var(--dsw-font-family, system-ui);overflow:hidden;transition:height .18s ease}',
        '.dsp-card[data-state="off"]{background:color-mix(in srgb, var(--dsp-fg) 2.5%, var(--dsp-bg))}',
        '.dsp-card[data-state="fire"]{border-color:var(--dsp-danger)}',
        '.dsp-card.is-folded{height:auto;padding-bottom:8px}',
        '.dsp-hrow{display:flex;align-items:center;gap:4px;height:22px;line-height:22px}',
        '.dsp-chead{display:flex;align-items:center;gap:7px;flex:1 1 auto;min-width:0;height:22px;line-height:22px;cursor:pointer;user-select:none}',
        '.dsp-live{width:6px;height:6px;margin-top:0;border-radius:50%;flex:0 0 6px;align-self:center;background:var(--dsp-muted)}',
        '.dsp-card[data-state="armed"] .dsp-live,.dsp-card[data-state="hold"] .dsp-live{background:var(--dsp-accent);box-shadow:0 0 8px var(--dsp-accent)}',
        '.dsp-card[data-state="fire"] .dsp-live,.dsp-card[data-state="fired"] .dsp-live{background:var(--dsp-danger);animation:dsp-pulse-red .9s infinite}',
        '.dsp-ctitle{flex:1 1 auto;min-width:0;font-size:12.5px;line-height:22px;color:var(--dsp-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsp-card[data-lang="en"] .dsp-ctitle,.dsp-card[data-lang="ru"] .dsp-ctitle{font-size:12px}',
        '.dsp-tag{flex:0 0 auto;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9px;letter-spacing:.08em;',
        'padding:1px 5px;border-radius:5px;border:1px solid color-mix(in srgb, var(--dsp-muted) 40%, transparent);color:var(--dsp-muted)}',
        '.dsp-card[data-state="armed"] .dsp-tag,.dsp-card[data-state="hold"] .dsp-tag{color:var(--dsp-accent);border-color:color-mix(in srgb, var(--dsp-accent) 50%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-tag,.dsp-card[data-state="fired"] .dsp-tag{color:var(--dsp-danger);border-color:color-mix(in srgb, var(--dsp-danger) 50%, transparent)}',
        '.dsp-chev{flex:0 0 auto;display:block;color:var(--dsp-muted);transition:transform .18s}',
        '.dsp-chev.is-folded{transform:rotate(-90deg)}',
        '.dsp-float{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;margin:0;border:0;border-radius:4px;background:transparent;color:var(--dsp-muted);cursor:pointer;opacity:.72;transition:opacity .15s,color .15s,background .15s}',
        '.dsp-float:hover,.dsp-float:focus-visible{opacity:1;color:var(--dsp-fg);background:color-mix(in srgb, var(--dsp-accent) 14%, transparent);outline:none}',
        '.dsp-float:active{background:color-mix(in srgb, var(--dsp-accent) 22%, transparent)}',
        // Settings-nav patch target: mask with the inlined glyph so the icon
        // inherits currentColor and follows the theme without a second asset.
        '.dsp-navicon{width:20px;height:20px;flex:none;display:inline-block;background-color:currentColor;-webkit-mask:url("data:image/png;base64,' + NAV_ICON_B64 + '") center/contain no-repeat;mask:url("data:image/png;base64,' + NAV_ICON_B64 + '") center/contain no-repeat}',
        '.dsp-cbody{position:relative;flex:1;min-height:0}',
        '.dsp-v-a{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0}',
        '.dsp-big{font-family:ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;font-size:26px;line-height:1.15;font-weight:650;letter-spacing:-.2px}',
        '.dsp-card[data-state="fire"] .dsp-big{color:var(--dsp-danger)}',
        '.dsp-meta{margin-top:5px;font-size:11.5px;line-height:16px;color:var(--dsp-muted);min-height:15px}',
        '.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsp-accent)}',
        '.dsp-cbtns{display:flex;align-items:center;gap:6px;padding:8px 0 10px;flex:0 0 auto}',
        '.dsp-btn{flex:1 1 auto;min-width:0;height:30px;border-radius:8px;border:1px solid var(--dsp-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}',
        '.dsp-btn:hover{background:color-mix(in srgb, var(--dsp-fg) 7%, transparent)}',
        '.dsp-btn-primary{border-color:transparent;background:var(--dsp-accent);color:#1a1200;font-weight:600}',
        '.dsp-btn-danger{border-color:color-mix(in srgb, var(--dsp-danger) 45%, transparent);color:var(--dsp-danger);background:color-mix(in srgb, var(--dsp-danger) 6%, transparent)}',
        // caution tape: one wide strip with an intrinsic repeating gradient, translated 鈥?no tiling seams
        '.dsp-hazard{position:relative;height:10px;margin:0 -12px;overflow:hidden}',
        '.dsp-hazard::before{content:"";position:absolute;top:0;bottom:0;left:-48px;right:-48px;',
        'background:repeating-linear-gradient(45deg,var(--dsp-tape-a) 0 10px,var(--dsp-tape-b) 10px 20px);',
        'animation:dsp-slide var(--dsp-haz-dur, 1.15s) linear infinite;animation-delay:var(--dsp-haz-phase, 0s)}',
        '.dsp-card[data-state="hold"] .dsp-hazard::before{--dsp-haz-dur:2.6s;opacity:.9}',
        '.dsp-card[data-state="fire"] .dsp-hazard::before{--dsp-haz-dur:.42s}',
        '.dsp-card[data-state="off"] .dsp-hazard{opacity:.55}',
        '.dsp-card[data-state="off"] .dsp-hazard::before{animation-play-state:paused}',
        '.dsp-card[data-state="fired"] .dsp-hazard{opacity:.45}',
        '.dsp-card[data-state="fired"] .dsp-hazard::before{animation-play-state:paused}',
        // radar
        // B: radar scope fills the body, exactly as in preview/sidebar-live.html
        '.dsp-v-b{display:block;height:100%;padding:6px 0 0}',
        '.dsp-disc{position:relative;height:100%;min-height:66px;border-radius:10px;border:1px solid var(--dsp-line);overflow:hidden;',
        'background:radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--dsp-accent) 9%, transparent), transparent 66%), color-mix(in srgb, var(--dsp-bg) 94%, var(--dsp-fg))}',
        '.dsp-sweep{position:absolute;left:50%;top:50%;width:320px;height:320px;margin:-160px 0 0 -160px;border-radius:50%;',
        'background:conic-gradient(from 0deg,transparent 0deg,transparent 10deg,',
        'color-mix(in srgb, var(--dsp-accent) 8%, transparent) 22deg,',
        'color-mix(in srgb, var(--dsp-accent) 20%, transparent) 38deg,',
        'color-mix(in srgb, var(--dsp-accent) 34%, transparent) 54deg,',
        'color-mix(in srgb, var(--dsp-accent) 12%, transparent) 66deg,',
        'color-mix(in srgb, var(--dsp-accent) 4%, transparent) 72deg,transparent 78deg,transparent 360deg);',
        'animation:dsp-spin 3.2s linear infinite;',
        '-webkit-mask-image:radial-gradient(circle, #000 0 44%, transparent 74%);mask-image:radial-gradient(circle, #000 0 44%, transparent 74%)}',        '.dsp-card[data-state="hold"] .dsp-sweep{animation-duration:5.6s;opacity:.62}',
        '.dsp-card[data-state="fire"] .dsp-sweep{animation-duration:1s}',
        '.dsp-rings{position:absolute;inset:0}',
        '.dsp-radar-svg{position:absolute;left:50%;top:50%;width:238px;height:202px;margin:-101px 0 0 -119px;pointer-events:none}',
        '.dsp-dots{position:absolute;inset:0}',
        '.dsp-ring{position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);border:1px solid color-mix(in srgb, var(--dsp-accent) 30%, transparent);z-index:1}',
        '.dsp-ping{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--dsp-accent);z-index:2;box-shadow:0 0 12px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-ping{background:var(--dsp-danger);box-shadow:0 0 12px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}',
        '.dsp-rdot{position:absolute;width:5px;height:5px;border-radius:50%;transform:translate(-50%,-50%);z-index:2}',
        '.dsp-rdot-run{background:var(--dsp-muted);box-shadow:0 0 6px color-mix(in srgb, var(--dsp-muted) 80%, transparent)}',
        '.dsp-rdot-job{background:var(--dsp-accent);box-shadow:0 0 8px color-mix(in srgb, var(--dsp-accent) 95%, transparent)}',
        '.dsp-card[data-state="hold"] .dsp-rdot{animation:dsp-dotpulse 2.4s ease-in-out infinite}',
        '.dsp-card[data-state="fire"] .dsp-rdot{opacity:.3}',
        '.dsp-card[data-state="fired"] .dsp-rdot{opacity:.18}',
        '.dsp-disc::after{content:"";position:absolute;left:0;right:0;bottom:0;height:42px;z-index:1;pointer-events:none;',
        'background:linear-gradient(0deg, color-mix(in srgb, var(--dsp-bg) 92%, transparent) 12%, transparent)}',
        '.dsp-hud{position:absolute;left:9px;right:9px;bottom:7px;z-index:3;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;row-gap:1px;',
        'font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;',
        'color:var(--dsp-muted);text-shadow:0 1px 8px rgba(0,0,0,.5);white-space:nowrap;line-height:1.45}',
        '.dsp-hud::before{content:"";width:4px;height:4px;border-radius:50%;background:var(--dsp-accent);flex:none;align-self:center;',
        'box-shadow:0 0 7px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}',
        '.dsp-hud b{font-size:11px;letter-spacing:.1em;color:var(--dsp-fg);font-weight:600}',
        '.dsp-card[data-state="fire"] .dsp-hud b{font-size:12px;color:color-mix(in srgb, var(--dsp-danger) 55%, #fff)}',
        '.dsp-card[data-state="fire"] .dsp-hud::before{background:var(--dsp-danger);box-shadow:0 0 7px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}',
        '.dsp-card[data-state="off"] .dsp-hud::before,.dsp-card[data-state="fired"] .dsp-hud::before{background:var(--dsp-muted);box-shadow:none}',
        // terminal
        '.dsp-v-c{display:flex;flex-direction:column;height:100%;padding:6px 0 0}',
        '.dsp-screen{flex:1;min-height:0;border-radius:6px;padding:6px 8px;background:#0b0d10;border:1px solid rgba(255,255,255,.08);font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9.5px;line-height:1.5;color:#9ef0a8;overflow:hidden}',
        '.dsp-term-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9f7d2}',
        '.dsp-pr{color:#5d8f6b;margin-right:4px}',
        '.dsp-caret{display:inline-block;width:5px;height:9px;margin-left:2px;background:#9ef0a8;animation:dsp-blink 1s steps(1) infinite;vertical-align:-1px}',
        '.dsp-card[data-state="fire"] .dsp-screen{background:#2a0d0d;border-color:rgba(255,77,79,.4);color:#ffb3b0}',
        '.dsp-card[data-state="fire"] .dsp-term-line{color:#ffd0cc}',
        '.dsp-card[data-state="fire"] .dsp-caret{background:#ff4d4f}',
        '.dsp-led{display:flex;gap:4px;margin-top:6px;flex:0 0 auto}',
        '.dsp-led-seg{flex:1 1 0;height:4px;border-radius:2px;background:var(--dsp-track)}',
        '.dsp-led-seg.on{background:var(--dsp-accent)}',
        '.dsp-card[data-state="fire"] .dsp-led-seg.on{background:var(--dsp-danger)}',
        '.dsp-code{margin-top:5px;font-size:9px;line-height:12px;color:var(--dsp-muted);flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // blocked: something outside is stopping the shutdown, so the card must
        // never look like it is about to fire. Two flavours — grey-blue when a
        // human has to act, grey-green (breathing) while the plugin retries.
        '.dsp-card[data-state="blocked"]{--dsp-blocked:#7e8aa3;--dsp-blocked-soft:rgba(126,138,163,.16)}',
        '.dsp-card[data-lum="light"][data-state="blocked"]{--dsp-blocked:#5a6b8c;--dsp-blocked-soft:rgba(90,107,140,.12)}',
        '.dsp-card[data-state="blocked"][data-retry="1"]{--dsp-blocked:#6f8f7a;--dsp-blocked-soft:rgba(111,143,122,.16)}',
        '.dsp-card[data-lum="light"][data-state="blocked"][data-retry="1"]{--dsp-blocked:#4a7059;--dsp-blocked-soft:rgba(74,112,89,.12)}',
        '.dsp-card[data-state="blocked"] .dsp-live{background:var(--dsp-blocked);box-shadow:0 0 0 3px var(--dsp-blocked-soft);animation:none}',
        '.dsp-card[data-state="blocked"][data-retry="1"] .dsp-live{animation:dsp-wait 1.6s ease-in-out infinite}',
        '@keyframes dsp-wait{0%,100%{opacity:.45;box-shadow:0 0 0 2px var(--dsp-blocked-soft)}50%{opacity:1;box-shadow:0 0 0 5px transparent}}',
        '.dsp-card[data-state="blocked"] .dsp-tag{color:var(--dsp-blocked);border-color:var(--dsp-blocked-soft);background:var(--dsp-blocked-soft)}',
        '.dsp-card[data-state="blocked"] .dsp-big{color:var(--dsp-blocked)}',
        '.dsp-card[data-state="blocked"] .dsp-meta{color:var(--dsp-blocked)}',
        '.dsp-card[data-state="blocked"] .dsp-btn{color:var(--dsp-fg);border-color:color-mix(in srgb,var(--dsp-blocked) 55%,transparent);background:var(--dsp-blocked-soft)}',
        '.dsp-card[data-state="blocked"] .dsp-hazard{opacity:.28;filter:grayscale(1)}',
        '.dsp-card[data-state="blocked"] .dsp-hazard::before{animation-play-state:paused}',
        '.dsp-card[data-state="blocked"] .dsp-rings{opacity:.30;filter:grayscale(1)}',
        '.dsp-card[data-state="blocked"] .dsp-sweep{display:none}',
        '.dsp-card[data-state="blocked"] .dsp-ping{display:none}',
        '.dsp-card[data-state="blocked"] .dsp-rdot{opacity:.22}',
        '.dsp-card[data-state="blocked"] .dsp-hud b{color:var(--dsp-blocked)}',
        '.dsp-card[data-state="blocked"] .dsp-hud::before{background:var(--dsp-blocked);box-shadow:none}',
        '.dsp-card[data-state="blocked"] .dsp-screen{background:color-mix(in srgb,var(--dsp-blocked) 10%,#0b0d10);border-color:color-mix(in srgb,var(--dsp-blocked) 40%,transparent);color:#c3cbdc}',
        '.dsp-card[data-state="blocked"] .dsp-pr{color:var(--dsp-blocked)}',
        '.dsp-card[data-state="blocked"] .dsp-led-seg.on{background:var(--dsp-blocked)}',
        '.dsp-card[data-state="blocked"] .dsp-code{color:var(--dsp-blocked)}',
        '.dsp-ev-blocked .dsp-ev-text{color:#7e8aa3}',
        // settings (host theme tokens: it lives in the app settings page)
        '.dsp-settings{display:flex;flex-direction:column;padding:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-srow{display:flex;align-items:center;justify-content:space-between;gap:12px 8px;padding:14px 0;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-srow:first-child{border-top:none}',
        '.dsp-srow-text{flex:1 1 140px;min-width:0;display:flex;flex-direction:column;gap:3px;padding-right:28px}',
        '.dsp-stitle{font-size:14px;line-height:22px}',
        '.dsp-sdesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sgroup-box{display:flex;flex-direction:column;padding-top:16px;margin-top:16px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-sgroup-box:first-child{padding-top:0;margin-top:0;border-top:none}',
        '.dsp-sgroup{font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary, #b0aea5);padding:0 0 2px}',
        '.dsp-sgroup + .dsp-srow{border-top:none}',
        '.dsp-srow{padding:12px 0}',
        '.dsp-srow-stack{align-items:flex-start;flex-direction:column;gap:6px}',
        // in a column container flex-basis would apply to height, collapsing the
        // row into a 140px-tall blank box
        '.dsp-srow-stack .dsp-srow-text{flex:0 0 auto;padding-right:0;width:100%}',
        '.dsp-srow-stack .dsp-sval{font-size:12px;line-height:18px;white-space:normal}',
        '.dsp-srow-ro .dsp-sval{max-width:58%;text-align:right;white-space:normal}',
        '.dsp-sval-dim{opacity:.55}',
        '.dsp-shead{margin:16px 0 -2px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));font-size:12px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-secondary, #b9b9b4)}',
        '.dsp-seg{display:flex;gap:4px;flex:none;flex-wrap:wrap;justify-content:flex-end}',
        '.dsp-segbtn{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));background:transparent;color:var(--dsw-alias-label-secondary, #b9b9b4);font:inherit;font-size:13px;cursor:pointer}',
        '.dsp-segbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))}',
        '.dsp-segbtn.on{background:var(--dsw-alias-button-primary-fill, #f5a623);border-color:transparent;color:var(--dsw-alias-label-inverse, #201500);font-weight:600}',
        '.dsp-switch{flex:none;width:36px;height:20px;border-radius:10px;border:0;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.3));position:relative;cursor:pointer;padding:0}',
        '.dsp-switch i{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-overlay, #fff);transition:.16s}',
        '.dsp-switch.on{background:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-switch.on i{left:18px}',
        '.dsp-shint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sval{font-size:12px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sgroup-note{margin-left:6px;font-weight:400;letter-spacing:0;opacity:.7}',
        '.dsp-slotbar{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}',
        '.dsp-slotbtn{width:30px;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));background:transparent;color:var(--dsw-alias-label-secondary, #b9b9b4);font:inherit;font-size:11px;cursor:pointer;padding:0}',
        '.dsp-slotbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))}',
        '.dsp-slotbtn.on{background:var(--dsw-alias-button-primary-fill, #f5a623);border-color:transparent;color:var(--dsw-alias-label-inverse, #201500);font-weight:600}',
        '.dsp-slotbtn.locked{opacity:.35;cursor:not-allowed}',
        '.dsp-evlog{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow:auto;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:11px;line-height:16px}',
        '.dsp-ev{display:flex;gap:8px;align-items:baseline}',
        '.dsp-ev-time{flex:none;opacity:.5}',
        '.dsp-ev-text{min-width:0;word-break:break-word}',
        '.dsp-ev-config .dsp-ev-text{color:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-ev-skip .dsp-ev-text{color:var(--dsw-alias-state-warning-primary, #d8a12a)}',
        '.dsp-ev-empty{opacity:.45}',
        '.dsp-switch:disabled{opacity:.4;cursor:not-allowed}',
        // keyframes
        '@keyframes dsp-slide{to{transform:translateX(28.28px)}}',
        '@keyframes dsp-spin{to{transform:rotate(360deg)}}',
        '@keyframes dsp-blink{50%{opacity:0}}',
        '@keyframes dsp-dotpulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '@keyframes dsp-pulse-red{0%{box-shadow:0 0 0 0 rgba(239,83,80,.7)}70%{box-shadow:0 0 0 6px rgba(239,83,80,0)}100%{box-shadow:0 0 0 0 rgba(239,83,80,0)}}',
      ].join('')


      // ---- settings-nav icon patch (host DOM, not a slot) --------------------
      // Host nav rows are `.…navCell` with a hashed prefix; never match the hash.
      // Locate our row semantically by its label text, then swap the host svg.
      var navObserver = null
      var navRaf = 0

      function maskSupported() {
        try {
          // `CSS` at module scope is our stylesheet string array — the browser
          // API lives on window/globalThis, so never read the bare identifier.
          var face = (typeof window !== 'undefined' && window && window.CSS) ||
            (typeof globalThis !== 'undefined' && globalThis.CSS) || null
          if (!face || typeof face.supports !== 'function') return false
          return !!(face.supports('mask', 'none') || face.supports('mask-image', 'none') || face.supports('-webkit-mask', 'none'))
        } catch (e) { return false }
      }

      function paintNavIcon() {
        try {
          if (typeof document === 'undefined' || !document.querySelectorAll) return
          var rows = document.querySelectorAll('[class*="navCell"]')
          if (!rows || !rows.length) return
          var title = tr('app.title')
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i]
            var text = String(row.textContent || '').replace(/\s+/g, ' ').trim()
            if (text !== title && text.indexOf(title) < 0) continue
            var svg = row.querySelector('svg')
            if (svg) {
              // No mask support: keep the host gear rather than break the row.
              if (!maskSupported()) return
              var span = document.createElement('span')
              span.className = NAVICON_CLASS
              span.setAttribute('aria-hidden', 'true')
              if (svg.parentNode) svg.parentNode.replaceChild(span, svg)
            }
            // Hot reload can mount twice; keep exactly one takeover icon.
            var ours = row.querySelectorAll('.' + NAVICON_CLASS)
            for (var d = ours.length - 1; d > 0; d--) {
              try { if (ours[d].remove) ours[d].remove() } catch (e) { /* ignore */ }
            }
          }
        } catch (e) { /* host DOM changed — stay out of the way */ }
      }

      function scheduleNavIcon() {
        try {
          if (navRaf) return
          if (typeof requestAnimationFrame === 'function') {
            navRaf = requestAnimationFrame(function () { navRaf = 0; paintNavIcon() })
          } else {
            navRaf = setTimeout(function () { navRaf = 0; paintNavIcon() }, 16)
          }
        } catch (e) { /* ignore */ }
      }

      function watchNavIcon() {
        try {
          paintNavIcon()
          if (navObserver) return
          if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return
          navObserver = new MutationObserver(function () { scheduleNavIcon() })
          navObserver.observe(document.body, { childList: true, subtree: true })
        } catch (e) { /* host DOM unavailable */ }
      }

      function unwatchNavIcon() {
        try { if (navObserver) { navObserver.disconnect(); navObserver = null } } catch (e) { /* ignore */ }
        try {
          if (navRaf) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(navRaf)
            else if (typeof clearTimeout === 'function') clearTimeout(navRaf)
          }
        } catch (e) { /* ignore */ }
        navRaf = 0
      }

      function apply(ctx) {
        // Claim the card on mount: a newer instance must win over the stale one,
        // otherwise the stale instance's paint loop would keep the old card alive.
        try { window[OWNER_KEY] = INSTANCE } catch (e) { /* ignore */ }
        try {
          ctx.effect(function () {
            // A hot reload runs apply() again without disposing the old instance:
            // drop the previous stylesheet first so they cannot pile up.
            if (document.head.querySelectorAll) {
              var old = document.head.querySelectorAll('style[data-dsh-shutdown-guard]')
              for (var i = 0; i < old.length; i++) old[i].remove()
            }
            var style = document.createElement('style')
            style.setAttribute('data-dsh-shutdown-guard', '')
            style.textContent = CSS
            document.head.appendChild(style)
            return function () { style.remove() }
          }, 'shutdown-panel: styles')
        } catch (e) { /* ignore */ }

        try {
          ctx.effect(function () {
            watchNavIcon()
            return unwatchNavIcon
          }, 'shutdown-panel: nav icon')
        } catch (e) { /* ignore */ }

        try {
          ctx.effect(function () {
            var off = subscribe(paint)
            var offUi = subscribeUi(function () {
              if (card) {
                card.setAttribute('data-variant', ui.variant)
                // variant/fold change the DOM structure; rebuild on next paint
                builtSig = ''
                var parent = card.parentNode
                buildCard()
                if (parent) parent.replaceChild(card, parent.firstChild)
              }
              paint()
            })
            paint()
            var timer = setInterval(paint, POLL_MS)
            return function () {
              off()
              offUi()
              clearInterval(timer)
              stopPolling()
              if (host) host.remove()
              host = null
              card = null
              builtSig = ''
              try {
                if (window[OWNER_KEY] === INSTANCE) delete window[OWNER_KEY]
              } catch (e) { /* ignore */ }
            }
          }, 'shutdown-panel: card')
        } catch (e) { /* ignore */ }

        try {
          ctxRef = ctx
          // Declare the namespace the slot advertises through `locale`, and keep
          // the two host language ids in sync with app.title. The label itself
          // still resolves through navLabel(): `locale` alone only injects a `t`
          // seat into the component, it never translates the nav label.
          try {
            if (ctx.locale && typeof ctx.locale.register === 'function') {
              ctx.locale.register(SETTINGS_NS, {
                zh: { nav: MSG.zh['app.title'] },
                en: { nav: MSG.en['app.title'] },
              })
            }
          } catch (e) { /* locale face unavailable */ }
          slotDispose = registerSettings(ctx)
        } catch (e) { /* slot unavailable */ }
      }

      function registerSettings(ctx) {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'shutdown-panel-settings',
            order: 40,
            label: navLabel,
            locale: SETTINGS_NS,
          }, function () { return h(SettingsSection) })
        })
      }

      function relabelSettings() {
        try {
          if (typeof slotDispose === 'function' && ctxRef) {
            slotDispose()
            slotDispose = registerSettings(ctxRef)
          }
        } catch (e) { /* slot unavailable */ }
        try { paint() } catch (e) { /* ignore */ }
        // The host re-renders the nav label on locale change; re-apply the icon
        // in case that render replaced our span with its own svg.
        try { paintNavIcon() } catch (e) { /* ignore */ }
      }

      return {
        name: 'dsh-shutdown-guard',
        apply: apply,
        inject: ['slots'],
      }
    },
  })
})()
