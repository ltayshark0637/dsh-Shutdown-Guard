import assert from 'node:assert'
import { apply, hostRestartPlan, judgeLaunchResult, restartHelperLaunch, takeRestartStatus } from '../lib/index.mjs'
import { LANGS, MESSAGES, catalogCoverage, t } from '../lib/i18n.mjs'
import { writeV4SharedScripts, SAMPLES, SHARED_SHA, sha256 } from './fixtures/script-library.mjs'

const spawns = []
const timers = new Map()
// The dsh-autorestart gate asks the real home directory. Point it at an empty
// sandbox so the answer never depends on what happens to be installed on the
// developer's machine; 54e creates the marker there on purpose.
let emptyHome = ''
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const os = await import('node:os')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  emptyHome = pathMod.join(os.tmpdir(), 'dsh-guard-empty-home-' + process.pid)
  fs.mkdirSync(emptyHome, { recursive: true })
  process.env.USERPROFILE = emptyHome
  process.env.HOME = emptyHome
  const cfg = pathMod.join(here, '..', 'data', 'config.json')
  try { fs.unlinkSync(cfg) } catch { /* absent on a first run */ }
  // Same for the UI preferences: assertion 26 expects the shipped defaults.
  const uiFile = pathMod.join(here, '..', 'data', 'ui.json')
  try { fs.unlinkSync(uiFile) } catch { /* absent on a first run */ }
}
const routes = new Map()
let statusHandler = null
let errorHandler = null
let sessionHandler = null

const nudges = []
const rootAgent = { id: 'root-1', status: 'idle', followup: (message) => { nudges.push(message) } }
let rootsValue = [rootAgent]

const agents = {
  roots: () => rootsValue,
}
const subprocess = {
  resolveExecutable: async (name) => `C:\\Windows\\System32\\${name}.exe`,
  spawn: (options) => {
    spawns.push(options.argv)
    return { done: Promise.resolve({ code: 0 }) }
  },
}
const webServer = {
  register(route) {
    assert.ok(!routes.has(route.path), `duplicate route ${route.path}`)
    routes.set(route.path, route.handler)
    return () => routes.delete(route.path)
  },
}
let jobListener = null
let questionHandler = null
let questionOptions = null
let jobFilterSeen = null
const jobs = {
  events: {
    subscribe(filter, listener) {
      jobFilterSeen = filter
      jobListener = listener
      return () => { jobListener = null }
    },
  },
}
function emitJob(event) {
  assert.ok(jobListener, 'job event subscription is live')
  jobListener(event)
}

let timerSeq = 0
const ctx = {
  get(name) {
    if (name === 'agents') return agents
    if (name === 'subprocess') return subprocess
    if (name === 'webServer') return webServer
    if (name === 'jobs') return jobs
    return undefined
  },
  on(name, cb) {
    if (name === 'agent/status') statusHandler = cb
    if (name === 'agent/error') errorHandler = cb
    if (name === 'session/event') sessionHandler = cb
    if (name === 'user-questions/request') { questionHandler = cb; questionOptions = arguments[2] }
    return () => {}
  },
  setTimeout(cb) {
    const id = ++timerSeq
    timers.set(id, cb)
    return () => timers.delete(id)
  },
}

// language: 'zh' pins the assertions below: 'auto' would follow the runner's
// locale, and CI happens to be en-US.
const dispose = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' }) // default profile is locked to 60s

const calls = []
function request(method, path, origin, payload) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      body: '',
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body; resolve(this) },
    }
    // Minimal readable-stream stand-in so handlers can read a JSON body.
    const listeners = {}
    const req = {
      method,
      url: path,
      headers: origin === undefined ? {} : { origin },
      on(event, fn) { (listeners[event] = listeners[event] || []).push(fn) },
      destroy() {},
    }
    const handler = routes.get(path.split('?')[0])
    assert.ok(handler, `route ${path} registered`)
    handler(req, res)
    if (payload !== undefined) {
      const text = JSON.stringify(payload)
      setImmediate(() => {
        ;(listeners.data || []).forEach((fn) => fn(text))
        ;(listeners.end || []).forEach((fn) => fn())
      })
    }
  })
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Timer ids registered since `before` was captured, in registration order. */
function newTimers(before) {
  return [...timers.keys()].filter((id) => !before.has(id))
}
function fireTimer(id) {
  const cb = timers.get(id)
  assert.ok(cb, `timer ${id} is still registered`)
  cb()
}

assert.deepStrictEqual(
  [...routes.keys()].sort(),
  ['/api/dsh-shutdown-guard/arm', '/api/dsh-shutdown-guard/cancel', '/api/dsh-shutdown-guard/config', '/api/dsh-shutdown-guard/disarm', '/api/dsh-shutdown-guard/events', '/api/dsh-shutdown-guard/state', '/api/dsh-shutdown-guard/ui', '/api/dsh-shutdown-guard/unblock', '/api/dsh-shutdown-guard/window'],
)

// 1. initial state
let res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(res.status, 200)
let body = JSON.parse(res.body)
assert.strictEqual(body.armed, false)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.countdownSec, 60) // default profile is locked to 60s
assert.strictEqual(body.countdownLocked, true)
calls.push('initial-state-ok')

// 2. method guard
res = await request('GET', '/api/dsh-shutdown-guard/arm')
assert.strictEqual(res.status, 405)
calls.push('method-guard-ok')

// 3. foreign origin rejected
res = await request('POST', '/api/dsh-shutdown-guard/arm', 'http://evil.example.com')
assert.strictEqual(res.status, 403)
calls.push('origin-guard-ok')

// 4. arm from loopback
res = await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
assert.strictEqual(res.status, 200)
assert.strictEqual(JSON.parse(res.body).armed, true)
calls.push('arm-ok')

// 5. last agent goes idle -> countdown only. Nothing is handed to the OS at
// arm time any more: every action is inline and fires at the deadline.
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
assert.strictEqual(spawns.length, 0, 'nothing is sent when the countdown starts')
await flush()
assert.strictEqual(spawns.length, 0, 'still nothing after the arm settles')
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.strictEqual(body.state, 'countdown')
assert.ok(body.deadline > Date.now() - 1000)
calls.push('countdown-ok')

// 6. a new task starts -> the countdown is dropped, but no undo command exists
// to send (nothing ever left the process) and the mode stays armed.
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
await flush()
assert.strictEqual(spawns.length, 0, 'cancelling an inline countdown sends nothing')
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.armed, true, 'running keeps the mode armed')
calls.push('auto-cancel-keeps-armed-ok')

// 7. error in the batch -> skip
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle', 'skipped because of the error')
assert.strictEqual(body.erroredCount, 1)
assert.ok(body.lastSkip && /出错/.test(body.lastSkip.reason))
calls.push('error-skip-ok')

// 8. clean batch -> countdown, the deadline timer sends one immediate `/s /t 0`,
// and only the later fired timer flips the state. Cancel then sends nothing.
const firedBefore = new Set(timers.keys())
statusHandler({ agent: rootAgent, status: 'running' })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'countdown')
assert.strictEqual(body.erroredCount, 0)
assert.strictEqual(spawns.length, 0, 'the countdown itself sends nothing')

const timersForFired = newTimers(firedBefore)
assert.ok(timersForFired.length >= 2, 'the countdown registered the deadline and the fired timer')
fireTimer(timersForFired[0])
await flush()
assert.strictEqual(spawns.length, 1, 'the deadline sends exactly one command')
assert.deepStrictEqual(spawns[0].slice(1), ['/s', '/t', '0'], 'win32 shutdown is immediate now')
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'countdown', 'the command is out but the state has not flipped yet')
fireTimer(timersForFired[1])
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'fired')

const before = spawns.length
res = await request('POST', '/api/dsh-shutdown-guard/cancel', 'http://localhost:43129')
await flush()
const cancelBody = JSON.parse(res.body)
assert.strictEqual(cancelBody.ok, true)
assert.strictEqual(spawns.length, before, 'cancel never sends an undo command')
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.armed, true, 'cancel keeps the mode armed')
calls.push('fired-and-cancel-ok')

// 9. a running background job blocks arming (no /s), and settles -> arm
assert.deepStrictEqual(jobFilterSeen, { owners: 'all' }, 'subscribes to every owner')
emitJob({ type: 'registered', job: { id: 'bash-1', kind: 'bash', label: '后台构建', status: 'running' } })
let beforeJobs = spawns.length
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeJobs, 'no shutdown while a background job runs')
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.armed, true)
assert.strictEqual(body.jobsRunning, 1)
assert.ok(body.lastSkip && /后台任务/.test(body.lastSkip.reason), 'skip reason mentions background jobs')
calls.push('job-blocks-arm-ok')

emitJob({ type: 'settled', job: { id: 'bash-1', kind: 'bash', label: '后台构建', status: 'completed' } })
await flush()
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'countdown', 'settling the last job arms the shutdown')
assert.strictEqual(body.jobsRunning, 0)
calls.push('job-settle-arms-ok')

// 10. a job starting during the countdown drops it but keeps the mode armed,
// and sends nothing (there is no OS-held timer to undo any more).
const beforeJobCancel = spawns.length
emitJob({ type: 'registered', job: { id: 'bash-2', kind: 'bash', label: '后台测试', status: 'running' } })
await flush()
assert.strictEqual(spawns.length, beforeJobCancel, 'a countdown cancel sends nothing')
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.armed, true)
assert.strictEqual(body.jobsRunning, 1)
emitJob({ type: 'settled', job: { id: 'bash-2', kind: 'bash', label: '后台测试', status: 'completed' } })
await flush()
assert.strictEqual(JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body).state, 'countdown', 'settling arms again')
calls.push('job-during-countdown-cancels-ok')

// 11. disarm
res = await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
assert.strictEqual(JSON.parse(res.body).armed, false)
calls.push('disarm-ok')

// 12. profiles: a fresh store ships only the default one; custom slots are
// created on demand, and the config persists to data/config.json
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.profiles.length, 1, 'a new install ships only the default profile')
assert.strictEqual(body.activeProfileId, 'default')
assert.strictEqual(body.customEnabled, false)
calls.push('profiles-listed-ok')

// The behaviour tests below run on c3, so materialise c1..c3 first.
for (let i = 1; i <= 3; i += 1) {
  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { createProfile: {} })
  assert.strictEqual(res.status, 200, 'createProfile succeeds')
}
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.deepStrictEqual(body.profiles.map((p) => p.id), ['default', 'c1', 'c2', 'c3'], 'ids are assigned in order')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { profileId: 'c3', patch: { countdownSec: 120, onlyOnSuccess: false } })
body = JSON.parse(res.body)
const c3 = body.profiles.find((p) => p.id === 'c3')
assert.strictEqual(c3.countdownSec, 120, 'custom slot stores countdown')
assert.strictEqual(c3.onlyOnSuccess, false, 'custom slot stores success rule')
calls.push('custom-profile-write-ok')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { activeProfileId: 'c3' })
assert.strictEqual(res.status, 400, 'custom slot unusable while custom profiles are off')
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true, activeProfileId: 'c3' })
body = JSON.parse(res.body)
assert.strictEqual(body.customEnabled, true)
assert.strictEqual(body.activeProfileId, 'c3')
assert.strictEqual(body.countdownSec, 120, 'active profile drives the countdown')
assert.strictEqual(body.onlyOnSuccess, false)
calls.push('profile-switch-ok')

const fsx = await import('node:fs')
const cfgPath = (await import('node:path')).join((await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)), '..', 'data', 'config.json')
assert.ok(fsx.existsSync(cfgPath), 'config.json is written next to the plugin')
const saved = JSON.parse(fsx.readFileSync(cfgPath, 'utf8'))
assert.strictEqual(saved.activeProfileId, 'c3')
assert.strictEqual(saved.profiles.find((p) => p.id === 'c3').countdownSec, 120)
calls.push('config-persisted-ok')

// 13. events ring buffer
res = await request('GET', '/api/dsh-shutdown-guard/events?limit=5')
body = JSON.parse(res.body)
assert.ok(Array.isArray(body.events) && body.events.length > 0, 'events are served')
assert.ok(body.events.every((e) => typeof e.text === 'string' && typeof e.at === 'number'))
calls.push('events-ok')

// 13b. Event text is re-rendered from key/params in the active language; the
// text recorded at write time is not frozen. Regression: recentEvents(lang,
// since) lost its lang argument, so every event silently fell back to English.
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
const oldestEvent = body.events[0]
assert.ok(oldestEvent && typeof oldestEvent.key === 'string' && oldestEvent.key.length > 0, 'the oldest event keeps its key')
assert.strictEqual(oldestEvent.text, t('zh', oldestEvent.key, oldestEvent.params), 'event text matches the active zh catalog')
assert.match(oldestEvent.text, /[\u4e00-\u9fa5]/, 'the event text is not the English fallback')
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { language: 'ru' })
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.notStrictEqual(body.events[0].text, oldestEvent.text, 'switching language re-renders stored events')
assert.match(body.events[0].text, /[\u0400-\u04FF]/, 'the re-rendered event is Russian')
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { language: 'zh' })
calls.push('events-i18n-ok')

// 13c. ?since= is an incremental cursor; a swapped argument order would return
// the whole buffer on every poll and break the client's lastEventAt logic.
const allEvents = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/events?limit=100')).body).events
assert.ok(allEvents.length > 0, 'events are available')
const eventCursor = allEvents[allEvents.length - 1].at
const newerEvents = JSON.parse((await request('GET', `/api/dsh-shutdown-guard/events?since=${eventCursor}`)).body).events
assert.ok(newerEvents.length < allEvents.length, 'since returns only the events after the cursor')
assert.ok(newerEvents.every((e) => e.at > eventCursor), 'every returned event is newer than the cursor')
calls.push('events-since-ok')

await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: false, activeProfileId: 'default' })

// 14. the default profile is the safety baseline: the timer and the three hard
// gates cannot be edited there, and the rejection names the field.
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { updateProfile: { id: 'default', patch: { countdownSec: 300 } } })
body = JSON.parse(res.body)
assert.strictEqual(res.status, 400, 'the default profile rejects a timer change')
assert.ok(body.error.includes('countdownSec'), 'the rejection names the locked field')
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { updateProfile: { id: 'default', patch: { blockOnJobs: false } } })
assert.strictEqual(res.status, 400, 'the default profile rejects a gate change')
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.strictEqual(body.profiles.find((p) => p.id === 'default').countdownSec, 60, 'default countdown is locked')
assert.strictEqual(body.profiles.find((p) => p.id === 'default').onlyOnSuccess, true, 'default gates stay on')
calls.push('default-locked-ok')

// Behaviour tests below need a profile whose gates can be loosened: c3 was
// patched above and is the one the user would arm with.
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true, activeProfileId: 'c3' })
assert.strictEqual(JSON.parse(res.body).activeProfileId, 'c3', 'the behaviour tests run on a custom profile')

// 15. AFK auto answer while armed
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
assert.ok(questionHandler, 'user-questions/request is subscribed')
assert.deepStrictEqual(questionOptions, { prepend: true }, 'listener must run before the built-in web answerer')
let handedOff = false
let canned = questionHandler({ questions: [{ id: 'q1', question: '继续吗？', options: [{ id: 'a', label: '继续' }] }] }, () => { handedOff = true })
assert.strictEqual(handedOff, false, 'afk answer intercepts the question')
assert.ok(Array.isArray(canned.answers) && canned.answers.length === 1)
assert.strictEqual(canned.answers[0].id, 'q1')
assert.deepStrictEqual(canned.answers[0].selected, [])
assert.ok(canned.answers[0].custom.includes('AFK'), 'custom answer explains AFK state')
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { afkAutoAnswer: false })
handedOff = false
canned = questionHandler({ questions: [{ id: 'q2', question: '继续吗？' }] }, () => { handedOff = true })
assert.strictEqual(handedOff, true, 'switching afk off hands the question back')
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { afkAutoAnswer: true })
calls.push('afk-answer-ok')

