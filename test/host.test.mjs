import assert from 'node:assert'
import { apply } from '../lib/index.mjs'
import { LANGS, MESSAGES, catalogCoverage, t } from '../lib/i18n.mjs'

const spawns = []
const timers = new Map()
// Each run starts from a clean profile store: an earlier run may have left
// customEnabled / activeProfileId in data/config.json.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
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

assert.deepStrictEqual(
  [...routes.keys()].sort(),
  ['/api/dsh-shutdown-guard/arm', '/api/dsh-shutdown-guard/cancel', '/api/dsh-shutdown-guard/config', '/api/dsh-shutdown-guard/disarm', '/api/dsh-shutdown-guard/events', '/api/dsh-shutdown-guard/state', '/api/dsh-shutdown-guard/ui', '/api/dsh-shutdown-guard/window'],
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

// 5. last agent goes idle -> countdown + real /s /t 15
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
assert.strictEqual(spawns.length, 0, 'spawn is async')
await flush()
assert.deepStrictEqual(spawns[0], ['C:\\Windows\\System32\\shutdown.exe', '/s', '/t', '65'])
res = await request('GET', '/api/dsh-shutdown-guard/state')
body = JSON.parse(res.body)
assert.strictEqual(body.state, 'countdown')
assert.ok(body.deadline > Date.now() - 1000)
calls.push('countdown-ok')

// 6. a new task starts -> /a, stays armed
rootAgent.status = 'running'
statusHandler({ agent: rootAgent, status: 'running' })
await flush()
assert.deepStrictEqual(spawns[1], ['C:\\Windows\\System32\\shutdown.exe', '/a'])
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

// 8. clean batch -> countdown, then fired timer, then /cancel keeps armed
statusHandler({ agent: rootAgent, status: 'running' })
rootAgent.status = 'idle'
statusHandler({ agent: rootAgent, status: 'idle' })
await flush()
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'countdown')
assert.strictEqual(body.erroredCount, 0)

const lastTimer = [...timers.values()].pop()
assert.ok(lastTimer, 'fired timer registered')
lastTimer()
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'fired')

const before = spawns.length
res = await request('POST', '/api/dsh-shutdown-guard/cancel', 'http://localhost:43129')
await flush()
const cancelBody = JSON.parse(res.body)
assert.strictEqual(cancelBody.ok, true)
assert.deepStrictEqual(spawns[before], ['C:\\Windows\\System32\\shutdown.exe', '/a'])
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

// 10. a job starting during the countdown cancels /a but keeps the mode armed
const beforeJobCancel = spawns.length
emitJob({ type: 'registered', job: { id: 'bash-2', kind: 'bash', label: '后台测试', status: 'running' } })
await flush()
assert.deepStrictEqual(spawns[beforeJobCancel], ['C:\\Windows\\System32\\shutdown.exe', '/a'])
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.state, 'idle')
assert.strictEqual(body.armed, true)
assert.strictEqual(body.jobsRunning, 1)
emitJob({ type: 'settled', job: { id: 'bash-2', kind: 'bash', label: '后台测试', status: 'completed' } })
await flush()
calls.push('job-during-countdown-cancels-ok')

// 11. disarm
res = await request('POST', '/api/dsh-shutdown-guard/disarm', 'http://127.0.0.1:43129')
assert.strictEqual(JSON.parse(res.body).armed, false)
calls.push('disarm-ok')

// 12. profiles: default + 8 custom slots, config persists to data/config.json
body = JSON.parse((await request('GET', '/api/dsh-shutdown-guard/state')).body)
assert.strictEqual(body.profiles.length, 9, 'one default plus eight custom slots')
assert.strictEqual(body.activeProfileId, 'default')
assert.strictEqual(body.customEnabled, false)
calls.push('profiles-listed-ok')

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

// 14. default profile is locked to 60s
res = await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', { profileId: 'default', patch: { countdownSec: 300 } })
body = JSON.parse(res.body)
assert.strictEqual(body.profiles.find((p) => p.id === 'default').countdownSec, 60, 'default countdown is locked')
calls.push('default-locked-ok')

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
  profileId: 'default',
  patch: { onlyOnSuccess: false },
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
assert.strictEqual(spawns.length, beforeWrap + 1, 'wrap-up finished: shutdown is armed')
assert.deepStrictEqual(spawns[beforeWrap].slice(1, 3), ['/s', '/t'])
await request('POST', '/api/dsh-shutdown-guard/cancel', 'http://127.0.0.1:43129')
calls.push('afk-wrap-shutdown-ok')

