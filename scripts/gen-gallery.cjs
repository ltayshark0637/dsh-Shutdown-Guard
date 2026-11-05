// Generates the README / release screenshots from the plugin's real CSS.
//
// Every image here is rendered from the same `var CSS = [...]` block that
// ships in lib/client.js, so the gallery cannot drift from the product.
// Run from the plugin root:  node scripts/gen-gallery.cjs
// then screenshot each generated HTML file (see scripts/screenshot.ps1).
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

function extractCss() {
  const start = src.indexOf('var CSS = [')
  const end = src.indexOf("].join('')", start)
  if (start < 0 || end < 0) throw new Error('CSS block not found in lib/client.js')
  return src
    .slice(start + 'var CSS = ['.length, end)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith("'"))
    .map((s) => s.replace(/^'/, '').replace(/',?$/, ''))
    .join('\n')
}

const CSS = extractCss()
const OUT = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---------------------------------------------------------------- card parts
const RINGS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  .map((k) => `<circle cx="119" cy="101" r="${23 + k * 12}" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="${Math.max(0.14, 0.42 - k * 0.032).toFixed(2)}"></circle>`)
  .join('')

const DOTS = [
  ['job', 38, 34], ['job', 64, 62], ['run', 52, 72], ['run', 30, 58],
].map(([k, x, y]) => `<i class="dsp-dot dsp-dot-${k}" style="left:${x}%;top:${y}%"></i>`).join('')

const CHEV = '<svg class="dsp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'

