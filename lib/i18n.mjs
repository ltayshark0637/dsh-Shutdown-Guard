/**
 * Host-side message catalog for dsh-shutdown-guard.
 *
 * The browser half of the plugin cannot import this file (the client bundle may
 * only `require('react')`), so it carries its own copy of the strings it needs.
 * Everything the host *generates* — log lines, skip reasons, blocked reasons —
 * is rendered here, in the language the user picked, before it leaves the host.
 *
 * Keep the three languages key-for-key aligned: a missing key falls back to
 * English and then to Chinese, which is better than printing a raw key but is
 * still a bug worth avoiding.
 */

export const LANGS = ['zh', 'en', 'ru'];

export const LANG_LABELS = {
  zh: '中文',
  en: 'English',
  ru: 'Русский',
};

/** Normalize a preference (`auto` | `zh` | `en` | `ru`) to a concrete language. */
export function resolveLang(preference) {
  const raw = typeof preference === 'string' ? preference.trim().toLowerCase() : '';
  if (raw && raw !== 'auto' && LANGS.includes(raw)) return raw;
  if (raw && raw !== 'auto') {
    // A few forgiving aliases: zh-CN, en_US, ru-RU and friends.
    const head = raw.split(/[-_]/)[0];
    if (LANGS.includes(head)) return head;
  }
  const fromSystem =
    (typeof process !== 'undefined' && process.env
      ? process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG
      : '') || '';
  const head = String(fromSystem).toLowerCase().split(/[-_.]/)[0];
  if (LANGS.includes(head)) return head;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const tag = String(locale).toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(tag)) return tag;
  } catch {
    /* Intl is present everywhere we run; ignore exotic failures. */
  }
  return 'en';
}

const AFK_REPLY_ZH = [
  '【AFK 自动回答】用户当前处于 AFK 状态，无法即时回复。请自行推进，不要停下来等回复：',
  '1. 先把已经交代好的任务全部处理完成；',
  '2. 完成后把结果汇总成一份报告，写入工作区文件，并在回复里说明落盘路径；',
  '3. 不要触碰未交代的分支、选项或额外改动；确实需要决策时，按「保持现状、最小改动」处理，并在报告里注明。',
].join('\n');

const AFK_REPLY_EN = [
  '[AFK auto-reply] The user is currently AFK and cannot answer right now. Keep going on your own instead of waiting for a reply:',
  '1. Finish every task that was already assigned to you;',
  '2. When done, write a summary report to a file in the workspace and state its path in your reply;',
  '3. Do not touch branches, options or extra changes that were not requested. If a decision is unavoidable, keep the current behaviour with the smallest possible change and note it in the report.',
].join('\n');

const AFK_REPLY_RU = [
  '[AFK-автоответ] Пользователь сейчас отсутствует (AFK) и не может ответить. Продолжайте работу самостоятельно, не ожидая ответа:',
  '1. Сначала полностью выполните все уже поставленные задачи;',
  '2. По завершении составьте отчёт, запишите его в файл в рабочей области и укажите путь к нему в ответе;',
  '3. Не трогайте ветки, варианты и дополнительные изменения, которых не было в задании. Если решение всё же необходимо, сохраните текущее поведение минимальным изменением и отметьте это в отчёте.',
].join('\n');

const AFK_RECOVER_ZH = [
  '【AFK 自动接管】上一轮执行报错了，但用户当前处于 AFK，无法立刻介入。请按这个顺序处理：',
  '1. 先定位报错原因（读报错信息，检查刚才的改动、命令或文件），能修就修；',
  '2. 修好之后按原计划继续推进剩下的任务，不要因为一次报错就整体放弃；',
  '3. 如果同一个问题连续两次尝试仍然解决不了，停止重试，把已完成的部分、失败原因和下一步建议写成报告文件并说明落盘路径，然后结束本轮。',
  '不要触碰未交代的分支或额外改动。',
].join('\n');

const AFK_RECOVER_EN = [
  '[AFK takeover] The previous turn failed, but the user is AFK and cannot step in right now. Work through it in this order:',
  '1. Find the cause first (read the error, inspect the change, command or file involved) and fix it if you can;',
  '2. Once fixed, continue the remaining work as originally planned — do not abandon the whole task over one error;',
  '3. If the same problem still resists two consecutive attempts, stop retrying: write the finished parts, the failure reason and the suggested next step into a report file, state its path, then end the turn.',
  'Do not touch branches or extra changes that were not requested.',
].join('\n');

