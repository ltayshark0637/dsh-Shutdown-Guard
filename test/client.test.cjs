// Structure + radar smoke test for lib/client.js.
// The card is a plain DOM node mounted into the sidebar region; only the
// settings section is a React component. This test runs the real bundle
// against a ~150-line fake DOM (no dependencies): enough of createElement,
// innerHTML, querySelector/classList for paint() to build the variant-B card
// and for the radar dots to be counted.
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')

// --- fake DOM ---------------------------------------------------------------
class ClassList {
  constructor(el) { this.el = el }
  _tokens() { return String(this.el.attrs.class || '').split(/\s+/).filter(Boolean) }
  _write(list) { this.el.attrs.class = list.join(' ') }
  add(...names) { const t = this._tokens(); for (const n of names) if (!t.includes(n)) t.push(n); this._write(t) }
  remove(...names) { this._write(this._tokens().filter((n) => !names.includes(n))) }
  contains(name) { return this._tokens().includes(name) }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force
    if (on) this.add(name); else this.remove(name)
    return on
  }
}

function makeStyle() {
  const props = {}
  return {
    _cssText: '',
    get cssText() { return this._cssText },
    // probeRgb() writes `background:<value>` through cssText, so the fake
    // computed style has to see it.
    set cssText(v) {
      this._cssText = String(v)
      const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(this._cssText)
      if (m) props.background = m[1].trim()
    },
    get backgroundColor() { return props.background || '' },
    setProperty(k, v) { props[k] = String(v) },
    removeProperty(k) { delete props[k] },
    getPropertyValue(k) { return props[k] || '' },
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase()
    this.attrs = {}
    this.children = []
    this.parentNode = null
    this._listeners = {}
    this._text = ''
    this._html = ''
    this.style = makeStyle()
    this.classList = new ClassList(this)
  }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = String(v) }
  get firstChild() { return this.children[0] || null }
  get isConnected() { return true }
  setAttribute(name, value) { this.attrs[name] = String(value == null ? '' : value) }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) }
  removeAttribute(name) { delete this.attrs[name] }
  get textContent() {
    return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = [] }
  get innerHTML() { return this._html }
  set innerHTML(html) {
    this._html = String(html)
    this._text = ''
    this.children = []
    parseHTML(this._html, this)
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }
  insertBefore(child, ref) {
    child.parentNode = this
    const i = ref ? this.children.indexOf(ref) : -1
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child)
    return child
  }
  replaceChild(next, old) {
    const i = this.children.indexOf(old)
    if (i < 0) return old
    next.parentNode = this
    this.children[i] = next
    return old
  }
  remove() {
    if (!this.parentNode) return
    const i = this.parentNode.children.indexOf(this)
    if (i >= 0) this.parentNode.children.splice(i, 1)
    this.parentNode = null
  }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn) }
  removeEventListener(type, fn) {
    const list = this._listeners[type]
    if (!list) return
    this._listeners[type] = list.filter((f) => f !== fn)
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 } }
  focus() { try { document.activeElement = this } catch { /* document wiring comes later */ } }
  querySelector(sel) { return descendants(this).find((n) => matchSimple(n, sel)) || null }
  querySelectorAll(sel) { return descendants(this).filter((n) => matchSimple(n, sel)) }
}

function descendants(root, out) {
  out = out || []
  for (const c of root.children || []) {
    if (typeof c === 'string') continue
    out.push(c)
    descendants(c, out)
  }
  return out
}

// Minimal selector support: tag, .class, [attr], [attr="v"], [attr*="v"] and
// descendant combinations (the selectors paint() and the mount path use).
function matchSimple(node, sel) {
  const parts = sel.trim().split(/\s+/)
  if (parts.length > 1) {
    // Descendant selector: match the tail inside any match of the head.
    const head = parts[0]
    const tail = parts.slice(1).join(' ')
    if (!matchSimple(node, head)) return false
    return descendants(node).some((n) => matchSimple(n, tail))
  }
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(sel)
  const tag = tagMatch ? tagMatch[0].toLowerCase() : null
  if (tag && node.tagName !== tag) return false
  const rest = sel.slice(tagMatch ? tagMatch[0].length : 0)
  const token = /\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g
  let m
  while ((m = token.exec(rest))) {
    if (m[1]) {
      if (!node.classList.contains(m[1])) return false
    } else {
      const name = m[2]
      if (!node.hasAttribute(name)) return false
      if (m[3]) {
        const want = m[4]
        const got = String(node.getAttribute(name))
        if (m[3] === '=' && got !== want) return false
        if (m[3] === '*=' && got.indexOf(want) < 0) return false
        if (m[3] === '^=' && got.indexOf(want) !== 0) return false
        if (m[3] === '$=' && got.slice(-want.length) !== want) return false
      }
    }
  }
  return true
}

function parseHTML(html, parent) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g
  let cur = parent
  let last = 0
  let m
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index)
    if (text) cur.children.push(text)
    if (m[1]) {
      if (cur !== parent) cur = cur.parentNode
    } else {
      const el = new El(m[2])
      const attrs = m[3] || ''
      const ar = /([\w:-]+)(?:="([^"]*)")?/g
      let a
      while ((a = ar.exec(attrs))) el.setAttribute(a[1], a[2] === undefined ? '' : a[2])
      cur.appendChild(el)
      if (!m[4]) cur = el
    }
    last = re.lastIndex
  }
  const tail = html.slice(last)
  if (tail) cur.children.push(tail)
}

const region = new El('div')
region.setAttribute('class', 'regionArea')
const document = {
  head: new El('head'),
  body: new El('body'),
  documentElement: new El('html'),
  createElement: (tag) => new El(tag),
  querySelector(sel) { return matchSimple(region, sel) ? region : this.body.querySelector(sel) },
  querySelectorAll(sel) { return this.body.querySelectorAll(sel) },
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn) },
  removeEventListener(type, fn) {
    if (!this._listeners[type]) return
    this._listeners[type] = this._listeners[type].filter((f) => f !== fn)
  },
  activeElement: null,
}
document.body.appendChild(region)

const styleStub = { backgroundColor: 'rgb(20,20,20)', getPropertyValue: () => '' }
const window = {
  addEventListener() {}, removeEventListener() {}, open() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => styleStub,
  __ModuleLoader__: { load(opts) { global.__captured = opts } },
}

const state = {
  armed: false, state: 'idle', deadline: 0, countdownSec: 60,
  erroredCount: 0, lastSkip: null, runningCount: 0, rootsCount: 1,
  agentTotal: 3, agentRunningTotal: 2,
  jobsRunning: 0, jobsTotal: 0,
  lang: 'zh', language: 'zh',
  ui: { variant: 'B', folded: false, theme: 'auto', compact: true },
  // Custom profiles on: the fixture then covers the real path where the
  // profiles group is part of the settings tree.
  customEnabled: true,
  activeProfileId: 'default',
}

let fetchCount = 0
global.fetch = async () => { fetchCount++; return { ok: true, json: async () => state } }
const intervals = []
global.setInterval = (fn) => { intervals.push(fn); return intervals.length }
global.clearInterval = (id) => { if (id) intervals[id - 1] = null }
global.localStorage = {
  // Variant B owns the radar, and the real card restores it before the first
  // paint. (The /state adoption path is gated by a 1.5s UI grace period.)
  getItem: (key) => (key === 'dsh-shutdown-guard.variant' ? 'B' : null),
  setItem: () => {},
}
global.document = document
global.window = window
global.getComputedStyle = window.getComputedStyle
global.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
global.requestAnimationFrame = () => 0