// ---------------------------------------------------------------- copy source
// Card text comes from the same inlined catalog that ships in lib/client.js, so
// a copy change there shows up here on the next run instead of drifting silently.
function extractMsg() {
  const head = src.indexOf('var MSG = {')
  if (head < 0) throw new Error('MSG block not found in lib/client.js')
  const out = {}
  const langs = ['zh', 'en', 'ru']
  const starts = langs.map((l) => src.indexOf(l + ': {', head))
  for (let i = 0; i < langs.length; i++) {
    if (starts[i] < 0) throw new Error('MSG.' + langs[i] + ' not found')
    const stop = i + 1 < langs.length ? starts[i + 1] : src.indexOf('\n      }', starts[i])
    if (stop < 0) throw new Error('MSG end not found')
    out[langs[i]] = {}
    const re = /'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g
    let m
    const chunk = src.slice(starts[i], stop)
    while ((m = re.exec(chunk))) out[langs[i]][m[1]] = m[2].replace(/\\'/g, "'")
  }
  return out
}
const MSG = extractMsg()
// 图集默认中文（文件名保持 02-armed.html 这类原名）；传 --lang en|ru|all 时
// 输出带语言后缀的文件（02-armed.en.html），由 screenshot.ps1 一并渲染。
let LANG = 'zh'
const LANGS = ['zh', 'en', 'ru']
function setLang(lang) {
  if (!LANGS.includes(lang)) throw new Error('unknown language: ' + lang + ' (expected zh|en|ru)')
  LANG = lang
}

// 截图夹具：这些串不是产品文案（产品文案来自 client.js 的 MSG / 宿主
// i18n.mjs 的生成文案），而是演示用的示例内容（会话名、事件流水、阻塞原因），
// 所以单独维护三语，保证三份 README 的图不出现「英文界面里夹中文」。
const DEMO = {
  zh: {
    navNew: '新会话', navBoard: '工作台', navPlugins: '插件', navSkills: '技能中心',
    sess1: '重构关机插件', sess2: '周报数据整理',
    time1: '1 分钟', time2: '14 小时',
    profName: '自定义 {n}',
    haltedBig: '已暂停', haltedMeta: '账户额度不足，需充值后解除', haltedBtn: '解除并重试',
    waitingBig: '等待恢复', waitingMeta: '请求过于频繁，30 秒后自动重试（第 1 次）',
    skipLine: '还有 2 个后台任务在运行，暂不关机（模式保持开启）',
    ev1: '外部服务暂不可用（RATE_LIMIT，策略 rate-limit）：请求过于频繁，等待自动重试（第 1 次，30 秒后重试）',
    ev2: '还有 2 个后台任务在运行，暂不关机（模式保持开启）',
    ev3: '切换配置：自定义 3',
    ev4: '已开启：任务完成后自动关机',
  },
  en: {
    navNew: 'New chat', navBoard: 'Workspace', navPlugins: 'Plugins', navSkills: 'Skills',
    sess1: 'Refactor the shutdown guard', sess2: 'Weekly report cleanup',
    time1: '1 min', time2: '14 hr',
    profName: 'Custom {n}',
    haltedBig: 'Paused', haltedMeta: 'Account quota exhausted — top up to resume', haltedBtn: 'Resume and retry',
    waitingBig: 'Waiting to recover', waitingMeta: 'Too many requests — retrying in 30 s (attempt 1)',
    skipLine: '2 background tasks are still running, so no shutdown (mode stays armed)',
    ev1: 'External service unavailable (RATE_LIMIT, policy rate-limit): too many requests, retrying in 30 s (attempt 1)',
    ev2: '2 background tasks are still running, so no shutdown (mode stays armed)',
    ev3: 'Profile changed: custom 3',
    ev4: 'Armed: shut down when tasks finish',
  },
  ru: {
    navNew: 'Новый чат', navBoard: 'Рабочий стол', navPlugins: 'Плагины', navSkills: 'Навыки',
    sess1: 'Переписать сторожа выключения', sess2: 'Разбор недельного отчёта',
    time1: '1 мин', time2: '14 ч',
    profName: 'Своя {n}',
    haltedBig: 'Пауза', haltedMeta: 'Квота аккаунта исчерпана — пополните счёт, чтобы снять паузу', haltedBtn: 'Снять паузу и повторить',
    waitingBig: 'Ждём восстановления', waitingMeta: 'Слишком много запросов — повтор через 30 с (попытка 1)',
    skipLine: 'Ещё 2 фоновые задачи в работе, выключения не будет (режим остаётся взведённым)',
    ev1: 'Внешний сервис недоступен (RATE_LIMIT, политика rate-limit): слишком много запросов, повтор через 30 с (попытка 1)',
    ev2: 'Ещё 2 фоновые задачи в работе, выключения не будет (режим остаётся взведённым)',
    ev3: 'Профиль изменён: своя 3',
    ev4: 'Взведено: выключение по завершении задач',
  },
}

function D(key, vars) {
  const table = DEMO[LANG]
  const raw = table[key]
  if (raw === undefined) throw new Error('missing demo copy: ' + key + ' (' + LANG + ')')
  return raw.replace(/\{(\w+)\}/g, (all, k) => (vars && k in vars ? String(vars[k]) : all))
}

function tr(key, vars) {
  const raw = MSG[LANG][key]
  if (raw === undefined) throw new Error('missing copy key: ' + key + ' (' + LANG + ')')
  return raw.replace(/\{(\w+)\}/g, (all, k) => (vars && k in vars ? String(vars[k]) : all))
}

// Little "open in a window" glyph — same path as lib/client.js:707.
const FLOAT_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>'

// view: off | armed | hold | fire | fired | blocked
function bigFor(c) {
  if (c.view === 'blocked') return c.big || (c.retry ? tr('big.retry') : tr('big.paused'))
  if (c.view === 'fire') return c.t || '00:42'
  return tr('big.' + c.view)
}

function metaFor(c) {
  const jobs = c.jobs ?? (c.view === 'off' ? 0 : 2)
  const agent = c.agent ?? (c.view === 'off' ? 1 : 3)
  if (c.view === 'blocked') return c.meta || tr('set.blocked.waiting')
  if (c.view === 'fire') return tr('meta.fire')
  if (c.view === 'fired') return tr('meta.fired')
  if (c.view === 'hold') {
    // Mirrors lib/client.js metaText: only non-zero counts are listed.
    const parts = []
    if (jobs > 0) parts.push(tr('meta.jobs', { n: jobs }))
    if (agent > 0) parts.push(tr('meta.sessions', { n: agent }))
    return tr('meta.hold', { parts: parts.join(' · ') })
  }
  return tr('meta.' + c.view)
}

function termLine(c) {
  // Mirrors lib/client.js:935 — armed falls through to the "waiting" line.
  if (c.view === 'fire') return tr('term.fire', { t: c.t || '00:42' })
  if (c.view === 'hold') return tr('term.hold')
  if (c.view === 'off') return tr('term.off')
  if (c.view === 'blocked') return c.retry ? tr('term.retry') : tr('term.halted')
  if (c.view === 'fired') return tr('term.done')
  return tr('term.wait')
}

function hudFor(c) {
  const jobs = c.jobs ?? (c.view === 'off' ? 0 : 2)
  const agent = c.agent ?? (c.view === 'off' ? 1 : 3)
  const b = c.view === 'fire' ? (c.t || '00:42')
    : c.view === 'hold' ? tr('hud.state.hold')
      : c.view === 'fired' ? tr('hud.state.fired')
        : c.view === 'off' ? tr('hud.state.off')
          : c.view === 'blocked' ? (c.retry ? tr('hud.state.retrying') : tr('hud.state.paused'))
            : tr('hud.state.standby')
  const span = c.view === 'blocked'
    ? (c.retry ? tr('hud.retry', { n: c.retryN || 2 }) : tr('hud.manual'))
    : tr('unit.jobs', { n: jobs }) + ' · ' + tr('unit.agent', { n: agent })
  return { b, span }
}

function bodyHtml(c) {
  if (c.variant === 'B') {
    const hud = hudFor(c)
    return `<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">
      <div class="dsp-sweep"></div>
      <div class="dsp-rings"><svg class="dsp-radar-svg" viewBox="0 0 238 202">${RINGS}</svg></div>
      <div class="dsp-ping"></div>
      <div class="dsp-dots">${DOTS}</div>
      <div class="dsp-hud"><b>${esc(hud.b)}</b><span>${esc(hud.span)}</span></div></div></div>`
  }
  if (c.variant === 'C') {
    // Mirrors lib/client.js: line 2 is the live counts, line 3 is the phase.
    const jobs = c.view === 'off' ? 0 : 2
    const agent = c.view === 'off' ? 1 : 3
    const l2 = tr('unit.jobs', { n: jobs }) + ' · ' + tr('unit.agent', { n: agent })
    const lines = `<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>
      <div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2">${esc(l2)}</span></div>
      <div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3">${esc(termLine(c))}</span><i class="dsp-caret"></i></div>`
    const ledState = [c.view !== 'off', true, agent === 0, jobs === 0, true, c.view === 'fire']
    const led = [0, 1, 2, 3, 4, 5].map((i) => `<i class="dsp-led-seg${ledState[i] ? ' on' : ''}" data-i="${i}"></i>`).join('')
    const code = c.view === 'blocked'
      ? (c.retry ? tr('code.waiting') : tr('code.halted'))
      : tr('code.gates', { n: ledState.filter(Boolean).length })
    return `<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">${lines}</div>
      <div class="dsp-led">${led}</div><div class="dsp-code">${esc(code)}</div></div>`
  }
  return `<div class="dsp-cbody dsp-v-a"><div class="dsp-big">${esc(bigFor(c))}</div><div class="dsp-meta">${esc(metaFor(c))}</div></div>`
}

function card(c) {
  const variant = c.variant || 'A'
  const view = c.view || 'armed'
  const tag = c.retry && view === 'blocked' ? tr('hud.state.retrying') : tr('tag.' + view)
  const cls = ['dsp-card', c.folded && 'is-folded', c.claude && 'dsp-claude'].filter(Boolean).join(' ')
  const btnLabel = c.btn || (view === 'off' ? tr('btn.arm') : view === 'fire' ? tr('btn.cancel') : tr('btn.disarm'))
  const btnCls = view === 'off' ? 'dsp-btn dsp-btn-primary' : view === 'fire' ? 'dsp-btn dsp-btn-danger' : 'dsp-btn'
  const btn = `<button class="${btnCls}">${esc(btnLabel)}</button>`
  const inner = c.folded ? '' : bodyHtml(c) + `<div class="dsp-cbtns">${btn}</div><div class="dsp-hazard"></div>`
  const floatLabel = esc(tr('card.float'))
  return `<div class="${cls}" data-state="${view}" data-variant="${variant}" data-lum="${c.lum || 'dark'}" data-retry="${c.retry ? '1' : '0'}">
    <div class="dsp-hrow">
      <div class="dsp-chead" role="button" tabindex="0"><i class="dsp-live"></i><span class="dsp-ctitle">${esc(tr('app.title'))}</span>
        <span class="dsp-tag">${esc(tag)}</span>${CHEV}</div>
      <button type="button" class="dsp-float" title="${floatLabel}" aria-label="${floatLabel}">${FLOAT_ICON}</button>
    </div>${inner}</div>`
}

// ---------------------------------------------------------------- page chrome
const BASE_CSS = `
body{margin:0;background:#0f0f0e;color:#faf9f5;font-family:'Inter',system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
.page{padding:34px 38px 40px}
.h1{font-size:19px;font-weight:650;letter-spacing:-.01em;margin:0 0 4px}
.sub{font-size:12.5px;color:#8b887e;margin:0 0 26px}
.grid{display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start}
.cell{display:flex;flex-direction:column;gap:9px}
.cap{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:#7d7b72}
.frame{width:264px;background:#1a1a19;border-radius:14px;padding:10px}
.frame.light{background:#f6f6f4}
.sechead{font-size:12px;font-weight:600;color:#b0aea5;margin:34px 0 14px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08)}
.sechead:first-of-type{margin-top:0;padding-top:0;border-top:0}
`

// a sidebar mock so the card is seen in its real place
const SIDEBAR_CSS = `
.sb{width:264px;background:#141413;border-radius:14px;padding:10px 8px 14px;display:flex;flex-direction:column;gap:2px}
.sb-top{display:flex;align-items:center;gap:8px;padding:6px 8px 12px;font-size:14px;font-weight:650}
.sb-badge{font-size:9px;font-weight:700;letter-spacing:.06em;padding:2px 5px;border-radius:4px;background:#2a2a28;color:#b0aea5}
.sb-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;font-size:13px;color:#c9c7be}
.sb-row svg{opacity:.75;flex:0 0 16px}
.sb-row.on{background:rgba(255,255,255,.07);color:#faf9f5}
.sb-gap{height:8px}
.sb-sect{font-size:11.5px;color:#7d7b72;padding:10px 8px 4px;letter-spacing:.04em}
.sb-sess{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;font-size:12.5px;color:#b0aea5}
.sb-sess i{width:6px;height:6px;border-radius:50%;background:#5f5d57;flex:0 0 6px}
.sb-sess .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-sess .tm{font-size:10.5px;color:#6b6963}
`

const ICON = {
  chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  board: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  plug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v6M8 9h8v4a4 4 0 0 1-8 0V9zM12 17v4"/></svg>',
  skill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3z"/></svg>',
}

function sidebar(cardHtml, opts = {}) {
  return `<div class="sb">
    <div class="sb-top"><span>deepseek</span><span class="sb-badge">HARNESS</span></div>
    <div class="sb-row">${ICON.chat}<span>${esc(D('navNew'))}</span></div>
    <div class="sb-row">${ICON.board}<span>${esc(D('navBoard'))}</span></div>
    <div class="sb-row">${ICON.plug}<span>${esc(D('navPlugins'))}</span></div>
    <div class="sb-row">${ICON.skill}<span>${esc(D('navSkills'))}</span></div>
    <div class="sb-gap"></div>
    ${cardHtml}
    <div class="sb-gap"></div>
    <div class="sb-sess"><i></i><span class="nm">${esc(opts.s1 || D('sess1'))}</span><span class="tm">${esc(D('time1'))}</span></div>
    <div class="sb-sess"><i></i><span class="nm">${esc(opts.s2 || D('sess2'))}</span><span class="tm">${esc(D('time2'))}</span></div>
  </div>`
}

// ---------------------------------------------------------------- settings
// 分组图标：与 lib/client.js 的 GROUP_ICONS 同一组 path（15px、stroke 1.9）。
const SICON = {
  look: ['M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4', 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'],
  prof: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'],
  rule: ['M12 3.5 19 6.5v5.2c0 3.9-2.9 6.9-7 8.8-4.1-1.9-7-4.9-7-8.8V6.5z', 'M9 12l2.1 2.1L15.4 10'],
  watch: ['M20 14.6A8.6 8.6 0 1 1 9.4 4a6.9 6.9 0 0 0 10.6 10.6z'],
  notify: ['M18 15.5H6l1.4-2.1V9a4.6 4.6 0 0 1 9.2 0v4.4z', 'M10 18.5a2 2 0 0 0 4 0'],
  status: ['M3 12h4l2 5 3-10 2 5h5'],
}
const sicon = (name) => {
  const paths = SICON[name]
  if (!paths) return ''
  return `<svg class="dsp-sicon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`
}
const group = (icon, title, note) => `<div class="dsp-sgroup" role="heading" aria-level="3">${sicon(icon)}<span class="dsp-sgroup-title">${esc(title)}</span>${note ? `<span class="dsp-sgroup-note">${esc(note)}</span>` : ''}</div>`

function row(title, desc, control, extra = '') {
  return `<div class="dsp-srow${extra ? ' ' + extra : ''}"><div class="dsp-srow-text">
    <span class="dsp-stitle">${esc(title)}</span>${desc ? `<span class="dsp-sdesc">${esc(desc)}</span>` : ''}
    </div>${control || ''}</div>`
}
const seg = (items, on) => `<div class="dsp-seg">${items.map((t, i) => `<button class="dsp-segbtn${i === on ? ' on' : ''}">${esc(t)}</button>`).join('')}</div>`
const sw = (on, off) => `<button class="dsp-switch${on ? ' on' : ''}"${off ? ' disabled' : ''}><i></i></button>`
const val = (text, style = '') => `<span class="dsp-sval"${style ? ` style="${style}"` : ''}>${esc(text)}</span>`

// 一个配置行：默认配置只有秒数；自定义配置还有 设为默认 / 重命名 / 删除。
function profileRow(name, sec, opts = {}) {
  const isActive = !!opts.active
  const actions = opts.default
    ? val(tr('set.prof.sec', { n: sec }))
    : `${val(tr('set.prof.sec', { n: sec }))}
       <button class="dsp-sbtn">${esc(tr('set.prof.setDefault'))}</button>
       <button class="dsp-sbtn">${esc(tr('set.prof.rename'))}</button>
       <button class="dsp-sbtn">${esc(tr('set.prof.del'))}</button>`
  return `<div class="dsp-srow dsp-srow-prof${isActive ? ' is-active' : ''}"><div class="dsp-srow-text">
    <span class="dsp-stitle">${esc(name)}${isActive ? `<span class="dsp-badge">${esc(tr('set.prof.active'))}</span>` : ''}</span>
    </div><div class="dsp-prof-actions">${actions}</div></div>`
}

// 事件流水是演示内容，三语各自成套（见 DEMO）。
const eventsFor = () => [
  ['12:07:41', 'afk', D('ev1')],
  ['12:07:12', 'skip', D('ev2')],
  ['12:06:58', 'config', D('ev3')],
  ['12:06:31', 'info', D('ev4')],
]
const evlog = () => `<div class="dsp-evlog">${eventsFor().map(([t, k, s]) => `<div class="dsp-ev dsp-ev-${k}">
  <span class="dsp-ev-time">${t}</span><span class="dsp-ev-text">${esc(s)}</span></div>`).join('')}</div>`

// 六组：外观 / 配置 / 判定与关机 / 守夜行为 / 通知 / 状态
function settingsPanel(opts = {}) {
  const variant = opts.variant ?? 0
  return `<div class="dsp-settings">
    <div class="dsp-sgroup-box">
      ${group('look', tr('set.look'))}
      ${row(tr('set.variant'), '', seg(['A', 'B', 'C'], variant))}
      ${variant === 2 ? row(tr('set.led'), tr('set.led.desc'), '', 'dsp-srow-stack') : ''}
      ${row(tr('set.theme'), '', seg([tr('theme.auto'), tr('theme.dark'), tr('theme.light'), tr('theme.claude')], opts.theme ?? 0))}
      ${row(tr('set.fold'), '', sw(false))}
      ${row(tr('set.compact'), '', sw(true))}
      ${row(tr('set.lang'), '', seg([tr('lang.auto'), tr('lang.zh'), tr('lang.en'), tr('lang.ru')], opts.lang ?? 0))}
    </div>
    <div class="dsp-sgroup-box">
      ${group('prof', tr('set.prof.group'))}
      ${row(tr('set.pick'), tr('set.prof.current', { label: D('profName', { n: 3 }), sec: 120 }), '', 'dsp-srow-plain')}
      ${profileRow(tr('set.default'), 60, { default: true })}
      ${profileRow(D('profName', { n: 1 }), 90)}
      ${profileRow(D('profName', { n: 2 }), 120)}
      ${profileRow(D('profName', { n: 3 }), 120, { active: true })}
      <div class="dsp-srow dsp-srow-new"><div class="dsp-srow-text"></div><button class="dsp-sbtn">${esc(tr('set.prof.new'))}</button></div>
    </div>
    <div class="dsp-sgroup-box">
      ${group('rule', tr('set.when'))}
      ${row(tr('set.custom'), '', sw(true))}
      ${row(tr('set.bottom'), tr('set.bottom.desc'), val(tr('set.always')), 'dsp-srow-ro')}
      ${row(tr('set.jobs'), tr('set.jobs.desc'), sw(true))}
      ${row(tr('set.err'), tr('set.err.desc'), sw(false))}
      ${row(tr('set.cd'), tr('set.cd.desc'), seg([tr('cd.30'), tr('cd.60'), tr('cd.120'), tr('cd.300')], 2))}
    </div>
    <div class="dsp-sgroup-box">
      ${group('watch', tr('set.watch'))}
      ${row(tr('set.afk'), tr('set.afk.desc'), sw(true))}
    </div>
    <div class="dsp-sgroup-box">
      ${group('notify', tr('set.notify.group'))}
      ${row(tr('set.notify'), tr('set.notify.desc'), sw(true))}
      ${row(tr('set.notify.countdown'), '', sw(true), 'dsp-srow-sub')}
      ${row(tr('set.notify.fired'), '', sw(true), 'dsp-srow-sub')}
      ${row(tr('set.notify.blocked'), '', sw(true), 'dsp-srow-sub')}
      ${row(tr('set.notify.recovered'), '', sw(false), 'dsp-srow-sub')}
    </div>
    <div class="dsp-sgroup-box">
      ${group('status', tr('set.status'))}
      ${row(tr('set.blocked'), tr('set.blocked.waiting'), val(tr('hud.state.retrying') + ' · ' + tr('hud.retry', { n: 1 }), 'color:#6f8f7a'), 'dsp-srow-stack')}
      ${row(tr('set.skip'), '', val(D('skipLine')), 'dsp-srow-stack')}
      ${row(tr('set.events'), tr('set.events.desc', { n: 4 }), evlog(), 'dsp-srow-stack')}
    </div>
  </div>`
}

// ---------------------------------------------------------------- pages
function page(title, sub, inner, extraCss = '') {
  return `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}${SIDEBAR_CSS}${extraCss}\n${CSS}</style></head><body><div class="page">
<div class="h1">${esc(title)}</div><div class="sub">${esc(sub)}</div>${inner}</div></body></html>`
}

// ---------------------------------------------------------------- one image per state
// The release page wants individual pictures, not contact sheets: every entry
// below renders exactly one card (or one panel) on its own canvas, so the
// filename doubles as the image caption and nothing is cropped by its
// neighbours.
const single = (inner, extra = '') => `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8">
<style>${BASE_CSS}${SIDEBAR_CSS}body{display:inline-block;background:transparent}
.wrap{padding:16px}.bare .frame{background:transparent;padding:0;width:280px}</style>
<style>${extra}</style><style>${CSS}</style></head><body><div class="wrap bare">${inner}</div></body></html>`

const frame = (html, cls = '') => `<div class="frame ${cls}">${html}</div>`
const cardOnly = (c) => single(frame(card(c)))

// 主图矩阵用：同一张卡按主题出浅/深两版。浅色走 `lum:'light'`（卡片自带的
// 浅色配色）+ `.frame.light`（外框底色）；与 14-light 同一套写法。
const themedCard = (c, theme) => single(frame(card({ ...c, lum: theme === 'light' ? 'light' : 'dark' }), theme === 'light' ? 'light' : ''))

// Claude 档不再有静态调色板：运行时由 resolveClaudePaint() 读 dsh-claude-style
// 暴露在 :root/body 上的 CSS 变量，再换算成卡片的 --dsp-*。纯静态渲染没有那个
// 插件，所以这里把「真实样本里的变量值 + 同一套换算」显式注入，图和产品一致。
// 换算规则照 lib/client.js：bg=bg-layer-1、fg=label-primary、muted=label-secondary、
// line=divider、accent=apex、danger=state-error-primary、track=hover-bg、
// tape-a=accent 85% + 黑、tape-b=danger、accent-ink=对 accent 对比度更高的黑/白。
const CLAUDE_PALETTES = {
  light: {
    vars: {
      '--dsw-alias-label-primary': '#161616',
      '--dsw-alias-label-secondary': '#6b6b6b',
      '--dsw-alias-bg-layer-1': '#ffffff',
      '--dsw-alias-border-l1': 'rgba(22,22,22,.08)',
      '--dsw-alias-brand-primary': '#d97757',
      '--dsw-alias-state-error-primary': '#ec1313',
      '--dsh-claude-apex': '#d97757',
      '--dsh-claude-divider': 'rgba(22,22,22,.05)',
      '--dsh-claude-hover-bg': 'rgba(22,22,22,.04)',
    },
    card: '--dsp-bg:#ffffff;--dsp-fg:#161616;--dsp-muted:#6b6b6b;--dsp-line:rgba(22,22,22,.05);' +
      '--dsp-accent:#d97757;--dsp-danger:#ec1313;--dsp-track:rgba(22,22,22,.04);' +
      '--dsp-tape-a:#b8654a;--dsp-tape-b:#ec1313;--dsp-accent-ink:#1a1200',
  },
  dark: {
    vars: {
      '--dsw-alias-label-primary': '#fdfdfd',
      '--dsw-alias-label-secondary': '#a3a3a3',
      '--dsw-alias-bg-layer-1': '#212121',
      '--dsw-alias-border-l1': 'rgba(255,255,255,.12)',
      '--dsw-alias-brand-primary': '#d97757',
      '--dsw-alias-state-error-primary': '#f25a5a',
      '--dsh-claude-apex': '#d97757',
      '--dsh-claude-divider': 'rgba(255,255,255,.08)',
      '--dsh-claude-hover-bg': 'rgba(255,255,255,.06)',
    },
    card: '--dsp-bg:#212121;--dsp-fg:#fdfdfd;--dsp-muted:#a3a3a3;--dsp-line:rgba(255,255,255,.08);' +
      '--dsp-accent:#d97757;--dsp-danger:#f25a5a;--dsp-track:rgba(255,255,255,.06);' +
      '--dsp-tape-a:#b8654a;--dsp-tape-b:#f25a5a;--dsp-accent-ink:#1a1200',
  },
}

function claudeShot(view, theme) {
  const p = CLAUDE_PALETTES[theme]
  const rootVars = Object.entries(p.vars).map(([k, v]) => `${k}:${v}`).join(';')
  const css = `:root{${rootVars}}.dsp-card.dsp-claude{${p.card}}`
  return single(frame(card({ view, variant: 'A', claude: true })), css)
}

// 18 张主图：样式 A/B/C × 语言 zh/en/ru × 主题 浅/深。
// 排序按「样式 → 语言 → 主题」，文件名自带全部维度，排序即分组。
const MATRIX = { variants: ['a', 'b', 'c'], langs: LANGS, themes: ['light', 'dark'] }
function matrixShots(state = 'armed') {
  const out = {}
  let n = 0
  for (const variant of MATRIX.variants) {
    for (const lang of MATRIX.langs) {
      for (const theme of MATRIX.themes) {
        n += 1
        const id = String(n).padStart(2, '0')
        const name = `${id}-${state}-${variant}-${lang}-${theme}`
        out[name] = { lang, html: () => themedCard({ view: state, variant: variant.toUpperCase() }, theme) }
      }
    }
  }
  return out
}

// No `.frame` here: it is 280px wide, and the sidebar is 264px, so wrapping the
// card in one made it bleed past the sidebar edges.
const sidebarOnly = (c) => single(`<div style="padding:8px">${sidebar(card(c))}</div>`)

// 每次切换语言都要按当前 LANG 重新生成一遍（文案在生成时求值）。
const shotDefs = {
  // 1-5: the five running states, one picture each
  '01-off': () => cardOnly({ view: 'off', variant: 'A' }),
  '02-armed': () => cardOnly({ view: 'armed', variant: 'A' }),
  '03-hold': () => cardOnly({ view: 'hold', variant: 'A' }),
  '04-fire': () => cardOnly({ view: 'fire', variant: 'A' }),
  '05-fired': () => cardOnly({ view: 'fired', variant: 'A' }),

  // 6-7: the other two skins
  '06-variant-b-radar': () => cardOnly({ view: 'armed', variant: 'B' }),
  '07-variant-c-terminal': () => cardOnly({ view: 'armed', variant: 'C' }),

  // 8-9: blocked, halted vs waiting
  '08-blocked-halted': () => cardOnly({ view: 'blocked', variant: 'A', big: D('haltedBig'), meta: D('haltedMeta'), btn: D('haltedBtn') }),
  '09-blocked-waiting': () => cardOnly({ view: 'blocked', variant: 'A', retry: true, big: D('waitingBig'), meta: D('waitingMeta') }),

  // 10-11: the card where it actually lives
  '10-sidebar-hold': () => sidebarOnly({ view: 'hold', variant: 'A' }),
  '11-sidebar-fire': () => sidebarOnly({ view: 'fire', variant: 'A' }),

  // 12-13: settings, dark and light
  '12-settings-dark': () => single(`<div style="background:#1a1a19;border-radius:14px;padding:6px 20px 16px;width:560px">${settingsPanel()}</div>`),
  '13-settings-light': () => single(`<div class="theme-light" style="background:#fff;color:#1b2030;border-radius:14px;padding:6px 20px 16px;width:560px;--dsp-fg:#1b2030;--dsp-muted:#5b6472;--dsp-line:rgba(0,0,0,.15);--dsp-accent:#e08f13;--dsp-danger:#d92d20;--dsp-track:rgba(0,0,0,.13);--dsw-alias-label-primary:#1b2030;--dsw-alias-label-secondary:#3d4859;--dsw-alias-label-tertiary:#5b6472;--dsw-alias-border-l2:rgba(0,0,0,.12);--dsw-alias-border-l3:rgba(0,0,0,.18);--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-button-primary-fill:#e08f13">${settingsPanel({ theme: 2 })}</div>`),

  // 14-15: light and Claude palettes
  '14-light': () => single(frame(card({ view: 'armed', variant: 'A', lum: 'light' }), 'light')),
  '15-claude': () => claudeShot('off', 'light'),
  '15-claude-dark': () => claudeShot('off', 'dark'),

  // 16: folded
  '16-folded': () => cardOnly({ view: 'armed', variant: 'A', folded: true }),
}

// 设置面板里的外观缩略图：A/B/C × zh/en/ru × 浅/深 = 18 张，armed 态。
// 卡片里有文案（待命 / Armed / Взведено）与卡面底色，所以颜色和语言都必须真渲染，
// 不能靠 CSS 反色。`cardOnly` 的 ink 就是卡片本体（`.bare .frame` 透明、零内边距），
// 截图脚本 Trim 之后没有多余留白。
function thumbShots() {
  const out = {}
  for (const [key, variant] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {
    for (const lang of LANGS) {
      for (const theme of ['light', 'dark']) {
        out['thumb-' + key + '-' + lang + '-' + theme] = {
          lang,
          html: () => themedCard({ view: 'armed', variant }, theme),
        }
      }
    }
  }
  return out
}


// 只在需要时执行 thunk：--only 过滤掉未选的页面，避免某页文案漂移拖垮整批。
function buildShots(only = []) {
  const out = {}
  for (const [name, make] of Object.entries(shotDefs)) {
    if (only.length && !only.some((o) => name.includes(o))) continue
    out[name] = make()
  }
  return out
}

if (require.main === module) {
  // 用法（全部从仓库根跑）：
  //   node scripts/gen-gallery.cjs                      中文一套，沿用 02-armed.html 这类原名
  //   node scripts/gen-gallery.cjs --lang all           zh/en/ru 各一套（02-armed.en.html）
  //   node scripts/gen-gallery.cjs --lang ru            只出俄语
  //   node scripts/gen-gallery.cjs --matrix             18 张主图：A/B/C × zh/en/ru × 浅/深
  //   node scripts/gen-gallery.cjs --matrix --state off 换主图状态（默认 armed）
  //   node scripts/gen-gallery.cjs --thumbs             18 张设置页缩略图：A/B/C × zh/en/ru × 浅/深
  //   node scripts/gen-gallery.cjs --only 02-armed      只生成名字含该子串的页（可重复）
  // 之后统一跑 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1`
  // （可用 -Filter '01-*.html' 只渲一批）。
  const argv = process.argv.slice(2)
  const val = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null)
  const langArg = val('--lang')
  const state = val('--state') || 'armed'
  const only = []
  argv.forEach((a, i) => { if (a === '--only' && argv[i + 1]) only.push(argv[i + 1]) })

  const write = (name, html) => {
    const file = path.join(OUT, name + '.html')
    fs.writeFileSync(file, html)
    console.log('wrote', path.relative(root, file))
  }

  if (argv.includes('--matrix') || argv.includes('--thumbs')) {
    const matrix = argv.includes('--matrix')
    const shots = matrix ? matrixShots(state) : thumbShots()
    for (const [name, shot] of Object.entries(shots)) {
      if (only.length && !only.some((o) => name.includes(o))) continue
      setLang(shot.lang)
      write(name, shot.html())
    }
  } else {
    const jobs = langArg === 'all' ? LANGS : langArg ? [langArg] : [null]
    for (const lang of jobs) {
      if (lang) setLang(lang)
      const suffix = lang ? '.' + lang : ''
      for (const [name, html] of Object.entries(buildShots(only))) {
        write(name + suffix, html)
      }
    }
  }
}

// gen-banner.cjs reuses these so the banner is built from the same markup.
module.exports = { CSS, esc, card, sidebar, settingsPanel, single, frame, BASE_CSS, SIDEBAR_CSS, LANGS, setLang, buildShots, matrixShots, thumbShots }