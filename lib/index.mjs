/*
 * dsh-shutdown-panel — host half.
 *
 * Arms an automatic Windows shutdown once every root agent has finished and
 * no background job is still running. Behaviour mirrors
 * dsh-shutdown-after-task@0.2.0; the UI lives in the sidebar footer
 * (lib/client.js) instead of a floating DOM button.
 *
 * HTTP surface (same-origin, polled by the client half):
 *   GET  /api/dsh-shutdown-panel/state   -> state snapshot
 *   POST /api/dsh-shutdown-panel/arm     -> arm the mode
 *   POST /api/dsh-shutdown-panel/disarm  -> disarm the mode (cancels a countdown)
 *   POST /api/dsh-shutdown-panel/cancel  -> cancel the pending OS shutdown, stay armed
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-shutdown-panel'
export const inject = ['agents', 'subprocess', 'webServer']

const BASE = '/api/dsh-shutdown-panel'
const FS_HOME = process.env.DSH_HOME || process.cwd()

// Everything this plugin writes lives beside the plugin itself, so the files
// travel with it instead of being scattered around the harness home.
const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = path.join(PLUGIN_DIR, 'data')
const LOG_PATH = path.join(DATA_DIR, 'events.log')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

const DEFAULT_PROFILE_ID = 'default'
const CUSTOM_SLOT_COUNT = 8

function emptyProfile(id, label) {
  return {
    id,
    label,
    countdownSec: 60,
    marginSec: 5,
    onlyOnSuccess: true,
    blockOnJobs: true,
  }
}

function profileList() {
  const list = [emptyProfile(DEFAULT_PROFILE_ID, '默认配置')]
  for (let i = 1; i <= CUSTOM_SLOT_COUNT; i += 1) {
    list.push(emptyProfile('c' + i, '自定义 ' + i))
  }
  return list
}

/**
 * The default profile is the safety baseline: its countdown is fixed at 60s
 * (plus a 5s margin) and cannot be edited. Custom slots stay adjustable.
 */
function lockDefaultProfile(store) {
  const def = store.profiles.find((p) => p.id === DEFAULT_PROFILE_ID)
  if (!def) return
  def.countdownSec = 60
  def.marginSec = 5
}

/**
 * Answer text used when an armed plugin replies to an agent question on the
 * user's behalf. Kept in one place so the settings copy can quote it.
 */
const AFK_REPLY = [
  '【AFK 自动回答】用户当前处于 AFK 状态，无法即时回复。请自行推进，不要停下来等回复：',
  '1. 先把已经交代好的任务全部处理完成；',
  '2. 完成后把结果汇总成一份报告，写入工作区文件，并在回复里说明落盘路径；',
  '3. 不要触碰未交代的分支、选项或额外改动；确实需要决策时，按「保持现状、最小改动」处理，并在报告里注明。',
].join('\n')

const EVENTS_MAX = 300
const events = []

function log(message, kind) {
  const at = Date.now()
  const entry = { at, kind: kind || 'info', text: String(message) }
  events.push(entry)
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX)
  console.log(`[${name}] ${message}`)
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(LOG_PATH, `[${new Date(at).toISOString()}] ${entry.kind} ${entry.text}\n`)
  } catch {
    /* logging must never break the plugin */
  }
}

function recentEvents(since) {
  const from = Number(since) || 0
  return events.filter((e) => e.at > from)
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizeProfile(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    countdownSec: clampInt(src.countdownSec, 10, 600, fallback.countdownSec),
    marginSec: clampInt(src.marginSec, 0, 60, fallback.marginSec),
    onlyOnSuccess: src.onlyOnSuccess !== false,
    blockOnJobs: src.blockOnJobs !== false,
  }
}

/** The shipped defaults, or the bundle patch when one is provided. */
function baselineConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  return normalizeProfile(cfg, emptyProfile('x', 'x'))
}