require(path.join(__dirname, '..', 'lib', 'client.js'))
assert.strictEqual(global.__captured.id, 'dsh-shutdown-guard')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useSyncExternalStore: (subscribe, get) => { subscribe(() => {}); return get() },
}
const mod = global.__captured.factory((name) => { assert.strictEqual(name, 'react'); return React })

const slots = {}
const ctx = {
  effect(fn) { fn() },
  slots: { inject(name, fn) { fn() }, register(entry, render) { slots[entry.name] = { entry, render } } },
}
mod.apply(ctx)

assert.ok(!slots['sidebar.workspaces'], 'must NOT shadow the single workspaces slot')
assert.ok(slots['settings.section'], 'settings section registered')
assert.strictEqual(slots['settings.section'].entry.id, 'shutdown-panel-settings')
assert.strictEqual(slots['settings.section'].entry.order, 40)
assert.deepStrictEqual(mod.inject, ['slots'])
assert.strictEqual(mod.name, 'dsh-shutdown-guard')

// The client bundle carries its own zh/en/ru table; read it instead of
// hard-coding the expected aria string in the test.
function readClientMsg() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  const marker = 'var MSG = '
  const start = src.indexOf(marker) + marker.length
  assert.ok(start > marker.length - 1, 'var MSG is present in client.js')
  let i = src.indexOf('{', start)
  let depth = 0
  let quote = ''
  for (; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) break
  }
  return vm.runInNewContext('(' + src.slice(src.indexOf('{', start), i + 1) + ')')
}
const clientText = readClientMsg()

// --- settings section renders with profiles + events -------------------------
function flat(node, out) {
  if (node == null || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((n) => flat(n, out)); return out }
  if (node.children) node.children.forEach((n) => flat(n, out))
  return out
}

const calls = ['client-bundle-smoke']
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }
const cardEl = () => region.querySelector('.dsp-card')
async function repaint() {
  fetchCount = 0
  for (const fn of intervals.slice()) if (fn) fn()
  await settle()
}

