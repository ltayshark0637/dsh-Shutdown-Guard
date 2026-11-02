/*
 * dsh-shutdown-guard — host half.
 *
 * Arms an automatic Windows shutdown once every root agent has finished and
 * no background job is still running. Behaviour mirrors
 * dsh-shutdown-after-task@0.2.0; the UI lives in the sidebar footer
 * (lib/client.js) instead of a floating DOM button.
 *
 * HTTP surface (same-origin, polled by the client half):
 *   GET  /api/dsh-shutdown-guard/state   -> state snapshot
 *   POST /api/dsh-shutdown-guard/arm     -> arm the mode
 *   POST /api/dsh-shutdown-guard/disarm  -> disarm the mode (cancels a countdown)
 *   POST /api/dsh-shutdown-guard/cancel  -> cancel the pending OS shutdown, stay armed
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-shutdown-guard'
export const inject = ['agents', 'subprocess', 'webServer']

const BASE = '/api/dsh-shutdown-guard'
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
    retrySec: 30,
    retryPolicies: null,
    retryAssign: null,
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

/**
 * Sent to a root agent whose turn failed while armed with AFK auto-answer on:
 * find out what broke, fix it, keep going on the original plan.
 */
const AFK_RECOVER_TEXT = [
  '【AFK 自动接管】上一轮执行报错了，但用户当前处于 AFK，无法立刻介入。请按这个顺序处理：',
  '1. 先定位报错原因（读报错信息，检查刚才的改动、命令或文件），能修就修；',
  '2. 修好之后按原计划继续推进剩下的任务，不要因为一次报错就整体放弃；',
  '3. 如果同一个问题连续两次尝试仍然解决不了，停止重试，把已完成的部分、失败原因和下一步建议写成报告文件并说明落盘路径，然后结束本轮。',
  '不要触碰未交代的分支或额外改动。',
].join('\n')

/** Sent when the same agent failed again: stop retrying and write it down. */
/** Sent when a provider-side outage has passed and the batch should resume. */
const AFK_RETRY_TEXT = [
  '【AFK 自动重试】刚才的外部服务故障看起来已经恢复，请继续推进原计划。',
  '1. 先回顾已经做到哪一步，不要重复已经完成的工作；',
  '2. 按原计划继续，完成后把结果汇总成报告并落盘。',
].join('\n')
const AFK_FINAL_TEXT = [
  '【AFK 收尾】这个问题重试过仍然失败。请停止重试，直接收尾：',
  '1. 把已完成的内容、失败原因、可复现步骤和建议写成一份报告文件，并说明落盘路径；',
  '2. 在回复里简要总结，然后结束任务。',
].join('\n')

/**
 * Two different kinds of stop sign, because they end differently.
 *
 * `halted` — no amount of retrying can fix it: the account, the model, or the
 * disk has to change first. Retrying only burns the turn budget and, worse,
 * would let an errored batch reach the shutdown. A human clears it.
 *
 * `waiting` — the outside world is temporarily unavailable. The failure is not
 * the task's fault, so the plugin backs off, retries on its own schedule, and
 * clears itself once a run finally succeeds.
 */