function loadStore(baseline) {
  const slots = profileList()
  const store = { activeProfileId: DEFAULT_PROFILE_ID, customEnabled: false, afkAutoAnswer: true, profiles: slots }
  store.profiles[0] = Object.assign({}, slots[0], baseline)
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    raw = null
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.profiles)) {
      for (const item of raw.profiles) {
        if (!item || typeof item.id !== 'string') continue
        const slot = store.profiles.find((p) => p.id === item.id)
        if (!slot) continue
        if (typeof item.label === 'string' && item.label.trim().length > 0) slot.label = item.label.trim().slice(0, 24)
        Object.assign(slot, normalizeProfile(item, slot))
      }
    }
    if (typeof raw.activeProfileId === 'string' && store.profiles.some((p) => p.id === raw.activeProfileId)) {
      store.activeProfileId = raw.activeProfileId
    }
    store.customEnabled = raw.customEnabled === true
    store.afkAutoAnswer = raw.afkAutoAnswer !== false
  }
  if (!store.customEnabled) store.activeProfileId = DEFAULT_PROFILE_ID
  lockDefaultProfile(store)
  return store
}

function saveStore(store) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      version: 1,
      activeProfileId: store.activeProfileId,
      customEnabled: store.customEnabled,
      afkAutoAnswer: store.afkAutoAnswer !== false,
      profiles: store.profiles,
    }, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    log(`写入配置文件失败：${err && err.message ? err.message : err}`)
    return false
  }
}

function activeProfile(store) {
  return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0]
}

