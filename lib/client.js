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
      // `auto` borrows the host surface luminance, `dark`/`light` are fixed, and
      // `claude` follows whatever dsh-claude-style actually paints: its palette is
      // resolved from live CSS custom properties at paint time (see
      // resolveClaudePaint) and falls back to `auto` when the plugin is absent.
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
          'app.nav': 'Shutdown Guard',
          'notify.countdown': '{sec} 秒后自动关机',
          'notify.fired': '已下发系统关机指令',
          'notify.blocked': '已暂停：{reason}',
          'notify.recovered': '条件恢复，重新开始守夜',
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
          'unit.jobs': 'jobs {n}',
          'unit.agent': 'agent {n}',
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
        'set.link.github': 'GitHub 仓库',
        'set.link.npm': 'npm 包',
          'set.variant': '卡片样式',
          'set.led': '终端里的 6 个小块',
          'set.led.desc': '从左到右：已开启、只算成功、会话空闲、后台任务清零、没有报错、正在倒计时。亮几个，就是几条已经满足。',
          'set.theme': '主题',
          'theme.auto': '跟随',
          'theme.dark': '深色',
          'theme.light': '浅色',
          'theme.claude': 'Claude',
          'set.fold': '默认折叠',
          'set.compact': '悬浮窗简洁模式',
          'set.error': '保存失败，已还原',
          'set.notify': '状态变化通知',
          'set.notify.desc': '进入倒计时、即将关机、首次阻断、阻断恢复时各一条；手动武装、解除、取消不提醒。',
          'set.notify.countdown': '进入倒计时',
          'set.notify.fired': '即将关机',
          'set.notify.blocked': '首次阻断',
          'set.notify.recovered': '阻断恢复',
          'set.notify.group': '通知',
          'set.locked.hint': '切到自定义配置后可改',
          'set.lang': '语言',
          'lang.auto': '跟随系统',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': '判定与关机',
          'set.watch': '守夜行为',
          'set.custom': '自定义配置',
          'set.pick': '选择配置',
          'set.default': '默认',
          'set.bottom': '会话都停下来',
          'set.bottom.desc': '底线条件，始终开启。',
          'set.always': '总是开启',
          'set.jobs': '后台任务跑完',
          'set.jobs.desc': '有后台任务时先不关机。',
          'set.err': '有会话报错就跳过这一轮',
          'set.err.desc': '出过错的批次不关机。',
          'set.cd': '倒计时时长',
          'set.cd.locked': '默认配置固定 60 秒，不能修改。切到自定义配置后可以调。',
          'set.cd.desc': '关机前的取消时间，10–600 秒。',
          'set.cd.fixed': '60 秒 · 固定',
          'set.prof.group': '配置',
          'set.prof.current': '当前：{label}（{sec} 秒）',
          'set.prof.new': '＋ 新建',
          'set.prof.newTitle': '从当前配置复制一份：',
          'set.prof.name': '名称',
          'set.prof.save': '保存',
          'set.prof.setDefault': '设为默认',
          'set.prof.rename': '重命名',
          'set.prof.del': '删除',
          'set.prof.confirm': '确认删除？',
          'set.prof.confirmActive': '确认删除？（会回落到默认配置）',
          'set.prof.active': '当前',
          'set.prof.sec': '{n} 秒',
          'set.prof.errEmpty': '名称不能为空。',
          'set.prof.errLimit': '最多 24 个字符。',
          'set.prof.lockedHint': '自定义配置已关闭，先在下面打开「自定义配置」。',
          'set.prof.empty': '还没有自定义配置，点「＋ 新建」从当前配置复制一份。',
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
          'app.nav': 'Shutdown Guard',
          'notify.countdown': 'Shutting down in {sec}s',
          'notify.fired': 'System shutdown command sent',
          'notify.blocked': 'Paused: {reason}',
          'notify.recovered': 'Conditions recovered; watching again',
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
        'set.link.github': 'GitHub repository',
        'set.link.npm': 'npm package',
          'set.variant': 'Card style',
          'set.led': 'The six blocks in the terminal',
          'set.led.desc': 'Left to right: armed, success-only, sessions idle, no background jobs, no errors, counting down. Lit blocks are satisfied conditions.',
          'set.theme': 'Theme',
          'theme.auto': 'Follow',
          'theme.dark': 'Dark',
          'theme.light': 'Light',
          'theme.claude': 'Claude',
          'set.fold': 'Folded by default',
          'set.compact': 'Compact window',
          'set.error': 'Could not save, reverted',
          'set.notify': 'Status notifications',
          'set.notify.desc': 'One notice per countdown, shutdown, first block and recovery; manual actions stay silent.',
          'set.notify.countdown': 'Countdown starts',
          'set.notify.fired': 'Shutting down',
          'set.notify.blocked': 'First block',
          'set.notify.recovered': 'Block cleared',
          'set.notify.group': 'Notifications',
          'set.locked.hint': 'switch to a custom profile to change this',
          'set.lang': 'Language',
          'lang.auto': 'Follow system',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': 'Shutdown rules',
          'set.watch': 'Night watch',
          'set.custom': 'Custom profiles',
          'set.pick': 'Active profile',
          'set.default': 'default',
          'set.bottom': 'All sessions idle',
          'set.bottom.desc': 'The floor condition; always on.',
          'set.always': 'Always on',
          'set.jobs': 'Background jobs finished',
          'set.jobs.desc': 'No shutdown while background jobs run.',
          'set.err': 'Skip a batch that errored',
          'set.err.desc': 'A batch with errors never shuts down.',
          'set.cd': 'Countdown',
          'set.cd.locked': 'The default profile is pinned to 60s. Switch to a custom profile to change it.',
          'set.cd.desc': 'Cancel window before shutdown, 10–600s.',
          'set.cd.fixed': '60s · pinned',
          'set.prof.group': 'Profiles',
          'set.prof.current': 'Active: {label} ({sec}s)',
          'set.prof.new': '+ New',
          'set.prof.newTitle': 'Copy the active profile as:',
          'set.prof.name': 'Name',
          'set.prof.save': 'Save',
          'set.prof.setDefault': 'Set as default',
          'set.prof.rename': 'Rename',
          'set.prof.del': 'Delete',
          'set.prof.confirm': 'Delete?',
          'set.prof.confirmActive': 'Delete? (falls back to default)',
          'set.prof.active': 'Active',
          'set.prof.sec': '{n}s',
          'set.prof.errEmpty': 'Name cannot be empty.',
          'set.prof.errLimit': 'Up to 24 characters.',
          'set.prof.lockedHint': 'Custom profiles are off — turn on "Custom profiles" below.',
          'set.prof.empty': 'No custom profiles yet. Use "+ New" to copy the active one.',
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
          'app.nav': 'Shutdown Guard',
          'notify.countdown': 'Выключение через {sec} с',
          'notify.fired': 'Команда завершения работы отправлена',
          'notify.blocked': 'Пауза: {reason}',
          'notify.recovered': 'Условия восстановлены, снова на страже',
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
          'unit.jobs': 'фоновых задач: {n}',
          'unit.agent': 'агентов: {n}',
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
        'set.link.github': 'Репозиторий GitHub',
        'set.link.npm': 'Пакет npm',
          'set.variant': 'Стиль карточки',
          'set.led': 'Шесть блоков в терминале',
          'set.led.desc': 'Слева направо: взведено, только успешные, сессии простаивают, фоновых задач нет, ошибок нет, идёт отсчёт. Сколько горит — столько условий выполнено.',
          'set.theme': 'Тема',
          'theme.auto': 'Как в системе',
          'theme.dark': 'Тёмная',
          'theme.light': 'Светлая',
          'theme.claude': 'Claude',
          'set.fold': 'Свёрнуто по умолчанию',
          'set.compact': 'Компактное окно',
          'set.error': 'Не удалось сохранить, откат',
          'set.notify': 'Уведомления о состоянии',
          'set.notify.desc': 'По одному уведомлению: старт отсчёта, выключение, первая блокировка, её снятие; ручные действия — без уведомлений.',
          'set.notify.countdown': 'Старт отсчёта',
          'set.notify.fired': 'Выключение',
          'set.notify.blocked': 'Первая блокировка',
          'set.notify.recovered': 'Блокировка снята',
          'set.notify.group': 'Уведомления',
          'set.locked.hint': 'переключитесь на пользовательский профиль',
          'set.lang': 'Язык',
          'lang.auto': 'Как в системе',
          'lang.zh': '中文',
          'lang.en': 'English',
          'lang.ru': 'Русский',
          'set.when': 'Правила выключения',
          'set.watch': 'Поведение',
          'set.custom': 'Свои профили',
          'set.pick': 'Активный профиль',
          'set.default': 'по умолч.',
          'set.bottom': 'Все сессии простаивают',
          'set.bottom.desc': 'Базовое условие, включено всегда.',
          'set.always': 'Всегда включено',
          'set.jobs': 'Фоновые задачи завершены',
          'set.jobs.desc': 'Пока идут фоновые задачи, выключения нет.',
          'set.err': 'Пропускать партию с ошибкой',
          'set.err.desc': 'Партия с ошибками не выключает.',
          'set.cd': 'Длительность отсчёта',
          'set.cd.locked': 'Профиль по умолчанию закреплён на 60 с. Переключитесь на свой профиль, чтобы изменить.',
          'set.cd.desc': 'Время на отмену до выключения, 10–600 с.',
          'set.cd.fixed': '60 с · закреплено',
          'set.prof.group': 'Профили',
          'set.prof.current': 'Активный: {label} ({sec} с)',
          'set.prof.new': '+ Создать',
          'set.prof.newTitle': 'Скопировать активный профиль как:',
          'set.prof.name': 'Название',
          'set.prof.save': 'Сохранить',
          'set.prof.setDefault': 'Сделать основным',
          'set.prof.rename': 'Переименовать',
          'set.prof.del': 'Удалить',
          'set.prof.confirm': 'Удалить?',
          'set.prof.confirmActive': 'Удалить? (вернётся к основному)',
          'set.prof.active': 'Текущий',
          'set.prof.sec': '{n} с',
          'set.prof.errEmpty': 'Название не может быть пустым.',
          'set.prof.errLimit': 'Не более 24 символов.',
          'set.prof.lockedHint': 'Пользовательские профили выключены — включите «Свои профили» ниже.',
          'set.prof.empty': 'Пользовательских профилей пока нет. Нажмите «+ Создать», чтобы скопировать активный.',
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
        if (pinned && pinned !== 'auto' && MSG[pinned]) return MSG[pinned]['app.nav']
        var hostLang = hostLocaleId()
        if (hostLang) return MSG[hostLang]['app.nav']
        return tr('app.nav')
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
          agentTotal: 0,
          agentRunningTotal: 0,
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
      // Manual arm/disarm must not pop a notification for its own side effect.
      var manualUntil = 0
      var lastNotifiedKey = ''
      var ui = { variant: 'A', folded: false, theme: 'auto', compact: true, errorKey: '', errorUntil: 0 }
      var NOTIFY_KINDS = ['countdown', 'fired', 'blocked', 'recovered']
      // UI prefs are shared with the floating window, so the host keeps the
      // canonical copy. A POST still in flight must not be overwritten by the
      // /state snapshot it raced with.
      var UI_GRACE_MS = 1500
      var pendingUiUntil = 0
      // Config switches (/config) get the same treatment: project the click into
      // the snapshot at once and keep it for a short grace period instead of
      // waiting up to one second for the next poll.
      var CONFIG_GRACE_MS = 1400
      var pendingConfigUntil = 0
      var pendingConfig = null
      // Inline error for the row whose save failed. It hides itself after a
      // few seconds and on the next successful click.
      var CONFIG_ERROR_MS = 4000
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
      // Push the local copy once at startup so the host and the floating window
      // agree even on a first run. The short grace period keeps the /state reply
      // that this POST races with from reverting the values we just pushed.
      try { pendingUiUntil = Date.now() + UI_GRACE_MS } catch (e) { /* ignore */ }
      postUi()

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
        pendingUiUntil = Date.now() + UI_GRACE_MS
        postUi()
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
        // switching into `claude` must resolve the live palette on this very
        // paint instead of waiting for the throttle window to lapse
        claudeAt = 0
        claudeDirty = true
        pendingUiUntil = Date.now() + UI_GRACE_MS
        postUi()
        emitUi()
        paint()
      }
      function setLanguage(next) {
        if (next !== 'auto' && LANGS.indexOf(next) < 0) return
        if ((snapshot.language || 'auto') === next) return
        try { localStorage.setItem(LANG_KEY, next) } catch (e) { /* ignore */ }
        pendingUiUntil = Date.now() + UI_GRACE_MS
        postUi(next)
        void post('/config', { language: next })
      }

      // ---- instant settings ----
      // Every switch paints its new value in the same frame and only then talks
      // to the host. The optimistic value is projected into a cloned snapshot
      // (never into the object the host last delivered) and kept for a short
      // grace period, so the poll that answers the POST cannot flip it back.
      function cloneSnapshot(src) {
        var next = {}
        for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) next[k] = src[k] }
        next.profiles = Array.isArray(src.profiles) ? src.profiles.map(function (p) {
          var copy = {}
          for (var pk in p) { if (Object.prototype.hasOwnProperty.call(p, pk)) copy[pk] = p[pk] }
          return copy
        }) : []
        return next
      }

      function patchProfile(next, id, patch) {
        next.profiles = next.profiles.map(function (p) {
          if (p.id !== id) return p
          for (var k in patch) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue
            if (k === 'notify' && patch[k] && typeof patch[k] === 'object' && p.notify && typeof p.notify === 'object') {
              var merged = {}
              for (var nk in p.notify) { if (Object.prototype.hasOwnProperty.call(p.notify, nk)) merged[nk] = p.notify[nk] }
              for (var pk in patch[k]) { if (Object.prototype.hasOwnProperty.call(patch[k], pk)) merged[pk] = patch[k][pk] }
              p.notify = merged
            } else p[k] = patch[k]
          }
          return p
        })
        // Boolean gates also live at the top level of /state; mirror them so the
        // card and every other consumer agree with the settings row.
        for (var mk in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, mk) && typeof patch[mk] === 'boolean') next[mk] = patch[mk]
        }
      }

      function markConfigError(key) {
        pendingConfig = null
        pendingConfigUntil = 0
        ui.errorKey = key
        ui.errorUntil = Date.now() + CONFIG_ERROR_MS
        emitUi()
      }

      function setConfig(key, payload, mutate) {
        var before = snapshot
        if (typeof mutate === 'function') {
          pendingConfig = mutate
          pendingConfigUntil = Date.now() + CONFIG_GRACE_MS
          ui.errorKey = ''
          var next = cloneSnapshot(snapshot)
          try { mutate(next) } catch (e) { /* ignore */ }
          setSnapshot(next)
        }
        post('/config', payload).then(function (ok) {
          if (ok) return
          markConfigError(key)
          // Put the pre-click values back at once; the resumed poll then adopts
          // whatever the host really has.
          try { if (before && before.ready) setSnapshot(before) } catch (e) { /* ignore */ }
        })
      }

      function postUiPatch(patch) {
        if (typeof fetch !== 'function') return Promise.resolve(true)
        return fetch(BASE + '/ui', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
          cache: 'no-store',
        })
          .then(function (res) {
            if (!res.ok) return false
            return res.json().then(function (body) {
              // Our own write is authoritative: end the grace guard before the
              // returned snapshot is merged so compact/notify land immediately.
              pendingUiUntil = 0
              if (body && typeof body === 'object' && typeof body.state === 'string') {
                if (Array.isArray(body.events)) body.events = []
                setSnapshot(normalize(body))
              }
              return true
            }, function () { return true })
          })
          .catch(function () { return false })
      }

      function setCompact(next) {
        var v = !!next
        if (ui.compact === v) return
        var prev = ui.compact
        ui.compact = v
        ui.errorKey = ''
        pendingUiUntil = Date.now() + UI_GRACE_MS
        emitUi()
        postUiPatch({ compact: v }).then(function (ok) {
          if (ok) return
          ui.compact = prev
          markConfigError('compact')
        })
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
        // Reconcile the shared prefs before the snapshot is published, so a
        // change made in the floating window repaints this card in the same tick.
        syncUiFromState(body.ui)
        var next = {
          ready: true,
          armed: body.armed === true,
          state: typeof body.state === 'string' ? body.state : 'idle',
          deadline: Number(body.deadline) || 0,
          countdownSec: Number(body.countdownSec) || 60,
          erroredCount: Number(body.erroredCount) || 0,
          lastSkip: body.lastSkip || null,
          runningCount: Number(body.runningCount) || 0,
          rootsCount: Number(body.rootsCount) || 0,
          // Full live agent count, children included; runningCount stays root-only
          // for the window page's hold gate and the existing assertions.
          agentTotal: body.agentTotal == null ? (Number(body.rootsCount) || 0) : Number(body.agentTotal) || 0,
          agentRunningTotal: body.agentRunningTotal == null ? (Number(body.runningCount) || 0) : Number(body.agentRunningTotal) || 0,
          jobsRunning: Number(body.jobsRunning) || 0,
          jobsTotal: Number(body.jobsTotal) || 0,
          blockOnJobs: body.blockOnJobs !== false,
          onlyOnSuccess: body.onlyOnSuccess !== false,
          customEnabled: body.customEnabled === true,
          afkAutoAnswer: body.afkAutoAnswer !== false,
          notify: {
            countdown: !body.notify || body.notify.countdown !== false,
            fired: !body.notify || body.notify.fired !== false,
            blocked: !body.notify || body.notify.blocked !== false,
            recovered: !body.notify || body.notify.recovered !== false,
          },
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
        // Keep a just-clicked switch on its new value for the grace period even
        // when this poll was already in flight before the POST was accepted.
        if (pendingConfig && Date.now() < pendingConfigUntil) {
          try { pendingConfig(next) } catch (e) { /* ignore */ }
        } else {
          pendingConfig = null
        }
        return next
      }

      // Notify only real transitions. The click that caused a change stays
      // silent (manualUntil), and a repeated state does not pop twice.
      function maybeNotify(prev, next) {
        try {
          if (!prev || !prev.ready || !next) return
          if (Date.now() < manualUntil) return
          var wasBlocked = !!prev.blocked
          var nowBlocked = !!next.blocked
          var view = viewOf(next)
          var kind = ''
          if (!wasBlocked && nowBlocked) kind = 'blocked'
          else if (wasBlocked && !nowBlocked && (view === 'armed' || view === 'countdown')) kind = 'recovered'
          else if (prev.state !== 'countdown' && next.state === 'countdown') kind = 'countdown'
          else if (prev.state !== 'fired' && next.state === 'fired') kind = 'fired'
          if (!kind) return
          if (next.notify && next.notify[kind] === false) return
          var key = kind + ':' + next.state + ':' + (next.blocked || '')
          if (key === lastNotifiedKey) return
          lastNotifiedKey = key
          // Electron renderers may show notifications without asking, but a user
          // who denied them must not be nagged: give up silently.
          if (typeof Notification !== 'function') return
          if (Notification.permission === 'denied') return
          var body
          if (kind === 'countdown') body = tr('notify.countdown', { sec: remainingSec(next) })
          else if (kind === 'fired') body = tr('notify.fired')
          else if (kind === 'blocked') body = tr('notify.blocked', { reason: String(next.blocked).slice(0, 80) })
          else body = tr('notify.recovered')
          var note = new Notification(tr('app.nav'), { body: body, tag: 'dsh-shutdown-guard:' + kind })
          note.onclick = function () {
            // Same name as the card button: an open window is focused, not duplicated.
            try { window.open(BASE + '/window', FLOAT_NAME, 'width=420,height=640') } catch (e) { /* ignore */ }
            try { note.close() } catch (e) { /* ignore */ }
          }
        } catch (e) { /* notifications are optional */ }
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
        maybeNotify(snapshot, next)
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
          .then(function (value) {
            inflight = false
            return value
          })
      }

      // Returns true when the host accepted the write, false when it rejected it
      // (400, offline). A reply that carries a state snapshot is merged at once;
      // the poll then advances the event cursor. POST replies are not filtered by
      // `since`, so their event list is dropped to keep the tape duplicate-free.
      function post(path, payload) {
        return fetch(BASE + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
          cache: 'no-store',
        })
          .then(function (res) {
            if (!res.ok) return false
            return res.json().then(function (body) {
              if (body && typeof body === 'object' && typeof body.state === 'string') {
                if (Array.isArray(body.events)) body.events = []
                setSnapshot(normalize(body))
              }
              return refresh().then(function () { return true })
            }, function () {
              return refresh().then(function () { return true })
            })
          })
          .catch(function () {
            return refresh().then(function () { return false })
          })
      }

      function localLang() {
        // Before the first /state arrives the chosen language lives only in
        // localStorage; after it, snapshot.language mirrors the host config.
        var lang = snapshot.ready ? snapshot.language : null
        if (lang !== 'auto' && LANGS.indexOf(lang) < 0) {
          try { lang = localStorage.getItem(LANG_KEY) } catch (e) { lang = null }
        }
        return lang === 'auto' || LANGS.indexOf(lang) >= 0 ? lang : 'auto'
      }

      // Fire-and-forget. A missing route (older host) or a 400 must never show
      // up in the card: the local copy stays usable, and the next /state merge
      // either converges or keeps our value.
      function postUi(langOverride) {
        if (typeof fetch !== 'function') return
        var payload = { variant: ui.variant, theme: ui.theme, lang: langOverride || localLang() }
        try {
          fetch(BASE + '/ui', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          })
            .then(function (res) {
              if (!res.ok) throw new Error('ui ' + res.status)
            })
            .catch(function (err) {
              if (typeof console !== 'undefined' && console.debug) {
                console.debug('[shutdown-guard] ui sync skipped', err && err.message)
              }
            })
        } catch (e) { /* ignore */ }
      }

      // The host is the source of truth for the settings the floating window
      // shares. Adopt its copy only when the user is not mid-change: the POST
      // fired by a click is still in flight, and its /state reply is older.
      function syncUiFromState(remote) {
        if (!remote || typeof remote !== 'object') return
        if (Date.now() < pendingUiUntil) return
        var touched = false
        if (VARIANTS.indexOf(remote.variant) >= 0 && remote.variant !== ui.variant) {
          ui.variant = remote.variant
          try { localStorage.setItem(VAR_KEY, remote.variant) } catch (e) { /* ignore */ }
          touched = true
        }
        if (THEMES.indexOf(remote.theme) >= 0 && remote.theme !== ui.theme) {
          ui.theme = remote.theme
          try { localStorage.setItem(THEME_KEY, remote.theme) } catch (e) { /* ignore */ }
          lumAt = 0
          touched = true
        }
        if ((remote.lang === 'auto' || LANGS.indexOf(remote.lang) >= 0) && remote.lang !== localLang()) {
          try { localStorage.setItem(LANG_KEY, remote.lang) } catch (e) { /* ignore */ }
        }
        // compact belongs to the host (data/ui.json); never persist it in
        // localStorage, whose partition differs from the window's. notify is a
        // profile field now and arrives in the normalized snapshot.
        if (typeof remote.compact === 'boolean' && remote.compact !== ui.compact) {
          ui.compact = remote.compact
          touched = true
        }
        if (touched) {
          emitUi()
          paint()
        }
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
          if (snap.agentTotal > 0) parts.push(tr('meta.sessions', { n: fmt2(snap.agentTotal) }))
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
        // The transition we are about to cause is the user's own action; the
        // notification for it would be noise, so mute for the round trip.
        manualUntil = Date.now() + 2000
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

      // ---------------- Claude Style palette ----------------
      // The third-party dsh-claude-style plugin keeps its prefs in the host
      // settings service (never localStorage) and exposes the result as data-*
      // attributes plus CSS custom properties: on <body> normally, on <html>
      // when the host's skin mode owns the surface. We never import that plugin
      // and never freeze its colours here — every value below is read from the
      // living document at paint time.
      //
      // Each row is `[slot, candidate, ...]`: the first candidate that resolves
      // to a non-empty computed value wins, and a slot with no value at all means
      // the plugin is not painting, in which case `claude` degrades to `auto`.
      var CLAUDE_SLOTS = [
        // Raised-surface variable first: Claude Style redefines it in both its
        // own palette and the hosted one, and it stays tonally correct in host
        // dark mode (where --dsh-claude-card resolves to a mid grey overlay).
        ['--dsp-bg', '--dsw-alias-bg-layer-1', '--dsh-claude-card'],
        ['--dsp-fg', '--dsw-alias-label-primary'],
        ['--dsp-muted', '--dsw-alias-label-secondary'],
        ['--dsp-line', '--dsh-claude-divider', '--dsw-alias-border-l1'],
        ['--dsp-accent', '--dsh-claude-apex', '--dsw-alias-brand-primary'],
        ['--dsp-danger', '--dsw-alias-state-error-primary'],
        ['--dsp-track', '--dsh-claude-hover-bg']
      ]
      var CLAUDE_KEYS = ['--dsp-bg', '--dsp-fg', '--dsp-muted', '--dsp-line',
        '--dsp-accent', '--dsp-accent-ink', '--dsp-danger', '--dsp-track',
        '--dsp-tape-a', '--dsp-tape-b']
      // getComputedStyle forces a style recalculation, so a burst of host
      // mutations must not turn into a burst of reads.
      var CLAUDE_THROTTLE = 200
      var claudePaint = null
      var claudeAt = 0
      var claudeDirty = true
      var claudeTimer = 0
      var claudeApplied = false
      var claudeObserver = null
      var claudeMq = null
      var claudeMqHandler = null

      function readVar(name) {
        if (typeof document === 'undefined' || typeof window === 'undefined' ||
          typeof window.getComputedStyle !== 'function') return ''
        var roots = [document.body, document.documentElement]
        for (var i = 0; i < roots.length; i++) {
          if (!roots[i]) continue
          var v = ''
          try { v = window.getComputedStyle(roots[i]).getPropertyValue(name) || '' } catch (e) { v = '' }
          v = String(v).replace(/^\s+|\s+$/g, '')
          if (v) return v
        }
        return ''
      }

      function resolveClaudePaint() {
        var out = {}
        for (var i = 0; i < CLAUDE_SLOTS.length; i++) {
          var row = CLAUDE_SLOTS[i]
          var val = ''
          for (var j = 1; j < row.length; j++) {
            val = readVar(row[j])
            if (val) break
          }
          if (!val) return null
          out[row[0]] = val
        }
        // The hazard tape was fixed amber; borrow the live palette instead so it
        // stops reading as a sticker on a hosted theme. tape-a is the accent
        // pulled ~15% darker, tape-b is the danger colour.
        out['--dsp-tape-a'] = 'color-mix(in srgb, ' + out['--dsp-accent'] + ' 85%, #000)'
        out['--dsp-tape-b'] = out['--dsp-danger']
        // Label ink for the primary button: pick whichever of black/white keeps
        // the better contrast against the accent, so a near-black host accent
        // does not paint dark text on a dark fill.
        out['--dsp-accent-ink'] = inkOn(out['--dsp-accent'])
        return out
      }

      function relLum(rgb) {
        var v = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255].map(function (x) {
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
      }

      function inkOn(value) {
        var rgb = colorRgb(value)
        if (!rgb) return '#1a1200'
        var L = relLum(rgb)
        var onWhite = 1.05 / (L + 0.05)
        var onBlack = (L + 0.05) / 0.05
        return onWhite >= onBlack ? '#ffffff' : '#151006'
      }

      function clearClaudeVars() {
        if (!claudeApplied) return
        claudeApplied = false
        if (!card || !card.style || typeof card.style.removeProperty !== 'function') return
        for (var i = 0; i < CLAUDE_KEYS.length; i++) {
          try { card.style.removeProperty(CLAUDE_KEYS[i]) } catch (e) { /* ignore */ }
        }
      }

      function applyClaudeVars(src) {
        if (!card || !card.style || typeof card.style.setProperty !== 'function') return
        for (var i = 0; i < CLAUDE_KEYS.length; i++) {
          var k = CLAUDE_KEYS[i]
          var v = src[k]
          try {
            if (v) card.style.setProperty(k, v)
            else card.style.removeProperty(k)
          } catch (e) { /* ignore */ }
        }
        claudeApplied = true
      }

      // luminance of the palette's own surface, so data-lum still selects the
      // light-only fixes elsewhere in the stylesheet
      function rgbOf(value) {
        var s = String(value || '')
        var m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
        if (m) {
          var x = m[1]
          if (x.length === 3) x = x.charAt(0) + x.charAt(0) + x.charAt(1) + x.charAt(1) + x.charAt(2) + x.charAt(2)
          return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
        }
        m = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/.exec(s)
        if (m) return [+m[1], +m[2], +m[3]]
        m = /^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(s)
        return m ? [+m[1] * 255, +m[2] * 255, +m[3] * 255] : null
      }

      // Custom properties come back as their authored value, so a `color-mix()`
      // or `oklch()` has to be resolved by the engine. The probe is only created
      // for values that are not plain hex/rgb, i.e. hardly ever.
      function colorRgb(value) {
        var rgb = rgbOf(value)
        if (rgb || !document.body) return rgb
        var probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;background:' + value
        document.body.appendChild(probe)
        var raw = ''
        try { raw = getComputedStyle(probe).backgroundColor } finally { probe.remove() }
        return rgbOf(raw)
      }

      function lumOfValue(value) {
        var rgb = colorRgb(value)
        if (!rgb) return ''
        var l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
        return l > 0.55 ? 'light' : 'dark'
      }

      // Repaints are coalesced: a theme switch is one attribute write, but the
      // host may also toggle several attributes in the same task.
      function markClaude() {
        if (claudeTimer) return
        var wait = CLAUDE_THROTTLE - (Date.now() - claudeAt)
        if (wait < 16) wait = 16
        claudeDirty = true
        try {
          claudeTimer = setTimeout(function () {
            claudeTimer = 0
            if (ui.theme === 'claude') paint()
          }, wait)
        } catch (e) { claudeTimer = 0 }
      }

      function watchClaude() {
        try {
          if (!claudeObserver && typeof MutationObserver === 'function' &&
            typeof document !== 'undefined' && document.body) {
            claudeObserver = new MutationObserver(markClaude)
            var opts = {
              attributes: true,
              attributeFilter: ['data-dsh-claude-style', 'data-dsh-claude-palette',
                'data-dsh-claude-palette-card', 'data-dsh-claude-brand',
                'data-dsh-claude-custom-palette', 'data-ds-dark-theme',
                'data-dsh-skin', 'class', 'style']
            }
            claudeObserver.observe(document.body, opts)
            if (document.documentElement) claudeObserver.observe(document.documentElement, opts)
          }
        } catch (e) { /* observer unavailable — the paint interval still catches up */ }
        try {
          if (!claudeMq && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            claudeMq = window.matchMedia('(prefers-color-scheme: light)')
            claudeMqHandler = markClaude
            if (typeof claudeMq.addEventListener === 'function') claudeMq.addEventListener('change', claudeMqHandler)
            else if (typeof claudeMq.addListener === 'function') claudeMq.addListener(claudeMqHandler)
          }
        } catch (e) { /* ignore */ }
      }

      function unwatchClaude() {
        try { if (claudeObserver) { claudeObserver.disconnect(); claudeObserver = null } } catch (e) { /* ignore */ }
        try { if (claudeTimer && typeof clearTimeout === 'function') clearTimeout(claudeTimer) } catch (e) { /* ignore */ }
        claudeTimer = 0
        try {
          if (claudeMq && claudeMqHandler) {
            if (typeof claudeMq.removeEventListener === 'function') claudeMq.removeEventListener('change', claudeMqHandler)
            else if (typeof claudeMq.removeListener === 'function') claudeMq.removeListener(claudeMqHandler)
          }
        } catch (e) { /* ignore */ }
        claudeMq = null
        claudeMqHandler = null
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
          clearClaudeVars()
          if (Date.now() - lumAt > 3000) {
            lumAt = Date.now()
            card.setAttribute('data-lum', detectLum())
          }
        } else if (ui.theme === 'claude') {
          var cnow = Date.now()
          if ((claudeDirty || !claudePaint) && cnow - claudeAt >= CLAUDE_THROTTLE) {
            claudeAt = cnow
            claudeDirty = false
            claudePaint = resolveClaudePaint()
          }
          if (claudePaint) {
            applyClaudeVars(claudePaint)
            var lum = lumOfValue(claudePaint['--dsp-bg'])
            card.setAttribute('data-lum', lum || detectLum())
          } else {
            // No Claude Style surface to follow: behave exactly like `auto`
            // instead of pinning a palette of our own.
            card.classList.remove('dsp-claude')
            clearClaudeVars()
            if (Date.now() - lumAt > 3000) {
              lumAt = Date.now()
              card.setAttribute('data-lum', detectLum())
            }
          }
        } else {
          clearClaudeVars()
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
            : tr('unit.jobs', { n: fmt2(snap.jobsRunning) }) + ' · ' + tr('unit.agent', { n: fmt2(snap.agentRunningTotal) })
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
        if (l2) l2.textContent = tr('unit.jobs', { n: fmt2(snap.jobsRunning) }) + ' · ' + tr('unit.agent', { n: fmt2(snap.agentRunningTotal) })
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

      function settingsRow(key, title, desc, control, extraClass, error) {
        return h('div', { key: key, className: 'dsp-srow' + (extraClass ? ' ' + extraClass : '') },
          h('div', { className: 'dsp-srow-text' },
            h('span', { className: 'dsp-stitle' }, title),
            desc ? h('span', { className: 'dsp-sdesc' }, desc) : null,
            error ? h('span', { className: 'dsp-srow-err', role: 'alert' }, error) : null),
          control)
      }

      // 15px stroke icons, inline so they follow `currentColor` in both themes.
      var GROUP_ICONS = {
        look: ['M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4', 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'],
        prof: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'],
        rule: ['M12 3.5 19 6.5v5.2c0 3.9-2.9 6.9-7 8.8-4.1-1.9-7-4.9-7-8.8V6.5z', 'M9 12l2.1 2.1L15.4 10'],
        watch: ['M20 14.6A8.6 8.6 0 1 1 9.4 4a6.9 6.9 0 0 0 10.6 10.6z'],
        notify: ['M18 15.5H6l1.4-2.1V9a4.6 4.6 0 0 1 9.2 0v4.4z', 'M10 18.5a2 2 0 0 0 4 0'],
        status: ['M3 12h4l2 5 3-10 2 5h5'],
      }

      function sicon(name) {
        var paths = GROUP_ICONS[name]
        if (!paths) return null
        return h('svg', {
          className: 'dsp-sicon', width: 15, height: 15, viewBox: '0 0 24 24',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.9,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        }, paths.map(function (d, i) { return h('path', { key: i, d: d }) }))
      }

      // Solid brand marks for the header links (simple-icons paths, 24 grid).
      var LINK_ICONS = {
        github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
        npm: 'M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z',
      }

      // Both marks share one ink (currentColor). Sizes follow each shape:
      // GitHub is squarish (16x16 on the 24 grid); the npm wordmark is a long
      // band, so it is cropped to its own bounds and drawn 30x12 instead of
      // being squeezed into a square. Centres of both hit areas line up.
      var LINK_BOX = {
        github: { w: 16, h: 16, view: '0 0 24 24', cls: 'dsp-slink' },
        npm: { w: 30, h: 12, view: '0 7.334 24 9.332', cls: 'dsp-slink dsp-slink-npm' },
      }

      function settingsLink(href, icon, label) {
        var box = LINK_BOX[icon]
        return h('a', {
          className: box.cls, href: href, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': label, title: label,
        }, h('svg', {
          className: 'dsp-slink-icon', width: box.w, height: box.h, viewBox: box.view,
          fill: 'currentColor', stroke: 'none', 'aria-hidden': 'true',
        }, h('path', { d: LINK_ICONS[icon] })))
      }

      // Title left (truncating), links right (never shrinking): the pair stays
      // visible on a 280px sidebar, which is the narrowest host width we see.
      function settingsHead() {
        return h('div', { className: 'dsp-shead' },
          h('span', { className: 'dsp-shead-title' }, tr('app.nav')),
          h('div', { className: 'dsp-shead-links' },
            settingsLink('https://github.com/ltayshark0637/dsh-Shutdown-Guard', 'github', tr('set.link.github')),
            settingsLink('https://www.npmjs.com/package/dsh-shutdown-guard', 'npm', tr('set.link.npm'))))
      }


      function settingsGroup(key, title, note, icon) {
        return h('div', { key: key, className: 'dsp-sgroup', role: 'heading', 'aria-level': 3 },
          sicon(icon),
          h('span', { className: 'dsp-sgroup-title' }, title),
          note ? h('span', { className: 'dsp-sgroup-note' }, note) : null)
      }

      // The sliding pill is positioned from one getBoundingClientRect pass; the
      // CSS only interpolates the four variables. Rendering schedules the pass
      // for the next frame, so the pill is measured after React has committed.
      var PILL_QUEUED = false
      function schedulePillMeasure() {
        if (PILL_QUEUED || typeof requestAnimationFrame !== 'function') return
        PILL_QUEUED = true
        requestAnimationFrame(function () {
          PILL_QUEUED = false
          measurePills()
        })
      }
      function measurePills() {
        try {
          if (typeof document === 'undefined' || !document.querySelectorAll) return
          var list = document.querySelectorAll('.dsp-seg')
          for (var i = 0; i < list.length; i += 1) {
            var box = list[i]
            var on = box.querySelector ? box.querySelector('.dsp-segbtn.on') : null
            if (!on || !box.getBoundingClientRect || !on.getBoundingClientRect) continue
            var br = box.getBoundingClientRect()
            var ar = on.getBoundingClientRect()
            if (!br.width || !ar.width) continue
            box.style.setProperty('--pill-x', (ar.left - br.left) + 'px')
            box.style.setProperty('--pill-y', (ar.top - br.top) + 'px')
            box.style.setProperty('--pill-w', ar.width + 'px')
            box.style.setProperty('--pill-h', ar.height + 'px')
            box.setAttribute('data-ready', '')
          }
        } catch (e) { /* measurement is cosmetic only */ }
      }
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', measurePills)
      }

      function seg(items, current, onPick) {
        schedulePillMeasure()
        return h('div', { className: 'dsp-seg', 'data-pill': '' }, items.map(function (pair) {
          return h('button', {
            key: pair[0],
            type: 'button',
            className: 'dsp-segbtn' + (current === pair[0] ? ' on' : ''),
            'aria-pressed': current === pair[0],
            onClick: function () {
              if (current === pair[0]) return
              onPick(pair[0])
              schedulePillMeasure()
            },
          }, pair[1])
        }))
      }

      function toggle(on, onPick, disabled, label) {
        var attrs = {
          type: 'button',
          className: 'dsp-switch' + (on ? ' on' : ''),
          'aria-pressed': !!on,
          disabled: !!disabled,
          onClick: function (ev) {
            if (disabled) return
            // Mark the node on the very first click: the first paint has nothing
            // to animate, while every later move plays the spring.
            try { if (ev && ev.currentTarget) ev.currentTarget.setAttribute('data-moved', '') } catch (e) { /* ignore */ }
            onPick(!on)
          },
        }
        if (on) attrs['data-on'] = ''
        // A switch has no text of its own; without a name a screen reader only
        // announces "button". Reuse the row title so no extra MSG key is needed.
        if (label) attrs['aria-label'] = label
        return h('button', attrs, h('i', null))
      }

      // ---- profile management state (outside React on purpose: the bundle
      // smoke test ships a React stub with useSyncExternalStore only) --------
      var PROFILE_ERR_MS = 4000
      var profileUi = {
        editId: '', draft: '', confirmId: '', confirmUntil: 0,
        creating: false, newDraft: '', busy: '', errorId: '', error: '',
      }
      var profileListeners = new Set()
      function subscribeProfiles(fn) {
        profileListeners.add(fn)
        return function () { profileListeners.delete(fn) }
      }
      function getProfileUi() { return profileUi }
      function patchProfileUi(patch) {
        var next = {}
        var k
        for (k in profileUi) if (Object.prototype.hasOwnProperty.call(profileUi, k)) next[k] = profileUi[k]
        for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k]
        profileUi = next
        profileListeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }
      var profileErrTimer = 0
      var profileConfirmTimer = 0
      function profileFail(id, message) {
        if (profileErrTimer) clearTimeout(profileErrTimer)
        patchProfileUi({ errorId: id, error: message || '', busy: '' })
        profileErrTimer = setTimeout(function () {
          profileErrTimer = 0
          patchProfileUi({ errorId: '', error: '' })
        }, PROFILE_ERR_MS)
      }
      function profileDone() {
        if (profileConfirmTimer) { clearTimeout(profileConfirmTimer); profileConfirmTimer = 0 }
        patchProfileUi({
          busy: '', editId: '', draft: '', creating: false, newDraft: '',
          confirmId: '', confirmUntil: 0, errorId: '', error: '',
        })
      }
      // Profile writes need the host's rejection message, so this keeps the
      // response body instead of collapsing it to the boolean post() returns.
      function postConfigRaw(payload) {
        if (typeof fetch !== 'function') return Promise.resolve({ ok: true, error: '' })
        return fetch(BASE + '/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        }).then(function (res) {
          return res.json().then(function (body) {
            if (body && typeof body === 'object' && typeof body.state === 'string') {
              if (Array.isArray(body.events)) body.events = []
              setSnapshot(normalize(body))
            }
            return { ok: !!res.ok, error: body && typeof body.error === 'string' ? body.error : '' }
          }, function () {
            return { ok: !!res.ok, error: '' }
          })
        }).catch(function () { return { ok: false, error: '' } })
      }
      function focusNode(node) {
        if (!node || typeof node.focus !== 'function') return
        try { node.focus(); if (typeof node.select === 'function') node.select() } catch (e) { /* ignore */ }
      }
      // An untouched slot carries the auto label and the baseline values; the
      // list hides those, so eight pre-created slots do not read as eight rows.
      function profileIsUsed(p) {
        if (!p || p.id === 'default') return true
        if (p.labelAuto === false) return true
        var n = p.notify || {}
        return p.countdownSec !== 60 || p.marginSec !== 5 || p.onlyOnSuccess !== true ||
          p.blockOnJobs !== true || p.afkAutoAnswer !== true ||
          n.countdown === false || n.fired === false || n.blocked === false || n.recovered === false
      }

      function SettingsSection() {
        var uiState = React.useSyncExternalStore(subscribeUi, getUi)
        var pui = React.useSyncExternalStore(subscribeProfiles, getProfileUi)
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
        // Inline failure hint: only the row whose POST was rejected shows it,
        // and it hides itself after a few seconds or on the next click.
        var errKey = uiState.errorKey
        var errText = errKey && Date.now() < (uiState.errorUntil || 0) ? tr('set.error') : ''
        function errFor(key) { return errKey === key ? errText : '' }

        // Behaviour belongs to the active profile. The default profile is a
        // locked baseline now: its rows stay visible but read-only, and the
        // hint explains how to unlock them instead of earning a 400 on click.
        var locked = snap.countdownLocked === true
        var cur = activeProfile || { countdownSec: 60, onlyOnSuccess: true, blockOnJobs: true, afkAutoAnswer: true, notify: null }
        var prefs = snap.notify && typeof snap.notify === 'object' ? snap.notify : { countdown: true, fired: true, blocked: true, recovered: true }
        var hint = locked ? ' · ' + tr('set.locked.hint') : ''
        function profileWrite(key, field, value) {
          var patch = {}
          patch[field] = value
          setConfig(key, { updateProfile: { id: active, patch: patch } }, function (n) {
            patchProfile(n, active, patch)
          })
        }
        function notifyWrite(key, patch) {
          setConfig(key, { updateProfile: { id: active, patch: { notify: patch } } }, function (n) {
            patchProfile(n, active, { notify: patch })
            if (typeof patch === 'boolean') {
              n.notify = { countdown: patch, fired: patch, blocked: patch, recovered: patch }
            } else {
              var merged = {}
              for (var nk = 0; nk < NOTIFY_KINDS.length; nk += 1) {
                var kindName = NOTIFY_KINDS[nk]
                merged[kindName] = Object.prototype.hasOwnProperty.call(patch, kindName) ? patch[kindName] !== false : prefs[kindName] !== false
              }
              n.notify = merged
            }
          })
        }

        function startRename(p) {
          patchProfileUi({ editId: p.id, draft: p.label, creating: false, confirmId: '', errorId: '', error: '' })
        }
        function commitRename(p) {
          var label = String(pui.draft || '').trim()
          if (!label) { profileFail(p.id, tr('set.prof.errEmpty')); return }
          if (label.length > 24) { profileFail(p.id, tr('set.prof.errLimit')); return }
          patchProfileUi({ busy: p.id })
          postConfigRaw({ renameProfile: { id: p.id, label: label } }).then(function (r) {
            if (r.ok) profileDone()
            else profileFail(p.id, r.error || tr('set.prof.errEmpty'))
          })
        }
        function makeDefault(p) {
          patchProfileUi({ busy: p.id, editId: '', confirmId: '' })
          postConfigRaw({ setDefault: p.id }).then(function (r) {
            if (r.ok) profileDone()
            else profileFail(p.id, r.error || '')
          })
        }
        function doDelete(p) {
          patchProfileUi({ busy: p.id, confirmId: '', confirmUntil: 0 })
          postConfigRaw({ deleteProfile: p.id }).then(function (r) {
            if (r.ok) profileDone()
            else profileFail(p.id, r.error || '')
          })
        }
        function askDelete(p) {
          var now = Date.now()
          if (pui.confirmId === p.id && now < (pui.confirmUntil || 0)) { doDelete(p); return }
          patchProfileUi({ confirmId: p.id, confirmUntil: now + 2000, errorId: '', error: '' })
          if (profileConfirmTimer) clearTimeout(profileConfirmTimer)
          profileConfirmTimer = setTimeout(function () {
            profileConfirmTimer = 0
            patchProfileUi({ confirmId: '', confirmUntil: 0 })
          }, 2050)
        }
        function submitCreate() {
          var label = String(pui.newDraft || '').trim()
          if (!label) { profileFail('new', tr('set.prof.errEmpty')); return }
          if (label.length > 24) { profileFail('new', tr('set.prof.errLimit')); return }
          patchProfileUi({ busy: 'new' })
          postConfigRaw({ createProfile: { label: label, from: active } }).then(function (r) {
            if (r.ok) profileDone()
            else profileFail('new', r.error || tr('set.prof.errEmpty'))
          })
        }

        function profileRow(p) {
          var isDef = p.id === 'default'
          var isActive = p.id === active
          var editing = pui.editId === p.id
          var confirming = pui.confirmId === p.id && Date.now() < (pui.confirmUntil || 0)
          var rowErr = pui.errorId === p.id ? pui.error : ''
          var action = null
          if (editing) {
            action = h('div', { className: 'dsp-prof-edit' },
              h('input', {
                className: 'dsp-sinput', type: 'text', value: pui.draft,
                placeholder: tr('set.prof.name'), maxLength: 24,
                'aria-label': tr('set.prof.name'),
                ref: focusNode,
                onChange: function (ev) { patchProfileUi({ draft: ev.target.value }) },
                onKeyDown: function (ev) {
                  if (ev.key === 'Enter') { ev.preventDefault(); commitRename(p) }
                  else if (ev.key === 'Escape') { ev.preventDefault(); patchProfileUi({ editId: '', draft: '' }) }
                },
                // A click on Save fires blur first; give the click one tick to
                // land before the blur cancels the edit.
                onBlur: function () {
                  setTimeout(function () {
                    if (profileUi.editId === p.id) patchProfileUi({ editId: '', draft: '' })
                  }, 120)
                },
              }),
              h('button', {
                className: 'dsp-sbtn dsp-sbtn-primary', type: 'button',
                disabled: pui.busy === p.id,
                onClick: function () { commitRename(p) },
              }, tr('set.prof.save')))
          } else if (isDef) {
            action = h('div', { className: 'dsp-prof-actions' },
              h('span', { className: 'dsp-sval' }, tr('set.prof.sec', { n: p.countdownSec })))
          } else {
            action = h('div', { className: 'dsp-prof-actions' },
              h('span', { className: 'dsp-sval' }, tr('set.prof.sec', { n: p.countdownSec })),
              h('button', {
                key: 'd', className: 'dsp-sbtn', type: 'button',
                disabled: !customOn || pui.busy === p.id,
                onClick: function () { makeDefault(p) },
              }, tr('set.prof.setDefault')),
              h('button', {
                key: 'r', className: 'dsp-sbtn', type: 'button',
                disabled: !customOn || pui.busy === p.id,
                onClick: function () { startRename(p) },
              }, tr('set.prof.rename')),
              h('button', {
                key: 'x',
                className: 'dsp-sbtn' + (confirming ? ' dsp-sbtn-danger' : ''),
                type: 'button',
                disabled: !customOn || pui.busy === p.id,
                onClick: function () { askDelete(p) },
              }, confirming
                ? (isActive ? tr('set.prof.confirmActive') : tr('set.prof.confirm'))
                : tr('set.prof.del')))
          }
          return h('div', { key: 'prof-' + p.id, className: 'dsp-srow dsp-srow-prof' + (isActive ? ' is-active' : '') },
            h('div', { className: 'dsp-srow-text' },
              h('span', { className: 'dsp-stitle' }, p.label,
                isActive ? h('span', { className: 'dsp-badge' }, tr('set.prof.active')) : null),
              rowErr ? h('span', { className: 'dsp-srow-err', role: 'alert' }, rowErr) : null),
            action)
        }

        function profileNewRow() {
          var newErr = pui.errorId === 'new' ? pui.error : ''
          if (pui.creating) {
            return h('div', { key: 'prof-new', className: 'dsp-srow dsp-srow-new' },
              h('div', { className: 'dsp-srow-text' },
                h('span', { className: 'dsp-sdesc dsp-sdesc-strong' }, tr('set.prof.newTitle')),
                newErr ? h('span', { className: 'dsp-srow-err', role: 'alert' }, newErr) : null),
              h('div', { className: 'dsp-prof-edit' },
                h('input', {
                  className: 'dsp-sinput', type: 'text', value: pui.newDraft,
                  placeholder: tr('set.prof.name'), maxLength: 24,
                  'aria-label': tr('set.prof.name'), ref: focusNode,
                  onChange: function (ev) { patchProfileUi({ newDraft: ev.target.value }) },
                  onKeyDown: function (ev) {
                    if (ev.key === 'Enter') { ev.preventDefault(); submitCreate() }
                    else if (ev.key === 'Escape') { ev.preventDefault(); patchProfileUi({ creating: false, newDraft: '' }) }
                  },
                }),
                h('button', {
                  className: 'dsp-sbtn dsp-sbtn-primary', type: 'button',
                  disabled: pui.busy === 'new',
                  onClick: function () { submitCreate() },
                }, tr('set.prof.save'))))
          }
          return h('div', { key: 'prof-new', className: 'dsp-srow dsp-srow-new' },
            h('div', { className: 'dsp-srow-text' },
              newErr ? h('span', { className: 'dsp-srow-err', role: 'alert' }, newErr) : null),
            h('button', {
              className: 'dsp-sbtn', type: 'button', disabled: !customOn || !!pui.busy,
              onClick: function () {
                patchProfileUi({ creating: true, newDraft: '', editId: '', confirmId: '', errorId: '', error: '' })
              },
            }, tr('set.prof.new')))
        }

        // 1) 外观：这几行只有标题，行高由控件撑开（CSS 用 min-height 兜底）。
        var look = [settingsGroup('look-g', tr('set.look'), null, 'look')]
        look.push(settingsRow('look', tr('set.variant'), null,
          seg(VARIANTS.map(function (v) { return [v, v] }), uiState.variant, setVariant)))
        if (uiState.variant === 'C') {
          look.push(settingsRow('led', tr('set.led'),
            tr('set.led.desc'),
            null, 'dsp-srow-stack'))
        }
        look.push(settingsRow('theme', tr('set.theme'), null,
          seg([['auto', tr('theme.auto')], ['dark', tr('theme.dark')], ['light', tr('theme.light')], ['claude', tr('theme.claude')]], uiState.theme, setTheme)))
        look.push(settingsRow('fold', tr('set.fold'), null,
          toggle(uiState.folded, setFolded, false, tr('set.fold'))))
        // compact and notify are owned by the host (/state.ui, data/ui.json):
        // no localStorage, no optimistic "success" without the host's snapshot.
        look.push(settingsRow('compact', tr('set.compact'), null,
          toggle(uiState.compact !== false, setCompact, false, tr('set.compact')), null, errFor('compact')))
        look.push(settingsRow('lang', tr('set.lang'), null,
          seg([
            ['auto', tr('lang.auto')],
            ['zh', tr('lang.zh')],
            ['en', tr('lang.en')],
            ['ru', tr('lang.ru')],
          ], snap.language || 'auto', setLanguage)))
        groups.push(h('div', { key: 'g-look', className: 'dsp-sgroup-box' }, look))

        // 2) 配置：每个配置一行。默认配置不显示 设为默认/重命名/删除，宿主会 400。
        var prof = [settingsGroup('prof-g', tr('set.prof.group'),
          customOn ? null : tr('set.prof.lockedHint'), 'prof')]
        prof.push(settingsRow('prof-cur', tr('set.pick'),
          activeProfile
            ? tr('set.prof.current', { label: activeProfile.label, sec: activeProfile.countdownSec })
            : tr('set.prof.current', { label: tr('set.default'), sec: snap.countdownSec }),
          null, 'dsp-srow-plain'))
        var listed = profiles.filter(profileIsUsed)
        var hasActive = false
        for (var lj = 0; lj < listed.length; lj += 1) if (listed[lj].id === active) hasActive = true
        if (!hasActive && activeProfile) listed = listed.concat([activeProfile])
        for (var pj = 0; pj < listed.length; pj += 1) prof.push(profileRow(listed[pj]))
        if (listed.length <= 1) {
          prof.push(h('div', { key: 'prof-empty', className: 'dsp-srow dsp-srow-plain' },
            h('div', { className: 'dsp-srow-text' },
              h('span', { className: 'dsp-sdesc dsp-sdesc-flat' }, tr('set.prof.empty')))))
        }
        prof.push(profileNewRow())
        groups.push(h('div', { key: 'g-prof', className: 'dsp-sgroup-box' }, prof))

        // 3) 判定与关机
        var rules = [settingsGroup('rule-g', tr('set.when'), locked ? tr('set.locked.hint') : null, 'rule')]
        rules.push(settingsRow('custom', tr('set.custom'), null,
          toggle(customOn, function (next) {
            setConfig('custom', { customEnabled: next }, function (n) { n.customEnabled = next })
          }, false, tr('set.custom')), null, errFor('custom')))
        rules.push(settingsRow('c3', tr('set.bottom'), tr('set.bottom.desc'),
          h('span', { className: 'dsp-sval' }, tr('set.always')), 'dsp-srow-ro'))
        rules.push(settingsRow('c2', tr('set.jobs'), tr('set.jobs.desc') + hint,
          toggle(cur.blockOnJobs, function (next) { profileWrite('jobs', 'blockOnJobs', next) },
            locked, tr('set.jobs')), null, errFor('jobs')))
        rules.push(settingsRow('c1', tr('set.err'), tr('set.err.desc') + hint,
          toggle(cur.onlyOnSuccess, function (next) { profileWrite('err', 'onlyOnSuccess', next) },
            locked, tr('set.err')), null, errFor('err')))
        rules.push(settingsRow('cd', tr('set.cd'),
          snap.countdownLocked
            ? tr('set.cd.locked')
            : tr('set.cd.desc'),
          snap.countdownLocked
            ? h('span', { className: 'dsp-sval' }, tr('set.cd.fixed'))
            : seg([[30, tr('cd.30')], [60, tr('cd.60')], [120, tr('cd.120')], [300, tr('cd.300')]], cur.countdownSec, function (v) {
              profileWrite('cd', 'countdownSec', v)
            }), null, errFor('cd')))
        groups.push(h('div', { key: 'g-rule', className: 'dsp-sgroup-box' }, rules))

        // 4) 守夜行为
        var watch = [settingsGroup('watch-g', tr('set.watch'), null, 'watch')]
        watch.push(settingsRow('afk', tr('set.afk'), tr('set.afk.desc') + hint,
          toggle(snap.afkAutoAnswer !== false, function (next) { profileWrite('afk', 'afkAutoAnswer', next) },
            locked, tr('set.afk')), null, errFor('afk')))
        groups.push(h('div', { key: 'g-watch', className: 'dsp-sgroup-box' }, watch))

        // 5) 通知：父行说明 + 四种通知各一行
        var notif = [settingsGroup('notify-g', tr('set.notify.group'), null, 'notify')]
        var allNotify = prefs.countdown !== false && prefs.fired !== false && prefs.blocked !== false && prefs.recovered !== false
        notif.push(settingsRow('notify', tr('set.notify'), tr('set.notify.desc') + hint,
          toggle(allNotify, function (next) { notifyWrite('notify', next) }, locked, tr('set.notify')), null, errFor('notify')))
        for (var ni = 0; ni < NOTIFY_KINDS.length; ni += 1) {
          (function (kind) {
            notif.push(settingsRow('notify-' + kind, tr('set.notify.' + kind), null,
              toggle(prefs[kind] !== false, function (next) {
                var patch = {}
                patch[kind] = next
                notifyWrite('notify.' + kind, patch)
              }, locked, tr('set.notify.' + kind)), 'dsp-srow-sub', errFor('notify.' + kind)))
          })(NOTIFY_KINDS[ni])
        }
        groups.push(h('div', { key: 'g-notify', className: 'dsp-sgroup-box' }, notif))

        // 6) 状态与日志
        var status = [settingsGroup('st-g', tr('set.status'), null, 'status')]
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

        return h('div', { className: 'dsp-settings' }, settingsHead(), groups)
      }
      // ---------------- css ----------------

      var CSS = [
        // host: matches the panel row hit area (button x=12, width=256 in a 280px sidebar)
        '.dsp-host{flex:0 0 auto;padding:0 12px 8px 0;min-width:0}',
        // own palette: the card does not follow the host theme's alias tokens
        '.dsp-card{--dsp-bg:#1c1e22;--dsp-fg:#f3f4f6;--dsp-muted:#a7abb4;--dsp-line:rgba(255,255,255,.14);',
        '--dsp-accent:#f0a83a;--dsp-danger:#ef5350;--dsp-track:rgba(255,255,255,.16);',
        '--dsp-tape-a:#f2b13c;--dsp-tape-b:#e8453c}',
        // `claude` carries no static palette on purpose: resolveClaudePaint()
        // writes the live dsh-claude-style values inline on the card, and without
        // the plugin the mode falls back to `auto` (the `.dsp-claude` class is
        // then removed), so no amber constants are pinned here.
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
        '.dsp-navicon{width:16px;height:16px;flex:none;display:inline-block;align-self:center;vertical-align:middle;background-color:currentColor;-webkit-mask:url("data:image/png;base64,' + NAV_ICON_B64 + '") center/19px 19px no-repeat;mask:url("data:image/png;base64,' + NAV_ICON_B64 + '") center/19px 19px no-repeat}',
        '.dsp-cbody{position:relative;flex:1;min-height:0}',
        '.dsp-v-a{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0}',
        '.dsp-big{font-family:ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;font-size:26px;line-height:1.15;font-weight:650;letter-spacing:-.2px}',
        '.dsp-card[data-state="fire"] .dsp-big{color:var(--dsp-danger)}',
        '.dsp-meta{margin-top:5px;font-size:11.5px;line-height:16px;color:var(--dsp-muted);min-height:15px}',
        '.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsp-accent)}',
        '.dsp-cbtns{display:flex;align-items:center;gap:6px;padding:8px 0 10px;flex:0 0 auto}',
        '.dsp-btn{flex:1 1 auto;min-width:0;height:30px;border-radius:8px;border:1px solid var(--dsp-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}',
        '.dsp-btn:hover{background:color-mix(in srgb, var(--dsp-fg) 7%, transparent)}',
        '.dsp-btn-primary{border-color:transparent;background:var(--dsp-accent);color:var(--dsp-accent-ink, #1a1200);font-weight:600}',
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
        // settings (host theme tokens: it lives in the app settings page)
        '.dsp-settings{display:flex;flex-direction:column;padding:16px 0 0;font-family:var(--dsw-font-family, inherit);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-shead{display:flex;align-items:center;gap:12px;padding:0 0 6px;min-width:0}',
        '.dsp-shead-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-shead-links{flex:none;display:flex;align-items:center;gap:2px}',
        '.dsp-slink{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:7px;color:var(--dsw-alias-label-tertiary, #8f8d84);text-decoration:none;transition:color 120ms ease,background-color 120ms ease}',
        '.dsp-slink-npm{width:36px}',
        '.dsp-slink:hover{color:var(--dsw-alias-label-primary, #f4f4f5);background:color-mix(in srgb, currentColor 10%, transparent)}',
        '.dsp-slink-icon{display:block;flex:none}',
        '.dsp-sgroup-box{display:flex;flex-direction:column;min-width:0}',
        '.dsp-sgroup{display:flex;align-items:center;gap:6px;padding:24px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));font-size:12px;font-weight:600;line-height:18px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary, #b0aea5)}',
        '.dsp-sgroup-box:first-child .dsp-sgroup{padding-top:4px;border-top:none}',
        '.dsp-sicon{flex:none;width:15px;height:15px;display:block;color:inherit}',
        '.dsp-sgroup-title{flex:none;min-width:0;white-space:nowrap}',
        '.dsp-sgroup-note{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;letter-spacing:0;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-srow{display:flex;align-items:center;flex-wrap:wrap;gap:12px 8px;padding:16px 0;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-sgroup + .dsp-srow{border-top:none}',
        '.dsp-srow-text{flex:1 1 140px;min-width:0;min-height:22px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding-right:48px}',
        '.dsp-stitle{display:flex;align-items:center;min-width:0;font-size:14px;font-weight:400;line-height:22px;letter-spacing:normal;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-sdesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sdesc-strong{color:var(--dsw-alias-label-secondary, #b0aea5)}',
        '.dsp-sdesc-flat{display:block;padding:2px 0}',
        '.dsp-badge{margin-left:8px;padding:0 6px;border-radius:5px;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0;color:var(--dsw-alias-brand-primary, #d97757);background:color-mix(in srgb, var(--dsw-alias-brand-primary, #d97757) 14%, transparent)}',
        '.dsp-srow-err{display:block;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary, #d0342c)}',
        '.dsp-srow-sub{padding-left:18px}',
        '.dsp-srow-sub .dsp-stitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary, #b0aea5)}',
        '.dsp-srow-stack{align-items:flex-start;flex-direction:column;gap:8px}',
        '.dsp-srow-stack .dsp-srow-text{flex:0 0 auto;width:100%;padding-right:0}',
        '.dsp-srow-stack .dsp-sval{font-size:12px;line-height:18px;white-space:normal}',
        '.dsp-srow-ro{padding:12px 0}',
        '.dsp-srow-ro .dsp-sval{max-width:58%;text-align:right;white-space:normal}',
        '.dsp-srow-plain{padding:6px 0;border-top:none}',
        '.dsp-srow-plain .dsp-srow-text{padding-right:24px}',
        '.dsp-srow-new{padding:12px 0 2px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-srow-prof{gap:8px}',
        '.dsp-srow-prof .dsp-srow-text{padding-right:20px}',
        '.dsp-srow-prof.is-active .dsp-stitle{font-weight:500}',
        '.dsp-srow-prof.is-active{background:linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-brand-primary, #d97757) 5%, transparent), transparent 70%)}',
        '.dsp-sval{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84);font-variant-numeric:tabular-nums}',
        '.dsp-sval-dim{opacity:.55}',
        '.dsp-prof-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:2px;flex:none}',
        '.dsp-prof-actions .dsp-sval{margin-right:4px}',
        '.dsp-prof-edit{display:flex;align-items:center;gap:6px;flex:none;padding:2px 0}',
        '.dsp-sinput{width:170px;max-width:42vw;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1, transparent);color:var(--dsw-alias-label-primary, #f4f4f5);font-family:inherit;font-size:13px;line-height:18px;outline:none;transition:border-color 120ms ease}',
        '.dsp-sinput:focus{border-color:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-sbtn{flex:none;height:28px;padding:0 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary, #b0aea5);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background-color 120ms ease, color 120ms ease}',
        '.dsp-sbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-sbtn:disabled{opacity:.4;cursor:not-allowed}',
        '.dsp-sbtn-primary{color:var(--dsw-alias-brand-primary, #d97757);font-weight:500}',
        '.dsp-sbtn-primary:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary, #d97757) 12%, transparent);color:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-sbtn-danger{color:var(--dsw-alias-state-error-primary, #d0342c);font-weight:500}',
        '.dsp-sbtn-danger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #d0342c) 12%, transparent);color:var(--dsw-alias-state-error-primary, #d0342c)}',
        '.dsp-settings a:focus-visible,.dsp-settings button:focus-visible,.dsp-settings input:focus-visible,.dsp-settings [tabindex]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #d97757);outline-offset:1px}',
        '.dsp-seg{position:relative;display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:7px;background:var(--dsw-specific-selector, rgba(128,128,128,.16));max-width:100%;overflow-x:auto;scrollbar-width:none}',
        '.dsp-seg::-webkit-scrollbar{display:none}',
        '.dsp-seg::before{content:"";position:absolute;left:0;top:0;width:var(--pill-w, 0);height:var(--pill-h, 0);border-radius:5px;background:var(--dsw-alias-bg-overlay, #ffffff);box-shadow:0 1px 2px rgba(20,20,19,.1);transform:translate(var(--pill-x, 0), var(--pill-y, 0));opacity:0;pointer-events:none;transition:transform .24s cubic-bezier(.22,.61,.36,1), width .24s cubic-bezier(.22,.61,.36,1), height .24s cubic-bezier(.22,.61,.36,1), opacity .12s ease}',
        '.dsp-seg[data-ready]::before{opacity:1}',
        '[data-ds-dark-theme] .dsp-seg::before{background:rgba(255,255,255,.14);box-shadow:none}',
        '.dsp-segbtn{position:relative;z-index:1;height:26px;padding:0 12px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary, #b0aea5);font-family:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap;transition:color 120ms ease}',
        '.dsp-segbtn:hover{color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-segbtn.on{color:var(--dsw-alias-label-primary, #f4f4f5);font-weight:500}',
        '.dsp-switch{flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.3));position:relative;cursor:pointer;transition:background-color 120ms ease}',
        '.dsp-switch i{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-overlay, #ffffff);box-shadow:0 1px 2px rgba(20,20,19,.18);translate:0 0}',
        '.dsp-switch.on,.dsp-switch[data-on]{background:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-switch.on i,.dsp-switch[data-on] i{translate:16px 0}',
        '.dsp-switch[data-moved][data-on] i{animation:dsp-switch-on 350ms cubic-bezier(.34,1.45,.64,1) both}',
        '.dsp-switch[data-moved]:not([data-on]) i{animation:dsp-switch-off 350ms cubic-bezier(.34,1.45,.64,1) both}',
        '.dsp-switch:disabled{opacity:.4;cursor:not-allowed}',
        '.dsp-evlog{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow:auto;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:11px;line-height:16px}',
        '.dsp-ev{display:flex;gap:8px;align-items:baseline}',
        '.dsp-ev-time{flex:none;opacity:.5}',
        '.dsp-ev-text{min-width:0;word-break:break-word}',
        '.dsp-ev-config .dsp-ev-text{color:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-ev-skip .dsp-ev-text{color:var(--dsw-alias-state-warning-primary, #d8a12a)}',
        '.dsp-ev-empty{opacity:.45}',
        '@keyframes dsp-switch-on{0%{translate:0 0}55%{translate:17px 0}80%,to{translate:16px 0}}',
        '@keyframes dsp-switch-off{0%{translate:16px 0}55%{translate:-1px 0}80%,to{translate:0 0}}',
        '@media (prefers-reduced-motion: reduce){.dsp-switch,.dsp-switch i,.dsp-seg::before,.dsp-segbtn,.dsp-sbtn,.dsp-sinput{transition:none!important;animation:none!important}}',
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
      var navTimer = 0
      var navVisHandler = null

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
          // Accept the current section name and the old card title, so a row
          // rendered just before/after a language switch still matches.
          var titles = [tr('app.nav'), tr('app.title')]
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i]
            var text = String(row.textContent || '').replace(/\s+/g, ' ').trim()
            var matched = false
            for (var k = 0; k < titles.length; k++) {
              if (titles[k] && (text === titles[k] || text.indexOf(titles[k]) >= 0)) { matched = true; break }
            }
            if (!matched) continue
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
          if (navTimer) return
          // Merge bursts with a timer, never requestAnimationFrame: rAF is
          // suspended while the tab is hidden or the window is minimized, so a
          // settings panel opened later would wait forever for the repaint.
          navTimer = setTimeout(function () { navTimer = 0; paintNavIcon() }, 16)
        } catch (e) { /* ignore */ }
      }

      function watchNavIcon() {
        try {
          paintNavIcon()
          if (!navObserver &&
            typeof MutationObserver === 'function' &&
            typeof document !== 'undefined' && document.body) {
            navObserver = new MutationObserver(function () { scheduleNavIcon() })
            navObserver.observe(document.body, { childList: true, subtree: true })
          }
          // Timer + observer can miss a repaint while the tab is hidden; catch up
          // the moment the user brings the window back.
          if (!navVisHandler && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            navVisHandler = function () { scheduleNavIcon() }
            document.addEventListener('visibilitychange', navVisHandler)
          }
        } catch (e) { /* host DOM unavailable */ }
      }

      function unwatchNavIcon() {
        try { if (navObserver) { navObserver.disconnect(); navObserver = null } } catch (e) { /* ignore */ }
        try {
          if (navTimer && typeof clearTimeout === 'function') clearTimeout(navTimer)
        } catch (e) { /* ignore */ }
        navTimer = 0
        try {
          if (navVisHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', navVisHandler)
          }
        } catch (e) { /* ignore */ }
        navVisHandler = null
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
            watchClaude()
            return unwatchClaude
          }, 'shutdown-panel: claude palette')
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
          // the two host language ids in sync with app.nav (the product name,
          // identical in all languages). The label itself still resolves through
          // navLabel(): `locale` alone only injects a `t` seat into the
          // component, it never translates the nav label.
          try {
            if (ctx.locale && typeof ctx.locale.register === 'function') {
              ctx.locale.register(SETTINGS_NS, {
                zh: { nav: MSG.zh['app.nav'] },
                en: { nav: MSG.en['app.nav'] },
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