const HALTED_CODES = new Set([
  'QUOTA',
  'ACCOUNT_QUOTA',
  'INVALID_CREDENTIAL',
  'MISSING_CREDENTIAL',
  'CONTEXT_WINDOW_EXCEEDED',
  'CAPABILITY_UNSUPPORTED',
  'UNSUPPORTED_CAPABILITY',
  'DISK_FULL',
  'ENOSPC',
])
const HALTED_REASONS = {
  QUOTA: '额度不足，已暂停关机（充值后解除再武装）',
  ACCOUNT_QUOTA: '账户额度用尽，已暂停关机（充值后解除再武装）',
  INVALID_CREDENTIAL: '凭证无效，已暂停关机（修复后解除再武装）',
  MISSING_CREDENTIAL: '缺少凭证，已暂停关机（配置后解除再武装）',
  CONTEXT_WINDOW_EXCEEDED: '上下文已超出模型窗口，已暂停关机（建议新开会话）',
  CAPABILITY_UNSUPPORTED: '当前模型不支持这项操作，已暂停关机（换模型后再试）',
  UNSUPPORTED_CAPABILITY: '当前模型不支持这项操作，已暂停关机（换模型后再试）',
  DISK_FULL: '写盘失败，已暂停关机（清理空间后解除再武装）',
  ENOSPC: '写盘失败，已暂停关机（清理空间后解除再武装）',
}
// Retryable on the provider's side: worth waiting for, not worth asking a human.
// Each code names a retry *policy*, because within this group the right rhythm
// differs: a rate limit punishes retries (back off), while a dropped connection
// or a 5xx clears in seconds (poll at a fixed short interval).
const WAITING_CODES = new Set(['RATE_LIMIT', 'SERVER', 'TRANSPORT', 'EMPTY_RESPONSE', 'TIMEOUT', 'IMAGE_OFFLOAD_REQUIRED'])
const WAITING_REASONS = {
  RATE_LIMIT: '被限流，等待自动重试',
  SERVER: '服务端故障，等待自动重试',
  TRANSPORT: '网络中断，等待自动重试',
  EMPTY_RESPONSE: '模型返回空内容，等待自动重试',
  TIMEOUT: '请求超时，等待自动重试',
  IMAGE_OFFLOAD_REQUIRED: '图片需要先卸载到磁盘，等待自动重试',
}
// policy: { mode: 'backoff', base, max } | { mode: 'fixed', every }
const DEFAULT_RETRY_POLICIES = {
  'rate-limit': { mode: 'backoff', base: 30, max: 300 },
  transient: { mode: 'fixed', every: 20 },
  empty: { mode: 'fixed', every: 30 },
  offload: { mode: 'fixed', every: 5 },
}
const DEFAULT_RETRY_ASSIGN = {
  RATE_LIMIT: 'rate-limit',
  SERVER: 'transient',
  TRANSPORT: 'transient',
  TIMEOUT: 'transient',
  EMPTY_RESPONSE: 'empty',
  IMAGE_OFFLOAD_REQUIRED: 'offload',
}

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

/**
 * Merge a user-supplied policy table over the shipped defaults. Only the shapes
 * the scheduler understands survive, so a typo in the patch cannot park the
 * plugin with a policy that has no delay.
 */
function normalizePolicies(raw) {
  const out = {}
  for (const name of Object.keys(DEFAULT_RETRY_POLICIES)) {
    out[name] = Object.assign({}, DEFAULT_RETRY_POLICIES[name])
  }
  if (raw && typeof raw === 'object') {
    for (const name of Object.keys(raw)) {
      const p = raw[name]
      if (!p || typeof p !== 'object') continue
      if (p.mode === 'fixed') {
        out[name] = { mode: 'fixed', every: clampInt(p.every, 1, 3600, 20) }
      } else if (p.mode === 'backoff') {
        const base = clampInt(p.base, 1, 3600, 30)
        out[name] = { mode: 'backoff', base, max: Math.max(base, clampInt(p.max, base, 3600, 300)) }
      }
    }
  }
  return out
}

/** Which policy each error code uses; unknown codes fall back to `transient`. */
function normalizeAssign(raw) {
  const out = Object.assign({}, DEFAULT_RETRY_ASSIGN)
  if (raw && typeof raw === 'object') {
    for (const code of Object.keys(raw)) {
      const name = raw[code]
      if (typeof name === 'string' && name.length > 0) out[code] = name
    }
  }
  return out
}