// 16. AFK error recovery: first failure asks the agent to investigate and
// continue, the second asks it to wrap up, and the third stops nudging.
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
nudges.length = 0
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent })
await flush()
assert.strictEqual(nudges.length, 1, 'first failure queues one recovery turn')
assert.ok(nudges[0].content[0].text.includes('AFK 自动接管'), 'recovery text asks the agent to investigate')
assert.ok(nudges[0].content[0].text.includes('按原计划继续'), 'recovery text keeps the original plan')
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
errorHandler({ agent: rootAgent })
await flush()
assert.strictEqual(nudges.length, 2, 'second failure queues a wrap-up turn')
assert.ok(nudges[1].content[0].text.includes('AFK 收尾'), 'wrap-up text asks for a written report')
errorHandler({ agent: rootAgent })
await flush()
assert.strictEqual(nudges.length, 2, 'third failure does not nudge again')
calls.push('afk-recover-ok')

// 17. "有会话报错就跳过" off + AFK on: once the wrap-up turn ends, the errored
// batch no longer blocks the shutdown.
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  updateProfile: { id: 'c3', patch: { onlyOnSuccess: false } },
})
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
nudges.length = 0
const beforeWrap = spawns.length
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent })
await flush()
assert.strictEqual(nudges.length, 1, 'first failure still asks to investigate')
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
assert.strictEqual(spawns.length, beforeWrap, 'recovery in progress must not shut down')
errorHandler({ agent: rootAgent })
await flush()
assert.strictEqual(nudges.length, 2, 'second failure asks for the wrap-up')
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeWrap, 'wrap-up finished: the countdown starts, nothing is sent')
assert.strictEqual(JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body).state, 'countdown', 'wrap-up finished: shutdown is armed')
await request('POST', '/api/dsh-shutdown-guard/cancel', 'http://127.0.0.1:43129')
calls.push('afk-wrap-shutdown-ok')

// 18. Quota errors park the plugin: no nudge, and the shutdown never arms.
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  updateProfile: { id: 'c3', patch: { onlyOnSuccess: false } },
})
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
nudges.length = 0
const beforeQuota = spawns.length
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent, error: { code: 'QUOTA', message: 'no quota' } })
await flush()
assert.strictEqual(nudges.length, 0, 'quota errors must not be re-prompted')
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.ok(typeof body.blocked === 'string' && body.blocked.includes('额度不足'), 'state reports the block')
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeQuota, 'a blocked batch never arms the shutdown')
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).blocked, null, 'disarming clears the block')
calls.push('quota-block-ok')
// Back to the shipped baseline so the remaining assertions see the locked gates.
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: false, activeProfileId: 'default' })
// 19. A cancelled turn is not a failure: no nudge, no errored entry.
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
nudges.length = 0
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent, error: Object.assign(new Error('aborted'), { name: 'AbortError' }) })
await flush()
assert.strictEqual(nudges.length, 0, 'a cancelled turn is never re-prompted')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).erroredCount, 0, 'a cancelled turn is not an errored batch')
calls.push('abort-ignored-ok')

// 20. Context-window overflow parks the plugin with its own reason.
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent, error: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'too long' } })
await flush()
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.ok(JSON.parse(res.body).blocked.includes('上下文'), 'context overflow has its own reason')
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
calls.push('context-window-block-ok')

// 21. A user cancel also ends at status=idle. The session log records the abort
// cause, and an interrupted batch must never arm the shutdown.
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
const beforeAbort = spawns.length
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
sessionHandler({}, { type: 'turn/start', data: { turn: 1 } })
  sessionHandler({}, { type: 'turn/end', data: { turn: 1, cause: { kind: 'user' } } })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeAbort, 'an interrupted batch never arms the shutdown')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).state, 'idle', 'the plugin stays idle')
// A fresh turn clears the flag, so the next completed batch behaves normally.
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeAbort, 'the next completed run may arm again, sending nothing yet')
assert.strictEqual(JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body).state, 'countdown', 'the next completed run enters the countdown')
await request('POST', '/api/dsh-shutdown-guard/cancel', 'http://127.0.0.1:43129')
calls.push('interrupt-ignored-ok')

// 22. Provider-side failures wait and retry instead of asking a human.
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
nudges.length = 0
const beforeLimit = spawns.length
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent, error: { code: 'RATE_LIMIT', message: 'slow down' } })
await flush()
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.ok(typeof body.blocked === 'string' && body.blocked.includes('限流'), 'rate limit parks with a retry reason')
assert.strictEqual(body.retryAttempt, 1, 'first provider failure counts one attempt')
assert.ok(body.retryAt > Date.now() - 1000, 'a retry deadline is published')
assert.strictEqual(nudges.length, 0, 'the first failure does not nudge immediately')
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
assert.strictEqual(spawns.length, beforeLimit, 'a waiting batch never arms the shutdown')
const retryTimer = [...timers.entries()].pop()
timers.delete(retryTimer[0])
retryTimer[1]()
await flush()
assert.strictEqual(nudges.length, 1, 'the retry timer nudges the agent')
assert.ok(nudges[0].content[0].text.includes('自动重试'), 'retry text mentions the automatic retry')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).blocked, null, 'the retry clears the park')

// 23. Different failures wait differently: a rate limit backs off, a dropped
// connection polls at a fixed short interval, an offload request is fastest.
async function delayFor(code, attemptPad) {
  await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
  await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
  rootAgent.status = 'running'
  statusHandler({ agent: rootAgent, status: 'running' })
  for (let i = 0; i < attemptPad; i += 1) {
    errorHandler({ agent: rootAgent, error: { code, message: 'again' } })
    await flush()
  }
  errorHandler({ agent: rootAgent, error: { code, message: 'again' } })
  await flush()
  const r = await request('GET', '/api/dsh-shutdown-guard/state')
  const b = JSON.parse(r.body)
  const m = /(\d+) 秒后重试/.exec(b.blocked || '')
  return m ? Number(m[1]) : -1
}
const rateFirst = await delayFor('RATE_LIMIT', 0)
assert.strictEqual(rateFirst, 30, 'rate limit starts at its 30s base')
const rateSecond = await delayFor('RATE_LIMIT', 1)
assert.strictEqual(rateSecond, 60, 'rate limit backs off to 60s on the second try')
const serverFirst = await delayFor('SERVER', 0)
assert.strictEqual(serverFirst, 20, 'server errors poll at a fixed 20s')
const serverSecond = await delayFor('SERVER', 1)
assert.strictEqual(serverSecond, 20, 'server polling does not grow')
const offloadFirst = await delayFor('IMAGE_OFFLOAD_REQUIRED', 0)
assert.strictEqual(offloadFirst, 5, 'image offload retries quickly')
calls.push('retry-policy-ok')

// 24. A blocked event stores a *reference* to its reason, not a finished
// sentence: switching the language must re-render the inner reason too, with the
// wrapper and the retry suffix around it. Params that are plain strings keep
// working exactly as before, so old history is never lost or re-interpreted.
await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
errorHandler({ agent: rootAgent, error: { code: 'RATE_LIMIT', message: 'slow down' } })
await flush()

async function eventByKey(key) {
  const r = await request('GET', '/api/dsh-shutdown-guard/events?since=0')
  const list = JSON.parse(r.body).events.filter((e) => e.key === key)
  return list[list.length - 1] || null
}

const blockedEventZh = await eventByKey('log.retryScheduled')
assert.ok(blockedEventZh, 'the blocked event is recorded')
assert.ok(blockedEventZh.text.includes('等待恢复'), 'the wrapper survives the nesting')
assert.ok(blockedEventZh.text.includes('被限流'), 'the nested reason renders in Chinese')
assert.ok(/第 \d+ 次/.test(blockedEventZh.text), 'the retry suffix survives the nesting')
assert.ok(!blockedEventZh.text.includes('[object Object]'), 'the reference is expanded, never stringified')
assert.ok(blockedEventZh.params && typeof blockedEventZh.params.reason === 'object', 'the stored param is a reference, so it can be re-rendered')

await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { language: 'ru' })
const blockedEventRu = await eventByKey('log.retryScheduled')
assert.ok(blockedEventRu.text.includes('Ожидание восстановления'), 'the wrapper re-renders in Russian')
assert.ok(blockedEventRu.text.includes('Ограничение частоты'), 'the nested reason re-renders in Russian')
assert.ok(/[\u0400-\u04FF]/.test(blockedEventRu.text), 'the Russian line carries Cyrillic')
assert.ok(!/[\u4e00-\u9fff]/.test(blockedEventRu.text), 'no Chinese is left inside the Russian line')
assert.ok(!blockedEventRu.text.includes('[object Object]'), 'the Russian line is expanded too')
assert.strictEqual(blockedEventRu.at, blockedEventZh.at, 'the same event is re-rendered, not replaced')

await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { language: 'zh' })
const blockedEventBack = await eventByKey('log.retryScheduled')
assert.strictEqual(blockedEventBack.text, blockedEventZh.text, 'switching back restores the Chinese line exactly')

// Legacy shape: a param that was stored as a plain string still renders as-is,
// and mixing plain values with references in one event works.
const plain = await eventByKey('log.retryScheduled')
assert.strictEqual(typeof plain.params.code, 'string', 'plain string params are untouched')
assert.ok(plain.text.includes('RATE_LIMIT'), 'plain string params still land in the text')
const renderedEvents = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/events?since=0')).body).events
assert.ok(renderedEvents.length > 0 && renderedEvents.every((e) => typeof e.text === 'string' && e.text.length > 0), 'every event keeps a rendered line')
assert.ok(renderedEvents.every((e) => !e.text.includes('[object Object]')), 'no event ever leaks a stringified object')
calls.push('events-nested-i18n-ok')

// 24. i18n catalog: the three shipped languages keep the same key set, so a
// half-translated card can never ship unnoticed.
assert.deepStrictEqual(LANGS, ['zh', 'en', 'ru'], 'the shipped language list is fixed')
const coverage = catalogCoverage()
assert.deepStrictEqual(coverage.missing, {}, 'every language defines every zh key')
assert.ok(coverage.base.length > 0, 'the base catalog is not empty')
for (const lang of LANGS) {
  assert.strictEqual(Object.keys(MESSAGES[lang]).length, coverage.base.length, `${lang} has the same key count as the base`)
}
calls.push('i18n-coverage-ok')

// 25. Floating window page: a self-contained read-only document served by the
// host. Assert only the contract (status, type, doctype, product name) — the
// copy inside the page changes with language and must not be locked here.
res = await request('GET', '/api/dsh-shutdown-guard/window')
assert.strictEqual(res.status, 200, 'the window page responds')
assert.match(String(res.headers['content-type'] || ''), /text\/html/i, 'the window page is HTML')
assert.ok(res.body.toLowerCase().includes('<!doctype html'), 'the window page is a full document')
assert.ok(res.body.includes('dsh-shutdown-guard'), 'the window page names the plugin')
calls.push('window-page-ok')

// 25b. The window mirrors the card's counters. B's run dots and C's agent counter
// read the live-agent total (roots + children), not the root-only runningCount, so
// a Team of subagents cannot show 3 dots in the sidebar and 1 in the window.
// Asserted on the served HTML because both numbers come from the runtime /state.
assert.ok(res.body.includes('agentRunningTotal'), 'the window reads the live-agent total')
assert.ok(res.body.includes('DOT_CAP'), 'the run dots are capped like the card')
assert.match(res.body, /DOT_CAP\s*=\s*12/, 'the cap matches the card value')
assert.ok(res.body.includes('dsp-rplus'), 'the overflow badge uses the card class')
assert.ok(res.body.includes('radarAria'), 'the dots carry a translated aria label')
assert.ok(res.body.includes("setAttribute('role', 'img')"), 'the dots container is an img role')
assert.ok(!res.body.includes("Number(snap.runningCount) || 0, 'run'"), 'run dots no longer count roots only')
calls.push('window-radar-parity-ok')

// 25c. Hazard tape: both stripes derive from the accent hue, except for our own
// amber palette, where the familiar yellow/red pair returns while the card is
// armed. Count occurrences, not `includes`, so a duplicated literal (the old
// implementation wrote them twice) cannot slip through.
{
  const countOf = (haystack, needle) => haystack.split(needle).length - 1
  assert.strictEqual(countOf(res.body, '--dsp-tape-a:#f2b13c'), 1, 'the amber tape stripe is declared exactly once')
  assert.strictEqual(countOf(res.body, '--dsp-tape-b:#e8453c'), 1, 'the red tape stripe is declared exactly once')
  assert.ok(res.body.includes(':not(.dsp-claude):not([data-state="off"]):not([data-state="blocked"])'),
    'the yellow/red tape belongs to the non-Claude card while it is armed')
  assert.ok(res.body.includes('oklch(from var(--dsp-accent)'), 'the stripes follow the accent hue where supported')
  assert.ok(res.body.includes('color-mix(in oklch, var(--dsp-accent) 76%'), 'the fallback stripes mix toward white/black')
  assert.ok(res.body.includes('@property --dsp-tape-a'), 'the tape colour is interpolable, so state changes can animate')
  assert.ok(res.body.includes('prefers-reduced-motion: reduce'), 'reduced-motion users get no tape transition')
  for (const stale of ['#e08a5f', '#f0b03a', '#b8483a', '#e0483c']) {
    assert.ok(!res.body.includes(stale), `the old tape literal ${stale} is gone`)
  }
  calls.push('window-tape-ok')
}

// 25d. The window's copy follows the action, not the name of the plugin. It has
// its own table (a separate document cannot read the client bundle), so assert
// the mechanism rather than the literal words: every title/cancel/fired string
// takes an {action}, and the terminal command line is painted from /state.
// A profile that runs "lock" must not print "shutdown --when idle".
{
  const countOf = (haystack, needle) => haystack.split(needle).length - 1
  assert.ok(res.body.includes("cardTitle: '任务完成后{action}'"), 'the window title interpolates the action')
  assert.strictEqual(countOf(res.body, 'btnCancel: '), 3, 'every language cancels the action it runs')
  assert.ok(res.body.includes("bigFired: '已{action}'"), 'the fired headline names the action that ran')
  assert.strictEqual(countOf(res.body, 'termCmd: '), 3, 'every language carries the command template')
  assert.ok(res.body.includes('<span class="dsp-cmdtext"></span>'),
    'the terminal line is a paint target, not a hard-coded shutdown')
  assert.ok(!res.body.includes('&gt;</span>shutdown --when idle'),
    'the old hard-coded terminal command is gone')
  assert.ok(res.body.includes("snap.activeActionLabel"), 'the window reads the label the host computed')
  assert.ok(res.body.includes('ACTION_COMMANDS'), 'the command table mirrors the client bundle')
  assert.ok(res.body.includes("signoff"), 'the table covers the actions the host can actually run')
  calls.push('window-action-copy-ok')
}

// 25e. /state carries the action twice on purpose: an id for the window's
// decorative command line and a localised label for its text. The label has to
// follow the profile, not the plugin: a hard-coded "关机" would pass a weaker
// check, so compare the label across two different actions.
{
  const cfg = 'http://127.0.0.1:43129'
  const read = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  const activeId = (await read()).activeProfileId
  const setAction = (action) =>
    request('POST', '/api/dsh-shutdown-guard/config', cfg, { updateProfile: { id: activeId, patch: { action } } })

  await setAction('sleep')
  const sleeping = await read()
  assert.strictEqual(sleeping.activeAction, 'sleep', '/state reports the active action id')
  assert.ok(sleeping.activeActionLabel && !/[{}]/.test(sleeping.activeActionLabel),
    'the label is already rendered, with no {action} left in it')

  await setAction('shutdown')
  const done = await read()
  assert.strictEqual(done.activeAction, 'shutdown', 'the id follows a later switch')
  assert.notStrictEqual(done.activeActionLabel, sleeping.activeActionLabel,
    'the label follows the action, not a hard-coded word')
  assert.notStrictEqual(done.activeActionLabel, done.activeAction,
    'the label is a translated name, not the raw id')
  calls.push('state-active-action-ok')
}

// 26. UI preferences live on the host, not in the window's localStorage: both
// surfaces must agree even when they sit in different storage partitions.
// Defaults are A / auto / auto plus compact on and every notify kind on; a POST
// replaces only the given fields; an unknown value is rejected instead of
// silently replaced, and the choice survives a restart through data/ui.json.
const NOTIFY_ALL = { countdown: true, fired: true, blocked: true, recovered: true }
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'A', theme: 'auto', lang: 'auto', compact: true }, 'UI defaults are A / auto / auto with compact and every notify kind on')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { variant: 'B', theme: 'light', lang: 'ru' })
assert.strictEqual(res.status, 200, 'a valid UI update is accepted')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'light', lang: 'ru', compact: true }, 'the POST response already carries the new UI')

