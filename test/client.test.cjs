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
    cssText: '',
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
  addEventListener() {},
  removeEventListener() {},
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

  console.log('client bundle smoke: PASS')
  console.log('PASS: ' + calls.join(', '))
})().catch((err) => { console.error(err); process.exitCode = 1 })