function normalizeProfile(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    countdownSec: clampInt(src.countdownSec, 10, 600, fallback.countdownSec),
    marginSec: clampInt(src.marginSec, 0, 60, fallback.marginSec),
    onlyOnSuccess: src.onlyOnSuccess !== false,
    blockOnJobs: src.blockOnJobs !== false,
    retrySec: clampInt(src.retrySec, 10, 600, 30),
    retryPolicies: normalizePolicies(src.retryPolicies),
    retryAssign: normalizeAssign(src.retryAssign),
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
  // Set when a failure needs a human (quota / credentials). While it is set the
  // plugin never arms the shutdown, no matter how other conditions look.
  let blocked = null
  // A cancelled turn ends at the same `status = idle` as a finished one. The
  // session log still records why it ended, so watch `turn/end` and refuse to
  // arm while the latest turn was aborted by the user.
  let interrupted = false
  // AFK recovery attempts per root agent, cleared whenever the mode changes.
  const afkRecovered = new Map()
  // Agents that already got the wrap-up instruction: their earlier failure
  // stops blocking the shutdown once that turn finishes, but only when the
  // "skip on error" rule is off (otherwise a failed batch must never shut down).
  const afkWrapping = new Set()
  const disposers = []
  // Background jobs that have registered and not yet settled, keyed by job id.
  // Events are process-wide (`owners: 'all'`), so one registry serves every
  // session without us needing to enumerate session ids.
  const liveJobs = new Map()
  let offJobEvents = null
  // A `waiting` stop sign: the provider is unavailable, not the task. While set
  // the shutdown stays disarmed and a timer re-runs the batch on its own.
  let retryTimer = null
  let retryAt = 0
  let retryAttempt = 0

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

  /**
   * Pick the wait for one failure. The policy is chosen per error code, because
   * a rate limit punishes fast retries while a dropped connection clears in
   * seconds — one global rhythm would be wrong for both.
   */
  function retryDelaySec(code) {
    const name = cfg.retryAssign[code] || DEFAULT_RETRY_ASSIGN[code] || 'transient'
    const policy = cfg.retryPolicies[name] || DEFAULT_RETRY_POLICIES[name] || DEFAULT_RETRY_POLICIES.transient
    if (policy.mode === 'fixed') {
      return { policy: name, delaySec: clampInt(policy.every, 1, 3600, 20) }
    }
    const base = clampInt(policy.base, 1, 3600, 30)
    const cap = Math.max(base, clampInt(policy.max, base, 3600, 300))
    return { policy: name, delaySec: Math.min(base * Math.pow(2, Math.min(retryAttempt, 4)), cap) }
  }

  /** Park on a provider-side failure and retry the batch later. */
  function scheduleRetry(agent, reason, code) {
    const { policy, delaySec } = retryDelaySec(code)
    retryAttempt += 1
    retryAt = Date.now() + delaySec * 1000
    blocked = `${reason}（第 ${retryAttempt} 次，${delaySec} 秒后重试）`
    log(`外部服务暂不可用（${code}，策略 ${policy}）：${blocked}`, 'afk')
    if (retryTimer !== null) { try { retryTimer() } catch { /* ignore */ } retryTimer = null }
    retryTimer = ctx.setTimeout(() => {
      retryTimer = null
      // Clear the park, wake the agent, and let the next idle decide again.
      blocked = null
      retryAt = 0
      if (!armed) { retryAttempt = 0; return }
      const target = agent || roots()[0]
      if (target) nudgeAgent(target, AFK_RETRY_TEXT)
      else tryArm()
    }, delaySec * 1000)
    if (typeof retryTimer === 'function') disposers.push(retryTimer)
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
    if (blocked) {
      lastSkip = { at: Date.now(), reason: blocked }
      return false
    }
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
    if (errored.size > 0 && (cfg.onlyOnSuccess || store.afkAutoAnswer !== false)) {
      lastSkip = {
        at: Date.now(),
        reason: cfg.onlyOnSuccess
          ? `本批次有 ${errored.size} 个会话出错，仅成功时关机（模式保持开启）`
          : `本批次有 ${errored.size} 个会话出错，正在进行 AFK 恢复，暂不关机（模式保持开启）`,
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
    afkRecovered.clear()
    afkWrapping.clear()
    blocked = null
    interrupted = false
    retryAttempt = 0
    retryAt = 0
    if (retryTimer !== null) { try { retryTimer() } catch { /* ignore */ } retryTimer = null }
    if (!value) cancelShutdown(true)
    log(armed ? '已开启：任务完成后自动关机' : '已关闭：任务完成后自动关机')
    return armed
  }

  // ---------- agent events ----------

  const offStatus = ctx.on('agent/status', ({ agent, status }) => {
    if (!agent || !isRoot(agent)) return
    const id = String(agent.id)
    if (status === 'running') {
      errored = new Set() // new activity: fresh error window
      if (blocked && retryAt === 0 && retryTimer === null) {
        // A run finished without a provider failure: the outage is over.
        log('外部服务已恢复，解除等待', 'afk')
        blocked = null
        retryAttempt = 0
      }
      interrupted = false
      if (state === 'countdown') {
        log('倒计时期间新任务开始，取消关机（模式保持开启）')
        cancelShutdown(false)
      }
      return
    }
    // status === 'idle'
    // The wrap-up turn of a failed agent just finished: its earlier failure no
    // longer blocks this batch (only reachable when "skip on error" is off).
    if (afkWrapping.has(id)) {
      afkWrapping.delete(id)
      errored.delete(id)
      log(`AFK 收尾会话 ${id} 已结束，本轮错误不再阻止关机`)
    }
    if (!armed || state !== 'idle') return
    if (rootsRunning() > 0) return
    if (interrupted) {
      lastSkip = { at: Date.now(), reason: '已检测到用户中断，本轮不关机（模式保持开启，下次任务完成后再算）' }
      log(lastSkip.reason, 'afk')
      return
    }
    tryArm()
  })
  if (typeof offStatus === 'function') disposers.push(offStatus)

  // `session/event` is the public tap on the session log: the host passes
  // `(session, event)`. A finished turn and a cancelled turn both end at
  // `agent/status = idle`, so the log is the only place the difference shows.
  // Two independent signals are collected, because the exact `turn/end` data
  // shape is an internal detail: (a) the abort cause it records, and (b) a turn
  // that ends without ever appending an assistant message.
  let sawAssistant = false
  const offSession = ctx.on('session/event', (session, event) => {
    try {
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'turn/start') {
        sawAssistant = false
        return
      }
      if (event.type === 'assistant/message') {
        sawAssistant = true
        return
      }
      if (event.type !== 'turn/end') return
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      const blob = JSON.stringify(data)
      const cancelCause = /"(abort|cancel|cause|cancelled|canceled)"\s*:/i.test(blob)
        || /"kind"\s*:\s*"(user|parent|disposed|hook)"/i.test(blob)
      const silentTurn = sawAssistant === false
      if (cancelCause || silentTurn) {
        interrupted = true
        log(`检测到会话中断：本轮${silentTurn ? '没有任何回复' : '带取消原因'}（${blob.slice(0, 100)}）`, 'afk')
      }
      sawAssistant = false
    } catch { /* never let a log tap break the event bus */ }
  })
  if (typeof offSession === 'function') disposers.push(offSession)

  /**
   * Queue one extra user turn on a root agent. The message mirrors what the
   * host and the Agent Teams plugin hand to `Agent#followup`; if the runtime
   * rejects the shape we fall back to `steer` and finally give up quietly so a
   * failed nudge never becomes a shutdown.
   */
  function nudgeAgent(agent, text) {
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: String(agent.id) },
    }
    try {
      if (typeof agent.followup === 'function') {
        agent.followup(message)
        return true
      }
    } catch (err) {
      log(`AFK followup 失败：${err && err.message ? err.message : err}`, 'afk')
    }
    try {
      if (typeof agent.steer === 'function') {
        agent.steer(message)
        return true
      }
    } catch (err) {
      log(`AFK steer 失败：${err && err.message ? err.message : err}`, 'afk')
    }
    return false
  }

  function handleAgentError(agent, error) {
    if (!agent || !isRoot(agent)) return
    const id = String(agent.id)
    const code = error && typeof error.code === 'string' ? error.code : ''
    const name = error && typeof error.name === 'string' ? error.name : ''
    // A cancelled turn is not a failure: the user hit stop on purpose, so it
    // must not be re-prompted and must not count as an errored batch.
    if (name === 'AbortError' || code === 'ABORTED' || code === 'ABORT') {
      log(`会话 ${id} 被中断（主动取消），不按失败处理`, 'afk')
      return
    }
    errored.add(id)
    log(`root 会话出错：${id}${error && error.code ? '（' + error.code + '）' : ''}`)
    if (HALTED_CODES.has(code)) {
      const reason = HALTED_REASONS[code] || ('遇到需要人工处理的错误（' + code + '），已暂停关机')
      if (blocked !== reason) log(`会话 ${id} 的错误无法自愈（${code}）：${reason}`, 'afk')
      blocked = reason
      return
    }
    // Provider-side failures need patience, not a human: keep the plugin parked
    // and let a timer retry the batch. A successful run clears it again.
    if (WAITING_CODES.has(code)) {
      scheduleRetry(agent, WAITING_REASONS[code] || ('外部服务不可用（' + code + '），等待自动重试'), code)
      return
    }
    // AFK recovery: instead of letting this failure block the shutdown (or
    // shutting down on a half-done job), tell the agent to look into it and
    // carry on. A second failure turns into "write the report and stop".
    if (!armed || store.afkAutoAnswer === false) return
    const attempts = afkRecovered.get(id) || 0
    if (attempts >= 2) {
      log(`AFK 已为会话 ${id} 重试过两次，不再继续（等待收尾）`, 'afk')
      return
    }
    afkRecovered.set(id, attempts + 1)
    const text = attempts === 0 ? AFK_RECOVER_TEXT : AFK_FINAL_TEXT
    if (nudgeAgent(agent, text)) {
      if (attempts === 0) {
        log(`AFK 已要求出错会话 ${id} 排查并继续原计划`, 'afk')
      } else {
        log(`AFK 已要求出错会话 ${id} 停止重试、收尾落盘`, 'afk')
        // With "skip on error" off, this batch may still shut down: the failure
        // stops counting as soon as the wrap-up turn ends (see agent/status).
        if (cfg.onlyOnSuccess === false) afkWrapping.add(id)
      }
    } else {
      log(`AFK 无法向会话 ${id} 注入恢复指令，本轮不关机`, 'afk')
    }
  }

  const offError = ctx.on('agent/error', ({ agent, error }) => {
    try {
      handleAgentError(agent, error)
    } catch (err) {
      log(`AFK 错误恢复处理异常：${err && err.message ? err.message : err}`, 'afk')
    }
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
      retrySec: cfg.retrySec,
      retryPolicies: cfg.retryPolicies,
      retryAssign: cfg.retryAssign,
      erroredCount: errored.size,
      blocked,
      retryAttempt,
      retryAt,
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
    // Opt-in test hook: fire the same recovery path as a real agent failure so
    // the whole chain can be rehearsed without waiting for a genuine crash.
    // Only registered when cordis.patch.yml sets debugHooks: true.
    if (rawConfig && rawConfig.debugHooks === true) {
      postRoute('/error-test', (req, res) => {
        const root = roots()[0]
        if (!root) return json(res, 409, { error: 'no root agent', ...statePayload() })
        const code = new URL(req.url || '/', 'http://localhost').searchParams.get('code') || ''
        log(`调试：模拟会话 ${String(root.id)} 报错${code ? '（' + code + '）' : ''}`, 'afk')
        handleAgentError(root, code ? { code, message: 'simulated ' + code } : undefined)
        json(res, 200, { ok: true, ...statePayload() })
      })
    }
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
