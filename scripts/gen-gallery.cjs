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
// 图集沿用中文界面；README.en / README.ru 复用这同一组截图。
const LANG = 'zh'

function tr(key, vars) {
  const raw = MSG[LANG][key]
  if (raw === undefined) throw new Error('missing copy key: ' + key)
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
    <div class="sb-row">${ICON.chat}<span>新会话</span></div>
    <div class="sb-row">${ICON.board}<span>工作台</span></div>
    <div class="sb-row">${ICON.plug}<span>插件</span></div>
    <div class="sb-row">${ICON.skill}<span>技能中心</span></div>
    <div class="sb-gap"></div>
    ${cardHtml}
    <div class="sb-gap"></div>
    <div class="sb-sess"><i></i><span class="nm">${esc(opts.s1 || '重构关机插件')}</span><span class="tm">1 分钟</span></div>
    <div class="sb-sess"><i></i><span class="nm">${esc(opts.s2 || '周报数据整理')}</span><span class="tm">14 小时</span></div>
  </div>`
}

// ---------------------------------------------------------------- settings
function row(title, desc, control, extra = '') {
  return `<div class="dsp-srow${extra ? ' ' + extra : ''}"><div class="dsp-srow-text">
    <span class="dsp-stitle">${esc(title)}</span>${desc ? `<span class="dsp-sdesc">${esc(desc)}</span>` : ''}
    </div>${control || ''}</div>`
}
const seg = (items, on) => `<div class="dsp-seg">${items.map((t, i) => `<button class="dsp-segbtn${i === on ? ' on' : ''}">${t}</button>`).join('')}</div>`
const sw = (on, off) => `<button class="dsp-switch${on ? ' on' : ''}"${off ? ' disabled' : ''}><i></i></button>`
const slotbar = (active) => `<div class="dsp-slotbar">${Array.from({ length: 9 }, (_, i) => {
  const label = i === 0 ? '默认' : String(i)
  return `<button class="dsp-slotbtn${active === i ? ' on' : ''}${i > 0 && !active ? ' locked' : ''}">${label}</button>`
}).join('')}</div>`

const EVENTS = [
  ['12:07:41', 'afk', '外部服务暂不可用（RATE_LIMIT，策略 rate-limit）：请求过于频繁，等待自动重试（第 1 次，30 秒后重试）'],
  ['12:07:12', 'skip', '还有 2 个后台任务在运行，暂不关机（模式保持开启）'],
  ['12:06:58', 'config', '切换配置：自定义 3'],
  ['12:06:31', 'info', '已开启：任务完成后自动关机'],
]
const evlog = `<div class="dsp-evlog">${EVENTS.map(([t, k, s]) => `<div class="dsp-ev dsp-ev-${k}">
  <span class="dsp-ev-time">${t}</span><span class="dsp-ev-text">${esc(s)}</span></div>`).join('')}</div>`

function settingsPanel(opts = {}) {
  return `<div class="dsp-settings">
    <div class="dsp-sgroup-box">
      <div class="dsp-sgroup">${esc(tr('set.look'))}</div>
      ${row(tr('set.variant'), tr('set.variant.desc'), seg(['A', 'B', 'C'], opts.variant ?? 0))}
      ${row(tr('set.theme'), tr('set.theme.desc'), seg([tr('theme.auto'), tr('theme.dark'), tr('theme.light'), tr('theme.claude')], opts.theme ?? 0))}
      ${row(tr('set.fold'), tr('set.fold.desc'), sw(false))}
      ${row(tr('set.lang'), tr('set.lang.desc'), seg([tr('lang.auto'), tr('lang.zh'), tr('lang.en'), tr('lang.ru')], opts.lang ?? 0))}
    </div>
    <div class="dsp-sgroup-box">
      <div class="dsp-sgroup">${esc(tr('set.when'))}</div>
      ${row(tr('set.custom'), tr('set.custom.on'), sw(true))}
      ${row(tr('set.pick'), tr('set.pick.cur', { label: '自定义 3', sec: 120 }), slotbar(3))}
      ${row(tr('set.bottom'), tr('set.bottom.desc'), `<span class="dsp-sval">${esc(tr('set.always'))}</span>`, 'dsp-srow-ro')}
      ${row(tr('set.jobs'), tr('set.jobs.desc'), sw(true))}
      ${row(tr('set.err'), tr('set.err.desc'), sw(false))}
      ${row(tr('set.cd'), tr('set.cd.desc'), seg([tr('cd.30'), tr('cd.60'), tr('cd.120'), tr('cd.300')], 2))}
      ${row(tr('set.afk'), tr('set.afk.desc'), sw(true))}
    </div>
    <div class="dsp-sgroup-box">
      <div class="dsp-sgroup">${esc(tr('set.status'))}</div>
      ${row(tr('set.blocked'), tr('set.blocked.waiting'), `<span class="dsp-sval" style="color:#6f8f7a">${esc(tr('hud.state.retrying') + ' · ' + tr('hud.retry', { n: 1 }))}</span>`, 'dsp-srow-stack')}
      ${row(tr('set.skip'), '', `<span class="dsp-sval">还有 2 个后台任务在运行，暂不关机（模式保持开启）</span>`, 'dsp-srow-stack')}
      ${row(tr('set.events'), tr('set.events.desc', { n: 4 }), evlog, 'dsp-srow-stack')}
    </div>
  </div>`
}

// ---------------------------------------------------------------- pages
function page(title, sub, inner, extraCss = '') {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}${SIDEBAR_CSS}${extraCss}\n${CSS}</style></head><body><div class="page">
<div class="h1">${esc(title)}</div><div class="sub">${esc(sub)}</div>${inner}</div></body></html>`
}