res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'light', lang: 'ru', compact: true }, '/state reports the stored UI')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { theme: 'dark' })
assert.strictEqual(res.status, 200, 'an omitted field is not required')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'dark', lang: 'ru', compact: true }, 'omitted fields keep their value')

for (const bad of [{ variant: 'D' }, { theme: 'sepia' }, { lang: 'fr' }]) {
  res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', bad)
  assert.strictEqual(res.status, 400, `unknown value ${JSON.stringify(bad)} is rejected, not silently replaced`)
}
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'dark', lang: 'ru', compact: true }, 'a rejected update leaves the stored UI untouched')

{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const saved = JSON.parse(fs.readFileSync(pathMod.join(here, '..', 'data', 'ui.json'), 'utf8'))
  assert.deepStrictEqual(
    { variant: saved.variant, theme: saved.theme, lang: saved.lang, compact: saved.compact },
    { variant: 'B', theme: 'dark', lang: 'ru', compact: true },
    'the UI choice is persisted for the next start',
  )
}

await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { variant: 'A', theme: 'auto', lang: 'auto' })
calls.push('ui-state-ok')

// 27. Compact ships on: the floating window is just the card unless the settings
// row turns that off, and the window has no switch of its own any more.
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).ui.compact, true, 'compact ships on')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { compact: false })
assert.strictEqual(res.status, 200, 'compact can be turned off')
assert.strictEqual(JSON.parse(res.body).ui.compact, false, 'the POST response carries it')
assert.deepStrictEqual(
  { variant: JSON.parse(res.body).ui.variant, theme: JSON.parse(res.body).ui.theme, lang: JSON.parse(res.body).ui.lang },
  { variant: 'A', theme: 'auto', lang: 'auto' },
  'turning compact off leaves the other UI fields alone',
)
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).ui.compact, false, '/state reports compact, so the window follows without localStorage')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { compact: 'yes' })
assert.strictEqual(res.status, 400, 'a non-boolean compact is rejected')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.strictEqual(JSON.parse(res.body).ui.compact, false, 'the rejection does not change the stored value')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { compact: true })
assert.strictEqual(JSON.parse(res.body).ui.compact, true, 'compact can be turned back on')
calls.push('ui-compact-ok')

// 28. A profile is a behaviour snapshot: the timer, the three gates, AFK
// auto-answer, the four notification kinds and the retry policy all travel
// together, and the settings page manages them through /config.
res = await request('GET', '/api/dsh-shutdown-guard/state')
{
  const dflt = JSON.parse(res.body).profiles.find((p) => p.id === 'default')
  assert.strictEqual(dflt.afkAutoAnswer, true, 'profiles carry AFK auto-answer')
  assert.deepStrictEqual(dflt.notify, NOTIFY_ALL, 'profiles carry the four notification kinds')
  assert.strictEqual(JSON.parse(res.body).notify.countdown, true, 'the active profile mirrors its notify kinds on /state')
}
assert.strictEqual(JSON.parse(res.body).ui.notify, undefined, 'notify is no longer part of the UI store')

// /ui must not accept it any more: the setting moved, and the client has to hear
// about that instead of writing a field nobody reads.
res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: true })
assert.strictEqual(res.status, 400, 'a notify write through /ui is rejected')
assert.match(String(JSON.parse(res.body).error || ''), /profile/, 'the rejection points at the profile store')

// A whitelisted patch merges per kind and ignores unknown fields on purpose.
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  updateProfile: { id: 'c3', patch: { notify: { blocked: false }, afkAutoAnswer: false, nonsense: 1 } },
})
assert.strictEqual(res.status, 200, 'a whitelisted profile patch is accepted')
{
  const c3 = JSON.parse(res.body).profiles.find((p) => p.id === 'c3')
  assert.deepStrictEqual(c3.notify, { countdown: true, fired: true, blocked: false, recovered: true }, 'only the named notify kind changes')
  assert.strictEqual(c3.afkAutoAnswer, false, 'AFK auto-answer is per profile')
}

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  updateProfile: { id: 'c3', patch: { notify: { blocked: 'yes' } } },
})
assert.strictEqual(res.status, 400, 'a non-boolean notify kind is rejected')
assert.match(String(JSON.parse(res.body).error || ''), /notify\.blocked/, 'the rejection names the offending kind')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  updateProfile: { id: 'default', patch: { afkAutoAnswer: false } },
})
assert.strictEqual(res.status, 400, 'the default profile keeps AFK on')
assert.match(String(JSON.parse(res.body).error || ''), /afkAutoAnswer/, 'the rejection names the locked gate')

// create / rename / setDefault / delete round trip.
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true })
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  createProfile: { label: '夜里跑批', from: 'c3' },
})
assert.strictEqual(res.status, 200, 'a profile can be created')
let created = JSON.parse(res.body).profiles.find((p) => p.label === '夜里跑批')
assert.ok(created, 'the created profile is listed')
assert.strictEqual(created.notify.blocked, false, 'create copies the source profile behaviour')
const createdId = created.id

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  renameProfile: { id: createdId, label: '夜里跑批 v2' },
})
assert.strictEqual(JSON.parse(res.body).profiles.find((p) => p.id === createdId).label, '夜里跑批 v2', 'rename sticks')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { setDefault: createdId })
assert.strictEqual(res.status, 200, 'setDefault switches the active profile')
assert.strictEqual(JSON.parse(res.body).activeProfileId, createdId, 'the active profile follows setDefault')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { deleteProfile: createdId })
assert.strictEqual(res.status, 200, 'a profile can be deleted')
assert.ok(!JSON.parse(res.body).profiles.find((p) => p.label === '夜里跑批 v2'), 'the deleted profile is gone')
assert.strictEqual(JSON.parse(res.body).activeProfileId, 'default', 'deleting the active profile falls back to the baseline')

res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { deleteProfile: 'default' })
assert.strictEqual(res.status, 400, 'the default profile cannot be deleted')

{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const saved = JSON.parse(fs.readFileSync(pathMod.join(here, '..', 'data', 'config.json'), 'utf8'))
  // v4 adds script uploads; the rest of the store is unchanged.
  assert.strictEqual(saved.version, 5, 'the profile store is written as v5')
  assert.strictEqual(saved.parked, null, 'nothing is parked when no halt happened')
  assert.strictEqual(saved.afkAutoAnswer, undefined, 'no global AFK flag is left behind')
  assert.strictEqual(saved.profiles.find((p) => p.id === 'c3').notify.blocked, false, 'per-profile notify survives a restart')
}
calls.push('profile-v2-ok')

// 30. Agent totals are wider than the root-only counters: teammates and
// subagents own their own sessions, so a Team lead can look idle while its
// children are still running. rootsCount/runningCount keep the old meaning.
rootAgent.status = 'idle'
const childAgents = [
  { id: 'child-1', status: 'running', sessionId: 'session-child-1' },
  { id: 'child-2', status: 'running', sessionId: 'session-child-2' },
]
agents.list = () => [...rootsValue, ...childAgents]
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.strictEqual(body.agentTotal, 3, 'agentTotal counts roots and children')
assert.strictEqual(body.agentRunningTotal, 2, 'agentRunningTotal counts running children')
assert.strictEqual(body.rootsCount, 1, 'rootsCount still counts roots only')
assert.strictEqual(body.runningCount, 0, 'runningCount still counts running roots only')
calls.push('agent-total-ok')

// 31. A host without agents.list() keeps working: both totals fall back to the
// root-only counters instead of dropping to zero.
delete agents.list
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.strictEqual(body.agentTotal, body.rootsCount, 'agentTotal falls back to the root count')
assert.strictEqual(body.agentRunningTotal, body.runningCount, 'agentRunningTotal falls back to running roots')
calls.push('agent-total-fallback-ok')

dispose()
assert.strictEqual(routes.size, 0, 'disposer removes HTTP routes')

// 30b. A teammate still working means the batch is not finished, even though
// the root turn just ended. The child is not a root, so only the all-agents
// gate can hold the countdown.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  try { fs.unlinkSync(cfgFile) } catch { /* fresh start */ }
  const kid = { id: 'kid-1', status: 'running', sessionId: 'session-kid-1' }
  agents.list = () => [...rootsValue, kid]
  rootAgent.status = 'idle'
  const disposeAgents = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  const beforeSubagent = spawns.length
  const armTimers = new Set(timers.keys())
  res = await request('POST', '/api/dsh-shutdown-guard/arm', 'http://127.0.0.1:43129')
  assert.strictEqual(res.status, 200, 'arming is accepted while a child agent runs')
  for (const id of newTimers(armTimers)) fireTimer(id)
  await flush()
  body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  assert.strictEqual(body.armed, true, 'the mode is armed')
  assert.strictEqual(body.state, 'idle', 'a running child agent keeps the countdown idle')
  assert.strictEqual(body.agentRunningTotal, 1, 'the child is counted as running')
  assert.strictEqual(body.runningCount, 0, 'the root is not running')
  assert.strictEqual(spawns.length, beforeSubagent, 'no command is sent while the child runs')
  calls.push('subagent-blocks-arm-ok')

  kid.status = 'idle'
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  assert.strictEqual(body.agentRunningTotal, 0, 'no agent is running any more')
  assert.strictEqual(body.state, 'countdown', 'the countdown starts once every agent is idle')
  assert.strictEqual(spawns.length, beforeSubagent, 'the countdown itself sends nothing')
  calls.push('subagent-idle-allows-arm-ok')

  disposeAgents()
  delete agents.list
}

// 29. Upgrade paths. A 1.5.2 install kept `notify` in ui.json and `afkAutoAnswer`
// at the top level of config.json; both have to land in the profile store.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const uiFile = pathMod.join(here, '..', 'data', 'ui.json')
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  fs.mkdirSync(pathMod.dirname(uiFile), { recursive: true })
  try { fs.unlinkSync(cfgFile) } catch { /* fresh start */ }
  fs.writeFileSync(uiFile, JSON.stringify({ version: 1, variant: 'B', notify: false }) + '\n', 'utf8')
  const dispose2 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  {
    const dflt = JSON.parse(res.body).profiles.find((p) => p.id === 'default')
    assert.deepStrictEqual(dflt.notify, { countdown: false, fired: false, blocked: false, recovered: false }, 'a legacy ui.json notify:false seeds every kind off')
    assert.strictEqual(JSON.parse(res.body).ui.variant, 'B', 'the rest of the UI store is untouched')
    assert.strictEqual(JSON.parse(res.body).ui.notify, undefined, 'ui.notify is gone from /state')
  }
  {
    const rawUi = JSON.parse(fs.readFileSync(uiFile, 'utf8'))
    assert.strictEqual(rawUi.notify, undefined, 'ui.json is rewritten without notify')
    assert.strictEqual(rawUi.variant, 'B', 'the rewrite keeps the other UI fields')
  }
  dispose2()

  // Same for a top-level afkAutoAnswer in config.json.
  fs.writeFileSync(cfgFile, JSON.stringify({ version: 1, afkAutoAnswer: false, customEnabled: true, activeProfileId: 'c2' }) + '\n', 'utf8')
  const dispose3 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  assert.strictEqual(JSON.parse(res.body).profiles.find((p) => p.id === 'c2').afkAutoAnswer, false, 'a legacy top-level afkAutoAnswer reaches the profiles')
  assert.strictEqual(JSON.parse(res.body).profiles.find((p) => p.id === 'default').afkAutoAnswer, true, 'the locked baseline keeps AFK on')
  assert.strictEqual(JSON.parse(res.body).activeProfileId, 'c2', 'the legacy active profile id is kept')
  dispose3()
  calls.push('profile-legacy-ok')
}

// 32. Custom slots are created on demand: a fresh store ships only the default
// profile instead of eight pre-seeded empties.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  try { fs.unlinkSync(cfgFile) } catch { /* fresh start */ }
  const dispose4 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  body = JSON.parse(res.body)
  assert.strictEqual(body.profiles.length, 1, 'a fresh store has no pre-seeded custom slots')
  assert.strictEqual(body.profiles[0].id, 'default', 'the only profile is the baseline')
  dispose4()
  calls.push('profile-no-preseed-ok')
}

// 33. Turning custom profiles off and on again lands back on the profile the
// user was using, not on the baseline.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  try { fs.unlinkSync(cfgFile) } catch { /* fresh start */ }
  const dispose5 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { createProfile: {} })
  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true, activeProfileId: 'c1' })
  assert.strictEqual(JSON.parse(res.body).activeProfileId, 'c1', 'the custom profile is active')

  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: false })
  body = JSON.parse(res.body)
  assert.strictEqual(body.activeProfileId, 'default', 'switching custom profiles off falls back to the baseline')
  assert.strictEqual(body.lastCustomProfileId, 'c1', 'the custom selection is remembered')

  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true })
  assert.strictEqual(JSON.parse(res.body).activeProfileId, 'c1', 'switching custom profiles back on restores the remembered one')
  calls.push('profile-remember-ok')

  // Deleting the remembered profile must not leave a dangling pointer behind.
  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { deleteProfile: 'c1' })
  body = JSON.parse(res.body)
  assert.strictEqual(body.activeProfileId, 'default', 'deleting the active profile falls back to the baseline')
  assert.strictEqual(body.lastCustomProfileId, null, 'the remembered id is cleared with the profile')
  await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: false })
  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { customEnabled: true })
  body = JSON.parse(res.body)
  assert.strictEqual(body.activeProfileId, 'default', 'a deleted profile is never restored')
  assert.strictEqual(body.lastCustomProfileId, null, 'nothing is remembered after the delete')
  dispose5()
  calls.push('profile-remember-gone-ok')
}

// 34. A store written by an older build pre-created eight slots. Loading it
// drops the ones nobody ever configured and keeps everything the user touched.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  const pristine = (id, label, labelAuto) => ({
    id,
    label,
    labelAuto,
    countdownSec: 60,
    marginSec: 5,
    onlyOnSuccess: true,
    blockOnJobs: true,
    afkAutoAnswer: true,
    notify: { ...NOTIFY_ALL },
    retrySec: 30,
    retryPolicies: null,
    retryAssign: null,
  })
  fs.writeFileSync(cfgFile, JSON.stringify({
    version: 2,
    customEnabled: true,
    activeProfileId: 'default',
    profiles: [
      pristine('default', '默认配置', true),
      Object.assign(pristine('c1', '批量', false), { countdownSec: 120 }),
      pristine('c2', '配置 2', true),
      pristine('c3', '夜里跑批', false),
    ],
  }) + '\n', 'utf8')
  const dispose6 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  body = JSON.parse(res.body)
  assert.deepStrictEqual(body.profiles.map((p) => p.id), ['default', 'c1', 'c3'], 'the untouched slot is pruned on load')
  assert.strictEqual(body.profiles.find((p) => p.id === 'c1').countdownSec, 120, 'a touched field keeps the profile')
  assert.strictEqual(body.profiles.find((p) => p.id === 'c3').label, '夜里跑批', 'a renamed label keeps the profile')

  res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { createProfile: {} })
  body = JSON.parse(res.body)
  assert.deepStrictEqual(body.profiles.map((p) => p.id), ['default', 'c1', 'c3', 'c2'], 'a new profile reuses the freed id')
  dispose6()

  // The re-created profile still has every default value, yet it must survive a
  // restart: labelAuto=false marks it as user-made rather than a leftover slot.
  const dispose7 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  body = JSON.parse(res.body)
  assert.deepStrictEqual(body.profiles.map((p) => p.id), ['default', 'c1', 'c3', 'c2'], 'a created profile survives a restart even at default values')
  assert.strictEqual(body.profiles.find((p) => p.id === 'c2').labelAuto, false, 'a created profile is marked as user-made')
  dispose7()
  calls.push('profile-prune-ok')
}

