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

export const name = 'dsh-shutdown-panel'
export const inject = ['agents', 'subprocess', 'webServer']

const BASE = '/api/dsh-shutdown-panel'
const FS_HOME = process.env.DSH_HOME || process.cwd()
const LOG_PATH = path.join(FS_HOME, 'dsh-shutdown-panel.log')

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(`[${name}] ${message}`)
  try {
    fs.appendFileSync(LOG_PATH, line + '\n')
  } catch {
    /* logging must never break the plugin */
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  return {
    countdownSec: clampInt(cfg.countdownSec, 10, 600, 60),
    marginSec: clampInt(cfg.marginSec, 0, 60, 5),
    onlyOnSuccess: cfg.onlyOnSuccess !== false,
    blockOnJobs: cfg.blockOnJobs !== false,
  }
}

export function apply(ctx, rawConfig) {
  if (process.platform !== 'win32') {
    log(`当前平台为 ${process.platform}，本插件只在 Windows 上工作，不挂载`)
    return
  }

  const cfg = normalizeConfig(rawConfig)

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

    const statePayload = () => ({
      armed,
      state,
      deadline,
      countdownSec: cfg.countdownSec,
      erroredCount: errored.size,
      lastSkip,
      runningCount: rootsRunning(),
      rootsCount: roots().length,
      jobsRunning: jobsPending(),
      jobsTotal: liveJobs.size,
    })

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
      handler: (req, res) => json(res, 200, statePayload()),
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
