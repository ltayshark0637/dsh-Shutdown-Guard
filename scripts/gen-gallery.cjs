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

// view: off | armed | hold | fire | fired | blocked
const A_TEXT = {
  off: ['未开启', '仅在点击「武装」后才会运行程序'],
  armed: ['待命', '所有任务已结束 · 等待下一次触发'],
  hold: ['等待后台任务', '2 个后台任务 · 3 个会话，完成后关机'],
  fire: ['00:42', '系统即将关机 · 可撤销'],
  fired: ['已下发', '关机指令已生效，无法取消'],
}
const TAG = { off: 'OFF', armed: 'ARMED', hold: 'WAIT', fire: 'FIRE', fired: 'FIRED' }

function bodyHtml(c) {
  if (c.variant === 'B') {
    const hud = c.view === 'blocked'
      ? `<b>${c.retry ? 'Retrying' : 'Paused'}</b><span>${esc(c.hudNote || (c.retry ? '第 2 次重试' : '需人工处理'))}</span>`
      : c.view === 'hold' ? '<b>Holding</b><span>jobs 2 · agent 3</span>'
        : c.view === 'fire' ? '<b>00:42</b><span>T-minus</span>'
          : c.view === 'fired' ? '<b>Fired</b><span>已下发</span>'
            : c.view === 'off' ? '<b>Offline</b><span>jobs 0 · agent 1</span>'
              : '<b>Standby</b><span>jobs 0 · agent 1</span>'
    return `<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">
      <div class="dsp-sweep"></div>
      <div class="dsp-rings"><svg class="dsp-radar-svg" viewBox="0 0 238 202">${RINGS}</svg></div>
      <div class="dsp-ping"></div>
      <div class="dsp-dots">${DOTS}</div>
      <div class="dsp-hud">${hud}</div></div></div>`
  }
  if (c.variant === 'C') {
    // Mirrors lib/client.js: line 2 is the live counts, line 3 is the phase.
    const jobs = c.view === 'off' ? 0 : 2
    const agent = c.view === 'off' ? 1 : 3
    const l2 = `jobs ${jobs} · agent ${agent}`
    const l3 = c.view === 'fire' ? 'T-minus 00:42'
      : c.view === 'hold' ? 'holding'
        : c.view === 'off' ? 'offline'
          : c.view === 'blocked' ? (c.retry ? 'retrying' : 'halted')
            : c.view === 'fired' ? 'done' : 'waiting'
    const lines = `<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>
      <div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2">${l2}</span></div>
      <div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3">${l3}</span><i class="dsp-caret"></i></div>`
    const ledState = [c.view !== 'off', true, agent === 0, jobs === 0, true, c.view === 'fire']
    const led = [0, 1, 2, 3, 4, 5].map((i) => `<i class="dsp-led-seg${ledState[i] ? ' on' : ''}" data-i="${i}"></i>`).join('')
    const code = c.view === 'blocked'
      ? (c.retry ? 'waiting · 自动重试' : 'halted · 需人工处理')
      : `条件 ${ledState.filter(Boolean).length}/6 已满足`
    return `<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">${lines}</div>
      <div class="dsp-led">${led}</div><div class="dsp-code">${code}</div></div>`
  }
  const [big, meta] = c.view === 'blocked'
    ? [c.big || '已暂停', c.meta || '等待外部条件恢复']
    : A_TEXT[c.view]
  return `<div class="dsp-cbody dsp-v-a"><div class="dsp-big">${esc(big)}</div><div class="dsp-meta">${esc(meta)}</div></div>`
}

function card(c) {
  const variant = c.variant || 'A'
  const view = c.view || 'armed'
  const tag = view === 'blocked' ? (c.retry ? 'RETRY' : 'PAUSED') : TAG[view]
  const cls = ['dsp-card', c.folded && 'is-folded', c.claude && 'dsp-claude'].filter(Boolean).join(' ')
  const btn = view === 'off'
    ? '<button class="dsp-btn dsp-btn-primary">武装</button>'
    : view === 'fire'
      ? '<button class="dsp-btn dsp-btn-danger">取消关机</button>'
      : view === 'blocked'
        ? `<button class="dsp-btn">${esc(c.btn || '解除')}</button>`
        : '<button class="dsp-btn dsp-btn-danger">解除</button>'
  const inner = c.folded ? '' : bodyHtml(c) + `<div class="dsp-cbtns">${btn}</div><div class="dsp-hazard"></div>`
  return `<div class="${cls}" data-state="${view}" data-variant="${variant}" data-lum="${c.lum || 'dark'}" data-retry="${c.retry ? '1' : '0'}">
    <div class="dsp-chead"><i class="dsp-live"></i><span class="dsp-ctitle">任务完成后关机</span>
      <span class="dsp-tag">${tag}</span>${CHEV}</div>${inner}</div>`
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
      <div class="dsp-sgroup">外观</div>
      ${row('卡片外观', '三种外观共用同一套判定逻辑。', seg(['A', 'B', 'C'], opts.variant ?? 0))}
      ${row('配色', '跟随系统时按当前主题自动取深色或浅色。', seg(['跟随', '深色', '浅色', 'Claude'], opts.theme ?? 0))}
      ${row('默认折叠', '折叠后只保留标题和状态。', sw(false))}
    </div>
    <div class="dsp-sgroup-box">
      <div class="dsp-sgroup">何时关机</div>
      ${row('自定义配置', '正在使用自定义配置，默认配置暂时挂起。', sw(true))}
      ${row('选择配置', '当前：自定义 3（120 秒）', slotbar(3))}
      ${row('会话都停下来', '底线条件，始终开启。', '<span class="dsp-sval">总是开启</span>', 'dsp-srow-ro')}
      ${row('后台任务跑完', '有后台任务在跑时，先不下发关机指令。', sw(true))}
      ${row('有会话报错就跳过这一轮', '只认成功的任务，出过错的批次不关机。', sw(false))}
      ${row('倒计时时长', '关机前留出的取消时间，10–600 秒。', seg(['30s', '60s', '2min', '5min'], 2))}
      ${row('AFK 自动回答', '武装后 agent 若向你提问，自动代为回复：告知你处于 AFK、先完成已交代的任务、汇总报告并落盘，不碰未交代的分支。回复不会替你选中任何选项，关闭后提问照常弹给你。', sw(true))}
    </div>
    <div class="dsp-sgroup-box">
      <div class="dsp-sgroup">状态</div>
      ${row('当前阻断', '外部服务暂时不可用，插件会按策略自动重试。', '<span class="dsp-sval" style="color:#6f8f7a">等待 · 第 1 次重试</span>', 'dsp-srow-stack')}
      ${row('上次为什么没关机', '', '<span class="dsp-sval">还有 2 个后台任务在运行，暂不关机（模式保持开启）</span>', 'dsp-srow-stack')}
      ${row('事件日志', '最近 4 条，完整记录在插件 data/events.log。', evlog, 'dsp-srow-stack')}
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
const sidebarOnly = (c) => single(`<div style="padding:8px">${sidebar(frame(card(c)))}</div>`)

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