// 35-47. v1.6.1 action layer: capability reporting, defer/inline cancellation,
// custom argv validation, the halt coupling and the persisted `parked` state.
// A fresh store keeps these tests independent of the profile mutations above.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const cfgFile = pathMod.join(here, '..', 'data', 'config.json')
  const uiFile = pathMod.join(here, '..', 'data', 'ui.json')
  try { fs.unlinkSync(cfgFile) } catch { /* fresh start */ }
  try { fs.unlinkSync(uiFile) } catch { /* fresh start */ }
  const readCfg = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  const stateNow = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  const eventsNow = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/events?limit=300')).body).events
  const postState = async (suffix, payload) => {
    const r = await request('POST', '/api/dsh-shutdown-guard' + suffix, 'http://127.0.0.1:43129', payload)
    return { status: r.status, body: JSON.parse(r.body) }
  }
  // `/arm` now schedules one tick that re-runs the idle gate, so a test that
  // wants to see what the countdown registers has to let that tick run first.
  const armNow = async () => {
    const before = new Set(timers.keys())
    const res = await postState('/arm')
    if (res.status === 200 && res.body.armed) {
      for (const id of [...timers.keys()]) {
        if (before.has(id)) continue
        const cb = timers.get(id)
        timers.delete(id)
        if (cb) cb()
      }
      await flush()
    }
    return res
  }
  let mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await flush()
  await postState('/config', { createProfile: {} })
  await postState('/config', { customEnabled: true, activeProfileId: 'c1' })
  await postState('/config', { updateProfile: { id: 'c1', patch: { countdownSec: 30 } } })

  // 35. The capability map covers every action id the profile accepts. `custom`
  // has no table row but still reports why it cannot run while argv is empty.
  let st = await stateNow()
  assert.deepStrictEqual(
    Object.keys(st.actions).sort(),
    ['custom', 'hibernate', 'lock', 'restart', 'restart-dsh', 'shutdown', 'signout', 'sleep'],
    'every action id is reported',
  )
  for (const id of Object.keys(st.actions)) {
    assert.ok(Object.hasOwn(st.actions[id], 'available'), `${id} reports availability`)
    assert.ok(Object.hasOwn(st.actions[id], 'reason'), `${id} reports a reason slot`)
    assert.ok(st.actions[id].available === true || st.actions[id].available === false || st.actions[id].available === 'unknown', `${id} uses the tri-state`)
    assert.ok(st.actions[id].reason === null || typeof st.actions[id].reason === 'string', `${id} reason is prose-free`)
  }
  assert.strictEqual(st.actions['restart-dsh'].available, true, 'the host can restart itself')
  assert.strictEqual(st.actions['restart-dsh'].reason, null, 'no gate owns restart-dsh in an empty home')
  assert.strictEqual(st.actions.custom.available, false, 'custom without a script is unavailable')
  assert.strictEqual(st.actions.custom.reason, 'no-script', 'custom explains the missing script')
  assert.strictEqual(st.actionReady, true, 'the selected shutdown action is usable')
  calls.push('capability-report-ok')

  // 36. `'unknown'` is not `false`: on a platform whose OS may still veto the
  // command, the UI must let the user arm and report the sent command afterwards.
  // The probe is the only public way to reach that state, so the platform is
  // spoofed just for the recheck, then restored before anything runs.
  const realPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'linux' })
  await postState('/config', { recheck: true })
  Object.defineProperty(process, 'platform', { value: realPlatform })
  st = await stateNow()
  assert.strictEqual(st.actions.sleep.available, 'unknown', 'a veto-capable platform reports unknown')
  assert.notStrictEqual(st.actions.sleep.available, false, 'unknown is not treated as unavailable')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'sleep' } } })
  await armNow()
  let n = spawns.length
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.state, 'countdown', 'an unknown action can still be armed')
  assert.strictEqual(spawns.length, n, 'inline sleep sends nothing during the countdown')
  await postState('/cancel')
  calls.push('actions-tri-state-ok')

  // 37. Every action is inline now, including win32 shutdown: nothing reaches
  // the OS while the countdown runs, and cancel never sends an undo command.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
  n = spawns.length
  await armNow()
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  assert.strictEqual((await stateNow()).state, 'countdown', 'shutdown still enters the countdown')
  assert.strictEqual(spawns.length, n, 'arming shutdown sends nothing')
  await postState('/cancel')
  await flush()
  assert.strictEqual(spawns.length, n, 'cancelling shutdown sends nothing')
  calls.push('shutdown-countdown-sends-nothing-ok')

  // 38. An inline action is not handed to the OS at arm time, so cancelling in
  // the countdown must leave the spawn log completely untouched.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'lock' } } })
  n = spawns.length
  await armNow()
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  assert.strictEqual((await stateNow()).state, 'countdown', 'inline action entered the countdown')
  assert.strictEqual(spawns.length, n, 'arming an inline action sends nothing')
  await postState('/cancel')
  await flush()
  assert.strictEqual(spawns.length, n, 'cancelling an inline action sends nothing')
  calls.push('inline-cancel-sends-nothing-ok')

  // 39. Inline fires exactly at the deadline timer, with the row's argv.
  await postState('/disarm')
  const beforeIds = new Set(timers.keys())
  await armNow()
  const fresh = [...timers.keys()].filter((id) => !beforeIds.has(id))
  assert.ok(fresh.length >= 2, 'the arm registered the action timer and the fired timer')
  assert.strictEqual(spawns.length, n, 'still nothing before the deadline')
  timers.get(fresh[0])()
  await flush()
  assert.strictEqual(spawns.length, n + 1, 'the deadline sends exactly one command')
  assert.deepStrictEqual(spawns[n].slice(1), ['user32.dll,LockWorkStation'], 'the inline row argv is used')
  st = await stateNow()
  assert.strictEqual(st.state, 'countdown', 'the fired timer has not run yet')
  assert.strictEqual(st.lastAction.action, 'lock', 'the last action names what ran')
  assert.deepStrictEqual(st.lastAction.argv, ['rundll32', 'user32.dll,LockWorkStation'], 'lastAction records the argv')
  timers.get(fresh[1])()
  await flush()
  assert.strictEqual((await stateNow()).state, 'fired')
  calls.push('inline-fires-at-deadline-ok')

  // 40. Past the deadline the command is out: cancel cannot undo it, so it must
  // not spawn again, and the state reset is the design doc's §1.4 reset — not a
  // claim that nothing was sent.
  const beforeCancel = spawns.length
  const eventsLen = (await eventsNow()).length
  await postState('/cancel')
  await flush()
  st = await stateNow()
  assert.strictEqual(spawns.length, beforeCancel, 'a post-deadline cancel never spawns')
  assert.strictEqual(st.state, 'idle', 'the process state resets (design §1.4)')
  assert.strictEqual(st.lastAction.action, 'lock', 'the sent action is still recorded')
  assert.ok(Array.isArray(st.lastAction.argv) && st.lastAction.argv.length > 0, 'the sent argv is still recorded')
  calls.push('cancel-after-deadline-ok')

  // 41. …but the event must say "already ran", not "cancelled". Keys only: the
  // copy is the settings page's job.
  {
    const after = await eventsNow()
    const added = after.slice(eventsLen)
    assert.ok(added.length > 0, 'the cancel recorded an event')
    assert.strictEqual(added[added.length - 1].key, 'log.actionAlreadyRan', 'the newest event is the honest one')
    assert.ok(!added.some((e) => e.key === 'log.cancelledArmed' || e.key === 'log.cancelledDisarmed'), 'no cancelled event for an action that already ran')
  }
  calls.push('cancel-after-deadline-copy-ok')

  // 41b. The honest "already sent" marker is the sentInline flag, not `state`:
  // an inline command leaves the process at countdownSec, while `state` only
  // flips to 'fired' after countdownSec + marginSec + 5. A cancel inside that
  // gap must not spawn a second command nor claim it cancelled anything.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'lock', countdownSec: 10, marginSec: 45 } } })
  const gapBeforeIds = new Set(timers.keys())
  await armNow()
  const gapFresh = [...timers.keys()].filter((id) => !gapBeforeIds.has(id))
  assert.ok(gapFresh.length >= 2, 'the arm registered the inline deadline and the fired timer')
  const gapBase = spawns.length
  timers.get(gapFresh[0])()
  await flush()
  assert.strictEqual(spawns.length, gapBase + 1, 'the inline command has been spawned')
  st = await stateNow()
  assert.strictEqual(st.state, 'countdown', 'the state still lags behind the sent command')
  assert.strictEqual(st.lastAction.action, 'lock', 'lastAction records the inline command that ran')
  const gapEventsLen = (await eventsNow()).length
  await postState('/cancel')
  await flush()
  assert.strictEqual(spawns.length, gapBase + 1, 'a cancel in the gap spawns nothing more')
  {
    const added = (await eventsNow()).slice(gapEventsLen)
    assert.ok(added.length > 0, 'the gap cancel recorded an event')
    assert.strictEqual(added[added.length - 1].key, 'log.actionAlreadyRan', 'the gap cancel says the action already ran')
    assert.ok(!added.some((e) => e.key === 'log.cancelledArmed' || e.key === 'log.cancelledDisarmed'), 'no cancelled event in the gap')
  }
  assert.strictEqual((await stateNow()).state, 'idle', 'the local state resets as usual')
  calls.push('inline-cancel-in-gap-ok')

  // 42. A script is uploaded as bytes: the host writes it under data/scripts,
  // /state exposes metadata only, and uploading one forces the custom action.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
  const scriptDir = pathMod.join(here, '..', 'data', 'scripts')
  fs.rmSync(scriptDir, { recursive: true, force: true })
  const scriptBody = '@echo off\r\nshutdown /s /t 0\r\n'
  let r = await postState('/config', { putScript: { profileId: 'c1', name: 'bye.cmd', ext: 'cmd', content: scriptBody } })
  assert.strictEqual(r.status, 200, 'a script can be uploaded')
  let savedProfile = r.body.profiles.find((p) => p.id === 'c1')
  assert.strictEqual(savedProfile.action, 'custom', 'uploading a script selects the custom action')
  let savedScript = r.body.scripts.find((s) => s.id === savedProfile.scriptId)
  assert.ok(savedScript, 'the upload lands in the shared library and the profile points at it')
  assert.strictEqual(savedScript.name, 'bye.cmd', 'the display name is kept')
  assert.strictEqual(savedScript.ext, 'cmd', 'the extension is kept')
  assert.strictEqual(savedScript.bytes, Buffer.byteLength(scriptBody), 'the byte count matches the upload')
  assert.match(savedScript.sha256, /^[0-9a-f]{64}$/, 'the content hash is recorded')
  const scriptFile = pathMod.join(scriptDir, savedScript.id + '.cmd')
  assert.strictEqual(fs.readFileSync(scriptFile, 'utf8'), scriptBody, 'the bytes land under data/scripts')
  st = await stateNow()
  assert.deepStrictEqual(Object.keys(st.script).sort(), ['bytes', 'ext', 'name', 'savedAt', 'sha256'], 'state carries metadata only')
  assert.strictEqual(st.script.sha256, savedScript.sha256, 'the state hash matches the file')
  assert.ok(!JSON.stringify(st.script).includes('shutdown /s'), 'state never leaks the script body')
  await flush()
  calls.push('put-script-ok')

  // 42b. Consent is bound to the exact bytes: an unacknowledged script cannot
  // arm, and uploading new bytes creates a new library entry, leaving the old
  // entry (and its acknowledgement) in place.
  let scriptN = spawns.length
  let refused = await armNow()
  assert.strictEqual(refused.status, 409, 'an unacknowledged script is refused before arming')
  assert.strictEqual(refused.body.error, 'script-not-acknowledged', 'the refusal names the missing consent')
  assert.strictEqual(refused.body.armed, false, 'the mode is not switched on by a refused arm')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'an unacknowledged script never enters the countdown')
  assert.strictEqual(st.lastSkip, null, 'a refused arm does not claim to have skipped a batch')
  assert.strictEqual(spawns.length, scriptN, 'nothing is sent before consent')
  r = await postState('/config', { ackScript: { scriptId: savedScript.id } })
  assert.strictEqual(r.status, 200, 'the user can acknowledge the exact bytes')
  await flush()
  st = await stateNow()
  assert.strictEqual(st.scriptAckOk, true, 'state reports the acknowledgement')
  r = await armNow()
  assert.strictEqual(r.status, 200, 'an acknowledged script can be armed')
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  assert.strictEqual((await stateNow()).state, 'countdown', 'an acknowledged script can arm')
  await postState('/cancel')
  const scriptsBefore = st.scripts.length
  r = await postState('/config', { putScript: { profileId: 'c1', name: 'bye.cmd', ext: 'cmd', content: scriptBody + 'echo changed\r\n' } })
  assert.strictEqual(r.status, 200, 'different bytes can be uploaded alongside the old entry')
  const newScriptId = r.body.scriptId
  assert.notStrictEqual(newScriptId, savedScript.id, 'different bytes get their own library id')
  await flush()
  st = await stateNow()
  assert.strictEqual(st.scripts.length, scriptsBefore + 1, 'the old entry stays in the library')
  assert.strictEqual(st.scripts.find((s) => s.id === savedScript.id).ackOk, true,
    'the old acknowledgement is unaffected by the new upload')
  assert.strictEqual(st.scriptAckOk, false, 'the newly selected bytes are unacknowledged')
  scriptN = spawns.length
  await postState('/disarm')
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'new bytes without a new consent are refused')
  assert.strictEqual(refused.body.error, 'script-not-acknowledged', 'the new bytes need a new consent')
  assert.strictEqual(refused.body.armed, false, 'the refusal leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'the new script cannot arm on the old consent')
  assert.strictEqual(spawns.length, scriptN, 'still nothing is sent')
  calls.push('script-ack-gate-ok')

  // 42c. A language with no interpreter is unavailable, and says so instead of
  // arming and failing later.
  const realResolve = subprocess.resolveExecutable
  subprocess.resolveExecutable = async (name) => {
    if (name === 'python' || name === 'python3') return ''
    return realResolve(name)
  }
  r = await postState('/config', { putScript: { profileId: 'c1', name: 'bye.py', ext: 'py', content: 'print("bye")\n' } })
  assert.strictEqual(r.status, 200, 'a .py script is accepted as bytes')
  await flush()
  st = await stateNow()
  assert.deepStrictEqual(st.actions.custom, { available: false, reason: 'missing-interpreter' }, 'a missing interpreter is named')
  subprocess.resolveExecutable = realResolve
  await postState('/config', { recheck: true })
  await flush()
  calls.push('interpreter-missing-ok')

  // 42d. Every action is inline: the countdown sends nothing, the deadline sends
  // exactly one command with no OS-side delay.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
  const inlineBefore = new Set(timers.keys())
  await armNow()
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  scriptN = spawns.length
  assert.strictEqual((await stateNow()).state, 'countdown', 'shutdown enters the countdown')
  assert.strictEqual(spawns.length, scriptN, 'the countdown sends nothing')
  const inlineFresh = newTimers(inlineBefore)
  assert.ok(inlineFresh.length >= 2, 'the deadline and fired timers are registered')
  fireTimer(inlineFresh[0])
  await flush()
  assert.strictEqual(spawns.length, scriptN + 1, 'the deadline sends exactly one command')
  assert.deepStrictEqual(spawns[scriptN].slice(-3), ['/s', '/t', '0'], 'win32 shutdown asks the OS for no delay')
  await postState('/cancel')
  calls.push('inline-only-ok')

  // 42e. Deleting the file is not a crash: /state stays readable and the skip
  // line reports the missing script instead of arming something that cannot run.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'custom' } } })
  await postState('/config', { putScript: { profileId: 'c1', name: 'gone.cmd', ext: 'cmd', content: '@echo off\r\n' } })
  const goneId = (await stateNow()).profiles.find((p) => p.id === 'c1').scriptId
  await postState('/config', { ackScript: { scriptId: goneId } })
  fs.rmSync(pathMod.join(scriptDir, goneId + '.cmd'), { force: true })
  await postState('/config', { recheck: true })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.actions.custom.reason, 'no-script', 'a deleted script is reported as missing')
  scriptN = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'a missing file is refused before arming')
  assert.strictEqual(refused.body.error, 'no-script', 'the missing file is named as a missing script')
  assert.strictEqual(refused.body.armed, false, 'the refused arm keeps the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'a missing file never arms')
  assert.strictEqual(spawns.length, scriptN, 'nothing is sent for a missing file')
  calls.push('script-file-missing-ok')

  // 42f. Stores from 1.6.x load: v2 (the 1.6.0 release) and v3 (the beta) keep
  // their profiles and are rewritten as v5 on the first save.
  await postState('/disarm')
  for (const oldVersion of [2, 3]) {
    const seeded = {
      id: 'c1',
      label: 'Mine',
      countdownSec: 120,
      marginSec: 5,
      onlyOnSuccess: true,
      blockOnJobs: true,
      afkAutoAnswer: true,
      action: 'shutdown',
    }
    fs.writeFileSync(cfgFile, JSON.stringify({
      version: oldVersion,
      customEnabled: true,
      activeProfileId: 'c1',
      language: 'zh',
      profiles: [seeded],
    }) + '\n', 'utf8')
    mount()
    mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
    await flush()
    st = await stateNow()
    const loaded = st.profiles.find((p) => p.id === 'c1')
    assert.ok(loaded, `v${oldVersion} keeps the custom profile`)
    assert.strictEqual(loaded.countdownSec, 120, `v${oldVersion} keeps the profile values`)
    await postState('/config', { language: 'zh' })
    const disk = readCfg()
    assert.strictEqual(disk.version, 5, `v${oldVersion} is rewritten as v5`)
    assert.ok(disk.profiles.some((p) => p.id === 'c1'), `v${oldVersion} keeps the profile on disk`)
    calls.push(oldVersion === 2 ? 'migrate-v2-to-4-ok' : 'migrate-v3-to-4-ok')
  }
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })

  // 43. The parent gate may force the effective value to false, but the stored
  // choice must survive so flipping the parent back restores the user's value.
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: false, shutdownOnHalt: true } } })
  st = await stateNow()
  assert.strictEqual(st.shutdownOnHaltEffective, false, 'the parent gate forces the effective value off')
  assert.strictEqual(readCfg().profiles.find((p) => p.id === 'c1').shutdownOnHalt, true, 'the stored value is not rewritten')
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true } } })
  st = await stateNow()
  assert.strictEqual(st.shutdownOnHaltEffective, true, 'turning the parent back on restores the choice')
  assert.strictEqual(readCfg().profiles.find((p) => p.id === 'c1').shutdownOnHalt, true, 'and the stored value is still there')
  calls.push('halt-effective-not-written-ok')

  // 44. A halted batch is parked on disk (v4) and restored on the next boot
  // without replaying the failure as a fresh event.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true, shutdownOnHalt: true, action: 'shutdown' } } })
  errorHandler({ agent: rootAgent, error: { code: 'QUOTA' } })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'QUOTA halts the batch')
  assert.ok(st.parkedAt > 0, 'the halt carries a timestamp')
  let disk = readCfg()
  assert.strictEqual(disk.version, 5, 'the store is written as v5')
  assert.strictEqual(disk.parked.code, 'QUOTA', 'the halt code is persisted')
  assert.strictEqual(disk.parked.level, 'halted', 'only a halted block is persisted')
  const parkedAt = disk.parked.at
  const blockedBefore = (await eventsNow()).filter((e) => e.key === 'log.blockedSelfHealFailed').length
  const totalBefore = (await eventsNow()).length
  mount()
  mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'the halt survives a restart')
  assert.strictEqual(st.parkedAt, parkedAt, 'the original halt timestamp is restored')
  const addedEvents = (await eventsNow()).slice(totalBefore)
  assert.ok(!addedEvents.some((e) => /blocked|halt|parked/i.test(String(e.key))), 'restoring parked does not replay the failure')
  assert.strictEqual((await eventsNow()).filter((e) => e.key === 'log.blockedSelfHealFailed').length, blockedBefore, 'no duplicate halt event')
  await armNow()
  await postState('/disarm')
  calls.push('parked-persist-ok')

  // 45. A provider-side wait is not parked: its retry timer is the recovery, and
  // persisting it would turn "retry in 20s" into "wait forever after a restart".
  errorHandler({ agent: rootAgent, error: { code: 'RATE_LIMIT' } })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'waiting', 'RATE_LIMIT parks the batch in memory')
  assert.strictEqual(readCfg().parked, null, 'a waiting block never reaches the config file')
  await postState('/disarm')
  calls.push('parked-only-halted-ok')

  // 46. Three writers clear the park: arming, the haltExecute branch, and an
  // explicit cancel. Four unrelated settings must not. A new session starting is
  // no longer one of them: only a *waiting* block self-heals on new activity.
  const halt = async () => {
    errorHandler({ agent: rootAgent, error: { code: 'QUOTA' } })
    await flush()
  }
  // armed
  await halt()
  assert.strictEqual(readCfg().parked.code, 'QUOTA', 'precondition: parked')
  await postState('/arm')
  assert.strictEqual(readCfg().parked, null, 'arming clears the park')
  await postState('/disarm')
  // disarm
  await postState('/arm')
  await halt()
  await postState('/disarm')
  assert.strictEqual(readCfg().parked, null, 'disarming clears the park')
  // a new session must not clear a halt; that writer is gone on purpose (d74e3b6).
  // shutdownOnHalt fires
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true, afkAutoAnswer: false, shutdownOnHalt: true } } })
  await postState('/arm')
  await halt()
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.state, 'countdown', 'shutdownOnHalt lets the halted batch shut down')
  assert.strictEqual(st.blockedLevel, null, 'the halt is cleared when the countdown starts')
  assert.strictEqual(readCfg().parked, null, 'the park is cleared on disk too')
  await postState('/cancel')
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true, afkAutoAnswer: true } } })
  // restart
  await halt()
  mount()
  mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await flush()
  assert.strictEqual((await stateNow()).blockedLevel, 'halted', 'a restart does not clear the park')
  assert.strictEqual(readCfg().parked.code, 'QUOTA', 'and leaves it on disk')
  // profile switch
  await postState('/config', { activeProfileId: 'default' })
  assert.strictEqual(readCfg().parked.code, 'QUOTA', 'switching profile does not clear the park')
  await postState('/config', { activeProfileId: 'c1' })
  // language
  await postState('/config', { language: 'en' })
  assert.strictEqual(readCfg().parked.code, 'QUOTA', 'changing language does not clear the park')
  await postState('/config', { language: 'zh' })
  // appearance
  await postState('/ui', { theme: 'claude' })
  assert.strictEqual(readCfg().parked.code, 'QUOTA', 'changing appearance does not clear the park')
  await postState('/ui', { theme: 'auto' })
  await armNow()
  await postState('/disarm')
  assert.strictEqual(readCfg().parked, null, 'cleanup: the park is gone before the next scenario')
  calls.push('parked-clear-ok')

  // 47. halted + shutdownOnHalt must actually reach the countdown and clear the
  // block even though the halt now survives ordinary activity: the haltExecute
  // branch is the one place allowed to clear it. The parent gate stays on, so the
  // halted branch must skip the errored gate for this batch without erasing the
  // error set used by later batches.
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true, afkAutoAnswer: false, shutdownOnHalt: true, action: 'shutdown' } } })
  await postState('/arm')
  await halt()
  assert.strictEqual((await stateNow()).blockedLevel, 'halted', 'precondition: halted')
  n = spawns.length
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.state, 'countdown', 'the halted batch still shuts down')
  assert.strictEqual(st.blockedLevel, null, 'the block is cleared at the countdown')
  assert.strictEqual(spawns.length, n, 'the countdown itself sends nothing')
  await postState('/cancel')
  await postState('/disarm')
  calls.push('halt-executes-when-armed-ok')

  // 48. The mother switch is a hard gate: with onlyOnSuccess off, the effective
  // value is forced off and a halt stays parked, but the stored user choice must
  // keep its true value so turning the mother switch back on restores it.
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: false, shutdownOnHalt: true, action: 'shutdown' } } })
  await postState('/arm')
  n = spawns.length
  await halt()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'the halt is reported while the mother gate is off')
  assert.strictEqual(st.shutdownOnHaltEffective, false, 'the mother gate forces the effective value off')
  assert.strictEqual(st.state, 'idle', 'the halted batch is not armed')
  assert.strictEqual(spawns.length, n, 'nothing is sent while the effective value is off')
  assert.strictEqual(readCfg().profiles.find((p) => p.id === 'c1').shutdownOnHalt, true, 'the stored choice is untouched')
  await postState('/disarm')
  calls.push('halt-blocked-when-mother-off-ok')

  // 48b. A halted block is a decision, not a failed provider call. Only a
  // waiting block may self-heal when a session starts; the unarmed tryArm() must
  // also stay side-effect free (no skip line, no parked write).
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { onlyOnSuccess: true, afkAutoAnswer: true, shutdownOnHalt: true, action: 'shutdown' } } })
  await postState('/config', { activeProfileId: 'c1' })
  await halt()
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'precondition: a halt is parked')
  assert.strictEqual(st.armed, false, 'precondition: the mode is off')
  const parkedHalt = readCfg().parked
  assert.strictEqual(parkedHalt.code, 'QUOTA', 'precondition: the halt is on disk')
  n = spawns.length
  const skipBefore = st.lastSkip
  statusHandler({ agent: rootAgent, status: 'running' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'a new session does not clear a halt')
  assert.strictEqual(st.state, 'idle', 'nothing arms itself while the mode is off')
  assert.strictEqual(st.armed, false, 'the mode stays off')
  assert.strictEqual(spawns.length, n, 'no command is sent')
  assert.deepStrictEqual(readCfg().parked, parkedHalt, 'the parked halt is untouched on disk')
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'an idle event does not arm an unarmed guard')
  assert.strictEqual(st.armed, false, 'and does not flip the switch')
  assert.deepStrictEqual(st.lastSkip, skipBefore, 'an idle event on an off guard leaves no skip line')
  assert.deepStrictEqual(readCfg().parked, parkedHalt, 'an idle event on an off guard leaves the park alone')
  assert.strictEqual(spawns.length, n, 'still nothing is sent')
  calls.push('halt-survives-new-session-ok')

  // 48c. A waiting block still heals. The host-refused-timer path leaves
  // retryAt=0/retryTimer=null, so the next running event is its only recovery;
  // the scheduled-timer path clears it without another retryRecovered line.
  await postState('/disarm')
  await postState('/arm')
  await postState('/disarm')
  const realRetrySetTimeout = ctx.setTimeout
  ctx.setTimeout = () => { throw new Error('no timer') }
  try {
    errorHandler({ agent: rootAgent, error: { code: 'RATE_LIMIT' } })
    await flush()
  } finally {
    ctx.setTimeout = realRetrySetTimeout
  }
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'waiting', 'precondition: a waiting block exists')
  assert.strictEqual(st.retryAt, 0, 'a refused timer leaves no retry deadline')
  assert.strictEqual(readCfg().parked, null, 'a waiting block is never parked')
  const recoveredBefore = (await eventsNow()).filter((e) => e.key === 'log.retryRecovered').length
  n = spawns.length
  statusHandler({ agent: rootAgent, status: 'running' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, null, 'a waiting block self-heals on new activity')
  assert.strictEqual(spawns.length, n, 'healing a waiting block sends nothing')
  const recoveredAfter = (await eventsNow()).filter((e) => e.key === 'log.retryRecovered').length
  assert.strictEqual(recoveredAfter - recoveredBefore, 1, 'the heal is logged once')
  // The timed path also clears the wait, without a second recovery line.
  errorHandler({ agent: rootAgent, error: { code: 'RATE_LIMIT' } })
  await flush()
  assert.strictEqual((await stateNow()).blockedLevel, 'waiting', 'precondition: a timed wait')
  const retryTimer = [...timers.entries()].pop()
  timers.delete(retryTimer[0])
  retryTimer[1]()
  await flush()
  assert.strictEqual((await stateNow()).blockedLevel, null, 'the retry timer clears the wait')
  assert.strictEqual((await eventsNow()).filter((e) => e.key === 'log.retryRecovered').length,
    recoveredAfter, 'the timer path does not add another recovery line')
  calls.push('waiting-still-heals-ok')

  // 48d. /unblock clears a block without touching armed. The card used to fake
  // this with /disarm + /arm; on an off guard that switched the mode on.
  await postState('/disarm')
  await halt()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'precondition: a halt is parked')
  assert.strictEqual(st.armed, false, 'precondition: the guard is off')
  n = spawns.length
  let unblockRes = await postState('/unblock')
  assert.strictEqual(unblockRes.status, 200, '/unblock answers 200')
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, null, 'the block is cleared')
  assert.strictEqual(st.parkedAt, null, 'the parked halt is gone from state')
  assert.strictEqual(st.armed, false, 'clearing a block never arms the guard')
  assert.strictEqual(st.state, 'idle', 'nothing starts a countdown')
  assert.strictEqual(spawns.length, n, 'clearing sends no command')
  assert.ok((await eventsNow()).some((e) => e.key === 'log.unblocked'), 'the clear is announced')
  calls.push('unblock-keeps-guard-off-ok')

  // 48e. Clearing while armed leaves the mode on: block and switch are separate.
  await postState('/arm')
  st = await stateNow()
  assert.strictEqual(st.armed, true, 'precondition: the guard is armed')
  await halt()
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, 'halted', 'precondition: an armed halt')
  await postState('/unblock')
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, null, 'the block is cleared')
  assert.strictEqual(st.armed, true, 'clearing does not disarm')
  await postState('/disarm')
  calls.push('unblock-keeps-armed-ok')

  // 48f. With nothing blocked /unblock is a silent no-op.
  st = await stateNow()
  assert.strictEqual(st.blockedLevel, null, 'precondition: nothing is blocked')
  const eventsBeforeUnblock = (await eventsNow()).length
  unblockRes = await postState('/unblock')
  assert.strictEqual(unblockRes.status, 200, '/unblock still answers 200')
  assert.strictEqual((await eventsNow()).length, eventsBeforeUnblock, 'a no-op writes no event')
  calls.push('unblock-silent-without-block-ok')

  // 49. Custom-profile-only actions vanish while custom profiles are off: not
  // just the picker (the client hides those rows) but the host map itself, so a
  // stale client cannot arm them. restart-dsh keeps its own reason: that gate is
  // older and must not be overwritten by this one.
  await postState('/disarm')
  await postState('/config', { customEnabled: false })
  st = await stateNow()
  for (const id of ['lock', 'signout', 'custom']) {
    assert.deepStrictEqual(st.actions[id], { available: false, reason: 'no-custom-profile' },
      `${id} reports no-custom-profile while custom profiles are off`)
  }
  assert.strictEqual(st.actions.shutdown.available, true, 'shutdown needs no custom profile')
  // The default profile keeps action editable, so a stale profile can still say
  // lock after the feature is switched off. The gate must refuse that arm even
  // though the profile itself is the default one.
  await postState('/config', { updateProfile: { id: 'default', patch: { action: 'lock' } } })
  st = await stateNow()
  assert.strictEqual(st.activeProfileId, 'default', 'the default profile stays active')
  assert.strictEqual(st.actionReady, false, 'a gated action is never reported ready')
  n = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'arming a gated action is refused')
  assert.strictEqual(refused.body.error, 'action-unavailable', 'the refusal names the unavailable action')
  assert.strictEqual(refused.body.armed, false, 'the gated refusal leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'arming a gated action stays idle')
  assert.strictEqual(spawns.length, n, 'a gated action sends nothing')
  await postState('/config', { updateProfile: { id: 'default', patch: { action: 'shutdown' } } })
  await postState('/disarm')
  r = await postState('/config', { customEnabled: true })
  assert.strictEqual(r.status, 200, 'custom profiles can be turned back on')
  assert.strictEqual(r.body.actions.lock.available, true,
    'the same response already reports lock as available again')
  assert.strictEqual(r.body.actions.custom.reason, 'no-script',
    'custom falls back to no-script once the feature is on')
  calls.push('no-custom-profile-gate-ok')

  // 50. Enabling the feature must not make an unsaved script mandatory: a
  // profile can still store action=custom first and be told why it cannot arm.
  r = await postState('/config', { createProfile: { label: '脚本门' } })
  assert.strictEqual(r.status, 200, 'a profile can be created for the script gate')
  const scriptlessId = readCfg().profiles.find((p) => p.label === '脚本门').id
  r = await postState('/config', { updateProfile: { id: scriptlessId, patch: { action: 'custom' } } })
  assert.strictEqual(r.status, 200, 'action=custom can be saved without a script')
  assert.strictEqual(readCfg().profiles.find((p) => p.id === scriptlessId).action, 'custom',
    'the stored profile keeps action=custom')
  await postState('/config', { activeProfileId: scriptlessId })
  st = await stateNow()
  assert.deepStrictEqual(st.actions.custom, { available: false, reason: 'no-script' },
    'an empty script gate reports no-script')
  assert.strictEqual(st.actionReady, false, 'a scriptless custom action is not ready')
  calls.push('custom-script-still-saveable-ok')

  // 51. A host that suspends long timers still owes the deadline: every request
  // recomputes it (catchUp), but the command must leave exactly once and the
  // fired transition must be logged once. The stub registers no callback, which
  // is exactly the observed failure mode: HTTP keeps answering, no timer runs.
  await postState('/disarm')
  await postState('/config', { activeProfileId: 'c1' })
  // 10s is the host's floor for countdownSec (normalizeProfile clamps 10..600);
  // marginSec: 0 keeps the fired transition exactly 5s behind the deadline.
  r = await postState('/config', {
    updateProfile: { id: 'c1', patch: { action: 'shutdown', countdownSec: 10, marginSec: 0 } },
  })
  assert.strictEqual(r.status, 200, 'the short countdown profile is saved')
  const realNow = Date.now
  const realSetTimeout = ctx.setTimeout
  let fakeNow = realNow()
  let suspended = 0
  Date.now = () => fakeNow
  ctx.setTimeout = () => { suspended++; return () => {} }
  try {
    n = spawns.length
    await armNow()
    statusHandler({ agent: rootAgent, status: 'idle' })
    await flush()
    st = await stateNow()
    assert.strictEqual(st.state, 'countdown', 'the countdown is running while the timer is suspended')
    assert.strictEqual(st.lastAction, null, 'nothing has been sent during the countdown')
    assert.strictEqual(spawns.length, n, 'a suspended deadline timer sends nothing by itself')

    // Past the deadline (countdownSec 10), no timer will ever run: only the
    // requests can settle it.
    fakeNow += 11000
    for (let i = 0; i < 5; i++) await stateNow()
    await flush()
    assert.strictEqual(spawns.length, n + 1, 'five catch-up requests send the command exactly once')
    st = await stateNow()
    assert.strictEqual(st.lastAction && st.lastAction.action, 'shutdown', 'the catch-up path records the action')
    assert.ok(Array.isArray(st.lastAction.argv) && st.lastAction.argv.length > 0,
      'the catch-up path records the argv it sent')
    assert.strictEqual(st.state, 'countdown', 'the fired state still waits for its own margin')

    const firedBefore = (await eventsNow()).filter((e) => e.key === 'log.fired').length
    fakeNow += 6000
    st = await stateNow()
    assert.strictEqual(st.state, 'fired', 'a suspended fired timer is caught up on the next request')
    const firedAfter = (await eventsNow()).filter((e) => e.key === 'log.fired').length
    assert.strictEqual(firedAfter - firedBefore, 1, 'log.fired is written exactly once')

    // The countdown cancel copy is still true: every action is inline, so no
    // `shutdown /a` is ever claimed (or needed) in any language.
    for (const code of LANGS) {
      assert.ok(!t(code, 'log.cancelledArmed').includes('shutdown /a'),
        `${code} cancel copy does not claim a shutdown /a undo`)
    }
  } finally {
    Date.now = realNow
    ctx.setTimeout = realSetTimeout
    await postState('/disarm')
  }
  calls.push('catch-up-after-suspended-timer-ok')

  // 52. The consent round trip, now on the library entry: the host computes the
  // hash, the ack carries it, `unackScript` clears only the consent, and a client
  // cannot invent an ack through a profile patch.
  await postState('/disarm')
  await postState('/config', { activeProfileId: 'c1' })
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'custom' } } })
  const ackBody = '@echo off\r\necho ack\r\n'
  r = await postState('/config', { putScript: { profileId: 'c1', name: 'ack.cmd', ext: 'cmd', content: ackBody } })
  assert.strictEqual(r.status, 200, 'the script to acknowledge is uploaded')
  const ackScriptId = r.body.scriptId
  st = await stateNow()
  assert.ok(st.script && st.script.sha256, 'the state publishes the script metadata')
  assert.strictEqual(st.scriptAckOk, false, 'a fresh upload is not acknowledged')
  assert.strictEqual(st.profiles.find((p) => p.id === 'c1').scriptAck, null,
    'the stored profile has no ack yet')

  const ackRes = await postState('/config', { ackScript: { scriptId: ackScriptId } })
  assert.strictEqual(ackRes.status, 200, 'acknowledging the uploaded script is accepted')
  st = await stateNow()
  const ackedProfile = st.profiles.find((p) => p.id === 'c1')
  assert.ok(ackedProfile.scriptAck && ackedProfile.scriptAck.at, 'the ack is stored with a timestamp')
  // The client decides "confirmed" by comparing the ack hash with script.sha256,
  // so /state must publish both fields. Trimming the ack to `{ at }` silently
  // broke that comparison once; keep this shape pinned.
  assert.strictEqual(typeof ackedProfile.scriptAck.sha256, 'string',
    'the state publishes the ack hash for the client to compare')
  assert.strictEqual(ackedProfile.scriptAck.sha256, st.script.sha256,
    'the published ack hash is the host-computed script hash')
  assert.strictEqual(readCfg().scripts.find((s) => s.id === ackScriptId).ack.sha256, st.script.sha256,
    'the stored ack carries the host-computed hash, not a client value')
  assert.strictEqual(st.scriptAckOk, true, 'the state agrees the current bytes are acknowledged')
  await armNow()
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  assert.strictEqual((await stateNow()).state, 'countdown', 'an acknowledged script can arm')

  await postState('/disarm')
  const cleared = await postState('/config', { unackScript: { scriptId: ackScriptId } })
  assert.strictEqual(cleared.status, 200, 'withdrawing the consent is accepted')
  st = await stateNow()
  const clearedProfile = st.profiles.find((p) => p.id === 'c1')
  assert.strictEqual(clearedProfile.scriptAck, null, 'the ack is cleared')
  assert.strictEqual(readCfg().scripts.find((s) => s.id === ackScriptId).ack, null,
    'the stored ack is cleared too')
  assert.strictEqual(st.scriptAckOk, false, 'clearing the ack turns the gate off again')
  assert.strictEqual(clearedProfile.script.sha256, ackedProfile.script.sha256,
    'clearing the ack does not touch the script metadata')
  assert.ok(fs.existsSync(pathMod.join(scriptDir, ackScriptId + '.cmd')), 'the script bytes stay on disk')
  n = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'without an ack the script cannot arm')
  assert.strictEqual(refused.body.error, 'script-not-acknowledged',
    'the refusal says the script is not acknowledged')
  assert.strictEqual(refused.body.armed, false, 'the refusal leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'without an ack the script cannot arm')
  assert.strictEqual(spawns.length, n, 'nothing is sent without an ack')

  const forged = await postState('/config', {
    updateProfile: { id: 'c1', patch: { scriptAck: { sha256: 'deadbeef' } } },
  })
  assert.strictEqual(forged.status, 400, 'a client-invented ack is rejected')
  assert.strictEqual(forged.body.error, 'scriptAck can only be written by acknowledging a library script',
    'the rejection names the library route')
  assert.strictEqual(readCfg().scripts.find((s) => s.id === ackScriptId).ack, null,
    'a rejected ack leaves the stored value untouched')
  calls.push('script-ack-round-trip-ok')

  // 54f. The desktop shell is restarted as a whole. The desktop entry rewrites
  // process.argv before plugins load, so detection must use the Electron runtime
  // and the executable name only -- never the argv shape.
  {
    const fs = await import('node:fs')
    const pathMod = await import('node:path')
    const os = await import('node:os')
    const desktopExe = 'C:\\Program Files\\DSH Desktop\\DSH Desktop.exe'
    const desktopArgv = [desktopExe, 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\bin.js', 'web']

    const noEntryArgv = ['C:\\Program Files\\DSH Desktop\\resources\\app.asar\\bin.js', 'web']
    const noEntry = hostRestartPlan({ platform: 'win32', versions: { electron: '43.0.0' },
      argv: noEntryArgv, execPath: desktopExe, dataDir: 'C:\\data', pid: 11 })
    assert.strictEqual(noEntry.desktop, true, 'the shell is recognised without an argv entry')
    assert.ok(noEntry.content.includes('taskkill /IM "DSH Desktop.exe" /T /F'),
      'the shell is still ended by image name')
    assert.ok(noEntry.content.includes('Start-Process -FilePath'),
      'the shell is still restarted through Start-Process')
    assert.ok(!noEntry.content.includes('bin.js'), 'the rewritten argv is not passed on')
    assert.ok(!noEntry.content.includes('--port'), 'the shell still picks its own port')
    calls.push('desktop-detected-without-entry-ok')
    const desktop = hostRestartPlan({
      platform: 'win32', versions: { electron: '30' },
      argv: desktopArgv, execPath: desktopExe,
      cwd: 'C:\\work dir', dataDir: 'C:\\data', pid: 4242,
    })
    assert.strictEqual(desktop.desktop, true, 'a known desktop shell is restarted as a desktop')
    assert.ok(desktop.content.includes('taskkill /IM "DSH Desktop.exe" /T /F'),
      'the whole shell tree is ended by image name')
    assert.ok(!desktop.content.includes('/PID'), 'the desktop helper no longer kills one pid')
    assert.ok(desktop.content.includes('Start-Process -FilePath'),
      'the new shell is started through Start-Process, outside the helper console')
    assert.ok(!desktop.content.includes('start "" "C:\\Program Files\\DSH Desktop\\DSH Desktop.exe"'),
      'the desktop helper never starts the shell as a direct child')
    assert.ok(!desktop.content.includes('bin.js'), 'no harness entry is passed on the desktop')
    assert.ok(!desktop.content.includes('--port'), 'the desktop shell picks its own port')
    assert.strictEqual((desktop.content.match(/%ERRORLEVEL%/g) || []).length, 2,
      'both the kill and the start record their exit code')
    const old = hostRestartPlan({ platform: 'win32', versions: { electron: '30' }, argv: desktopArgv,
      execPath: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe', dataDir: 'C:\\data', pid: 1 })
    assert.strictEqual(old.desktop, true, 'the old shell name is still recognised')
    const unknown = hostRestartPlan({ platform: 'win32', versions: { electron: '30' }, argv: desktopArgv,
      execPath: 'C:\\Program Files\\Other\\some.exe', dataDir: 'C:\\data', pid: 4242 })
    assert.strictEqual(unknown.desktop, false, 'an unknown binary is never restarted as a desktop')
    assert.ok(unknown.content.includes('taskkill /PID 4242 /F'), 'it falls back to the pid helper')
    const cli = hostRestartPlan({ platform: 'win32', versions: {}, argv: ['bin.js', 'web'],
      execPath: 'C:\\node.exe', dataDir: 'C:\\data', pid: 7 })
    assert.strictEqual(cli.desktop, false, 'a CLI host is not a desktop host')
    assert.ok(cli.content.includes('taskkill /PID 7 /F'), 'the CLI helper still kills this pid')
    assert.ok(!cli.content.includes('/IM'), 'the CLI helper never kills by image name')
    assert.ok(cli.content.includes('start "" C:\\node.exe bin.js web'),
      'the CLI helper keeps its executable and argv')
    const electronButNode = hostRestartPlan({ platform: 'win32', versions: { electron: '30' },
      argv: ['bin.js', 'web'], execPath: 'C:\\Program Files\\nodejs\\node.exe', dataDir: 'C:\\data', pid: 8 })
    assert.strictEqual(electronButNode.desktop, false,
      'the executable whitelist, not Electron alone, decides')
    const noElectron = hostRestartPlan({ platform: 'win32', versions: {}, argv: desktopArgv,
      execPath: desktopExe, dataDir: 'C:\\data', pid: 9 })
    assert.strictEqual(noElectron.desktop, false, 'a non-Electron runtime is never a desktop')
    const posix = hostRestartPlan({ platform: 'linux', versions: {}, argv: ['bin.js', 'web'],
      execPath: '/usr/bin/node', dataDir: '/tmp/data', cwd: '/tmp', pid: 10 })
    assert.strictEqual(posix.desktop, false, 'a POSIX plan is never a desktop plan')
    const launched = restartHelperLaunch(desktop)
    assert.strictEqual(launched.file, 'powershell.exe', 'the desktop helper is launched by powershell')
    const launchLine = launched.args.join(' ')
    assert.ok(launchLine.includes('Invoke-CimMethod') && launchLine.includes('Win32_Process'),
      'the desktop helper is created through WMI, outside the shell tree')
    const cliLaunch = restartHelperLaunch(cli)
    assert.deepStrictEqual([cliLaunch.file, cliLaunch.args[1]], ['cmd', cli.helperPath],
      'the CLI helper is a plain detached child')
    calls.push('desktop-restart-plan-ok')

    // 54f-2. A launcher that printed nothing is not proof of failure, and a
    // non-zero ReturnValue or any stderr is proof it did not start. Real-machine
    // launch failures cannot be injected here (runLaunch spawns PowerShell
    // directly), so the pure verdict and the helper's liveness marker carry it.
    const verdictCases = [
      [{ code: 0, out: '0' }, true, 0],
      [{ code: 0, out: '1' }, false, 1],
      [{ code: 9, out: '' }, false, 9],
      [{ code: 0, out: '', err: '' }, true, 0],
      [{ code: 0, out: '  0  ' }, true, 0],
    ]
    for (const [outcome, started, code] of verdictCases) {
      const v = judgeLaunchResult(outcome)
      assert.strictEqual(v.started, started, 'the launcher verdict follows code/ReturnValue: ' + JSON.stringify(outcome))
      assert.strictEqual(v.code, code, 'the verdict reports the code it judged: ' + JSON.stringify(outcome))
    }
    const denied = judgeLaunchResult({ code: 0, out: '0', err: 'denied' })
    assert.strictEqual(denied.started, false, 'stderr means the helper did not start')
    assert.strictEqual(denied.detail, 'denied', 'stderr wins over a clean ReturnValue')
    calls.push('restart-launch-verdict-ok')

    const markerPlan = hostRestartPlan({ platform: 'win32', versions: { electron: '43' },
      argv: [desktopExe, 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\bin.js', 'web'],
      execPath: desktopExe, dataDir: 'C:\\data', pid: 12 })
    const markerAt = markerPlan.content.indexOf('helper-start')
    assert.ok(markerAt > 0, 'the helper writes a liveness marker')
    assert.ok(!markerPlan.content.slice(0, markerAt).includes('ping')
      && !markerPlan.content.slice(0, markerAt).includes('taskkill'),
      'the marker comes before the wait and the kill')
    assert.ok(markerPlan.content.indexOf('ping') > markerAt, 'the first wait follows the marker')
    const cliPlan = hostRestartPlan({ platform: 'win32', versions: {}, argv: ['bin.js', 'web'],
      execPath: 'C:\\node.exe', dataDir: 'C:\\data', pid: 13 })
    assert.ok(!cliPlan.content.includes('helper-start'), 'the CLI helper has no desktop marker')
    calls.push('restart-helper-start-marker-ok')

    for (const lang of LANGS) {
      const failed = t(lang, 'log.restartLaunchFailed', { code: '9', error: 'denied' })
      assert.ok(failed.includes('9') && failed.includes('denied'),
        'the launch failure renders its code and error in ' + lang)
      assert.ok(t(lang, 'log.restartFallback').length > 0, 'the fallback line exists in ' + lang)
    }
    calls.push('restart-launch-copy-ok')


    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'dsh-restart-status-'))
    const file = pathMod.join(dir, 'restart.status')
    fs.writeFileSync(file, 'ok\n')
    assert.strictEqual(takeRestartStatus({ dataDir: dir }), 'ok', 'ok is read back')
    assert.strictEqual(fs.existsSync(file), false, 'ok is consumed')
    fs.writeFileSync(file, 'unverified')
    assert.strictEqual(takeRestartStatus({ dataDir: dir }), 'unverified', 'unverified is read back')
    assert.strictEqual(fs.existsSync(file), false, 'unverified is consumed')
    assert.strictEqual(takeRestartStatus({ dataDir: dir }), null, 'a missing status is null')
    fs.writeFileSync(file, 'not a status')
    assert.doesNotThrow(() => takeRestartStatus({ dataDir: dir }), 'garbage never throws')
    assert.strictEqual(takeRestartStatus({ dataDir: dir }), null, 'garbage is not a claim')
    assert.strictEqual(fs.existsSync(file), false, 'garbage is consumed too')
    calls.push('restart-status-consumed-ok')

    // 54h. A success line may only come from the helper's status file, once per
    // boot: a plain boot claims nothing, and reading the file clears it.
    const dataDir = pathMod.join(process.cwd(), 'data')
    const liveStatus = pathMod.join(dataDir, 'restart.status')
    const count = async (key) => (await eventsNow()).filter((e) => e.key === key).length
    try { fs.unlinkSync(liveStatus) } catch { /* absent */ }
    const verifiedBefore = await count('log.restartVerified')
    const unverifiedBefore = await count('log.shellStartUnverified')
    mount()
    mount = apply(ctx, { countdownSec: 10, marginSec: 5, language: 'zh' })
    await flush()
    assert.strictEqual(await count('log.restartVerified'), verifiedBefore,
      'a boot without a status file does not claim a restart')
    assert.strictEqual(await count('log.shellStartUnverified'), unverifiedBefore,
      'and does not claim it was unverified either')
    fs.writeFileSync(liveStatus, 'ok')
    mount()
    mount = apply(ctx, { countdownSec: 10, marginSec: 5, language: 'zh' })
    await flush()
    assert.strictEqual(await count('log.restartVerified'), verifiedBefore + 1,
      'the next boot reports the helper result exactly once')
    assert.strictEqual(fs.existsSync(liveStatus), false, 'the status file is cleared after reading')
    calls.push('restart-no-false-success-ok')
  }

  mount()
}

// 53. The script library: a v4 store with two profile-owned copies of the same
// bytes migrates into one shared entry, the migration is written immediately
// (a crash right after mounting must not lose the library) and is idempotent on
// the next mount. Uploads dedupe by (sha256, ext), one acknowledgement covers
// every profile pointing at the entry, deleting it only clears the references,
// and renaming is a library operation that a profile patch cannot perform.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const dataDir = pathMod.join(here, '..', 'data')
  const scriptsDir = pathMod.join(dataDir, 'scripts')
  const cfgFile = pathMod.join(dataDir, 'config.json')
  const readCfg = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  let refused
  const stateNow = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  const postState = async (suffix, payload) => {
    const r = await request('POST', '/api/dsh-shutdown-guard' + suffix, 'http://127.0.0.1:43129', payload)
    return { status: r.status, body: JSON.parse(r.body) }
  }
  // `/arm` now schedules one tick that re-runs the idle gate, so a test that
  // wants to see what the countdown registers has to let that tick run first.
  const armNow = async () => {
    const before = new Set(timers.keys())
    const res = await postState('/arm')
    if (res.status === 200 && res.body.armed) {
      for (const id of [...timers.keys()]) {
        if (before.has(id)) continue
        const cb = timers.get(id)
        timers.delete(id)
        if (cb) cb()
      }
      await flush()
    }
    return res
  }
  try { fs.rmSync(scriptsDir, { recursive: true, force: true }) } catch { /* fresh */ }
  try { fs.rmSync(cfgFile, { force: true }) } catch { /* fresh */ }
  writeV4SharedScripts(dataDir)

  let mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await flush()
  let st = await stateNow()
  let entry = st.scripts.find((s) => s.sha256 === SHARED_SHA)
  assert.ok(entry, 'the two legacy copies collapse into one library entry')
  assert.strictEqual(st.scripts.length, 1, 'byte-identical legacy scripts share a single entry')
  const entryId = entry.id
  assert.deepStrictEqual(Object.keys(entry).sort(),
    ['ackAt', 'ackOk', 'bytes', 'ext', 'id', 'name', 'reason', 'runnable', 'savedAt', 'sha256', 'usedBy'],
    'a library entry has exactly the published shape')
  assert.strictEqual(entry.ext, 'ps1', 'the shared extension is kept')
  assert.strictEqual(entry.bytes, Buffer.byteLength(SAMPLES.shared.content), 'the byte count is kept')
  assert.strictEqual(entry.ackOk, true, 'the surviving acknowledgement is kept on the entry')
  assert.strictEqual(typeof entry.ackAt, 'number', 'the ack timestamp survives the migration')
  assert.strictEqual(entry.usedBy, 2, 'both legacy profiles point at the shared entry')
  const p1 = st.profiles.find((p) => p.id === 'p1')
  const p2 = st.profiles.find((p) => p.id === 'p2')
  assert.strictEqual(p1.scriptId, entryId, 'p1 points at the shared entry')
  assert.strictEqual(p2.scriptId, entryId, 'p2 points at the shared entry')
  assert.strictEqual(p1.script.sha256, SHARED_SHA, 'the compatibility projection still describes p1 bytes')
  assert.strictEqual(p2.script.sha256, SHARED_SHA, 'the compatibility projection still describes p2 bytes')
  assert.strictEqual(p1.scriptAck && p1.scriptAck.sha256, SHARED_SHA, 'p1 keeps its consent through the projection')
  assert.strictEqual(p2.scriptAck && p2.scriptAck.sha256, SHARED_SHA,
    'p2 inherits the shared entry consent through the projection')

  // The migration must hit disk before the first request returns: a host killed
  // right after mounting would otherwise come back to files it can no longer map.
  const saved = readCfg()
  assert.strictEqual(saved.version, 5, 'the migrated store is written as v5 immediately')
  assert.strictEqual(saved.scripts.length, 1, 'the library is persisted on migration')
  assert.strictEqual(saved.scripts[0].id, entryId, 'the persisted entry keeps its id')
  assert.strictEqual(readCfg().scripts[0].ack.sha256, SHARED_SHA, 'the ack moves onto the library entry')
  const migratedFiles = fs.readdirSync(scriptsDir)
  assert.deepStrictEqual(migratedFiles, [entryId + '.ps1'], 'only the library-named file remains')
  calls.push('migrate-script-library-ok')

  // Idempotence: mounting the same store again must not duplicate entries or files.
  mount()
  mount = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.scripts.length, 1, 'a second mount does not duplicate the library')
  assert.deepStrictEqual(fs.readdirSync(scriptsDir), [entryId + '.ps1'], 'a second mount does not copy the file')
  calls.push('migrate-script-library-idempotent-ok')

  // 53a. Dedupe is keyed by bytes *and* extension.
  const lib = st.scripts.length
  let r = await postState('/config', { putScript: { name: 'renamed.ps1', ext: 'ps1', content: SAMPLES.shared.content } })
  assert.strictEqual(r.status, 200, 're-uploading identical bytes is accepted')
  assert.strictEqual(r.body.reused, true, 'identical bytes reuse the library entry')
  assert.strictEqual(r.body.scriptId, entryId, 'the reused upload reports the existing id')
  st = await stateNow()
  assert.strictEqual(st.scripts.length, lib, 're-uploading identical bytes does not grow the library')
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).name, entry.name,
    'a reuse never renames the existing entry')
  r = await postState('/config', { putScript: { name: 'shared.py', ext: 'py', content: SAMPLES.sameShaDiffExt.content } })
  assert.strictEqual(r.body.reused, false, 'the same bytes under another extension are a new script')
  const pyId = r.body.scriptId
  r = await postState('/config', { putScript: { name: 'other.ps1', ext: 'ps1', content: SAMPLES.sameExtDiffSha.content } })
  assert.strictEqual(r.body.reused, false, 'different bytes under the same extension are a new script')
  const otherId = r.body.scriptId
  st = await stateNow()
  assert.strictEqual(st.scripts.length, lib + 2, 'both non-duplicates enter the library')
  assert.strictEqual(st.scripts.find((s) => s.id === pyId).sha256, SHARED_SHA, 'the py entry hashes its bytes')
  assert.strictEqual(st.scripts.find((s) => s.id === otherId).sha256, sha256(SAMPLES.sameExtDiffSha.content),
    'the other ps1 entry hashes its own bytes')
  calls.push('script-dedupe-ok')

  // 53b. Selecting an entry is per profile; usedBy counts the live references.
  await postState('/config', { selectScript: { profileId: 'p1', scriptId: entryId } })
  await postState('/config', { selectScript: { profileId: 'p2', scriptId: pyId } })
  st = await stateNow()
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').scriptId, entryId, 'p1 selects the shared entry')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p2').scriptId, pyId, 'p2 selects the py entry')
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).usedBy, 1, 'usedBy follows the references')
  assert.strictEqual(st.scripts.find((s) => s.id === pyId).usedBy, 1, 'usedBy counts each profile once')
  assert.strictEqual(st.scripts.find((s) => s.id === otherId).usedBy, 0, 'an unused entry reports zero')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p2').script.sha256, SHARED_SHA,
    'the projection describes the newly selected entry')
  calls.push('script-sharing-ok')

  // 53c. An acknowledgement belongs to the entry, not to the profile that made it.
  await postState('/config', { selectScript: { profileId: 'p2', scriptId: entryId } })
  r = await postState('/config', { ackScript: { scriptId: entryId } })
  assert.strictEqual(r.status, 200, 'acknowledging a library entry is accepted')
  st = await stateNow()
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').scriptAck.sha256, SHARED_SHA, 'p1 shares the ack')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p2').scriptAck.sha256, SHARED_SHA, 'p2 shares the ack')
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).ackOk, true, 'the entry records the ack')
  r = await postState('/config', { putScript: { profileId: 'p1', name: 'next.ps1', ext: 'ps1', content: SAMPLES.sameExtDiffSha.content } })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').scriptAck, null,
    'switching p1 to fresh bytes loses its consent')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p2').scriptAck.sha256, SHARED_SHA,
    'p2 keeps consent via the still-acknowledged entry')
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).ackOk, true,
    'a new upload does not clear another entry\'s ack')
  calls.push('script-ack-scope-ok')

  // 53d. Renaming is a library write; a profile patch cannot rename a script.
  r = await postState('/config', { renameScript: { scriptId: entryId, name: 'shared-renamed.ps1' } })
  assert.strictEqual(r.status, 200, 'renaming a library entry is accepted')
  st = await stateNow()
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).name, 'shared-renamed.ps1',
    'the new name is published')
  assert.strictEqual(readCfg().scripts.find((s) => s.id === entryId).name, 'shared-renamed.ps1',
    'the new name is persisted')
  assert.deepStrictEqual(fs.readdirSync(scriptsDir).filter((f) => f.startsWith(entryId + '.')),
    [entryId + '.ps1'], 'renaming keeps the file name stable on disk')
  await postState('/config', { updateProfile: { id: 'p1', patch: { name: 'not-a-script-name' } } })
  st = await stateNow()
  assert.strictEqual(st.scripts.find((s) => s.id === entryId).name, 'shared-renamed.ps1',
    'a profile patch cannot rename a script')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').label, 'A',
    'a profile patch cannot rename the profile through the script route either')
  const bad = await postState('/config', { renameScript: { scriptId: entryId, name: '' } })
  assert.strictEqual(bad.status, 400, 'an empty script name is rejected')
  calls.push('script-rename-ok')

  // 53e. Deleting an entry clears the references and only then does arming fail.
  await postState('/config', { updateProfile: { id: 'p2', patch: { countdownSec: 10 } } })
  await postState('/config', { activeProfileId: 'p2' })
  r = await postState('/config', { deleteScript: { scriptId: entryId } })
  assert.strictEqual(r.status, 200, 'deleting a referenced entry is accepted')
  assert.strictEqual(r.body.affected, 1, 'the delete reports the number of profiles it unhooked')
  st = await stateNow()
  assert.strictEqual(st.scripts.some((s) => s.id === entryId), false, 'the entry leaves the library')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').scriptId, otherId,
    'p1 points at the other entry after its upload')
  assert.strictEqual(st.profiles.find((p) => p.id === 'p2').scriptId, null, 'p2 loses the dangling reference')
  assert.strictEqual(fs.existsSync(pathMod.join(scriptsDir, entryId + '.ps1')), false,
    'the deleted entry takes its file with it')
  const spawnsBefore = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'a deleted script is refused before arming')
  assert.strictEqual(refused.body.error, 'no-script',
    'the arm refusal names the missing script, not a missing consent')
  assert.strictEqual(refused.body.armed, false, 'the refused arm leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'a profile without a script cannot arm')
  assert.strictEqual(spawns.length, spawnsBefore, 'nothing is sent with no script')
  calls.push('script-delete-ok')

  // 53e-bis. Selecting no script is not the same as deleting one: the library
  // entry survives, but arming still has to say the profile has no script.
  await postState('/config', { updateProfile: { id: 'p1', patch: { countdownSec: 10 } } })
  r = await postState('/config', { selectScript: { profileId: 'p1', scriptId: null } })
  assert.strictEqual(r.status, 200, 'a profile can select no script')
  await postState('/config', { activeProfileId: 'p1' })
  st = await stateNow()
  assert.strictEqual(st.profiles.find((p) => p.id === 'p1').scriptId, null,
    'the profile has no script selected')
  assert.ok(st.scripts.some((s) => s.id === otherId), 'the other library entry still exists')
  assert.ok(fs.existsSync(pathMod.join(scriptsDir, otherId + '.ps1')),
    'the unselected entry keeps its file')
  const unselectedSpawns = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'a profile with no script selected cannot arm')
  assert.strictEqual(refused.body.error, 'no-script',
    'an unselected script is reported as no-script, not as unconfirmed')
  assert.strictEqual(refused.body.armed, false, 'the refused arm leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'a profile with no script selected stays idle')
  assert.strictEqual(st.actions.custom.reason, 'no-script',
    'the action report agrees with the arm refusal')
  assert.strictEqual(spawns.length, unselectedSpawns, 'nothing is sent without a selected script')
  calls.push('arm-without-script-ok')

  // 53e-ter. A file that still exists but no longer hashes to the acknowledged
  // bytes is a consent failure, not a missing script.
  const otherFile = pathMod.join(scriptsDir, otherId + '.ps1')
  const otherBytes = fs.readFileSync(otherFile, 'utf8')
  r = await postState('/config', { selectScript: { profileId: 'p1', scriptId: otherId } })
  assert.strictEqual(r.status, 200, 'the surviving entry can be selected again')
  r = await postState('/config', { ackScript: { scriptId: otherId } })
  assert.strictEqual(r.status, 200, 'the surviving entry can be acknowledged')
  fs.writeFileSync(otherFile, otherBytes + 'Write-Output tampered\r\n')
  const tamperedSpawns = spawns.length
  refused = await armNow()
  assert.strictEqual(refused.status, 409, 'a tampered script is refused before arming')
  assert.strictEqual(refused.body.error, 'script-not-acknowledged',
    'a changed file is reported as unconfirmed, not as missing')
  assert.strictEqual(refused.body.armed, false, 'the refused arm leaves the mode off')
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'a tampered script cannot arm')
  assert.strictEqual(spawns.length, tamperedSpawns, 'nothing is sent with changed bytes')
  fs.writeFileSync(otherFile, otherBytes)
  calls.push('script-bytes-mismatch-ok')

  // 53f. The published state is self-consistent: every profile projection can be
  // matched back to a library entry by id and hash, and every hash is sha256.
  st = await stateNow()
  const byId = new Map(st.scripts.map((s) => [s.id, s]))
  for (const s of st.scripts) {
    assert.match(s.sha256, /^[0-9a-f]{64}$/, 'every published entry carries a sha256')
    const used = st.profiles.filter((p) => p.scriptId === s.id).length
    assert.strictEqual(s.usedBy, used, `usedBy matches the profiles for ${s.id}`)
  }
  for (const p of st.profiles) {
    if (!p.scriptId) continue
    const s = byId.get(p.scriptId)
    assert.ok(s, `profile ${p.id} points at a live entry`)
    assert.strictEqual(p.script.sha256, s.sha256, `profile ${p.id} projection hashes the entry bytes`)
    assert.strictEqual(s.ackOk === true, !!(p.scriptAck && p.scriptAck.sha256 === s.sha256),
      `profile ${p.id} ack mirrors the entry`)
  }
  calls.push('script-state-contract-ok')

  // 53g. Every library entry says whether it can run on this machine, so the
  // client can grey out what would fail at the deadline instead of letting the
  // user pick it and learn only from a refusal.
  const realLibResolve = subprocess.resolveExecutable
  st = await stateNow()
  const psEntry = st.scripts.find((s) => s.ext === 'ps1')
  assert.strictEqual(psEntry.runnable, true, 'a script whose interpreter resolves is runnable')
  assert.strictEqual(psEntry.reason, null, 'a runnable script carries no reason')
  r = await postState('/config', { putScript: { profileId: 'p1', name: 'probe.py', ext: 'py', content: 'print(1)\n' } })
  assert.strictEqual(r.status, 200, 'a .py script joins the library')
  const probePyId = r.body.scriptId
  await flush()
  st = await stateNow()
  let libEntry = st.scripts.find((s) => s.id === probePyId)
  assert.ok(libEntry, 'the .py entry is published')
  assert.strictEqual(typeof libEntry.runnable, 'boolean', 'runnable is always a boolean')
  fs.unlinkSync(pathMod.join(scriptsDir, libEntry.id + '.py'))
  await postState('/config', { recheck: true })
  await flush()
  st = await stateNow()
  libEntry = st.scripts.find((s) => s.id === probePyId)
  assert.deepStrictEqual([libEntry.runnable, libEntry.reason], [false, 'file-missing'],
    'a vanished file is reported as file-missing, not as a missing interpreter')
  r = await postState('/config', { putScript: { profileId: 'p1', name: 'probe.py', ext: 'py', content: 'print(1)\n' } })
  assert.strictEqual(r.status, 200, 'the same bytes can be uploaded again')
  assert.strictEqual(r.body.scriptId, probePyId, 're-uploading the original bytes heals the entry instead of duplicating it')
  const noPy = probePyId
  subprocess.resolveExecutable = async (name) => {
    if (name === 'python' || name === 'python3') return ''
    return realLibResolve(name)
  }
  await postState('/config', { recheck: true })
  await flush()
  st = await stateNow()
  libEntry = st.scripts.find((s) => s.id === noPy)
  assert.deepStrictEqual([libEntry.runnable, libEntry.reason], [false, 'missing-interpreter'],
    'a missing interpreter is named on the entry itself')
  subprocess.resolveExecutable = realLibResolve
  await postState('/config', { recheck: true })
  await flush()
  st = await stateNow()
  assert.strictEqual(typeof st.scripts.find((s) => s.id === noPy).runnable, 'boolean',
    'the entry recovers once the interpreter is back')
  assert.strictEqual(psEntry.runnable, true, 'one bad entry does not grey out the others')
  calls.push('script-runnable-ok')

  mount()
}