const AFK_RECOVER_RU = [
  '[AFK-перехват] Предыдущий шаг завершился ошибкой, но пользователь отсутствует (AFK) и не может вмешаться. Действуйте в таком порядке:',
  '1. Сначала найдите причину ошибки (прочитайте сообщение, проверьте сделанное изменение, команду или файл) и исправьте, если это возможно;',
  '2. После исправления продолжайте оставшуюся работу по исходному плану — не отказывайтесь от всей задачи из-за одной ошибки;',
  '3. Если одна и та же проблема не решается после двух последовательных попыток, прекратите повторы: запишите выполненную часть, причину сбоя и предложенный следующий шаг в файл отчёта, укажите путь к нему и завершите шаг.',
  'Не трогайте ветки и дополнительные изменения, которых не было в задании.',
].join('\n');

const AFK_RETRY_ZH = [
  '【AFK 自动重试】刚才的外部服务故障看起来已经恢复，请继续推进原计划。',
  '1. 先回顾已经做到哪一步，不要重复已经完成的工作；',
  '2. 按原计划继续，完成后把结果汇总成报告并落盘。',
].join('\n');

const AFK_RETRY_EN = [
  '[AFK auto-retry] The external service problem seems to have cleared. Continue with the original plan.',
  '1. First check where you left off, and do not redo work that is already finished;',
  '2. Carry on as planned, then summarise the result into a report and write it to disk.',
].join('\n');

const AFK_RETRY_RU = [
  '[AFK-автоповтор] Похоже, сбой внешнего сервиса устранён. Продолжайте по исходному плану.',
  '1. Сначала вспомните, на чём вы остановились, и не повторяйте уже выполненную работу;',
  '2. Продолжайте по плану, затем сведите результат в отчёт и запишите его на диск.',
].join('\n');

const AFK_FINAL_ZH = [
  '【AFK 收尾】这个问题重试过仍然失败。请停止重试，直接收尾：',
  '1. 把已完成的内容、失败原因、可复现步骤和建议写成一份报告文件，并说明落盘路径；',
  '2. 在回复里简要总结，然后结束任务。',
].join('\n');

const AFK_FINAL_EN = [
  '[AFK wrap-up] This problem still fails after retrying. Stop retrying and wrap up now:',
  '1. Write what was finished, the failure reason, reproduction steps and your recommendation into a report file, and state its path;',
  '2. Summarise briefly in your reply, then end the task.',
].join('\n');

const AFK_FINAL_RU = [
  '[AFK-завершение] После повторов проблема сохраняется. Прекратите попытки и завершайте:',
  '1. Запишите выполненное, причину сбоя, шаги воспроизведения и рекомендации в файл отчёта и укажите путь к нему;',
  '2. Кратко подведите итог в ответе и завершите задачу.',
].join('\n');

