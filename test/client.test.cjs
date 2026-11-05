// Structure smoke test for plugins/dsh-shutdown-guard/lib/client.js (v1.1)
// The card is a plain DOM node mounted into the sidebar region; only the
// settings section is a React component, so this test asserts registration
// shape and that apply() runs without a live DOM.
const assert = require('node:assert')
const path = require('node:path')

const state = {
  armed: false, state: 'idle', deadline: 0, countdownSec: 60,
  erroredCount: 0, lastSkip: null, runningCount: 0, rootsCount: 2,
  jobsRunning: 0, jobsTotal: 0,
  // Custom profiles on: the fixture then covers the real path where the
  // profiles group is part of the settings tree.
  customEnabled: true,
  activeProfileId: 'default',
}

global.fetch = async () => ({ ok: true, json: async () => state })
global.setInterval = () => 0
global.clearInterval = () => {}
global.localStorage = { getItem: () => null, setItem: () => {} }
global.document = {
  head: { appendChild() {} },
  querySelector: () => null,
  createElement() {
    return { setAttribute() {}, remove() {}, appendChild() {}, textContent: '', style: {}, className: '', innerHTML: '' }
  },
}
global.window = {
  addEventListener() {}, removeEventListener() {},
  __ModuleLoader__: { load(opts) { global.__captured = opts } },
}

require(path.join(__dirname,'..','lib','client.js'))
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

// --- settings section renders with profiles + events -------------------------
function flat(node, out) {
  if (node == null || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((n) => flat(n, out)); return out }
  if (node.children) node.children.forEach((n) => flat(n, out))
  return out
}
// The slot renders `h(SettingsSection)`; evaluate the component itself.
// The section reads its switch state from the first /state answer, so the
// render has to wait one turn for that stub to resolve.
void (async () => {
  await new Promise((resolve) => setImmediate(resolve))
  const element = slots['settings.section'].render({})
  const rendered = typeof element.type === 'function' ? element.type({}) : element
  const text = flat(rendered, []).join(' | ')
  const missing = ['外观', '判定与关机', 'AFK 自动回答', '自定义配置', '选择配置', '会话都停下来', '后台任务跑完', '倒计时时长', '状态', '上次为什么没关机', '事件日志']
    .filter((n) => !text.includes(n))
  assert.deepStrictEqual(missing, [], 'missing settings labels; got: ' + text.slice(0, 300))
  assert.ok(!text.includes('终端里的 6 个小块'), 'LED legend hidden while variant != C')

  console.log('client bundle smoke: PASS')
})().catch((err) => { console.error(err); process.exitCode = 1 })
