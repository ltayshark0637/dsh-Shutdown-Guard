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
  // 「判定与关机」这个组标题随结构变更不再渲染（四行并进了「守夜行为」），所以从
  // 清单里删的是标题，不是行：下面四行必须继续在清单里。
  const missing = ['外观', 'AFK 自动回答', '自定义配置', '选择配置', '会话都停下来', '后台任务跑完', '有会话报错就跳过这一轮', '倒计时时长', '状态', '上次为什么没关机', '事件日志']
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

  // Consent is a full-screen confirmation dialog, not a checkbox. The dialog
  // must be escapable without sending anything, and only its primary button may
  // send the dedicated `ackScript` field.
  state.customEnabled = true
  state.activeProfileId = 'default'
  state.profiles = [{
    id: 'default',
    label: '默认配置',
    countdownSec: 60,
    action: 'custom',
    script: { name: 'ack.cmd', ext: 'cmd', bytes: 12, sha256: 'a'.repeat(64), savedAt: 1 },
    scriptAck: null,
  }]
  await repaint()
  {
    const findNode = (cls) => {
      let found = null
      walkNodes(settingsTree(), (n) => {
        if (!found && n.props && typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(cls)) found = n
      })
      return found
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
      if (opts && opts.body) bodies.push(JSON.parse(opts.body))
      if (failNext) {
        const error = 'scriptAck is written by ackScript'
        return { ok: false, json: async () => ({ error, state: 'idle' }) }
      }
      return { ok: true, json: async () => state }
    }
    try {
      const openBtn = findNode('dsp-ackopen')
      assert.ok(openBtn, 'an unconfirmed script renders the confirm button')
      assert.strictEqual(findNode('dsp-ackbox'), null, 'no checkbox remains in the script row')

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
      findNode('dsp-ackopen').props.onClick({ currentTarget: findNode('dsp-ackopen') })
      assert.ok(dialog(), 'the dialog can be opened again')
      const root = dialog()
      for (const fn of (root._listeners.mousedown || []).slice()) fn({ target: root })
      assert.strictEqual(dialog(), null, 'clicking the backdrop closes the dialog')
      assert.strictEqual(bodies.length, 0, 'the backdrop never sends a request')

      // 3. A failed confirmation keeps the dialog open and turns the primary
      // action into a retry. Do not pin the wording of the error message.
      failNext = true
      findNode('dsp-ackopen').props.onClick({ currentTarget: findNode('dsp-ackopen') })
      okBtn()._listeners.click[0]({ preventDefault() {} })
      await settle()
      assert.ok(dialog(), 'a failed confirmation leaves the dialog open')
      assert.ok(errNode() && errNode().textContent.length > 0, 'the dialog shows an error')
      assert.strictEqual(okBtn().textContent, clientText.zh['set.script.dialog.retry'],
        'the primary button offers a retry')
      failNext = false
      esc()

      // 4. Confirm sends ackScript only, then closes.
      findNode('dsp-ackopen').props.onClick({ currentTarget: findNode('dsp-ackopen') })
      okBtn()._listeners.click[0]({ preventDefault() {} })
      await settle()
      assert.deepStrictEqual(bodies[bodies.length - 1], { ackScript: { profileId: 'default' } },
        'confirming sends ackScript only')
      assert.ok(!('updateProfile' in bodies[bodies.length - 1]) && !('patch' in bodies[bodies.length - 1]),
        'confirming never sends a profile patch')
      assert.strictEqual(dialog(), null, 'a successful confirmation closes the dialog')

      // 5. A confirmed script is shown as such and still lets the user reread
      // the disclaimer through the same dialog.
      state.profiles[0].scriptAck = { sha256: 'a'.repeat(64), at: Date.now() }
      await repaint()
      const viewBtn = findNode('dsp-ackview')
      assert.ok(viewBtn, 'a confirmed script offers the details link')
      let status = null
      walkNodes(settingsTree(), (n) => {
        if (n.props && typeof n.props.className === 'string' && n.props.className.includes('dsp-ackstatus')) status = n
      })
      assert.ok(status, 'the confirmed state is rendered')
      const confirmedPrefix = clientText.zh['set.script.confirmed'].split('{time}')[0].trim()
      assert.ok(flat(status, []).join('').includes(confirmedPrefix), 'the row reports the confirmation time')
      viewBtn.props.onClick({ currentTarget: viewBtn })
      assert.ok(dialog(), 'the details link reopens the dialog')
      esc()
    } finally {
      global.fetch = realFetch
    }
    calls.push('script-ack-payload-ok')
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