// 18. Quota errors park the plugin: no nudge, and the shutdown never arms.
await request('POST', '/api/dsh-shutdown-guard/config', 'http://127.0.0.1:43129', {
  profileId: 'c3',
  patch: { onlyOnSuccess: false },
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
assert.strictEqual(spawns.length, beforeAbort + 1, 'the next completed run may arm again')
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

// 26. UI preferences live on the host, not in the window's localStorage: both
// surfaces must agree even when they sit in different storage partitions.
// Defaults are A / auto / auto plus compact on and every notify kind on; a POST
// replaces only the given fields; an unknown value is rejected instead of
// silently replaced, and the choice survives a restart through data/ui.json.
const NOTIFY_ALL = { countdown: true, fired: true, blocked: true, recovered: true }
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'A', theme: 'auto', lang: 'auto', compact: true, notify: NOTIFY_ALL }, 'UI defaults are A / auto / auto with compact and every notify kind on')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { variant: 'B', theme: 'light', lang: 'ru' })
assert.strictEqual(res.status, 200, 'a valid UI update is accepted')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'light', lang: 'ru', compact: true, notify: NOTIFY_ALL }, 'the POST response already carries the new UI')

res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'light', lang: 'ru', compact: true, notify: NOTIFY_ALL }, '/state reports the stored UI')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { theme: 'dark' })
assert.strictEqual(res.status, 200, 'an omitted field is not required')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'dark', lang: 'ru', compact: true, notify: NOTIFY_ALL }, 'omitted fields keep their value')

for (const bad of [{ variant: 'D' }, { theme: 'sepia' }, { lang: 'fr' }]) {
  res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', bad)
  assert.strictEqual(res.status, 400, `unknown value ${JSON.stringify(bad)} is rejected, not silently replaced`)
}
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui, { variant: 'B', theme: 'dark', lang: 'ru', compact: true, notify: NOTIFY_ALL }, 'a rejected update leaves the stored UI untouched')

{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const saved = JSON.parse(fs.readFileSync(pathMod.join(here, '..', 'data', 'ui.json'), 'utf8'))
  assert.deepStrictEqual(
    { variant: saved.variant, theme: saved.theme, lang: saved.lang, compact: saved.compact, notify: saved.notify },
    { variant: 'B', theme: 'dark', lang: 'ru', compact: true, notify: NOTIFY_ALL },
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

// 28. Notify is the same kind of setting but split per transition: the user
// decides which state changes are worth a system notification. The host stores
// one object, always complete, and rejects a per-key value of the wrong type
// instead of guessing which half of a boolean it meant.
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, NOTIFY_ALL, 'notify ships with every kind on')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: { blocked: false } })
assert.strictEqual(res.status, 200, 'one notify kind can be turned off')
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: true, fired: true, blocked: false, recovered: true }, 'only the named kind changes')
assert.strictEqual(JSON.parse(res.body).ui.compact, true, 'turning a notify kind off leaves compact alone')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: true, fired: true, blocked: false, recovered: true }, '/state reports the per-kind object')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: { blocked: 'yes' } })
assert.strictEqual(res.status, 400, 'a non-boolean notify kind is rejected')
assert.match(String(JSON.parse(res.body).error || ''), /notify\.blocked/, 'the rejection names the offending kind')
res = await request('GET', '/api/dsh-shutdown-guard/state')
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: true, fired: true, blocked: false, recovered: true }, 'the rejection does not change the stored value')

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: false })
assert.strictEqual(res.status, 200, 'a bare boolean still flips every kind at once')
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: false, fired: false, blocked: false, recovered: false }, 'false turns every kind off')
res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: { fired: true } })
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: false, fired: true, blocked: false, recovered: false }, 'a later per-kind update merges into the all-off state')

{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = pathMod.dirname(fileURLToPath(import.meta.url))
  const saved = JSON.parse(fs.readFileSync(pathMod.join(here, '..', 'data', 'ui.json'), 'utf8'))
  assert.deepStrictEqual(saved.notify, { countdown: false, fired: true, blocked: false, recovered: false }, 'the per-kind choice is persisted for the next start')
}

res = await request('POST', '/api/dsh-shutdown-guard/ui', 'http://127.0.0.1:43129', { notify: true })
assert.deepStrictEqual(JSON.parse(res.body).ui.notify, NOTIFY_ALL, 'true turns every kind back on')
calls.push('ui-notify-ok')
dispose()
assert.strictEqual(routes.size, 0, 'disposer removes HTTP routes')

// 29. Data written by the previous release kept notify as one boolean. Reading
// it must not lose the user's choice: true means every kind, false means none.
{
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const uiFile = pathMod.join(pathMod.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ui.json')
  fs.mkdirSync(pathMod.dirname(uiFile), { recursive: true })
  fs.writeFileSync(uiFile, JSON.stringify({ version: 1, notify: true }) + '\n', 'utf8')
  const dispose2 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  assert.deepStrictEqual(JSON.parse(res.body).ui.notify, NOTIFY_ALL, 'a legacy boolean true is read as every kind on')
  dispose2()

  fs.writeFileSync(uiFile, JSON.stringify({ version: 1, notify: false }) + '\n', 'utf8')
  const dispose3 = apply(ctx, { countdownSec: 10, marginSec: 5, onlyOnSuccess: true, language: 'zh' })
  res = await request('GET', '/api/dsh-shutdown-guard/state')
  assert.deepStrictEqual(JSON.parse(res.body).ui.notify, { countdown: false, fired: false, blocked: false, recovered: false }, 'a legacy boolean false is read as every kind off')

  dispose3()
  calls.push('ui-notify-legacy-ok')
}

console.log('PASS: ' + calls.join(', '))