const MESSAGES = {
  zh: {
    'profile.default': '默认配置',
    'profile.custom': '自定义 {n}',

    'afk.reply': AFK_REPLY_ZH,
    'afk.recover': AFK_RECOVER_ZH,
    'afk.retry': AFK_RETRY_ZH,
    'afk.final': AFK_FINAL_ZH,

    'halted.QUOTA': '额度不足，已暂停关机（充值后解除再武装）',
    'halted.ACCOUNT_QUOTA': '账户额度用尽，已暂停关机（充值后解除再武装）',
    'halted.INVALID_CREDENTIAL': '凭证无效，已暂停关机（修复后解除再武装）',
    'halted.MISSING_CREDENTIAL': '缺少凭证，已暂停关机（配置后解除再武装）',
    'halted.CONTEXT_WINDOW_EXCEEDED': '上下文已超出模型窗口，已暂停关机（建议新开会话）',
    'halted.CAPABILITY_UNSUPPORTED': '当前模型不支持这项操作，已暂停关机（换模型后再试）',
    'halted.UNSUPPORTED_CAPABILITY': '当前模型不支持这项操作，已暂停关机（换模型后再试）',
    'halted.DISK_FULL': '写盘失败，已暂停关机（清理空间后解除再武装）',
    'halted.ENOSPC': '写盘失败，已暂停关机（清理空间后解除再武装）',
    'halted.unknown': '遇到需要人工处理的错误（{code}），已暂停关机',

    'waiting.RATE_LIMIT': '被限流，等待自动重试',
    'waiting.SERVER': '服务端故障，等待自动重试',
    'waiting.TRANSPORT': '网络中断，等待自动重试',
    'waiting.EMPTY_RESPONSE': '模型返回空内容，等待自动重试',
    'waiting.TIMEOUT': '请求超时，等待自动重试',
    'waiting.IMAGE_OFFLOAD_REQUIRED': '图片需要先卸载到磁盘，等待自动重试',
    'waiting.unknown': '外部服务不可用（{code}），等待自动重试',

    'blocked.retrySuffix': '（第 {n} 次，{sec} 秒后重试）',
    'blocked.halted': '已暂停关机：{reason}',
    'blocked.waiting': '等待恢复：{reason}',

    'skip.jobs': '还有 {n} 个后台任务在运行，暂不关机（模式保持开启）',
    'skip.errorsSuccess': '本批次有 {n} 个会话出错，仅成功时关机（模式保持开启）',
    'skip.errorsAfk': '本批次有 {n} 个会话出错，正在进行 AFK 恢复，暂不关机（模式保持开启）',
    'skip.interrupted': '已检测到用户中断，本轮不关机（模式保持开启，下次任务完成后再算）',

    'log.configWriteFailed': '写入配置文件失败：{error}',
    'log.platformUnsupported': '当前平台为 {platform}，本插件只在 Windows 上工作，不挂载',
    'log.servicesMissing': '缺少 agents / subprocess 服务，插件不挂载',
    'log.webServerMissing': '缺少 webServer 服务：无法通过侧边栏面板控制关机',
    'log.jobDuringCountdown': '倒计时期间出现后台任务「{label}」，取消关机（模式保持开启）',
    'log.retryScheduled': '外部服务暂不可用（{code}，策略 {policy}）：{reason}',
    'log.jobsNoStream': 'jobs 服务缺少事件流，无法跟踪后台任务（仍按会话状态判断）',
    'log.jobsSubscribed': '已订阅后台任务事件：运行中的后台任务会阻止关机',
    'log.jobsSubscribeFailed': '订阅后台任务事件失败：{error}',
    'log.jobsMissing': '未发现 jobs 服务：后台任务不会阻止关机',
    'log.shutdownExit': 'shutdown {args} 进程退出：{outcome}',
    'log.shutdownSpawnFailed': 'shutdown 进程启动失败：{error}',
    'log.spawnFailed': 'spawn 失败：{error}',
    'log.actionUnavailable': '任务已完成，但这个系统不支持所选操作，没有执行任何动作。',
    'log.actionAlreadyRan': '操作已经执行，无法撤回。',
    'log.countdownStart': '任务完成 → {sec} 秒后关机（侧边栏可取消）',
    'log.fired': '系统关机指令已生效（无法取消）',
    'log.cancelledDisarmed': '已取消，未发出任何命令，模式已关闭',
    'log.cancelledArmed': '已取消，未发出任何命令，模式保持开启',
    'log.armedOn': '已开启：任务完成后自动关机',
    'log.armedOff': '已关闭：任务完成后自动关机',
    'log.retryRecovered': '外部服务已恢复，解除等待',
    'log.taskDuringCountdown': '倒计时期间新任务开始，取消关机（模式保持开启）',
    'log.afkWrapDone': 'AFK 收尾会话 {id} 已结束，本轮错误不再阻止关机',
    'log.interruptDetected': '检测到会话中断：本轮{kind}（{blob}）',
    'log.interruptNoReply': '没有任何回复',
    'log.interruptWithCause': '带取消原因',
    'log.afkFollowupFailed': 'AFK followup 失败：{error}',
    'log.afkSteerFailed': 'AFK steer 失败：{error}',
    'log.sessionCancelled': '会话 {id} 被中断（主动取消），不按失败处理',
    'log.rootError': 'root 会话出错：{id}{codeSuffix}',
    'log.blockedSelfHealFailed': '会话 {id} 的错误无法自愈（{code}）：{reason}',
    'log.afkRetryExhausted': 'AFK 已为会话 {id} 重试过两次，不再继续（等待收尾）',
    'log.afkRecoverAsked': 'AFK 已要求出错会话 {id} 排查并继续原计划',
    'log.afkFinalAsked': 'AFK 已要求出错会话 {id} 停止重试、收尾落盘',
    'log.afkInjectFailed': 'AFK 无法向会话 {id} 注入恢复指令，本轮不关机',
    'log.afkErrorHandlerFailed': 'AFK 错误恢复处理异常：{error}',
    'log.afkAnswered': 'AFK 自动回答 {n} 个提问（模式保持开启）',
    'log.requestFailed': '{suffix} 处理失败：{error}',
    'log.debugSimulatedError': '调试：模拟会话 {id} 报错{codeSuffix}',
    'log.customEnabled': '已启用自定义配置',
    'log.customDisabled': '已停用自定义配置，回到默认配置',
    'log.profileSwitched': '切换配置：{label}',
    'log.afkEnabled': '已开启 AFK 自动回答：武装后会替用户回答提问',
    'log.afkDisabled': '已关闭 AFK 自动回答',
    'log.defaultLocked': '默认配置的倒计时固定为 60 秒，已忽略修改',
    'log.profileUpdated': '配置「{label}」更新：{sec}s / 成功才关机={onlyOnSuccess} / 后台任务拦截={blockOnJobs}',
    'log.routesRegistered': 'HTTP 路由已注册',
    'log.mounted': '插件已挂载：root 会话 {roots} 个，运行中 {running} 个（模式默认关闭）',
    'job.fallbackLabel': '后台任务',
  },

  en: {
    'profile.default': 'Default profile',
    'profile.custom': 'Custom {n}',

    'afk.reply': AFK_REPLY_EN,
    'afk.recover': AFK_RECOVER_EN,
    'afk.retry': AFK_RETRY_EN,
    'afk.final': AFK_FINAL_EN,

    'halted.QUOTA': 'Out of quota — shutdown paused (top up, then cancel and re-arm)',
    'halted.ACCOUNT_QUOTA': 'Account quota exhausted — shutdown paused (top up, then cancel and re-arm)',
    'halted.INVALID_CREDENTIAL': 'Invalid credentials — shutdown paused (fix, then cancel and re-arm)',
    'halted.MISSING_CREDENTIAL': 'Missing credentials — shutdown paused (configure, then cancel and re-arm)',
    'halted.CONTEXT_WINDOW_EXCEEDED': 'Context window exceeded — shutdown paused (a new session is recommended)',
    'halted.CAPABILITY_UNSUPPORTED': 'The current model does not support this — shutdown paused (try another model)',
    'halted.UNSUPPORTED_CAPABILITY': 'The current model does not support this — shutdown paused (try another model)',
    'halted.DISK_FULL': 'Disk write failed — shutdown paused (free some space, then cancel and re-arm)',
    'halted.ENOSPC': 'Disk write failed — shutdown paused (free some space, then cancel and re-arm)',
    'halted.unknown': 'Needs manual attention ({code}) — shutdown paused',

    'waiting.RATE_LIMIT': 'Rate limited — waiting to retry automatically',
    'waiting.SERVER': 'Server error — waiting to retry automatically',
    'waiting.TRANSPORT': 'Network interrupted — waiting to retry automatically',
    'waiting.EMPTY_RESPONSE': 'The model returned nothing — waiting to retry automatically',
    'waiting.TIMEOUT': 'Request timed out — waiting to retry automatically',
    'waiting.IMAGE_OFFLOAD_REQUIRED': 'Images must be offloaded to disk first — waiting to retry automatically',
    'waiting.unknown': 'External service unavailable ({code}) — waiting to retry automatically',

    'blocked.retrySuffix': ' (attempt {n}, retrying in {sec}s)',
    'blocked.halted': 'Shutdown paused: {reason}',
    'blocked.waiting': 'Waiting to recover: {reason}',

    'skip.jobs': '{n} background task(s) still running — not shutting down (the mode stays on)',
    'skip.errorsSuccess': '{n} session(s) failed in this batch — shutdown only on success (the mode stays on)',
    'skip.errorsAfk': '{n} session(s) failed in this batch — AFK recovery is running, not shutting down (the mode stays on)',
    'skip.interrupted': 'A user interruption was detected — not shutting down this round (the mode stays on; the next finished batch counts)',

    'log.configWriteFailed': 'Failed to write the config file: {error}',
    'log.platformUnsupported': 'Platform is {platform}; this plugin only runs on Windows and was not mounted',
    'log.servicesMissing': 'The agents / subprocess services are missing; the plugin was not mounted',
    'log.webServerMissing': 'The webServer service is missing: the sidebar card cannot control shutdown',
    'log.jobDuringCountdown': 'Background task "{label}" started during the countdown — shutdown cancelled (the mode stays on)',
    'log.retryScheduled': 'External service unavailable ({code}, policy {policy}): {reason}',
    'log.jobsNoStream': 'The jobs service exposes no event stream; background tasks cannot be tracked (session state is still used)',
    'log.jobsSubscribed': 'Subscribed to background task events: running tasks will block shutdown',
    'log.jobsSubscribeFailed': 'Failed to subscribe to background task events: {error}',
    'log.jobsMissing': 'No jobs service found: background tasks will not block shutdown',
    'log.shutdownExit': 'shutdown {args} exited: {outcome}',
    'log.shutdownSpawnFailed': 'Failed to start shutdown: {error}',
    'log.spawnFailed': 'spawn failed: {error}',
    'log.actionUnavailable': 'Done, but the selected action is not supported on this system, so nothing was run.',
    'log.actionAlreadyRan': 'The action has already run and cannot be undone.',
    'log.countdownStart': 'Tasks finished → shutting down in {sec}s (cancellable from the sidebar)',
    'log.fired': 'The shutdown command has taken effect (it cannot be cancelled)',
    'log.cancelledDisarmed': 'Cancelled; no command was sent, the mode is now off',
    'log.cancelledArmed': 'Cancelled; no command was sent, the mode stays on',
    'log.armedOn': 'Enabled: shut down automatically when tasks finish',
    'log.armedOff': 'Disabled: automatic shutdown when tasks finish',
    'log.retryRecovered': 'The external service recovered; leaving the waiting state',
    'log.taskDuringCountdown': 'A new task started during the countdown — shutdown cancelled (the mode stays on)',
    'log.afkWrapDone': 'AFK wrap-up session {id} finished; its error no longer blocks shutdown',
    'log.interruptDetected': 'Session interruption detected: {kind} this round ({blob})',
    'log.interruptNoReply': 'no reply at all',
    'log.interruptWithCause': 'with a cancel reason',
    'log.afkFollowupFailed': 'AFK followup failed: {error}',
    'log.afkSteerFailed': 'AFK steer failed: {error}',
    'log.sessionCancelled': 'Session {id} was interrupted (cancelled on purpose); not treated as a failure',
    'log.rootError': 'Root session failed: {id}{codeSuffix}',
    'log.blockedSelfHealFailed': 'Session {id} cannot recover by itself ({code}): {reason}',
    'log.afkRetryExhausted': 'AFK already retried session {id} twice; stopping (waiting for the wrap-up)',
    'log.afkRecoverAsked': 'AFK asked session {id} to diagnose the error and carry on with the plan',
    'log.afkFinalAsked': 'AFK asked session {id} to stop retrying and wrap up into a report',
    'log.afkInjectFailed': 'AFK could not deliver a recovery instruction to session {id}; not shutting down this round',
    'log.afkErrorHandlerFailed': 'AFK error recovery threw: {error}',
    'log.afkAnswered': 'AFK answered {n} question(s) automatically (the mode stays on)',
    'log.requestFailed': '{suffix} failed: {error}',
    'log.debugSimulatedError': 'Debug: simulated an error for session {id}{codeSuffix}',
    'log.customEnabled': 'Custom profiles enabled',
    'log.customDisabled': 'Custom profiles disabled; back to the default profile',
    'log.profileSwitched': 'Switched profile: {label}',
    'log.afkEnabled': 'AFK auto-answer enabled: once armed, questions are answered for you',
    'log.afkDisabled': 'AFK auto-answer disabled',
    'log.defaultLocked': 'The default profile pins the countdown to 60s; the change was ignored',
    'log.profileUpdated': 'Profile "{label}" updated: {sec}s / only on success={onlyOnSuccess} / block on background tasks={blockOnJobs}',
    'log.routesRegistered': 'HTTP routes registered',
    'log.mounted': 'Plugin mounted: {roots} root session(s), {running} running (the mode starts off)',
    'job.fallbackLabel': 'background task',
  },

  ru: {
    'profile.default': 'Профиль по умолчанию',
    'profile.custom': 'Пользовательский {n}',

    'afk.reply': AFK_REPLY_RU,
    'afk.recover': AFK_RECOVER_RU,
    'afk.retry': AFK_RETRY_RU,
    'afk.final': AFK_FINAL_RU,

    'halted.QUOTA': 'Квота исчерпана — выключение приостановлено (пополните и включите режим заново)',
    'halted.ACCOUNT_QUOTA': 'Квота аккаунта исчерпана — выключение приостановлено (пополните и включите режим заново)',
    'halted.INVALID_CREDENTIAL': 'Неверные учётные данные — выключение приостановлено (исправьте и включите режим заново)',
    'halted.MISSING_CREDENTIAL': 'Отсутствуют учётные данные — выключение приостановлено (настройте и включите режим заново)',
    'halted.CONTEXT_WINDOW_EXCEEDED': 'Контекст превысил окно модели — выключение приостановлено (лучше начать новый сеанс)',
    'halted.CAPABILITY_UNSUPPORTED': 'Текущая модель это не поддерживает — выключение приостановлено (смените модель)',
    'halted.UNSUPPORTED_CAPABILITY': 'Текущая модель это не поддерживает — выключение приостановлено (смените модель)',
    'halted.DISK_FULL': 'Ошибка записи на диск — выключение приостановлено (освободите место и включите режим заново)',
    'halted.ENOSPC': 'Ошибка записи на диск — выключение приостановлено (освободите место и включите режим заново)',
    'halted.unknown': 'Требуется вмешательство человека ({code}) — выключение приостановлено',

    'waiting.RATE_LIMIT': 'Ограничение частоты — ожидание автоматического повтора',
    'waiting.SERVER': 'Ошибка сервера — ожидание автоматического повтора',
    'waiting.TRANSPORT': 'Сеть прервалась — ожидание автоматического повтора',
    'waiting.EMPTY_RESPONSE': 'Модель вернула пустой ответ — ожидание автоматического повтора',
    'waiting.TIMEOUT': 'Превышено время ожидания — ожидание автоматического повтора',
    'waiting.IMAGE_OFFLOAD_REQUIRED': 'Сначала нужно выгрузить изображения на диск — ожидание автоматического повтора',
    'waiting.unknown': 'Внешний сервис недоступен ({code}) — ожидание автоматического повтора',

    'blocked.retrySuffix': ' (попытка {n}, повтор через {sec} с)',
    'blocked.halted': 'Выключение приостановлено: {reason}',
    'blocked.waiting': 'Ожидание восстановления: {reason}',

    'skip.jobs': 'Ещё выполняется фоновых задач: {n} — выключение отложено (режим остаётся включённым)',
    'skip.errorsSuccess': 'В этой партии с ошибкой завершилось сеансов: {n} — выключение только при успехе (режим остаётся включённым)',
    'skip.errorsAfk': 'В этой партии с ошибкой завершилось сеансов: {n} — идёт AFK-восстановление, выключение отложено (режим остаётся включённым)',
    'skip.interrupted': 'Обнаружено прерывание пользователем — в этот раз выключения не будет (режим остаётся включённым; счёт пойдёт со следующей партии)',

    'log.configWriteFailed': 'Не удалось записать файл конфигурации: {error}',
    'log.platformUnsupported': 'Платформа {platform}; плагин работает только в Windows и не был подключён',
    'log.servicesMissing': 'Нет сервисов agents / subprocess; плагин не подключён',
    'log.webServerMissing': 'Нет сервиса webServer: карточка в боковой панели не сможет управлять выключением',
    'log.jobDuringCountdown': 'Во время отсчёта появилась фоновая задача «{label}» — выключение отменено (режим остаётся включённым)',
    'log.retryScheduled': 'Внешний сервис недоступен ({code}, политика {policy}): {reason}',
    'log.jobsNoStream': 'У сервиса jobs нет потока событий; фоновые задачи не отслеживаются (состояние сеансов всё равно учитывается)',
    'log.jobsSubscribed': 'Подписка на события фоновых задач активна: выполняющиеся задачи блокируют выключение',
    'log.jobsSubscribeFailed': 'Не удалось подписаться на события фоновых задач: {error}',
    'log.jobsMissing': 'Сервис jobs не найден: фоновые задачи не будут блокировать выключение',
    'log.shutdownExit': 'Процесс shutdown {args} завершился: {outcome}',
    'log.shutdownSpawnFailed': 'Не удалось запустить shutdown: {error}',
    'log.spawnFailed': 'сбой spawn: {error}',
    'log.actionUnavailable': 'Готово, но выбранное действие не поддерживается в этой системе, поэтому ничего не выполнено.',
    'log.actionAlreadyRan': 'Действие уже выполнено, отменить его нельзя.',
    'log.countdownStart': 'Задачи завершены → выключение через {sec} с (можно отменить в боковой панели)',
    'log.fired': 'Команда выключения уже выполнена (отменить нельзя)',
    'log.cancelledDisarmed': 'Отменено; ни одна команда не отправлена, режим выключен',
    'log.cancelledArmed': 'Отменено; ни одна команда не отправлена, режим остаётся включённым',
    'log.armedOn': 'Включено: автоматическое выключение после завершения задач',
    'log.armedOff': 'Выключено: автоматическое выключение после завершения задач',
    'log.retryRecovered': 'Внешний сервис восстановился; ожидание снято',
    'log.taskDuringCountdown': 'Во время отсчёта началась новая задача — выключение отменено (режим остаётся включённым)',
    'log.afkWrapDone': 'AFK-сеанс {id} завершён; его ошибка больше не блокирует выключение',
    'log.interruptDetected': 'Обнаружено прерывание сеанса: в этот раз {kind} ({blob})',
    'log.interruptNoReply': 'ответа не было вообще',
    'log.interruptWithCause': 'с указанием причины отмены',
    'log.afkFollowupFailed': 'Сбой AFK followup: {error}',
    'log.afkSteerFailed': 'Сбой AFK steer: {error}',
    'log.sessionCancelled': 'Сеанс {id} прерван (отменён намеренно); это не считается ошибкой',
    'log.rootError': 'Ошибка корневого сеанса: {id}{codeSuffix}',
    'log.blockedSelfHealFailed': 'Сеанс {id} не может восстановиться сам ({code}): {reason}',
    'log.afkRetryExhausted': 'AFK уже дважды повторял сеанс {id}; повторы прекращены (ожидание завершения)',
    'log.afkRecoverAsked': 'AFK попросил сеанс {id} разобраться в ошибке и продолжить по плану',
    'log.afkFinalAsked': 'AFK попросил сеанс {id} прекратить повторы и завершить работу с отчётом',
    'log.afkInjectFailed': 'AFK не смог передать сеансу {id} инструкцию по восстановлению; в этот раз выключения не будет',
    'log.afkErrorHandlerFailed': 'Исключение в AFK-восстановлении: {error}',
    'log.afkAnswered': 'AFK автоматически ответил на вопросов: {n} (режим остаётся включённым)',
    'log.requestFailed': 'Ошибка обработки {suffix}: {error}',
    'log.debugSimulatedError': 'Отладка: смоделирована ошибка сеанса {id}{codeSuffix}',
    'log.customEnabled': 'Пользовательские профили включены',
    'log.customDisabled': 'Пользовательские профили выключены; используется профиль по умолчанию',
    'log.profileSwitched': 'Профиль переключён: {label}',
    'log.afkEnabled': 'AFK-автоответ включён: после включения режима вопросы будут отвечаться за вас',
    'log.afkDisabled': 'AFK-автоответ выключен',
    'log.defaultLocked': 'В профиле по умолчанию отсчёт закреплён на 60 с; изменение проигнорировано',
    'log.profileUpdated': 'Профиль «{label}» обновлён: {sec} с / только при успехе={onlyOnSuccess} / блокировать фоновыми задачами={blockOnJobs}',
    'log.routesRegistered': 'HTTP-маршруты зарегистрированы',
    'log.mounted': 'Плагин подключён: корневых сеансов {roots}, выполняется {running} (режим изначально выключен)',
    'job.fallbackLabel': 'фоновая задача',
  },
};

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Render `key` in `lang`. Falls back to English and then Chinese so a missing
 * translation never leaks a raw key into the UI or the log file.
 */
export function t(lang, key, params) {
  const primary = MESSAGES[lang] && MESSAGES[lang][key];
  if (primary !== undefined) return interpolate(primary, params);
  const english = MESSAGES.en[key];
  if (english !== undefined) return interpolate(english, params);
  const chinese = MESSAGES.zh[key];
  if (chinese !== undefined) return interpolate(chinese, params);
  return key;
}

/** True when every language defines the same key set — used by the test suite. */
export function catalogCoverage() {
  const base = Object.keys(MESSAGES.zh).sort();
  const missing = {};
  for (const lang of LANGS) {
    const keys = Object.keys(MESSAGES[lang]);
    const absent = base.filter((key) => !keys.includes(key));
    if (absent.length) missing[lang] = absent;
  }
  return { base, missing };
}

export { MESSAGES };