export function apply(ctx, rawConfig) {
  if (process.platform !== 'win32') {
    log(`当前平台为 ${process.platform}，本插件只在 Windows 上工作，不挂载`)
    return
  }

  const baseline = baselineConfig(rawConfig)
  const store = loadStore(baseline)
  // `cfg` stays a plain object so the rest of the state machine can read it
  // synchronously; it is refreshed from the active profile after every write.
  let cfg = normalizeProfile(activeProfile(store), baseline)

  function syncCfg() {
    if (!store.customEnabled) store.activeProfileId = DEFAULT_PROFILE_ID
    lockDefaultProfile(store)
    cfg = normalizeProfile(activeProfile(store), baseline)
    return cfg
  }

  let agents
  let subprocess
  let webServer
  let jobs
  try { agents = ctx.get('agents') } catch { agents = undefined }
  try { subprocess = ctx.get('subprocess') } catch { subprocess = undefined }
  try { webServer = ctx.get('webServer') } catch { webServer = undefined }
  try { jobs = ctx.get('jobs') } catch { jobs = undefined }

  if (!agents || !subprocess) {
    log('缺少 agents / subprocess 服务，插件不挂载')
    return
  }

  let armed = false
  let state = 'idle' // 'idle' | 'countdown' | 'fired'
  let errored = new Set()
  let deadline = 0
  let firedTimer = null
  let lastSkip = null
  const disposers = []
  // Background jobs that have registered and not yet settled, keyed by job id.
  // Events are process-wide (`owners: 'all'`), so one registry serves every
  // session without us needing to enumerate session ids.
  const liveJobs = new Map()
  let offJobEvents = null

  function roots() {
    try { return agents.roots() || [] } catch { return [] }
  }

  function rootsRunning() {
    try { return roots().filter((a) => a && a.status === 'running').length } catch { return 0 }
  }

  function isRoot(agent) {
    try { return roots().includes(agent) } catch { return true }
  }

  function jobsPending() {
    let count = 0
    for (const job of liveJobs.values()) {
      if (job && (job.status === 'running' || job.status === 'stopping')) count += 1
    }
    return count
  }

  function jobLabel(job) {
    if (job && typeof job.label === 'string' && job.label.length > 0) return job.label
    return (job && job.id) || '后台任务'
  }

  function onJobEvent(event) {
    const type = event && event.type
    const job = event && event.job
    if (!job || typeof job.id !== 'string') return
    if (type === 'registered' || type === 'stopping') {
      liveJobs.set(job.id, job)
      if (type === 'registered' && state === 'countdown') {
        log(`倒计时期间出现后台任务「${jobLabel(job)}」，取消关机（模式保持开启）`)
        cancelShutdown(false)
      }
      return
    }
    if (type === 'settled' || type === 'removed') {
      liveJobs.delete(job.id)
      // The last background job of an idle armed batch may now unblock arming.
      if (armed && state === 'idle') tryArm()
    }
  }

  function attachJobs(service) {
    if (!service || !service.events || typeof service.events.subscribe !== 'function') {
      log('jobs 服务缺少事件流，无法跟踪后台任务（仍按会话状态判断）')
      return
    }
    if (offJobEvents !== null) return
    try {
      offJobEvents = service.events.subscribe({ owners: 'all' }, onJobEvent)
      if (typeof offJobEvents !== 'function') offJobEvents = true
      log('已订阅后台任务事件：运行中的后台任务会阻止关机')
    } catch (err) {
      log(`订阅后台任务事件失败：${err && err.message ? err.message : err}`)
    }
  }

  /** Decide whether an idle batch may arm the shutdown; skips leave a reason. */
  function tryArm() {
    if (!armed || state !== 'idle') return false
    if (rootsRunning() > 0) return false
    const pendingJobs = cfg.blockOnJobs ? jobsPending() : 0
    if (pendingJobs > 0) {
      lastSkip = {
        at: Date.now(),
        reason: `还有 ${pendingJobs} 个后台任务在运行，暂不关机（模式保持开启）`,
      }
      log(lastSkip.reason)
      return false
    }
    if (cfg.onlyOnSuccess && errored.size > 0) {
      lastSkip = {
        at: Date.now(),
        reason: `本批次有 ${errored.size} 个会话出错，仅成功时关机（模式保持开启）`,
      }
      log(lastSkip.reason)
      return false
    }
    armShutdown()
    return true
  }

  async function spawnShutdown(args) {
    let argv = args
    try {
      const exe = await subprocess.resolveExecutable('shutdown')
      if (typeof exe === 'string' && exe.length > 0) argv = [exe, ...args]
    } catch {
      /* fall back to the bare command name (System32 is on PATH) */
    }
    try {
      const handle = subprocess.spawn({
        argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
        graceMs: 15000,
      })
      if (handle && handle.done && typeof handle.done.then === 'function') {
        handle.done
          .then((outcome) => log(`shutdown ${args.join(' ')} 进程退出：${JSON.stringify(outcome)}`))
          .catch((err) => log(`shutdown 进程启动失败：${err && err.message ? err.message : err}`))
      }
    } catch (err) {
      log(`spawn 失败：${err && err.message ? err.message : err}`)
    }
  }

  function reset() {
    state = 'idle'
    deadline = 0
    if (firedTimer !== null) {
      try { firedTimer() } catch { /* ignore */ }
      firedTimer = null
    }
  }

  function armShutdown() {
    if (state !== 'idle') return
    state = 'countdown'
    deadline = Date.now() + cfg.countdownSec * 1000
    log(`任务完成 → ${cfg.countdownSec} 秒后关机（侧边栏可取消）`)
    void spawnShutdown(['/s', '/t', String(cfg.countdownSec + cfg.marginSec)])
    firedTimer = ctx.setTimeout(() => {
      state = 'fired'
      log('系统关机指令已生效（无法取消）')
    }, (cfg.countdownSec + cfg.marginSec + 5) * 1000)
  }

  /**
   * Cancel the pending OS shutdown. `disarm` decides whether the mode keeps
   * watching for the next idle batch (a new task starting must keep it armed).
   */
  function cancelShutdown(disarm) {
    const wasPending = state === 'countdown' || state === 'fired'
    if (wasPending) {
      void spawnShutdown(['/a'])
      reset()
    }
    if (disarm && armed) {
      armed = false
      errored = new Set()
    }
    if (wasPending) log(`已取消关机（shutdown /a）${disarm ? '，模式已关闭' : '，模式保持开启'}`)
    return wasPending
  }

  function setArmed(next) {
    const value = !!next
    if (value === armed) return armed
    armed = value
    errored = new Set()
    if (!value) cancelShutdown(true)
    log(armed ? '已开启：任务完成后自动关机' : '已关闭：任务完成后自动关机')
    return armed
  }

  // ---------- agent events ----------

  const offStatus = ctx.on('agent/status', ({ agent, status }) => {
    if (!agent || !isRoot(agent)) return
    if (status === 'running') {
      errored = new Set() // new activity: fresh error window
      if (state === 'countdown') {
        log('倒计时期间新任务开始，取消关机（模式保持开启）')
        cancelShutdown(false)
      }
      return
    }
    // status === 'idle'
    if (!armed || state !== 'idle') return
    if (rootsRunning() > 0) return
    tryArm()
  })
  if (typeof offStatus === 'function') disposers.push(offStatus)

  const offError = ctx.on('agent/error', ({ agent }) => {
    if (!agent || !isRoot(agent)) return
    errored.add(String(agent.id))
    log(`root 会话出错：${String(agent.id)}`)
  })
  if (typeof offError === 'function') disposers.push(offError)

  // ---------- background jobs ----------

  if (jobs) {
    attachJobs(jobs)
  } else {
    log('未发现 jobs 服务：后台任务不会阻止关机')
    try {
      ctx.inject(['jobs'], (child) => {
        attachJobs(child.get('jobs'))
        return () => {
          if (typeof offJobEvents === 'function') {
            try { offJobEvents() } catch { /* ignore */ }
            offJobEvents = null
          }
        }
      })
    } catch { /* optional service */ }
  }

  // ---------- AFK auto answer ----------

  // While armed, answer an agent's question on the user's behalf so an
  // unattended batch keeps going instead of blocking until the countdown
  // fires. The answer is a custom text, not one of the offered options:
  // the user never picked anything, and the text tells the agent to finish
  // what it was already asked to do and to leave unrelated branches alone.
  //
  // `waterfall` runs listeners in registration order, and the built-in Web
  // answerer (via dsh-api-remotes) registers at boot and claims every
  // agent-scoped request first. Registering with `prepend` puts this listener
  // ahead of it; otherwise the question reaches the browser and this code
  // never runs.
  const onQuestion = (request, next) => {
    try {
      if (!armed || store.afkAutoAnswer === false) return next()
      const questions = request && Array.isArray(request.questions) ? request.questions : []
      if (questions.length === 0) return next()
      log(`AFK 自动回答 ${questions.length} 个提问（模式保持开启）`, 'afk')
      return {
        answers: questions.map((q) => ({ id: q.id, selected: [], custom: AFK_REPLY })),
      }
    } catch {
      return next()
    }
  }
  let offQuestions
  try {
    offQuestions = ctx.on('user-questions/request', onQuestion, { prepend: true })
  } catch {
    offQuestions = ctx.on('user-questions/request', onQuestion)
  }
  if (typeof offQuestions === 'function') disposers.push(offQuestions)

  // ---------- HTTP routes ----------

  if (!webServer) {
    log('缺少 webServer 服务：无法通过侧边栏面板控制关机')
  } else {
    const json = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const originOk = (req) => {
      const origin = req.headers.origin
      if (origin === undefined) return true
      try {
        const u = new URL(origin)
        return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
      } catch {
        return false
      }
    }
    const requirePost = (req, res) => {
      if (req.method === 'POST') return true
      json(res, 405, { error: 'method not allowed' })
      return false
    }

    const statePayload = (since) => ({
      armed,
      state,
      deadline,
      countdownSec: cfg.countdownSec,
      onlyOnSuccess: cfg.onlyOnSuccess,
      blockOnJobs: cfg.blockOnJobs,
      erroredCount: errored.size,
      lastSkip,
      runningCount: rootsRunning(),
      rootsCount: roots().length,
      jobsRunning: jobsPending(),
      jobsTotal: liveJobs.size,
      customEnabled: store.customEnabled,
      activeProfileId: store.activeProfileId,
      afkAutoAnswer: store.afkAutoAnswer !== false,
      countdownLocked: store.activeProfileId === DEFAULT_PROFILE_ID,
      profiles: store.profiles,
      events: recentEvents(since),
      serverTime: Date.now(),
    })

    function readJsonBody(req, done) {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 8192) req.destroy()
      })
      req.on('end', () => {
        try {
          done(raw ? JSON.parse(raw) : {})
        } catch {
          done(null)
        }
      })
      req.on('error', () => done(null))
    }

    function postRoute(suffix, handler) {
      disposers.push(webServer.register({
        kind: 'exact',
        path: BASE + suffix,
        handler: (req, res) => {
          if (!requirePost(req, res)) return
          if (!originOk(req)) return json(res, 403, { error: 'origin rejected' })
          try {
            handler(req, res)
          } catch (err) {
            log(`${suffix} 处理失败：${err && err.message ? err.message : err}`)
            json(res, 500, { error: 'internal error', ...statePayload() })
          }
        },
      }))
    }

    disposers.push(webServer.register({
      kind: 'exact',
      path: BASE + '/state',
      handler: (req, res) => {
        let since = 0
        try {
          since = Number(new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('since')) || 0
        } catch {
          since = 0
        }
        json(res, 200, statePayload(since))
      },
    }))
    postRoute('/arm', (req, res) => {
      setArmed(true)
      json(res, 200, statePayload())
    })
    postRoute('/disarm', (req, res) => {
      setArmed(false)
      json(res, 200, statePayload())
    })
    postRoute('/cancel', (req, res) => {
      const ok = cancelShutdown(false)
      json(res, 200, { ok, ...statePayload() })
    })
    // Writes land in data/config.json so custom profiles survive a restart.
    postRoute('/config', (req, res) => {
      readJsonBody(req, (body) => {
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'body is not JSON', ...statePayload() })

        if (typeof body.customEnabled === 'boolean') {
          store.customEnabled = body.customEnabled
          log(body.customEnabled ? '已启用自定义配置' : '已停用自定义配置，回到默认配置', 'config')
        }
        if (typeof body.activeProfileId === 'string') {
          const target = store.profiles.find((p) => p.id === body.activeProfileId)
          if (!target) return json(res, 400, { error: 'unknown profile', ...statePayload() })
          if (!store.customEnabled && target.id !== DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'custom profiles are disabled', ...statePayload() })
          }
          store.activeProfileId = target.id
          log(`切换配置：${target.label}`, 'config')
        }
        if (typeof body.afkAutoAnswer === 'boolean') {
          store.afkAutoAnswer = body.afkAutoAnswer
          log(body.afkAutoAnswer
            ? '已开启 AFK 自动回答：武装后会替用户回答提问'
            : '已关闭 AFK 自动回答', 'config')
        }
        if (typeof body.profileId === 'string') {
          const target = store.profiles.find((p) => p.id === body.profileId)
          if (!target) return json(res, 400, { error: 'unknown profile', ...statePayload() })
          if (typeof body.label === 'string' && body.label.trim().length > 0) {
            target.label = body.label.trim().slice(0, 24)
          }
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : body
          const next = normalizeProfile(Object.assign({}, target, {
            countdownSec: patch.countdownSec === undefined ? target.countdownSec : patch.countdownSec,
            marginSec: patch.marginSec === undefined ? target.marginSec : patch.marginSec,
            onlyOnSuccess: typeof patch.onlyOnSuccess === 'boolean' ? patch.onlyOnSuccess : target.onlyOnSuccess,
            blockOnJobs: typeof patch.blockOnJobs === 'boolean' ? patch.blockOnJobs : target.blockOnJobs,
          }), target)
          Object.assign(target, next)
          lockDefaultProfile(store)
          if (target.id === DEFAULT_PROFILE_ID) {
            log('默认配置的倒计时固定为 60 秒，已忽略修改', 'config')
          }
          log(`配置「${target.label}」更新：${target.countdownSec}s / 成功才关机=${target.onlyOnSuccess} / 后台任务拦截=${target.blockOnJobs}`, 'config')
        }
        syncCfg()
        saveStore(store)
        json(res, 200, statePayload())
      })
    })
    disposers.push(webServer.register({
      kind: 'exact',
      path: BASE + '/events',
      handler: (req, res) => {
        let since = 0
        let limit = 100
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          since = Number(url.searchParams.get('since')) || 0
          limit = clampInt(url.searchParams.get('limit'), 1, EVENTS_MAX, 100)
        } catch {
          /* keep defaults */
        }
        json(res, 200, { events: recentEvents(since).slice(-limit), serverTime: Date.now() })
      },
    }))

    log('HTTP 路由已注册')
  }

  log(`插件已挂载：root 会话 ${roots().length} 个，运行中 ${rootsRunning()} 个（模式默认关闭）`)

  return () => {
    if (typeof offJobEvents === 'function') {
      try { offJobEvents() } catch { /* ignore */ }
      offJobEvents = null
    }
    if (firedTimer !== null) {
      try { firedTimer() } catch { /* ignore */ }
      firedTimer = null
    }
    for (const dispose of disposers) {
      try { if (typeof dispose === 'function') dispose() } catch { /* ignore */ }
    }
  }
}