void (async () => {
  // Wait for the first /state round trip and the variant-B card.
  let dots = null
  for (let i = 0; i < 50 && !dots; i++) {
    await settle(2)
    const card = cardEl()
    if (card) dots = card.querySelector('.dsp-dots')
  }
  assert.ok(dots, 'variant B card with radar dots is mounted')

  // 1. Run dots follow the full agent total, not the root-only runningCount.
  assert.strictEqual(state.agentRunningTotal, 2)
  assert.strictEqual(dots.querySelectorAll('.dsp-rdot-run').length, 2, 'two running agents light two run dots')
  assert.notStrictEqual(dots.querySelectorAll('.dsp-rdot-run').length, 1, 'the old root-only count would have lit one dot')
  {
    const expected = clientText.zh['radar.aria'].replace('{total}', '3').replace('{running}', '2')
    assert.strictEqual(dots.getAttribute('aria-label'), expected, 'radar aria names total and running agents')
    calls.push('radar-dots-aria-ok')
  }
  calls.push('radar-dots-agent-total-ok')

  // 2. rootsCount is not the source: bumping it to 5 changes nothing.
  state.rootsCount = 5
  await repaint()
  dots = cardEl().querySelector('.dsp-dots')
  assert.strictEqual(dots.querySelectorAll('.dsp-rdot-run').length, 2, 'rootsCount does not drive the run dots')
  calls.push('radar-dots-roots-ignored-ok')

  // 3. Twelve dots is the cap; the badge explains the overflow.
  state.agentTotal = 20
  state.agentRunningTotal = 20
  await repaint()
  dots = cardEl().querySelector('.dsp-dots')
  assert.strictEqual(dots.querySelectorAll('.dsp-rdot-run').length, 12, 'run dots stop at the cap')
  const plus = dots.querySelector('.dsp-rplus')
  assert.ok(plus, 'overflow badge is rendered')
  assert.strictEqual(plus.textContent, '+8', 'overflow badge counts agents past the cap')
  calls.push('radar-dots-cap-ok')

  // 4. A snapshot without agentRunningTotal falls back to runningCount.
  delete state.agentRunningTotal
  state.runningCount = 4
  state.agentTotal = 5
  await repaint()
  dots = cardEl().querySelector('.dsp-dots')
  assert.strictEqual(dots.querySelectorAll('.dsp-rdot-run').length, 4, 'missing agentRunningTotal falls back to runningCount')
  calls.push('radar-dots-fallback-ok')

  // --- Claude Style accent colour parsing ------------------------------------
  // The real bundle resolves custom-property colours through a 1x1 canvas.
  // Node has no colour engine, so the fake canvas below emulates exactly what
  // Chrome computes for these fixtures (oklch -> sRGB bytes); everything
  // downstream (colorRgb chain, isDullAccent, fallback choice) is real code.
  const RESOLVED = new Map([
    ['#4d6bfe', [77, 107, 254]],
    ['oklch(0.66143 0.182299 269.607)', [77, 107, 254]],
    ['color-mix(in oklch, #4d6bfe 82%, #f4f9ff)', [107, 133, 254]],
    ['#0f1115', [15, 17, 21]],
    ['#61666b', [97, 102, 107]],
    ['oklch(0.5 0 0)', [119, 119, 119]],
    ['rebeccapurple', [102, 51, 153]],
    ['#f4f9ff', [244, 249, 255]],
    ['#0b0d10', [11, 13, 16]],
  ])
  // Read the fallback ambers from the bundle instead of freezing them here.
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  const fallbackOf = (name) => {
    const m = new RegExp("var " + name + " = '(#[0-9a-fA-F]{6})'").exec(clientSrc)
    assert.ok(m, name + ' is declared in client.js')
    return m[1]
  }
  const FALLBACK = {
    light: fallbackOf('FALLBACK_ACCENT_LIGHT_BG'),
    dark: fallbackOf('FALLBACK_ACCENT_DARK_BG'),
  }
  const CSS_VARS = {
    '--dsw-alias-label-primary': '#111111',
    '--dsw-alias-label-secondary': '#555555',
    '--dsh-claude-divider': '#dddddd',
    '--dsw-alias-state-error-primary': '#d92d20',
    '--dsh-claude-hover-bg': 'rgba(255,255,255,0.1)',
  }

  function makeCanvasCtx() {
    let style = '#010203'
    return {
      get fillStyle() { return style },
      set fillStyle(v) {
        const s = String(v)
        // Unsupported syntax leaves the sentinel in place, like a real canvas.
        style = RESOLVED.has(s) ? s : '#010203'
      },
      clearRect() {},
      fillRect() {},
      getImageData() {
        const rgb = RESOLVED.get(style) || [1, 2, 3]
        return { data: [rgb[0], rgb[1], rgb[2], 255] }
      },
    }
  }

  // Mounts the real bundle against a host page; `palette` is the value of
  // data-dsh-claude-palette (null = attribute absent). `hostLum` only controls
  // what the host surface resolves to, which the card reads through
  // --dsw-alias-bg-layer-1 / detectLum().
  // Fresh sandbox whose theme comes from localStorage (`auto`) and whose host
  // surface is light: the point is the card's own data-lum, not Claude Style.
  function mountAutoClient(hostBg = '#ffffff') {
    const localRegion = new El('div')
    localRegion.setAttribute('class', 'regionArea')
    const doc = {
      head: new El('head'),
      body: new El('body'),
      documentElement: new El('html'),
      createElement: (tag) => new El(tag),
      querySelector(sel) { return matchSimple(localRegion, sel) ? localRegion : this.body.querySelector(sel) },
      querySelectorAll(sel) { return this.body.querySelectorAll(sel) },
      addEventListener() {},
      removeEventListener() {},
    }
    doc.body.appendChild(localRegion)
    const hostRgb = (value) => {
      const m = /^#([0-9a-f]{6})$/i.exec(String(value))
      return m
        ? 'rgb(' + parseInt(m[1].slice(0, 2), 16) + ', ' + parseInt(m[1].slice(2, 4), 16) + ', ' + parseInt(m[1].slice(4, 6), 16) + ')'
        : String(value)
    }
    const styleOf = (el) => {
      if (el && el.tagName === 'span') {
        const raw = (el.style && el.style.backgroundColor) || ''
        if (raw.indexOf('var(--dsw-alias-bg-layer-1') === 0) {
          return { backgroundColor: hostRgb(hostBg), getPropertyValue() { return '' } }
        }
      }
      return { backgroundColor: hostRgb(hostBg), getPropertyValue() { return '' } }
    }
    const win = {
      addEventListener() {}, removeEventListener() {}, open() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
      getComputedStyle: styleOf,
    }
    let captured = null
    win.__ModuleLoader__ = { load(opts) { captured = opts } }
    const sandbox = {
      window: win,
      document: doc,
      getComputedStyle: styleOf,
      localStorage: {
        getItem: (key) => (key === 'dsh-shutdown-guard.theme' ? 'auto' : key === 'dsh-shutdown-guard.variant' ? 'B' : null),
        setItem() {},
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({ armed: false, state: 'idle', ui: { theme: 'auto', variant: 'B' }, lang: 'zh', language: 'zh' }),
      }),
      setInterval: () => 0,
      clearInterval() {},
      setTimeout: () => 0,
      clearTimeout() {},
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
      requestAnimationFrame: () => 0,
      console: { log() {}, warn() {}, error() {} },
    }
    vm.createContext(sandbox)
    vm.runInContext(clientSrc, sandbox)
    assert.ok(captured && captured.factory, 'auto-theme sandbox loads the client bundle')
    const react = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useSyncExternalStore: (subscribe, get) => { subscribe(() => {}); return get() },
    }
    captured.factory(() => react).apply({ effect(fn) { fn() }, slots: { inject() {}, register() {} } })
    const card = () => localRegion.querySelector('.dsp-card')
    const click = (sel) => {
      const el = localRegion.querySelector(sel)
      assert.ok(el, 'auto-theme card has ' + sel)
      for (const fn of (el._listeners.click || [])) fn({})
    }
    return { card, click }
  }

  function mountClient(opts = {}) {
    const palette = Object.prototype.hasOwnProperty.call(opts, 'palette') ? opts.palette : 'claude'
    const hostBg = opts.hostBg || (opts.hostLum === 'light' ? '#ffffff' : '#212121')
    const liveAccent = opts.accent || '#4d6bfe'
    const withCanvas = opts.withCanvas !== false
    const localRegion = new El('div')
    localRegion.setAttribute('class', 'regionArea')
    const doc = {
      head: new El('head'),
      body: new El('body'),
      documentElement: new El('html'),
      createElement(tag) {
        const el = new El(tag)
        if (String(tag).toLowerCase() === 'canvas') {
          el.getContext = () => (withCanvas ? makeCanvasCtx() : null)
        }
        return el
      },
      querySelector(sel) { return matchSimple(localRegion, sel) ? localRegion : this.body.querySelector(sel) },
      querySelectorAll(sel) { return this.body.querySelectorAll(sel) },
      addEventListener() {},
      removeEventListener() {},
    }
    if (palette !== null) doc.body.setAttribute('data-dsh-claude-palette', palette)
    doc.body.appendChild(localRegion)

    const vars = Object.assign({}, CSS_VARS, {
      '--dsw-alias-bg-layer-1': hostBg,
      '--dsw-alias-brand-primary': liveAccent,
      '--dsw-alias-border-l1': '#cccccc',
    })
    // The host's CSS resolves --dsw-alias-bg-layer-1 before the card reads it;
    // the fake engine has to do the same or detectLum() would see a var() string.
    const hostRgb = (value) => {
      const m = /^#([0-9a-f]{6})$/i.exec(String(value))
      return m
        ? 'rgb(' + parseInt(m[1].slice(0, 2), 16) + ', ' + parseInt(m[1].slice(2, 4), 16) + ', ' + parseInt(m[1].slice(4, 6), 16) + ')'
        : String(value)
    }
    const styleOf = (el) => {
      if (el && el.tagName === 'span') {
        const raw = (el.style && el.style.backgroundColor) || ''
        if (raw.indexOf('var(--dsw-alias-bg-layer-1') === 0) {
          return { backgroundColor: hostRgb(hostBg), getPropertyValue() { return '' } }
        }
        const rgb = RESOLVED.get(raw)
        // Chrome serialises oklch()/color-mix() as authored, so the old rgb
        // parser cannot read them. Hex and named colours come back as rgb().
        const legacy = raw.indexOf('oklch(') === 0 || raw.indexOf('color-mix(') === 0
        return {
          backgroundColor: rgb && !legacy ? 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')' : raw,
          getPropertyValue() { return '' },
        }
      }
      return { backgroundColor: hostRgb(hostBg), getPropertyValue: (n) => vars[n] || '' }
    }
    const win = {
      addEventListener() {}, removeEventListener() {}, open() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
      getComputedStyle: styleOf,
    }
    const errors = []
    let captured = null
    win.__ModuleLoader__ = { load(opts) { captured = opts } }
    const sandbox = {
      window: win,
      document: doc,
      getComputedStyle: styleOf,
      localStorage: {
        // The card does not adopt /state's ui during its 1.5s startup grace,
        // so the theme has to come from the persisted preference.
        getItem: (key) => (key === 'dsh-shutdown-guard.theme' ? 'claude' : null),
        setItem() {},
      },
      fetch: async () => ({ ok: true, json: async () => ({ armed: false, state: 'idle', ui: { theme: 'claude' }, lang: 'zh', language: 'zh' }) }),
      setInterval: () => 0,
      clearInterval() {},
      setTimeout: () => 0,
      clearTimeout() {},
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
      requestAnimationFrame: () => 0,
      console: { log() {}, warn() {}, error(...args) { errors.push(args) } },
    }
    vm.createContext(sandbox)
    vm.runInContext(clientSrc, sandbox)
    assert.ok(captured && captured.factory, 'client bundle loads inside the colour sandbox')
    const react = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useSyncExternalStore: (subscribe, get) => { subscribe(() => {}); return get() },
    }
    const mod = captured.factory(() => react)
    mod.apply({ effect(fn) { fn() }, slots: { inject() {}, register() {} } })
    const card = localRegion.querySelector('.dsp-card')
    assert.ok(card, 'colour sandbox mounts a card')
    return {
      accent: card.style.getPropertyValue('--dsp-accent'),
      bg: card.style.getPropertyValue('--dsp-bg'),
      lum: card.getAttribute('data-lum'),
      errors,
    }
  }

  function accentFor(accent, bg, withCanvas) {
    return mountClient({ accent, hostBg: bg, withCanvas })
  }

  function assertAccent(name, accent, bg, expected, withCanvas = true) {
    const got = accentFor(accent, bg, withCanvas)
    assert.deepStrictEqual(got.errors, [], name + ' produces no console errors')
    assert.strictEqual(got.accent, expected, name + ': got ' + got.accent)
  }

  // 1. oklch() and color-mix(in oklch, …) carry chroma: never the amber fallback.
  assertAccent('accent-oklch', 'oklch(0.66143 0.182299 269.607)', '#f4f9ff', 'oklch(0.66143 0.182299 269.607)')
  assert.notStrictEqual(accentFor('oklch(0.66143 0.182299 269.607)', '#f4f9ff', true).accent, FALLBACK.light)
  calls.push('accent-oklch-not-dull-ok')

  assertAccent('accent-color-mix', 'color-mix(in oklch, #4d6bfe 82%, #f4f9ff)', '#0b0d10', 'color-mix(in oklch, #4d6bfe 82%, #f4f9ff)')
  assert.notStrictEqual(accentFor('color-mix(in oklch, #4d6bfe 82%, #f4f9ff)', '#0b0d10', true).accent, FALLBACK.dark)
  calls.push('accent-color-mix-not-dull-ok')

  // 2. True greys still fall back, and the surface luminance picks the shade.
  assertAccent('accent-gray-hex-light', '#0f1115', '#f4f9ff', FALLBACK.light)
  assertAccent('accent-gray-hex-dark', '#61666b', '#0b0d10', FALLBACK.dark)
  assertAccent('accent-gray-oklch', 'oklch(0.5 0 0)', '#f4f9ff', FALLBACK.light)
  calls.push('accent-gray-falls-back-ok')

  // 3. Without a 2d context the old element probe still resolves a colour that
  //    the legacy rgb() parser can read, so the card does not crash and the
  //    accent survives. (oklch/color-mix stay unreadable without canvas, as in
  //    Chrome, and fall back to amber — the degradation this fix bounds.)
  assertAccent('accent-no-canvas', 'rebeccapurple', '#f4f9ff', 'rebeccapurple', false)
  calls.push('accent-no-canvas-probe-ok')

  // 4. Claude Style not installed: a built-in look-alike palette, one per host
  //    surface. Values from lib/client.js:1452 BUILTIN_CLAUDE_LIGHT and :1461
  //    BUILTIN_CLAUDE_DARK (terracotta accent #d97757 on #ffffff / #212121).
  {
    const light = mountClient({ palette: null, hostLum: 'light' })
    assert.deepStrictEqual(light.errors, [])
    assert.strictEqual(light.accent, '#d97757', 'built-in Claude accent (light)')
    assert.strictEqual(light.bg, '#ffffff', 'built-in Claude surface (light)')
    assert.strictEqual(light.lum, 'light', 'data-lum follows the built-in light surface')

    const dark = mountClient({ palette: null, hostLum: 'dark' })
    assert.deepStrictEqual(dark.errors, [])
    assert.strictEqual(dark.accent, '#d97757', 'built-in Claude accent (dark)')
    assert.strictEqual(dark.bg, '#212121', 'built-in Claude surface (dark)')
    assert.strictEqual(dark.lum, 'dark', 'data-lum follows the built-in dark surface')
    calls.push('builtin-palette-no-attr-ok')
  }

  // 5. `palette: host` means the plugin is installed but points its names at the
  //    host's neutral surface: the card must keep its own amber, never paint the
  //    built-in terracotta look-alike.
  {
    const effective = (got) => got.accent || (got.lum === 'light' ? FALLBACK.light : FALLBACK.dark)
    const light = mountClient({ palette: 'host', hostLum: 'light' })
    assert.deepStrictEqual(light.errors, [])
    assert.strictEqual(light.lum, 'light')
    assert.strictEqual(effective(light), FALLBACK.light, 'host palette falls back to amber on a light surface')
    assert.notStrictEqual(light.accent, '#d97757', 'host palette is not the built-in Claude palette')

    const dark = mountClient({ palette: 'host', hostLum: 'dark' })
    assert.deepStrictEqual(dark.errors, [])
    assert.strictEqual(dark.lum, 'dark')
    assert.strictEqual(effective(dark), FALLBACK.dark, 'host palette falls back to amber on a dark surface')
    assert.notStrictEqual(dark.accent, '#d97757', 'host palette is not the built-in Claude palette')
    calls.push('builtin-palette-not-for-host-ok')
  }

  // 6. The plugin writes the attribute on every boot; an empty value still means
  //    installed, so it must not be mistaken for "plugin absent" and repaint the
  //    built-in palette.
  //    空串属性视为未给出配色，按 host 处理：跟随实时变量会读到空值、产生脏帧。
  {
    const empty = mountClient({ palette: '', hostLum: 'dark' })
    assert.deepStrictEqual(empty.errors, [])
    assert.strictEqual(empty.lum, 'dark', 'an empty palette still borrows the host surface')
    assert.notStrictEqual(empty.accent, '#d97757', 'empty attribute is installed, not the built-in palette')
    calls.push('palette-attr-empty-means-installed-ok')
  }

  // 7. The theme option is named for the plugin it imitates, in every language,
  //    and the "not installed" note has copy to show.
  for (const lang of ['zh', 'en', 'ru']) {
    assert.strictEqual(clientText[lang]['theme.claude'], 'Claude Style', `${lang} names the Claude Style option`)
    assert.ok(String(clientText[lang]['theme.claudeMissing'] || '').trim().length > 0,
      `${lang} explains the built-in palette when the plugin is missing`)
  }
  calls.push('theme-label-ok')

  // --- settings section renders with profiles + events -----------------------
  await settle()
  const element = slots['settings.section'].render({})
  const rendered = typeof element.type === 'function' ? element.type({}) : element
  const text = flat(rendered, []).join(' | ')
  // 「判定与执行」这个组标题随结构变更不再渲染（四行并进了「守夜行为」），所以从
  // 清单里删的是标题，不是行：下面四行必须继续在清单里。
  const missing = ['外观', 'AFK 自动回答', '自定义配置', '选择配置', '会话都停下来', '后台任务跑完', '有会话报错就跳过这一轮', '倒计时时长', '状态', '上次为什么没执行', '事件日志']
    .filter((n) => !text.includes(n))
  assert.deepStrictEqual(missing, [], 'missing settings labels; got: ' + text.slice(0, 300))
  assert.ok(!text.includes('终端里的 6 个小块'), 'LED legend hidden while variant != C')

  // --- custom-profile rows follow customEnabled in both directions -----------
  // The settings tree is a plain element tree here, so presence checks walk the
  // nodes instead of relying on text: the option value and the file input are
  // the behaviour, while the labels are copy that may change.
  function walkNodes(node, visit) {
    if (node == null || node === false) return
    if (Array.isArray(node)) { for (const child of node) walkNodes(child, visit); return }
    if (typeof node !== 'object') return
    visit(node)
    if (node.children) for (const child of node.children) walkNodes(child, visit)
  }
  function settingsTree() {
    const el = slots['settings.section'].render({})
    return typeof el.type === 'function' ? el.type({}) : el
  }
  function settingsParts(tree) {
    const options = []
    let fileInputs = 0
    let ackRows = 0
    walkNodes(tree, (n) => {
      if (n.type === 'option') options.push(n)
      if (n.type === 'input' && n.props && n.props.type === 'file') fileInputs += 1
      if (typeof n.props?.className === 'string' && n.props.className.includes('dsp-ackrow')) ackRows += 1
    })
    return { options, fileInputs, ackRows }
  }
  state.profiles = [{ id: 'default', label: '默认配置', countdownSec: 60, action: 'shutdown' }]
  state.activeProfileId = 'default'

  state.customEnabled = false
  await repaint()
  {
    const parts = settingsParts(settingsTree())
    assert.ok(!parts.options.some((o) => o.props.value === 'custom'),
      'the picker has no custom option while custom profiles are off')
    assert.strictEqual(parts.fileInputs, 0, 'the script row is not rendered while custom profiles are off')
    assert.strictEqual(parts.ackRows, 0, 'the script confirmation is not rendered while custom profiles are off')
  }

  state.customEnabled = true
  await repaint()
  {
    const parts = settingsParts(settingsTree())
    assert.ok(parts.options.some((o) => o.props.value === 'custom'),
      'the picker offers custom once custom profiles are on')
    assert.strictEqual(parts.fileInputs, 1, 'the script row is rendered once custom profiles are on')
  }

  // Boundary: the feature was turned off while the active profile still stores
  // action=custom. The picker must keep a disabled placeholder, not silently
  // rewrite the stored choice to shutdown.
  state.customEnabled = false
  state.profiles = [{ id: 'default', label: '默认配置', countdownSec: 60, action: 'custom' }]
  await repaint()
  {
    const parts = settingsParts(settingsTree())
    const hidden = parts.options[0]
    assert.ok(hidden && hidden.props.value === 'custom' && hidden.props.disabled === true,
      'a stored custom action keeps a disabled placeholder option')
    assert.strictEqual(flat(hidden, []).join(''), clientText.zh['action.custom.off'],
      'the placeholder explains why custom is unavailable')
  }
  calls.push('custom-hidden-without-profiles-ok')

  // Consent lives in the shared library row: an unconfirmed entry shows a gate
  // button, the dialog sends `{ ackScript: { scriptId } }`, and withdrawing is
  // its own verb that never deletes the script. The fixture mirrors the real
  // /state payload: top-level `scripts[]` plus the compatibility projection.
  const LIB_SHA = 'a'.repeat(64)
  // The fixture mirrors the real /state entry, including the runnability pair
  // the host now reports per script.
  const libScript = (over) => Object.assign({
    id: 's1', name: 'ack.cmd', ext: 'cmd', bytes: 12, sha256: LIB_SHA,
    savedAt: 1, ackOk: false, ackAt: null, usedBy: 1, runnable: true, reason: null,
  }, over || {})
  const libProfile = (sc) => ({
    id: 'default', label: '默认配置', countdownSec: 60, action: 'custom',
    scriptId: sc.id,
    script: { name: sc.name, ext: sc.ext, bytes: sc.bytes, sha256: sc.sha256, savedAt: sc.savedAt },
    scriptAck: sc.ackOk ? { sha256: sc.sha256, at: sc.ackAt } : null,
  })
  const setLib = (scripts) => {
    state.scripts = scripts
    state.profiles = [libProfile(scripts[0])]
  }
  state.customEnabled = true
  state.activeProfileId = 'default'
  setLib([libScript()])
  await repaint()
  {
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
    }
    const findAll = (cls) => {
      const out = []
      walkNodes(settingsTree(), (n) => {
        if (n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) out.push(n)
      })
      return out
    }
    const dialog = () => document.body.querySelector('[role="dialog"]')
    const errNode = () => (dialog() ? dialog().querySelector('.dsp-modal-err') : null)
    const okBtn = () => (dialog() ? dialog().querySelector('.dsp-modal-ok') : null)
    const esc = () => {
      for (const fn of (document._listeners.keydown || []).slice()) fn({ key: 'Escape', preventDefault() {} })
    }
    const bodies = []
    const realFetch = global.fetch
    let failNext = false
    global.fetch = async (url, opts) => {
      let body = null
      if (opts && opts.body) {
        body = JSON.parse(opts.body)
        bodies.push(body)
      }
      if (failNext) {
        const error = 'scriptAck is written by ackScript'
        return { ok: false, json: async () => Object.assign({}, state, { error }) }
      }
      // The real host writes the ack onto the library entry; keep the mock state
      // in sync so the optimistic patch and the next snapshot agree.
      if (body && body.ackScript) {
        state.scripts[0].ackOk = true
        state.scripts[0].ackAt = Date.now()
        state.profiles[0].scriptAck = { sha256: LIB_SHA, at: state.scripts[0].ackAt }
      }
      if (body && body.unackScript) {
        state.scripts[0].ackOk = false
        state.scripts[0].ackAt = null
        state.profiles[0].scriptAck = null
      }
      return { ok: true, json: async () => state }
    }
    try {
      const openBtn = findNode('dsp-gatebtn')
      assert.ok(openBtn, 'an unconfirmed script renders the gate button')
      assert.strictEqual(findNode('dsp-ackbox'), null, 'no checkbox remains in the script row')
      assert.strictEqual(findNode('dsp-ackopen'), null, 'the old confirm link is gone')

      // 1. Open: the dialog appears and the primary action owns the focus.
      openBtn.props.onClick({ currentTarget: openBtn })
      assert.ok(dialog(), 'clicking confirm opens the consent dialog')
      assert.strictEqual(dialog().getAttribute('aria-modal'), 'true', 'the dialog is modal')
      assert.strictEqual(document.activeElement, okBtn(), 'the primary action starts focused, not cancel')

      // 2. Esc closes it without any request.
      esc()
      assert.strictEqual(dialog(), null, 'Esc closes the dialog')
      assert.strictEqual(bodies.length, 0, 'Esc never sends a request')

      // 2b. The backdrop does the same.
      findNode('dsp-gatebtn').props.onClick({ currentTarget: findNode('dsp-gatebtn') })
      assert.ok(dialog(), 'the dialog can be opened again')
      const root = dialog()
      for (const fn of (root._listeners.mousedown || []).slice()) fn({ target: root })
      assert.strictEqual(dialog(), null, 'clicking the backdrop closes the dialog')
      assert.strictEqual(bodies.length, 0, 'the backdrop never sends a request')

      // 3. A failed confirmation keeps the dialog open and turns the primary
      // action into a retry. Do not pin the wording of the error message.
      failNext = true
      findNode('dsp-gatebtn').props.onClick({ currentTarget: findNode('dsp-gatebtn') })
      okBtn()._listeners.click[0]({ preventDefault() {} })
      await settle()
      assert.ok(dialog(), 'a failed confirmation leaves the dialog open')
      assert.ok(errNode() && errNode().textContent.length > 0, 'the dialog shows an error')
      assert.strictEqual(okBtn().textContent, clientText.zh['set.script.dialog.retry'],
        'the primary button offers a retry')
      failNext = false
      esc()

      // 4. Confirm sends the library id only, then closes. The failed attempt
      // must not leave a local "confirmed" snapshot behind: rebuild from /state.
      setLib([libScript()])
      await repaint()
      findNode('dsp-gatebtn').props.onClick({ currentTarget: findNode('dsp-gatebtn') })
      assert.ok(dialog(), 'the dialog reopens after a retry')
      okBtn()._listeners.click[0]({ preventDefault() {} })
      await settle()
      assert.deepStrictEqual(bodies[bodies.length - 1], { ackScript: { scriptId: 's1' } },
        'confirming sends ackScript for the library entry')
      assert.ok(!('updateProfile' in bodies[bodies.length - 1]) && !('patch' in bodies[bodies.length - 1]),
        'confirming never sends a profile patch')
      assert.strictEqual(dialog(), null, 'a successful confirmation closes the dialog')

      // 5. A confirmed entry shows the green gate; the second button reopens the
      // dialog so the user can reread the disclaimer.
      await repaint()
      const okGate = findNode('dsp-gate')
      assert.ok(okGate && okGate.props.className.includes('is-ok'), 'the confirmed gate turns green')
      const btns = findAll('dsp-gatebtn')
      assert.strictEqual(btns.length, 2, 'a confirmed entry offers withdraw and details')
      assert.strictEqual(flat(btns[0], []).join(''), clientText.zh['set.script.dialog.withdraw'],
        'the first action withdraws consent')
      const confirmedPrefix = clientText.zh['set.script.confirmed'].split('{time}')[0].trim()
      const gateText = findNode('dsp-gatetext')
      assert.ok(gateText && flat(gateText, []).join('').includes(confirmedPrefix),
        'the gate reports the confirmation time')
      btns[1].props.onClick({ currentTarget: btns[1] })
      assert.ok(dialog(), 'the details action reopens the dialog')
      esc()
    } finally {
      global.fetch = realFetch
    }
    calls.push('script-ack-payload-ok')
  }

  // 11b. The library list itself and the non-optimistic rename. A 400 from the
  // host must leave the row showing the old name: an optimistic rename hides a
  // silently rejected write.
  await repaint()
  {
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
    }
    const findAll = (cls) => {
      const out = []
      walkNodes(settingsTree(), (n) => {
        if (n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) out.push(n)
      })
      return out
    }
    state.scripts = [libScript(), libScript({ id: 's2', name: 'other.ps1', ext: 'ps1', sha256: 'b'.repeat(64), usedBy: 2 })]
    state.profiles = [libProfile(state.scripts[0])]
    await repaint()
    assert.strictEqual(findAll('dsp-librow').length, 2, 'the library renders one row per entry')
    assert.strictEqual(findNode('dsp-libstat'), null,
      'the library has no summary line of its own any more')
    const usedRows = findAll('dsp-libused')
    assert.strictEqual(usedRows.length, 2,
      'every row carries its own usage count, including the one only one profile uses')
    assert.ok(flat(usedRows[0], []).join('').includes('1'), 'a single user is stated on its row')
    assert.ok(flat(usedRows[1], []).join('').includes('2'), 'a shared script states its own count')

    const bodies = []
    const realFetch = global.fetch
    global.fetch = async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : null
      bodies.push(body)
      if (body && body.renameScript) return { ok: false, json: async () => ({ error: 'script name must be 1..40 characters' }) }
      return { ok: true, json: async () => state }
    }
    try {
      findNode('dsp-libmore').props.onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: findNode('dsp-libmore') })
      await repaint()
      const rename = findAll('dsp-libmitem').find((n) => flat(n, []).join('') === clientText.zh['set.script.menu.rename'])
      assert.ok(rename, 'the row menu offers rename')
      rename.props.onClick({ preventDefault() {}, stopPropagation() {} })
      await repaint()
      const input = findNode('dsp-libedit')
      assert.ok(input, 'rename edits in place')
      input.props.onKeyDown({ key: 'Enter', preventDefault() {}, target: { value: 'new-name.ps1' } })
      await settle()
      await repaint()
      assert.ok(bodies.some((b) => b && b.renameScript && b.renameScript.name === 'new-name.ps1'),
        'the rename goes to renameScript')
      assert.strictEqual(findNode('dsp-libedit'), null, 'a rejected rename leaves edit mode')
      const row = findNode('dsp-librow')
      assert.ok(flat(row, []).join('').includes('ack.cmd'), 'a rejected rename keeps the old name visible')
      assert.ok(!flat(row, []).join('').includes('new-name.ps1'), 'a rejected rename is never shown optimistically')
    } finally {
      global.fetch = realFetch
    }
    calls.push('script-library-list-ok')
  }

  // 12a. The real /state ack carries { at, sha256 }. A payload trimmed to `at`
  // alone (the regression that made "confirmed" vanish after two seconds) must
  // not be treated as confirmed: the client compares the sha, it never guesses.
  setLib([libScript()])
  state.profiles[0].scriptAck = { at: Date.now() }
  await new Promise((resolve) => setTimeout(resolve, 1450))
  await repaint()
  {
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
    }
    const gate = findNode('dsp-gate')
    assert.ok(gate, 'the script row still renders the gate')
    assert.ok(!gate.props.className.includes('is-ok'), 'an ack without the hash is not treated as confirmed')
    assert.ok(findNode('dsp-gatebtn'), 'the trimmed ack still offers the confirm button')
    assert.strictEqual(cardEl().querySelector('.dsp-btn').disabled, true,
      'the card stays blocked while the ack has no hash')
    calls.push('script-ack-shape-ok')
  }

  // 12b. The dot is a state, not a decoration: filled blue means the script this
  // profile runs, hollow blue means acknowledged and safe to switch to, yellow
  // means not confirmed yet, grey means the host says it cannot run here. A grey
  // row must refuse to select, because arming it would only fail at the deadline.
  {
    const findAll = (cls) => {
      const out = []
      walkNodes(settingsTree(), (n) => {
        if (n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) out.push(n)
      })
      return out
    }
    const dotClasses = () => findAll('dsp-libdot').map(
      (n) => n.props.className.split(/\s+/).filter((c) => c.indexOf('is-') === 0).join('+'))

    setLib([libScript({ ackOk: false })])
    await repaint()
    assert.deepStrictEqual(dotClasses(), ['is-need'],
      'the selected but unconfirmed script shows the filled yellow dot')

    // Yellow follows the same two densities as blue: filled for the row in use,
    // hollow for another unconfirmed row.
    setLib([
      libScript({ ackOk: false }),
      libScript({ id: 's2', name: 'other.ps1', ext: 'ps1', ackOk: false }),
    ])
    await repaint()
    assert.deepStrictEqual(dotClasses(), ['is-need', 'is-need-open'],
      'an unconfirmed script that is not selected shows the hollow yellow dot')

    setLib([libScript({ ackOk: true, ackAt: Date.now() })])
    await repaint()
    assert.deepStrictEqual(dotClasses(), ['is-use'], 'the selected, confirmed script shows the filled blue dot')

    setLib([
      libScript({ id: 's1', name: 'run.cmd', ackOk: true, ackAt: Date.now() }),
      libScript({ id: 's2', name: 'other.ps1', ext: 'ps1', ackOk: true, ackAt: Date.now() }),
    ])
    await repaint()
    assert.deepStrictEqual(dotClasses(), ['is-use', 'is-ready'],
      'a confirmed script that is not selected shows the hollow blue dot')

    setLib([libScript({ ackOk: true, ackAt: Date.now(), runnable: false, reason: 'file-missing' })])
    await repaint()
    assert.deepStrictEqual(dotClasses(), ['is-na'], 'a script the host cannot run shows the grey dot')
    {
      const row = findAll('dsp-librow')[0]
      assert.ok(row.props.className.includes('is-na'), 'the grey row is marked so it can be styled')
      assert.strictEqual(row.props['aria-disabled'], 'true', 'the grey row is disabled for assistive tech')
      assert.ok(flat(row, []).join('').includes(clientText.zh['set.script.na.file']),
        'the grey row says why it cannot run instead of showing a confirmation pill')
      const bodies = []
      const realFetch2 = global.fetch
      global.fetch = async (url, opts) => {
        bodies.push(opts && opts.body ? JSON.parse(opts.body) : null)
        return { ok: true, status: 200, json: async () => ({ ok: true, state }) }
      }
      try {
        row.props.onClick({ preventDefault() {}, stopPropagation() {} })
        row.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} })
        await settle()
      } finally {
        global.fetch = realFetch2
      }
      assert.ok(!bodies.some((b) => b && b.selectScript),
        'clicking a script that cannot run never asks the host to select it')
    }
    calls.push('script-dot-states-ok')
  }

  // 12b. The row pill is a status word, not a timestamp: at 11px a date wraps
  // the row and buries the answer to "can this run?". The exact confirmation
  // time stays in the gate below the list, and it now always carries the year
  // — a confirmation is durable, "3/14 14:32" could be any spring.
  {
    const ACK_AT = Date.UTC(2021, 2, 14, 6, 32)
    setLib([libScript({ ackOk: true, ackAt: ACK_AT })])
    await repaint()
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
    }
    const pillText = flat(findNode('dsp-libpill'), []).join('')
    assert.strictEqual(pillText, '✓ ' + clientText.zh['set.script.confirmedShort'],
      'the library row states the status alone, without a time')
    assert.ok(!pillText.includes('2021') && !pillText.includes(':'),
      'the row pill carries neither a year nor a clock time')

    const gateText = flat(findNode('dsp-gatetext'), []).join('')
    assert.ok(gateText.includes('2021'),
      'the selected-script gate still dates the confirmation, year included')
    assert.ok(gateText.includes(clientText.zh['set.script.confirmed'].split('{time}')[0].trim()),
      'the gate keeps the full confirmed phrasing')
    calls.push('script-pill-no-time-ok')
  }

  // 12c. "Confirmed" reads as one colour everywhere: the gate band and its
  // button use the same blue as the dot, so a successful confirmation cannot
  // look like the green success state used elsewhere on the page.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
    assert.ok(!/\.dsp-gate\.is-ok\{[^}]*#2e7d32/.test(src),
      'the confirmed gate band no longer paints itself green')
    assert.ok(!/\.dsp-gatebtn\.is-ok\{[^}]*#2e7d32/.test(src),
      'the confirmed gate button no longer paints itself green')
    assert.ok(/\.dsp-gate\.is-ok\{[^}]*var\(--s-use\)/.test(src),
      'the confirmed gate band takes the shared blue token')
    assert.ok(/\.dsp-libpill\.is-ok\{[^}]*var\(--s-use\)/.test(src),
      'the confirmed pill takes the shared blue token')
    assert.ok(/--s-use:#2a63c4/.test(src) && /--s-use:#6fa5f2/.test(src),
      'the blue token is defined for both light and dark surfaces')
    calls.push('gate-ack-blue-ok')
  }

  // 12. Withdrawing consent is not deleting the script: the gate's withdraw
  // action sends `unackScript`, the row stays, the badge returns to pending and
  // the card blocks again while the bytes remain in the library.
  setLib([libScript({ ackOk: true, ackAt: Date.now() })])
  await repaint()
  {
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
    }
    const findAll = (cls) => {
      const out = []
      walkNodes(settingsTree(), (n) => {
        if (n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes(cls)) out.push(n)
      })
      return out
    }
    const bodies = []
    const realFetch = global.fetch
    global.fetch = async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : null
      bodies.push(body)
      if (body && body.unackScript) {
        state.scripts[0].ackOk = false
        state.scripts[0].ackAt = null
        state.profiles[0].scriptAck = null
      }
      return { ok: true, json: async () => state }
    }
    try {
      const arm = cardEl().querySelector('.dsp-btn')
      assert.strictEqual(arm.disabled, false, 'an acknowledged custom script lets the card arm')

      const withdraw = findAll('dsp-gatebtn').find((n) => flat(n, []).join('') === clientText.zh['set.script.dialog.withdraw'])
      assert.ok(withdraw, 'the confirmed gate offers withdraw')
      withdraw.props.onClick({ preventDefault() {}, currentTarget: withdraw })
      await settle()
      assert.deepStrictEqual(bodies[bodies.length - 1], { unackScript: { scriptId: 's1' } },
        'withdrawing uses the unackScript verb')
      assert.ok(!('ackScript' in bodies[bodies.length - 1]),
        'withdrawing never re-sends ackScript')
      assert.ok(!('patch' in bodies[bodies.length - 1]),
        'withdrawing never patches the profile projection')

      await repaint()
      assert.strictEqual(findAll('dsp-librow').length, 1, 'the script row stays after withdrawing')
      assert.strictEqual(state.scripts[0].sha256, LIB_SHA, 'withdrawing keeps the script bytes')
      const gate = findNode('dsp-gate')
      assert.ok(!gate.props.className.includes('is-ok'), 'the gate returns to pending')
      assert.ok(findNode('dsp-gatebtn'), 'the confirm button is back')
      assert.strictEqual(cardEl().querySelector('.dsp-btn').disabled, true,
        'the card returns to the blocked state until it is confirmed again')
    } finally {
      global.fetch = realFetch
    }
    calls.push('script-withdraw-keeps-script-ok')
  }

  // 12d. A profile row is a radio, not a label beside some buttons: clicking it
  // switches the active profile, which is the whole reason the list exists. The
  // controls inside the row ("set as default" / rename / delete) must not fire
  // the switch as a side effect — one click, one decision.
  setLib([libScript()])
  state.profiles = [
    { id: 'default', label: '默认配置', countdownSec: 60, action: 'custom', scriptId: 's1' },
    { id: 'p2', label: '夜里跑批', countdownSec: 120, action: 'custom', scriptId: 's1' },
  ]
  state.activeProfileId = 'default'
  await repaint()
  {
    const rows = []
    walkNodes(settingsTree(), (n) => {
      if (n.props && typeof n.props.className === 'string'
        && n.props.className.split(/\s+/).includes('dsp-srow-prof')) rows.push(n)
    })
    assert.strictEqual(rows.length, 2, 'both profiles render as rows')
    assert.strictEqual(rows[0].props.role, 'radio', 'a profile row announces itself as a radio')
    assert.strictEqual(rows[0].props['aria-checked'], 'true', 'the active row is checked')
    assert.strictEqual(rows[1].props['aria-checked'], 'false', 'an inactive row is not checked')

    const bodies = []
    const realFetch = global.fetch
    global.fetch = async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null
      bodies.push(body)
      if (body && typeof body.activeProfileId === 'string') state.activeProfileId = body.activeProfileId
      return { ok: true, status: 200, json: async () => ({ ok: true, state }) }
    }
    try {
      rows[1].props.onClick({ preventDefault() {}, stopPropagation() {} })
      await settle()
      assert.deepStrictEqual(bodies[bodies.length - 1], { activeProfileId: 'p2' },
        'clicking a row switches the active profile')
      assert.ok(!bodies.some((b) => b && b.setDefault),
        'switching is not the same verb as making the profile the default')

      // The controls inside the row swallow their own clicks, so pressing
      // "delete" cannot also switch the profile out from under the pointer.
      const actions = []
      walkNodes(rows[1], (n) => {
        if (n.props && typeof n.props.className === 'string'
          && n.props.className.split(/\s+/).includes('dsp-prof-actions')) actions.push(n)
      })
      assert.strictEqual(actions.length, 1, 'the row groups its controls')
      let stopped = false
      actions[0].props.onClick({ stopPropagation() { stopped = true } })
      assert.strictEqual(stopped, true, 'a click inside the controls never reaches the row')

      bodies.length = 0
      rows[1].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} })
      await settle()
      assert.deepStrictEqual(bodies[bodies.length - 1], { activeProfileId: 'p2' },
        'Enter on a row switches it, for keyboard users')
    } finally {
      global.fetch = realFetch
    }
    calls.push('profile-row-switch-ok')
  }

  // 12d. A 409 from /arm is an answer, not a dead click: the card keeps the
  // switch off and shows the host's reason above the button. An unknown code
  // must fall back to the generic sentence instead of leaking the raw enum.
  {
    state.armed = false
    state.state = 'idle'
    state.blocked = null
    state.jobsRunning = 0
    state.runningCount = 0
    state.activeProfileId = 'default'
    state.profiles = [{ id: 'default', label: '默认', action: 'shutdown' }]
    state.actions = { shutdown: { available: true }, custom: { available: true } }
    delete state.lastAction
    const realFetch = global.fetch
    let armError = 'script-not-acknowledged'
    const armBodies = []
    global.fetch = async (url, opts) => {
      if (String(url).endsWith('/arm')) {
        armBodies.push(opts && opts.body ? JSON.parse(opts.body) : null)
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: armError,
            armed: false,
            state: 'idle',
            lang: 'zh',
            language: 'zh',
            activeProfileId: 'default',
            profiles: state.profiles,
            actions: state.actions,
            ui: { variant: 'B', theme: 'auto', folded: false, compact: true },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => state }
    }
    try {
      await repaint()
      let btn = cardEl().querySelector('.dsp-btn')
      assert.strictEqual(btn.disabled, false, 'the arm button is clickable before the refusal')
      const armLabel = btn.textContent
      for (const fn of (btn._listeners.click || [])) fn({})
      await settle(10)
      await repaint()
      assert.strictEqual(cardEl().querySelector('.dsp-btn').textContent, armLabel,
        'a refused arm keeps the button asking to arm')
      assert.strictEqual(state.armed, false, 'the fixture never claims the switch turned on')
      const note = cardEl().querySelector('.dsp-armnote')
      assert.ok(note, 'the card has the refusal line')
      assert.strictEqual(note.hidden, false, 'the refusal line is visible')
      assert.strictEqual(note.textContent, clientText.zh['action.reason.script-not-acknowledged'],
        'the refusal names the real reason, not a generic failure')
      calls.push('arm-refusal-visible-ok')

      armError = 'weird-code'
      for (const fn of (cardEl().querySelector('.dsp-btn')._listeners.click || [])) fn({})
      await settle(10)
      await repaint()
      assert.strictEqual(cardEl().querySelector('.dsp-armnote').textContent,
        clientText.zh['action.reason.action-unavailable'], 'an unknown code falls back to the generic sentence')
      assert.ok(!cardEl().querySelector('.dsp-armnote').textContent.includes('weird-code'),
        'the raw enum never reaches the card')
      calls.push('arm-refusal-unknown-ok')
    } finally {
      global.fetch = realFetch
    }
    assert.ok(armBodies.length >= 2, 'both clicks reached POST /arm')
  }

  // 12e. Failed and elevated runs share the same short-lived line, and it is
  // tied to a new `lastAction.at` so polling does not pop it open again.
  {
    const realFetch = global.fetch
    global.fetch = async (url) => ({ ok: true, status: 200, json: async () => state })
    try {
      state.lastAction = { at: 100, action: 'custom', code: 1, failed: true, argv: [] }
      await repaint()
      let note = cardEl().querySelector('.dsp-armnote')
      assert.strictEqual(note.hidden, false, 'a failed run raises the note')
      assert.strictEqual(note.textContent, clientText.zh['card.actionFailed'], 'a failed run says so')
      calls.push('action-failed-note-ok')

      state.lastAction = { at: 101, action: 'custom', code: 0, elevated: true, argv: [] }
      await repaint()
      note = cardEl().querySelector('.dsp-armnote')
      assert.strictEqual(note.hidden, false, 'an elevated retry raises the note')
      assert.strictEqual(note.textContent, clientText.zh['card.actionElevated'],
        'an elevated retry names the elevation')

      // Same `at`: another poll must not restart the eight-second window.
      const before = note.textContent
      state.lastAction = { at: 101, action: 'custom', code: 0, elevated: true, argv: [] }
      await repaint()
      assert.strictEqual(cardEl().querySelector('.dsp-armnote').textContent, before,
        'polling the same action does not re-raise the note')
      calls.push('action-elevated-note-ok')
    } finally {
      global.fetch = realFetch
    }
  }

  // 12f. The ack gate is selectable: a custom action waiting for confirmation
  // stays enabled in the picker and the note explains what is still missing.
  {
    state.customEnabled = true
    state.activeProfileId = 'default'
    state.profiles = [{ id: 'default', label: '默认', action: 'custom', script: { sha256: 'abc' }, scriptAck: null }]
    state.actions = { custom: { available: false, reason: 'script-not-acknowledged' }, shutdown: { available: true } }
    await repaint()
    const tree = (() => {
      const el = slots['settings.section'].render({})
      return typeof el.type === 'function' ? el.type({}) : el
    })()
    const walk = (node, visit) => {
      if (!node || node === false) return
      if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
      if (typeof node !== 'object') return
      visit(node)
      if (node.children) node.children.forEach((n) => walk(n, visit))
    }
    let option = null
    let reason = null
    const opts = []
    walk(tree, (n) => {
      if (n.type === 'option') opts.push(n)
      if (n.props && n.props.value === 'custom' && n.type === 'option') option = n
      if (n.props && n.props.className === 'dsp-sreason') reason = n
    })
    assert.ok(option, 'the custom option is rendered: ' + JSON.stringify(opts.map((o) => o.props)))
    assert.strictEqual(option.props.disabled, false, 'a pending acknowledgement stays selectable')
    assert.ok(reason, 'the picker explains the pending reason')
    assert.strictEqual(flat(reason, []).join(''), clientText.zh['action.reason.script-not-acknowledged'],
      'the note names the acknowledgement, not a generic refusal')
    calls.push('action-note-pending-ok')
  }

  // 12g. "解除" on a blocked card is one request: /unblock. Chaining /disarm +
  // /arm (the old shape) armed a guard the user had never turned on.
  {
    state.armed = false
    state.state = 'idle'
    state.blocked = '已暂停：配额不足'
    state.activeProfileId = 'default'
    state.profiles = [{ id: 'default', label: '默认', action: 'shutdown' }]
    state.actions = { shutdown: { available: true }, custom: { available: true } }
    delete state.lastAction
    const realFetch = global.fetch
    const urls = []
    global.fetch = async (url, opts) => {
      if (!opts || opts.method === 'POST') urls.push(String(url))
      return { ok: true, status: 200, json: async () => state }
    }
    try {
      await repaint()
      const btn = cardEl().querySelector('.dsp-btn')
      assert.strictEqual(btn.textContent, clientText.zh['btn.disarm'],
        'a blocked card still offers the clear button')
      for (const fn of (btn._listeners.click || [])) fn({})
      await settle(10)
      const paths = urls.map((u) => u.replace(/^.*\/api\/dsh-shutdown-guard/, ''))
      assert.deepStrictEqual(paths, ['/unblock'],
        'clearing a block sends exactly one request, /unblock')
      assert.ok(!paths.includes('/arm'), 'clearing never arms the guard')
      calls.push('blocked-clear-unblock-only-ok')
    } finally {
      state.blocked = null
      global.fetch = realFetch
    }
  }

  // 13. A rebuild (here: folding the card) creates a brand-new node with no
  // data-lum. The probe is throttled for 3 s, so without a cached answer the
  // fresh node would show the dark default until the next window. The rebuild
  // must carry the light surface over immediately — no clock advance here.
  {
    const auto = mountAutoClient('#ffffff')
    const before = auto.card()
    assert.strictEqual(before.getAttribute('data-lum'), 'light',
      'the first paint marks a light host surface')
    auto.click('.dsp-chead')
    const after = auto.card()
    assert.notStrictEqual(after, before, 'folding rebuilds the card node')
    assert.strictEqual(after.getAttribute('data-lum'), 'light',
      'the rebuilt card keeps the light surface without waiting for the next probe')
  }
  calls.push('surface-kept-across-rebuild-ok')

  console.log('client bundle smoke: PASS')
  console.log('PASS: ' + calls.join(', '))
})().catch((err) => { console.error(err); process.exitCode = 1 })