// 54. `/arm` now answers 409 before flipping the switch, so every refusal path
// is checked against the same response contract. A failed script execution is
// also visible as a verdict, not only as "已执行", and the tick `/arm` schedules
// must catch a job that appears right after the switch is turned on.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const dataDir = pathMod.join(here, '..', 'data')
  const cfgFile = pathMod.join(dataDir, 'config.json')
  for (const p of [cfgFile, pathMod.join(dataDir, 'ui.json')]) {
    try { fs.unlinkSync(p) } catch { /* fresh start */ }
  }
  fs.rmSync(pathMod.join(dataDir, 'scripts'), { recursive: true, force: true })
  const stateNow = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
  const eventsNow = async () => JSON.parse((await request('GET', '/api/dsh-shutdown-guard/events?limit=300')).body).events
  const postState = async (suffix, payload) => {
    const r = await request('POST', '/api/dsh-shutdown-guard' + suffix, 'http://127.0.0.1:43129', payload)
    return { status: r.status, body: JSON.parse(r.body) }
  }
  const armNow = async () => {
    const before = new Set(timers.keys())
    const res = await postState('/arm')
    if (res.status === 200 && res.body.armed) {
      for (const id of [...timers.keys()]) {
        if (before.has(id)) continue
        const cb = timers.get(id)
        timers.delete(id)
        if (cb) cb()
      }
      await flush()
    }
    return res
  }
  let mount = apply(ctx, { countdownSec: 10, marginSec: 5, language: 'zh' })
  await flush()
  await postState('/config', { createProfile: {} })
  await postState('/config', { customEnabled: true, activeProfileId: 'c1' })
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'custom', countdownSec: 10 } } })

  // 54a. custom without a script, custom with unacknowledged bytes, and an
  // action the probe says is unavailable all refuse with their own reason.
  let r = await postState('/arm')
  assert.deepStrictEqual([r.status, r.body.error, r.body.armed], [409, 'no-script', false],
    'a scriptless custom action is refused as no-script')
  let st = await stateNow()
  assert.strictEqual(st.armed, false, 'a refused arm leaves the switch off')
  assert.strictEqual(st.actions.custom.reason, 'no-script', 'the action report agrees there is no script')
  r = await postState('/config', { putScript: { profileId: 'c1', name: 'fail.cmd', ext: 'cmd', content: '@echo off\r\nexit /b 3\r\n' } })
  const scriptId = r.body.scriptId
  r = await postState('/arm')
  assert.deepStrictEqual([r.status, r.body.error, r.body.armed], [409, 'script-not-acknowledged', false],
    'unacknowledged bytes are refused as script-not-acknowledged')
  // NOTE(30): the probe still reports custom as available here; /arm is the
  // authority for the ack gate. Reported to host-core; assert it once the
  // availability table carries the same reason.
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'restart-dsh' } } })
  r = await postState('/arm')
  assert.deepStrictEqual([r.status, r.body.armed], [200, true],
    'restart-dsh is a real action now, so it can be armed')
  await postState('/disarm')
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'custom' } } })
  calls.push('arm-refusal-enumerated-ok')

  // 54a-bis. A library selection without profileId targets the active profile.
  r = await postState('/config', { putScript: { profileId: 'c1', name: 'second.cmd', ext: 'cmd', content: '@echo off\r\necho second\r\n' } })
  const secondId = r.body.scriptId
  r = await postState('/config', { selectScript: { scriptId: secondId } })
  assert.strictEqual(r.status, 200, 'selectScript works without a profileId')
  st = await stateNow()
  assert.strictEqual(st.activeProfileId, 'c1', 'the active profile is the implicit target')
  assert.strictEqual(st.profiles.find((p) => p.id === 'c1').scriptId, secondId,
    'the active profile now points at the requested entry')
  r = await postState('/config', { selectScript: { scriptId } })
  assert.strictEqual(r.status, 200, 'the original entry can be selected again')
  calls.push('select-script-defaults-to-active-ok')

  // 54b. A non-zero exit must be published as a failure, not hidden behind the
  // "the action ran" copy.
  await postState('/config', { ackScript: { scriptId } })
  const realSpawn = subprocess.spawn
  subprocess.spawn = (options) => {
    spawns.push(options.argv)
    return { done: Promise.resolve({ code: 3 }) }
  }
  try {
    const failedBefore = (await eventsNow()).filter((e) => e.key === 'log.actionFailed').length
    const beforeIds = new Set(timers.keys())
    await armNow()
    const fresh = [...timers.keys()].filter((id) => !beforeIds.has(id))
    assert.ok(fresh.length >= 2, 'the failing script registered its deadline and fired timers')
    fireTimer(fresh[0])
    await flush()
    await flush()
    const st = await stateNow()
    assert.strictEqual(st.lastAction && st.lastAction.failed, true, 'a non-zero exit is published as a failure')
    assert.strictEqual(st.lastAction.code, 3, 'the exit code is kept next to the verdict')
    const failed = (await eventsNow()).filter((e) => e.key === 'log.actionFailed')
    assert.strictEqual(failed.length - failedBefore, 1,
      'the event log records the failed action once')
    assert.strictEqual(failed[failed.length - 1].params && failed[failed.length - 1].params.code, '3',
      'the failure event carries the exit code')
    await postState('/cancel')
    await postState('/disarm')
  } finally {
    subprocess.spawn = realSpawn
  }
  calls.push('action-failure-visible-ok')

  // 54b-bis. On Linux a refused power action is retried once through pkexec; a
  // custom script never elevates, because its own exit code is the answer.
  {
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      let outcomes = [1, 0]
      subprocess.spawn = (options) => {
        spawns.push(options.argv)
        const code = outcomes.length > 0 ? outcomes.shift() : 0
        return { done: Promise.resolve({ code }) }
      }
      await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
      const elevatedBefore = spawns.length
      const elevatedTimers = new Set(timers.keys())
      const elevatedEvents = (await eventsNow()).filter((e) => e.key === 'log.actionElevated').length
      await armNow()
      const elevatedFresh = [...timers.keys()].filter((id) => !elevatedTimers.has(id))
      fireTimer(elevatedFresh[0])
      await flush()
      await flush()
      st = await stateNow()
      assert.strictEqual(spawns.length - elevatedBefore, 2, 'a refused power action is retried exactly once')
      assert.ok(spawns[elevatedBefore][0].includes('systemctl'), 'the first attempt is the plain command')
      assert.ok(spawns[elevatedBefore + 1][0].includes('pkexec'), 'the retry goes through pkexec')
      assert.strictEqual(st.lastAction.elevated, true, 'the state says the retry was elevated')
      assert.strictEqual(st.lastAction.code, 0, 'the successful retry is what the action reports')
      assert.strictEqual((await eventsNow()).filter((e) => e.key === 'log.actionElevated').length - elevatedEvents, 1,
        'elevation is logged once')
      await postState('/cancel')
      await postState('/disarm')

      outcomes = [1]
      const customBefore = spawns.length
      await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'custom' } } })
      const customTimers = new Set(timers.keys())
      await armNow()
      const customFresh = [...timers.keys()].filter((id) => !customTimers.has(id))
      fireTimer(customFresh[0])
      await flush()
      await flush()
      st = await stateNow()
      assert.strictEqual(spawns.length - customBefore, 1, 'a script failure is not retried')
      assert.ok(!spawns.slice(customBefore).some((argv) => String(argv[0]).includes('pkexec')), 'custom never uses pkexec')
      assert.strictEqual(st.lastAction.failed, true, 'the script failure is still published')
      await postState('/cancel')
      await postState('/disarm')
      calls.push('elevation-retry-ok')
    } finally {
      subprocess.spawn = realSpawn
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }
  }

  // 54c. `/arm` returns before its one-tick job check; a job registered in that
  // gap must still hold the action instead of letting the countdown start.
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
  const raceBefore = new Set(timers.keys())
  r = await postState('/arm')
  assert.deepStrictEqual([r.status, r.body.armed], [200, true], 'the switch turns on before the job check runs')
  emitJob({ type: 'registered', job: { id: 'race-1', kind: 'bash', label: 'race', status: 'running' } })
  const zeroTick = [...timers.keys()].find((id) => !raceBefore.has(id))
  assert.ok(zeroTick, 'arming scheduled the post-arm tick')
  timers.get(zeroTick)()
  await flush()
  st = await stateNow()
  assert.strictEqual(st.state, 'idle', 'a job registered right after arming keeps the countdown off')
  assert.strictEqual(st.lastSkip && st.lastSkip.key, 'skip.jobs', 'the job gate explains the hold')
  const heldSpawns = spawns.length
  emitJob({ type: 'settled', job: { id: 'race-1', kind: 'bash', label: 'race', status: 'completed' } })
  await flush()
  assert.strictEqual(spawns.length, heldSpawns, 'nothing is sent while the job holds the action')
  assert.strictEqual((await stateNow()).state, 'countdown', 'settling the job lets the held action start')
  await postState('/cancel')
  await postState('/disarm')
  calls.push('arm-then-job-race-ok')

  // 54d. The "skipped because of errors" line must not outlive the error window:
  // new activity clears the count, so the old line would claim a skip over 0 errors.
  await postState('/config', { updateProfile: { id: 'c1', patch: { action: 'shutdown' } } })
  await postState('/arm')
  rootAgent.status = 'running'
  statusHandler({ agent: rootAgent, status: 'running' })
  errorHandler({ agent: rootAgent })
  rootAgent.status = 'idle'
  statusHandler({ agent: rootAgent, status: 'idle' })
  await flush()
  st = await stateNow()
  assert.ok(st.lastSkip && String(st.lastSkip.key).startsWith('skip.errors'),
    'an errored batch leaves the error skip behind')
  rootAgent.status = 'running'
  statusHandler({ agent: rootAgent, status: 'running' })
  await flush()
  st = await stateNow()
  assert.strictEqual(st.erroredCount, 0, 'new activity clears the error window')
  assert.strictEqual(st.lastSkip, null, 'the stale error skip does not survive the cleared window')
  await postState('/disarm')
  calls.push('stale-skip-cleared-ok')

  // 54e. restart-dsh is planned, never launched by the tests. The helper text is
  // the contract: kill only this pid (no /T, the helper is our child), then start
  // the same executable in the same cwd with the same argv.
  {
    const fs = await import('node:fs')
    const pathMod = await import('node:path')
    const win = hostRestartPlan({
      platform: 'win32',
      execPath: 'C:\\Program Files\\DeepSeek Harness\\app.exe',
      argv: ['a b', 'say "hi"'],
      cwd: 'C:\\work dir',
      dataDir: 'C:\\data',
      pid: 4242,
    })
    assert.strictEqual(win.ok, true, 'a windows plan exists')
    assert.ok(win.content.includes('taskkill /PID 4242 /F'), 'the helper kills this pid')
    assert.ok(!win.content.includes('/T'), 'the helper is a child, so /T would kill it too')
    assert.ok(win.content.includes('start "" "C:\\Program Files\\DeepSeek Harness\\app.exe"'),
      'the helper restarts the same executable')
    assert.ok(win.content.includes('"a b"'), 'arguments with spaces stay quoted')
    assert.ok(win.content.includes('say \\"hi\\"'), 'embedded quotes survive cmd quoting')
    assert.ok(win.content.includes('cd /d "C:\\work dir"'), 'the helper keeps the working directory')
    assert.ok(win.content.includes('>> C:\\data\\restart.log 2>&1'), 'the output goes to restart.log')
    calls.push('host-restart-plan-ok')

    const posix = hostRestartPlan({
      platform: 'linux',
      execPath: '/opt/dsh/app',
      argv: ["a'b"],
      cwd: '/work dir',
      dataDir: '/data',
      pid: 4242,
    })
    assert.strictEqual(posix.ok, true, 'a posix plan exists')
    assert.ok(posix.content.includes('kill -TERM 4242'), 'the helper SIGTERMs this pid')
    assert.ok(posix.content.includes('exec \'/opt/dsh/app\''), 'the helper execs the same binary')
    assert.ok(posix.content.includes('cd \'/work dir\''), 'the helper keeps the working directory')
    assert.ok(posix.content.includes("'a'\\''b'"), 'single quotes are escaped for sh')
    assert.ok(posix.content.includes('>> \'/data/restart.log\''), 'the output goes to restart.log')
    calls.push('host-restart-plan-posix-ok')

    assert.deepStrictEqual(hostRestartPlan({ execPath: '' }),
      { ok: false, reason: 'no-host-restart' }, 'no executable means no honest restart')
    assert.deepStrictEqual(hostRestartPlan({ platform: 'aix' }),
      { ok: false, reason: 'unsupported-on-platform' }, 'unknown platforms are refused')
    calls.push('host-restart-plan-unavailable-ok')

    // The dsh-autorestart marker is read live by the gate, so a recheck (and an
    // arm) must see it appear and disappear without a restart.
    const marker = pathMod.join(emptyHome, '.dsh', 'storages', 'dsh-autorestart')
    fs.mkdirSync(marker, { recursive: true })
    await postState('/config', { recheck: true })
    await flush()
    st = await stateNow()
    assert.deepStrictEqual(st.actions['restart-dsh'],
      { available: false, reason: 'host-restart-taken' },
      'an installed dsh-autorestart owns the restart')
    fs.rmSync(pathMod.join(emptyHome, '.dsh'), { recursive: true, force: true })
    await postState('/config', { recheck: true })
    await flush()
    st = await stateNow()
    assert.deepStrictEqual(st.actions['restart-dsh'], { available: true, reason: null },
      'removing the marker returns the action to the host')
    assert.strictEqual(st.actions['restart-dsh'].available, hostRestartPlan().ok,
      'the probe answer and the live plan agree')
    calls.push('host-restart-yields-ok')
    calls.push('host-restart-ready-parity-ok')
  }

  mount()
}

console.log('PASS: ' + calls.join(', '))