// ---------------------------------------------------------------- one image per state
// The release page wants individual pictures, not contact sheets: every entry
// below renders exactly one card (or one panel) on its own canvas, so the
// filename doubles as the image caption and nothing is cropped by its
// neighbours.
const single = (inner, extra = '') => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${BASE_CSS}${SIDEBAR_CSS}body{display:inline-block;background:transparent}
.wrap{padding:16px}.bare .frame{background:transparent;padding:0;width:280px}</style>
<style>${extra}</style><style>${CSS}</style></head><body><div class="wrap bare">${inner}</div></body></html>`

const frame = (html, cls = '') => `<div class="frame ${cls}">${html}</div>`
const cardOnly = (c) => single(frame(card(c)))
// No `.frame` here: it is 280px wide, and the sidebar is 264px, so wrapping the
// card in one made it bleed past the sidebar edges.
const sidebarOnly = (c) => single(`<div style="padding:8px">${sidebar(card(c))}</div>`)

const shots = {
  // 1-5: the five running states, one picture each
  '01-off': cardOnly({ view: 'off', variant: 'A' }),
  '02-armed': cardOnly({ view: 'armed', variant: 'A' }),
  '03-hold': cardOnly({ view: 'hold', variant: 'A' }),
  '04-fire': cardOnly({ view: 'fire', variant: 'A' }),
  '05-fired': cardOnly({ view: 'fired', variant: 'A' }),

  // 6-7: the other two skins
  '06-variant-b-radar': cardOnly({ view: 'armed', variant: 'B' }),
  '07-variant-c-terminal': cardOnly({ view: 'armed', variant: 'C' }),

  // 8-9: blocked, halted vs waiting
  '08-blocked-halted': cardOnly({ view: 'blocked', variant: 'A', big: '已暂停', meta: '账户额度不足，需充值后解除', btn: '解除并重试' }),
  '09-blocked-waiting': cardOnly({ view: 'blocked', variant: 'A', retry: true, big: '等待恢复', meta: '请求过于频繁，30 秒后自动重试（第 1 次）' }),

  // 10-11: the card where it actually lives
  '10-sidebar-hold': sidebarOnly({ view: 'hold', variant: 'A' }),
  '11-sidebar-fire': sidebarOnly({ view: 'fire', variant: 'A' }),

  // 12-13: settings, dark and light
  '12-settings-dark': single(`<div style="background:#1a1a19;border-radius:14px;padding:6px 20px 16px;width:560px">${settingsPanel()}</div>`),
  '13-settings-light': single(`<div class="theme-light" style="background:#fff;color:#1b2030;border-radius:14px;padding:6px 20px 16px;width:560px;--dsp-fg:#1b2030;--dsp-muted:#5b6472;--dsp-line:rgba(0,0,0,.15);--dsp-accent:#e08f13;--dsp-danger:#d92d20;--dsp-track:rgba(0,0,0,.13);--dsw-alias-label-primary:#1b2030;--dsw-alias-label-secondary:#3d4859;--dsw-alias-label-tertiary:#5b6472;--dsw-alias-border-l2:rgba(0,0,0,.12);--dsw-alias-border-l3:rgba(0,0,0,.18);--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-button-primary-fill:#e08f13">${settingsPanel({ theme: 2 })}</div>`),

  // 14-15: light and Claude palettes
  '14-light': single(frame(card({ view: 'armed', variant: 'A', lum: 'light' }), 'light')),
  '15-claude': cardOnly({ view: 'fire', variant: 'A', claude: true }),

  // 16: folded
  '16-folded': cardOnly({ view: 'armed', variant: 'A', folded: true }),
}

if (require.main === module) {
  for (const [name, html] of Object.entries(shots)) {
    fs.writeFileSync(path.join(OUT, name + '.html'), html)
    console.log('wrote', path.relative(root, path.join(OUT, name + '.html')))
  }
}

// gen-banner.cjs reuses these so the banner is built from the same markup.
module.exports = { CSS, esc, card, sidebar, settingsPanel, single, frame, BASE_CSS, SIDEBAR_CSS }