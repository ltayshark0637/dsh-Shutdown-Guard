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

import { LANGS, resolveLang, t } from './i18n.mjs'

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

// A profile is a behaviour snapshot, not a look: countdown, margin, the three
// hard gates, AFK auto-answer, the four notification kinds and the retry policy.
// Appearance (variant/theme/lang) stays in the UI store below, because it is a
// property of the surface rather than of the shutdown decision.
const NOTIFY_KINDS = ['countdown', 'fired', 'blocked', 'recovered']
const NOTIFY_DEFAULT = { countdown: true, fired: true, blocked: true, recovered: true }
// The default profile is the safety baseline: neither the timer nor the gates
// may be loosened there, so a write that touches one of these is rejected.
const PROFILE_LOCKED_FIELDS = ['countdownSec', 'marginSec', 'onlyOnSuccess', 'blockOnJobs', 'afkAutoAnswer']
// Everything `updateProfile` is allowed to write; anything else is ignored.
const PROFILE_PATCH_FIELDS = [
  'countdownSec',
  'marginSec',
  'onlyOnSuccess',
  'blockOnJobs',
  'afkAutoAnswer',
  'notify',
  'retrySec',
  'retryPolicies',
  'retryAssign',
  'action',
  'customArgv',
  'shutdownOnHalt',
]

// A custom command: at most CUSTOM_ARGV_MAX entries of CUSTOM_ARGV_LEN chars each,
// no NULs. The whole array is rejected on the first bad entry so the caller sees
// what is wrong instead of a silently trimmed version of their command.
const CUSTOM_ARGV_MAX = 16
const CUSTOM_ARGV_LEN = 256

/** Normalise a stored custom command without ever throwing. */
function normalizeCustomArgv(raw, fallback) {
  const base = Array.isArray(fallback) ? fallback : []
  if (!Array.isArray(raw)) return base.slice(0, CUSTOM_ARGV_MAX)
  const out = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (item.length === 0 || item.length > CUSTOM_ARGV_LEN || item.includes('\u0000')) continue
    out.push(item)
    if (out.length >= CUSTOM_ARGV_MAX) break
  }
  return out
}

// A boolean is the aggregate/legacy form: true/false flips every kind at once.
function normalizeNotify(raw, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : NOTIFY_DEFAULT
  const next = { countdown: base.countdown !== false, fired: base.fired !== false, blocked: base.blocked !== false, recovered: base.recovered !== false }
  if (typeof raw === 'boolean') {
    for (const kind of NOTIFY_KINDS) next[kind] = raw
    return next
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const kind of NOTIFY_KINDS) {
      if (typeof raw[kind] === 'boolean') next[kind] = raw[kind]
    }
  }
  return next
}

// Returns the first offending kind ('blocked'), '*' when `raw` is not an
// object/boolean at all, or an empty string when the value is acceptable.
function badNotifyKind(raw) {
  if (typeof raw === 'boolean') return ''
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '*'
  for (const kind of NOTIFY_KINDS) {
    if (raw[kind] !== undefined && typeof raw[kind] !== 'boolean') return kind
  }
  return ''
}

function emptyProfile(id, label) {
  return {
    id,
    label,
    // `labelAuto` marks the built-in name for a slot, so it can be re-rendered
    // in whatever language is active; a slot the user renamed keeps its exact
    // text and sets this to false.
    labelAuto: true,
    countdownSec: 60,
    marginSec: 5,
    onlyOnSuccess: true,
    blockOnJobs: true,
    afkAutoAnswer: true,
    notify: Object.assign({}, NOTIFY_DEFAULT),
    retrySec: 30,
    retryPolicies: null,
    retryAssign: null,
    // What actually runs at the deadline. These three are behaviour, not a gate,
    // so the default profile may change them too (see PROFILE_LOCKED_FIELDS).
    action: 'shutdown',
    customArgv: [],
    // Halted (quota / credentials) normally waits for a human. `true` means "shut
    // down anyway": the failure is recorded, but the machine does not stay on.
    shutdownOnHalt: true,
  }
}

function profileList(lang) {
  // Only the default profile is real at first. Custom slots are created when the
  // user asks for one (`createProfile`), which is why the settings page no longer
  // opens with eight empty entries.
  return [emptyProfile(DEFAULT_PROFILE_ID, t(lang, 'profile.default'))]
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
  def.onlyOnSuccess = true
  def.blockOnJobs = true
  def.afkAutoAnswer = true
}

/**
 * Answer text used when an armed plugin replies to an agent question on the
 * user's behalf. Kept in one place so the settings copy can quote it.
 */
const afkReply = (lang) => t(lang, 'afk.reply')

/**
 * Sent to a root agent whose turn failed while armed with AFK auto-answer on:
 * find out what broke, fix it, keep going on the original plan.
 */
const afkRecoverText = (lang) => t(lang, 'afk.recover')

/** Sent when the same agent failed again: stop retrying and write it down. */
/** Sent when a provider-side outage has passed and the batch should resume. */
const afkRetryText = (lang) => t(lang, 'afk.retry')
const afkFinalText = (lang) => t(lang, 'afk.final')

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
/** Look up the localized reason for a halted code; unknown codes get a generic one. */
function haltedReason(lang, code) {
  const key = 'halted.' + code
  return HALTED_CODES.has(code) ? t(lang, key) : t(lang, 'halted.unknown', { code })
}
// Retryable on the provider's side: worth waiting for, not worth asking a human.
// Each code names a retry *policy*, because within this group the right rhythm
// differs: a rate limit punishes retries (back off), while a dropped connection
// or a 5xx clears in seconds (poll at a fixed short interval).
const WAITING_CODES = new Set(['RATE_LIMIT', 'SERVER', 'TRANSPORT', 'EMPTY_RESPONSE', 'TIMEOUT', 'IMAGE_OFFLOAD_REQUIRED'])
function waitingReason(lang, code) {
  return WAITING_CODES.has(code) ? t(lang, 'waiting.' + code) : t(lang, 'waiting.unknown', { code })
}

/**
 * What a scheduled shutdown actually runs, per platform.
 *
 * `timing` decides who holds the delay, and that is what makes "cancel" honest:
 *   - 'defer'  the OS holds the timer (`shutdown /t N` on win32), and `cancel`
 *              is a real undo (`shutdown /a`). Only win32 shutdown/restart fit.
 *   - 'inline' nothing is sent until the deadline; cancelling during the
 *              countdown means no command ever left this process, so it may be
 *              reported as cancelled. After the deadline it is irreversible.
 *
 * `argv: null` = the action has no honest command on that platform; callers must
 * refuse to arm instead of firing nothing (capability reporting lands with the
 * `actions` block in /state; until then the skip is logged).
 *
 * NOTE: only the win32 rows have been exercised on a real machine. The darwin and
 * linux rows follow their documented CLIs and are UNVERIFIED here — see
 * `_ops/worklog/2026-11-06-actions-design.md` §1.3 and §5.
 */
const ACTIONS = {
  shutdown: {
    win32: { timing: 'defer', argv: (sec) => ['shutdown', '/s', '/t', String(sec)], cancel: ['shutdown', '/a'] },
    darwin: { timing: 'inline', argv: () => ['osascript', '-e', 'tell application "System Events" to shut down'], cancel: null },
    linux: { timing: 'inline', argv: () => ['systemctl', 'poweroff'], cancel: null },
  },
  restart: {
    win32: { timing: 'defer', argv: (sec) => ['shutdown', '/r', '/t', String(sec)], cancel: ['shutdown', '/a'] },
    darwin: { timing: 'inline', argv: () => ['osascript', '-e', 'tell application "System Events" to restart'], cancel: null },
    linux: { timing: 'inline', argv: () => ['systemctl', 'reboot'], cancel: null },
  },
  hibernate: {
    win32: { timing: 'inline', argv: () => ['shutdown', '/h'], cancel: null },
    // macOS has no user-level hibernate command; sleeping is the honest fallback.
    darwin: { timing: 'inline', argv: () => ['pmset', 'sleepnow'], cancel: null, degrade: 'sleep' },
    linux: { timing: 'inline', argv: () => ['systemctl', 'hibernate'], cancel: null },
  },
  sleep: {
    win32: { timing: 'inline', argv: () => ['rundll32', 'powrprof.dll,SetSuspendState', '0,1,0'], cancel: null },
    darwin: { timing: 'inline', argv: () => ['pmset', 'sleepnow'], cancel: null },
    linux: { timing: 'inline', argv: () => ['systemctl', 'suspend'], cancel: null },
  },
  lock: {
    win32: { timing: 'inline', argv: () => ['rundll32', 'user32.dll,LockWorkStation'], cancel: null },
    // No supported CLI: displaysleepnow only blanks the display, and the ⌃⌘Q
    // keystroke needs Accessibility permission. Refuse rather than half-lock.
    darwin: { timing: 'inline', argv: null, cancel: null, reason: 'unsupported-on-platform' },
    linux: { timing: 'inline', argv: () => ['loginctl', 'lock-session'], cancel: null },
  },
  signout: {
    win32: { timing: 'inline', argv: () => ['shutdown', '/l'], cancel: null },
    darwin: { timing: 'inline', argv: () => ['osascript', '-e', 'tell application "System Events" to log out'], cancel: null },
    linux: { timing: 'inline', argv: () => ['loginctl', 'terminate-user', process.env.USER || process.env.LOGNAME || ''], cancel: null },
  },
  // DSH cannot restart itself: `app.relaunch()` lives in the Electron main
  // process and the plugin has no path to it. process.exit() is deliberately not
  // an option (it skips host cleanup and can corrupt live sessions).
  'restart-dsh': {
    win32: { timing: 'inline', argv: null, cancel: null, reason: 'no-host-restart' },
    darwin: { timing: 'inline', argv: null, cancel: null, reason: 'no-host-restart' },
    linux: { timing: 'inline', argv: null, cancel: null, reason: 'no-host-restart' },
  },
}

// `custom` is not a table row (it carries the user's argv), but it is a real id:
// it must appear in /state.actions and be accepted by `profile.action`.
const ACTION_IDS = Object.keys(ACTIONS).concat(['custom'])

/** Narrow a stored action id to something the table knows; unknown falls back. */
function normalizeActionId(raw) {
  return ACTION_IDS.includes(raw) ? raw : 'shutdown'
}

/**
 * The row for this platform. Unknown actions fall back to shutdown so a corrupt
 * config can never leave the guard armed with no action behind it.
 */
function actionSpecFor(action, cfg) {
  if (action === 'custom') {
    // A user-supplied argv, always inline: there is nothing to cancel once sent.
    const argv = cfg && Array.isArray(cfg.customArgv) ? cfg.customArgv.filter((s) => typeof s === 'string' && s.length > 0) : []
    if (argv.length === 0) return null
    return { timing: 'inline', argv: () => argv.slice(), cancel: null }
  }
  const spec = ACTIONS[normalizeActionId(action)][process.platform]
  return spec || null
}
// Short, machine-readable probe reasons. /state carries these codes, not prose:
// the settings page maps them to copy, so a new failure mode never needs a new
// i18n key here (and the host keeps sending only protocol strings).
const ACTION_REASON = {
  noCli: 'no-cli',
  noSession: 'no-session',
  needsElevation: 'needs-elevation',
  unsupported: 'unsupported-on-platform',
  noHostRestart: 'no-host-restart',
  noCustom: 'no-custom-command',
}

/** True for an absolute/relative path, which needs no PATH lookup. */
function looksLikePath(value) {
  return typeof value === 'string' && value.length > 0
    && (value.includes('/') || value.includes('\\') || /^[A-Za-z]:/.test(value))
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

// Event params may hold a *reference* instead of a finished sentence, so a line
// recorded under one language can be re-rendered in another. A reference is
// `{ key, params }` (`{ k, p }` is accepted too) and may also be an array of
// parts, which are rendered in order and concatenated — that is how a nested
// sentence keeps its wrapper and its retry suffix without freezing either.
// Resolution is bounded: at most NESTED_REF_MAX_DEPTH levels of references, and
// a reference that reaches itself is dropped instead of looping.
const NESTED_REF_MAX_DEPTH = 2

function eventRefKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  if (typeof value.key === 'string') return value.key
  if (typeof value.k === 'string') return value.k
  return ''
}

/** Render one param value: reference, array of parts, or a plain value. */
function renderEventValue(lang, value, depth, stack) {
  if (Array.isArray(value)) return value.map((part) => renderEventValue(lang, part, depth, stack)).join('')
  const key = eventRefKey(value)
  if (!key) return value
  if (depth > NESTED_REF_MAX_DEPTH || stack.indexOf(key) !== -1) return key
  const raw = value.params !== undefined ? value.params : value.p
  const inner = resolveEventParams(lang, raw, depth + 1, stack.concat(key))
  return t(lang, key, inner)
}

/** Render every param of an event in `lang`, expanding nested references. */
function resolveEventParams(lang, params, depth, stack) {
  const level = typeof depth === 'number' ? depth : 1
  const seen = stack || []
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params
  const out = {}
  for (const name of Object.keys(params)) {
    out[name] = renderEventValue(lang, params[name], level, seen)
  }
  return out
}

/**
 * Record one event. `key`/`params` are kept alongside the rendered text so the
 * client can re-render the history after the language changes; the file on disk
 * gets whatever language was active when the line was written. Nested
 * references are kept raw in the entry, so a later render still expands them.
 */
function log(lang, key, params, kind) {
  const at = Date.now()
  const text = t(lang, key, resolveEventParams(lang, params, 1, [key]))
  const entry = { at, kind: kind || 'info', key, params: params || null, text }
  events.push(entry)
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX)
  console.log(`[${name}] ${text}`)
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(LOG_PATH, `[${new Date(at).toISOString()}] ${entry.kind} ${text}\n`)
  } catch {
    /* logging must never break the plugin */
  }
}

/**
 * Snapshot of the ring buffer newer than `since`, rendered in `lang`.
 *
 * Argument order matters: `lang` first, `since` second. Events that predate the
 * key/params storage (persisted lines, or anything pushed without a key) keep
 * their recorded text instead of re-rendering.
 */
function recentEvents(lang, since) {
  const from = Number(since) || 0
  return events
    .filter((e) => e.at > from)
    .map((e) => ({
      at: e.at,
      kind: e.kind,
      key: e.key,
      params: e.params,
      text: e.key ? t(lang, e.key, resolveEventParams(lang, e.params, 1, [e.key])) : e.text,
    }))
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
    afkAutoAnswer: src.afkAutoAnswer !== false,
    notify: normalizeNotify(src.notify, fallback.notify),
    retrySec: clampInt(src.retrySec, 10, 600, 30),
    retryPolicies: normalizePolicies(src.retryPolicies),
    retryAssign: normalizeAssign(src.retryAssign),
    action: normalizeActionId(src.action),
    customArgv: normalizeCustomArgv(src.customArgv, fallback.customArgv),
    shutdownOnHalt: src.shutdownOnHalt !== false,
  }
}

// A custom slot nobody has ever touched: the auto label plus every behaviour
// field at its shipped default. Older builds pre-created eight of these; loading
// such a store drops them so the settings page does not open with empty entries.
const PRISTINE_PROFILE = normalizeProfile(emptyProfile('p', 'p'), emptyProfile('p', 'p'))

function isPristineProfile(profile) {
  if (!profile || profile.labelAuto !== true) return false
  for (const key of ['countdownSec', 'marginSec', 'onlyOnSuccess', 'blockOnJobs', 'afkAutoAnswer', 'retrySec', 'action', 'shutdownOnHalt']) {
    if (profile[key] !== PRISTINE_PROFILE[key]) return false
  }
  if (JSON.stringify(profile.customArgv) !== JSON.stringify(PRISTINE_PROFILE.customArgv)) return false
  for (const kind of NOTIFY_KINDS) {
    if (!profile.notify || profile.notify[kind] !== PRISTINE_PROFILE.notify[kind]) return false
  }
  return JSON.stringify(profile.retryPolicies) === JSON.stringify(PRISTINE_PROFILE.retryPolicies)
    && JSON.stringify(profile.retryAssign) === JSON.stringify(PRISTINE_PROFILE.retryAssign)
}

/** The shipped defaults, or the bundle patch when one is provided. */
function baselineConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  return normalizeProfile(cfg, emptyProfile('x', 'x'))
}

/** 'auto' or one of LANGS; anything else falls back to following the system. */
function normalizeLanguage(value) {
  if (value === 'auto') return 'auto'
  if (typeof value === 'string' && LANGS.includes(value.toLowerCase())) return value.toLowerCase()
  return 'auto'
}

/** The first problem with a proposed custom command, or '' when it is usable. */
function badCustomArgv(raw) {
  if (!Array.isArray(raw)) return 'customArgv must be an array'
  if (raw.length > CUSTOM_ARGV_MAX) return `customArgv must have at most ${CUSTOM_ARGV_MAX} entries`
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) return 'customArgv entries must be non-empty strings'
    if (item.length > CUSTOM_ARGV_LEN) return `customArgv entries must be at most ${CUSTOM_ARGV_LEN} characters`
    if (item.includes('\u0000')) return 'customArgv entries must not contain NUL'
  }
  return ''
}

/**
 * A halted block that must survive a restart, as stored in config.json:
 * `{code, level:'halted', reasonKey, at}`. Anything else reads back as null —
 * an unknown code would render an empty reason, which is worse than forgetting.
 */
function normalizeParked(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const code = typeof raw.code === 'string' && HALTED_CODES.has(raw.code) ? raw.code : ''
  if (!code) return null
  const reasonKey = 'halted.' + code
  const at = typeof raw.at === 'number' && raw.at > 0 ? Math.floor(raw.at) : Date.now()
  return { code, level: 'halted', reasonKey, at }
}

/**
 * 「熔断后关机」的有效值。母开关 = onlyOnSuccess（有会话报错就跳过这一轮）。
 * 母关 → 子强制关；母开 → 尊重用户存的值。存储值永不被改写，所以母开关来回切
 * 不会丢用户选择。
 */
function effectiveShutdownOnHalt(profile) {
  const src = profile && typeof profile === 'object' ? profile : {}
  if (src.onlyOnSuccess === false) return false
  return src.shutdownOnHalt !== false
}

function loadStore(baseline, initialLang, preferredLanguage, seedNotify) {
  const store = {
    activeProfileId: DEFAULT_PROFILE_ID,
    customEnabled: false,
    language: normalizeLanguage(preferredLanguage),
    // Remembered so turning custom profiles off and then on again lands back on
    // the profile the user was actually using, instead of dropping to default.
    lastCustomProfileId: null,
    // A halted block (quota, missing credentials…) that outlived the process.
    // Only halted is persisted: a `waiting` block heals on its own timer, and
    // storing it would turn "retry in 20s" into "wait forever after a restart".
    parked: null,
    profiles: profileList(initialLang),
  }
  // A profile written before 1.5.3 has no notify/afk fields of its own. Seeding
  // the slots with the values inherited from the old global/UI store keeps the
  // user's choice through the upgrade instead of silently resetting it.
  if (seedNotify) {
    for (const slot of store.profiles) slot.notify = normalizeNotify(seedNotify, NOTIFY_DEFAULT)
  }
  store.profiles[0] = Object.assign({}, store.profiles[0], baseline)
  // The shipped baseline carries notify:true for every kind, so the seeded
  // legacy value has to win over it here — a stored profile overrides both.
  if (seedNotify) store.profiles[0].notify = normalizeNotify(seedNotify, NOTIFY_DEFAULT)
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    raw = null
  }
  const legacyAfk = raw && typeof raw === 'object' && typeof raw.afkAutoAnswer === 'boolean'
    ? raw.afkAutoAnswer
    : null
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.profiles)) {
      for (const item of raw.profiles) {
        if (!item || typeof item.id !== 'string') continue
        let slot = store.profiles.find((p) => p.id === item.id)
        if (!slot) {
          // An id the store does not ship yet: keep it rather than drop the
          // user's data, as long as it is a custom slot.
          if (item.id === DEFAULT_PROFILE_ID) continue
          const n = Number(String(item.id).replace(/^c/, '')) || store.profiles.length
          slot = emptyProfile(item.id, t(initialLang, 'profile.custom', { n }))
          store.profiles.push(slot)
        }
        if (typeof item.label === 'string' && item.label.trim().length > 0) {
          slot.label = item.label.trim().slice(0, 24)
          slot.labelAuto = item.labelAuto === true
        }
        // The 1.5.2 store kept AFK auto-answer once, for every profile.
        const source = legacyAfk !== null && item.afkAutoAnswer === undefined
          ? Object.assign({}, item, { afkAutoAnswer: legacyAfk })
          : item
        Object.assign(slot, normalizeProfile(source, slot))
      }
    }
    store.customEnabled = raw.customEnabled === true
    if (typeof raw.activeProfileId === 'string') {
      if (store.profiles.some((p) => p.id === raw.activeProfileId)) {
        store.activeProfileId = raw.activeProfileId
      } else if (store.customEnabled && raw.activeProfileId !== DEFAULT_PROFILE_ID) {
        // A store from before profiles carried their own fields, or one written by
        // hand: materialise the active custom slot instead of silently dropping
        // the user back to the default profile.
        const id = raw.activeProfileId
        const n = Number(String(id).replace(/^c/, '')) || store.profiles.length
        const slot = emptyProfile(id, t(initialLang, 'profile.custom', { n }))
        if (legacyAfk !== null) slot.afkAutoAnswer = legacyAfk
        store.profiles.push(slot)
        store.activeProfileId = id
      }
    }
    if (typeof raw.lastCustomProfileId === 'string'
      && raw.lastCustomProfileId !== DEFAULT_PROFILE_ID
      && store.profiles.some((p) => p.id === raw.lastCustomProfileId)) {
      store.lastCustomProfileId = raw.lastCustomProfileId
    }
    if (typeof raw.language === 'string' && (raw.language === 'auto' || LANGS.includes(raw.language))) {
      store.language = raw.language
    }
    // Schema 2 had no parked field; a v2 file simply reads back as null.
    store.parked = normalizeParked(raw.parked)
  }
  if (legacyAfk !== null && !Array.isArray(raw.profiles)) {
    for (const slot of store.profiles) slot.afkAutoAnswer = legacyAfk
  }
  // Drop the custom slots older builds pre-created but nobody ever configured.
  // A touched field or a renamed label keeps the profile; the active slot and the
  // remembered one are always kept.
  store.profiles = store.profiles.filter((p) => p.id === DEFAULT_PROFILE_ID
    || p.id === store.activeProfileId
    || p.id === store.lastCustomProfileId
    || !isPristineProfile(p))
  if (!store.customEnabled) {
    if (store.activeProfileId !== DEFAULT_PROFILE_ID) store.lastCustomProfileId = store.activeProfileId
    store.activeProfileId = DEFAULT_PROFILE_ID
  }
  lockDefaultProfile(store)
  return store
}

// `lang` is passed in explicitly: this helper sits outside `apply()`, where the
// active language lives. Without it the catch below would throw a
// ReferenceError and lose the write failure instead of reporting it.
function saveStore(store, lang) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      version: 3,
      activeProfileId: store.activeProfileId,
      customEnabled: store.customEnabled,
      lastCustomProfileId: store.lastCustomProfileId || null,
      language: store.language,
      // `parked` is the only piece of live state that belongs in the config file:
      // it must survive a restart so a halted batch stays halted.
      parked: store.parked || null,
      profiles: store.profiles,
    }, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    log(lang, 'log.configWriteFailed', { error: err && err.message ? err.message : err })
    return false
  }
}

function activeProfile(store) {
  return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0]
}

/**
 * Keep the id of the custom profile the user was on, so switching custom
 * profiles off and on again does not throw away the selection.
 */
function rememberCustomProfile(store) {
  if (store.activeProfileId && store.activeProfileId !== DEFAULT_PROFILE_ID) {
    store.lastCustomProfileId = store.activeProfileId
  }
}

/**
 * Come back to the remembered custom profile when custom profiles are turned
 * back on. A remembered id that no longer exists is cleared, so the caller sees
 * the honest "there is nothing to restore" state instead of a dangling pointer.
 */
function restoreLastCustomProfile(store) {
  const id = store.lastCustomProfileId
  if (!id) return
  if (store.profiles.some((p) => p.id === id)) {
    store.activeProfileId = id
    return
  }
  store.lastCustomProfileId = null
}

/** First free `cN` id, or '' when all slots are taken. */
function freeCustomProfileId(store) {
  const used = new Set(store.profiles.map((p) => p.id))
  for (let i = 1; i <= CUSTOM_SLOT_COUNT; i += 1) {
    const id = 'c' + i
    if (!used.has(id)) return id
  }
  return ''
}

// UI preferences (card variant, theme, card language) are held here, on the
// host side, instead of only in browser localStorage: the sidebar and the
// floating window can live in different browser storage partitions, and then a
// localStorage write in one of them is invisible to the other. The state
// machine is the only surface both sides are guaranteed to share.
const UI_PATH = path.join(DATA_DIR, 'ui.json')
const UI_VARIANTS = ['A', 'B', 'C']
const UI_THEMES = ['auto', 'dark', 'light', 'claude']
const UI_LANGS = ['auto', 'zh', 'en', 'ru']
// Host-held UI preferences for the two surfaces: which card body (variant),
// which theme, which language, and whether the floating window is compact. They
// live here because localStorage is per storage partition — the settings surface
// and the detached window do not necessarily share one.
//
// Notifications are *not* here: which transitions notify the user is behaviour,
// so it belongs to the profile (see NOTIFY_KINDS above).
const UI_DEFAULT = { variant: 'A', theme: 'auto', lang: 'auto', compact: true }

function loadUi() {
  const ui = Object.assign({}, UI_DEFAULT)
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(UI_PATH, 'utf8'))
  } catch {
    raw = null
  }
  if (raw && typeof raw === 'object') {
    if (UI_VARIANTS.includes(raw.variant)) ui.variant = raw.variant
    if (UI_THEMES.includes(raw.theme)) ui.theme = raw.theme
    if (UI_LANGS.includes(raw.lang)) ui.lang = raw.lang
    if (typeof raw.compact === 'boolean') ui.compact = raw.compact
  }
  return ui
}

function saveUi(ui, lang) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(UI_PATH, JSON.stringify({
      version: 1,
      variant: ui.variant,
      theme: ui.theme,
      lang: ui.lang,
      compact: ui.compact === true,
    }, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    // Same message as a failed config write: the caller only needs to know that
    // the preference did not reach the disk.
    log(lang, 'log.configWriteFailed', { error: err && err.message ? err.message : err })
    return false
  }
}

// One-release migration: 1.5.2 kept `notify` in ui.json. Read it once so the
// user's choice is not lost, then rewrite ui.json without it.
function takeLegacyUiNotify() {
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(UI_PATH, 'utf8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || raw.notify === undefined) return null
  const seeded = normalizeNotify(raw.notify, NOTIFY_DEFAULT)
  try {
    delete raw.notify
    fs.writeFileSync(UI_PATH, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  } catch {
    /* the UI store is best-effort: a failed rewrite leaves the old field behind */
  }
  return seeded
}

/**
 * Standalone page served at `GET .../window` — the floating window half.
 *
 * Why a page and not a React route: the sidebar card lives inside the host's
 * renderer bundle, but a detached window is a plain browser document. The host
 * Electron `setWindowOpenHandler` allows 127.0.0.1/localhost, so the card can
 * simply `window.open(BASE + '/window')` and get a real second window.
 *
 * The page is deliberately self-contained: inline CSS, inline JS, no network
 * beyond same-origin `/state`, no third-party code. Its own chrome strings live
 * in a small three-language table below (same choice client.js makes) so the
 * host catalog does not gain keys for a page the host never renders. Anything
 * agent-generated — blocked reason, skip reason, event lines — is *not*
 * translated here: the host already sends those rendered in the active
 * language, and the page prints them as text.
 *
 * Inside the page sits a copy of the sidebar card (header dot + title + tag,
 * the A/B/C body, one action button, hazard tape). It deliberately mirrors
 * lib/client.js instead of inventing a second vocabulary: `viewOf()` uses the
 * same precedence as the card, the dot colours come from the same variables,
 * the three bodies are copied from `bodyHtml()`, the theme tokens from the
 * `.dsp-card[data-lum="light"]` / `.dsp-claude` rules, and the button sends the
 * same arm/disarm/cancel requests. The floating window is for watching on a
 * second screen, so the card stays 1:1 and the extra stats line is the only
 * thing the sidebar does not have.
 *
 * MIRROR CONTRACT — this page is a *copy* of the card, not a reference to it:
 * whenever lib/client.js changes a variant body, a theme token, a state colour
 * or a card string, the same change must land here, and the comparison
 * screenshots under `_ops/worklog/` must be regenerated. The card settings
 * (variant / theme / lang) are held by the host and arrive in every `/state`
 * snapshot as `ui`, so the 1s poll repaints this page when they change; the
 * same localStorage keys are read once as a first-paint fallback because the
 * sidebar and this window can sit in different storage partitions. `folded` is
 * ignored on purpose — a floating window is always expanded.
 *
 * Counters belong to that contract as well: B's run dots (one per live agent, cap
 * DOT_CAP = 12, `+N` badge, `role="img"` + `radar.aria`) and C's agent counter
 * must stay same-source with lib/client.js's `syncDots()` / `unit.agent`. Both
 * read `agentRunningTotal` (falling back to `runningCount`), never `runningCount`
 * alone — otherwise a Team of subagents shows three dots in the sidebar and one
 * here, which is the contradiction a user notices first.
 *
 * It must survive three ugly situations, so the markup carries readable
 * fallbacks and the poller never throws:
 *   1. host not mounted yet / no state yet  -> placeholders, not a blank page
 *   2. /state returns 5xx or the fetch fails -> keep last snapshot, show offline
 *   3. language switched elsewhere          -> follow `state.lang`, refetch events
 */
function windowHtml(lang) {
  const active = LANGS.includes(lang) ? lang : 'en'
  return `<!doctype html>
<html lang="${active}" data-lum="dark" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>dsh-shutdown-guard</title>
<style>
:root{color-scheme:dark;--pg-bg-a:#1a2030;--pg-bg-b:#0d1017;--pg-bg-c:#080a0f;--pg-fg:#e7eaf2;--pg-muted:#8b93a7;--pg-line:rgba(255,255,255,.07);--pg-panel:rgba(255,255,255,.02);--pg-time:#6f7789;--pg-text:#dbe0ec}
html[data-lum="light"]{color-scheme:light;--pg-bg-a:#e9eff8;--pg-bg-b:#f5f8fc;--pg-bg-c:#ffffff;--pg-fg:#1b2030;--pg-muted:#5b6472;--pg-line:rgba(0,0,0,.09);--pg-panel:rgba(0,0,0,.02);--pg-time:#7b8494;--pg-text:#243044}
html[data-theme="claude"]{color-scheme:dark;--pg-bg-a:#2b2621;--pg-bg-b:#1b1815;--pg-bg-c:#14110f;--pg-fg:#f5f1ea;--pg-muted:#b3a99c;--pg-line:rgba(255,255,255,.09);--pg-panel:rgba(255,255,255,.03);--pg-time:#9c9184;--pg-text:#efe8dd}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:radial-gradient(120% 120% at 20% 0%,var(--pg-bg-a) 0%,var(--pg-bg-b) 55%,var(--pg-bg-c) 100%);color:var(--pg-fg);font:14px/1.5 "Segoe UI","Microsoft YaHei","PingFang SC",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:22px 22px 30px;min-height:100vh;display:flex;flex-direction:column;gap:16px}
.bar{display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;flex:none;background:#a7abb4}
.dot.s-armed,.dot.s-hold{background:#f0a83a;box-shadow:0 0 0 4px rgba(240,168,58,.16),0 0 12px rgba(240,168,58,.5)}
.dot.s-fire,.dot.s-fired{background:#ef5350;animation:dsp-pulse-red .9s infinite}
.dot.s-blocked{background:var(--blocked, #7e8aa3);box-shadow:0 0 0 3px var(--blocked-soft, rgba(126,138,163,.28))}
.dot.s-blocked[data-retry="1"]{background:var(--blocked-retry, #6f8f7a);animation:dsp-wait 1.6s ease-in-out infinite}
.brand{font-size:13px;letter-spacing:.04em;color:var(--pg-muted);flex:1}
.pill{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--pg-panel);border:1px solid var(--pg-line);color:var(--pg-text);white-space:nowrap}
/* ---- card: same variables, same state machine, same three variants as
   lib/client.js. Anything changed there must be changed here too. ---- */
.dsp-card{--dsp-bg:#1c1e22;--dsp-fg:#f3f4f6;--dsp-muted:#a7abb4;--dsp-line:rgba(255,255,255,.14);--dsp-accent:#f0a83a;--dsp-danger:#ef5350;--dsp-track:rgba(255,255,255,.16);--dsp-blocked:#7e8aa3;--dsp-blocked-soft:rgba(126,138,163,.16);--dsp-tape-a:color-mix(in oklch, var(--dsp-accent) 76%, #ffffff);--dsp-tape-b:color-mix(in oklch, var(--dsp-accent) 68%, #000000);
position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:420px;margin:0 auto;min-height:178px;padding:10px 12px 0;border-radius:12px;overflow:hidden;
border:1px solid var(--dsp-line);background:var(--dsp-bg);color:var(--dsp-fg);font-family:var(--dsw-font-family,system-ui,sans-serif);transition:--dsp-tape-a 280ms ease,--dsp-tape-b 280ms ease}
.dsp-card.dsp-claude{--dsp-bg:#1f1d1a;--dsp-fg:#f5f1ea;--dsp-muted:#b3a99c;--dsp-line:rgba(255,255,255,.12);--dsp-accent:#d97757;--dsp-danger:#e5674f}
.dsp-card[data-lum="light"]{--dsp-bg:#ffffff;--dsp-fg:#1b2030;--dsp-muted:#5b6472;--dsp-line:rgba(0,0,0,.15);--dsp-accent:#e08f13;--dsp-danger:#d92d20;--dsp-track:rgba(0,0,0,.13)}
/* Hazard tape, mirror of lib/client.js: both stripes come from the accent hue,
   so no palette can ever pair red-on-red or blue-on-red. The one exception is
   our own default palette (amber), where the classic yellow/red pair is the
   thing users recognise: it comes back whenever the card is actually armed or
   finished. Both rules live here and nowhere else. */
@supports (color: oklch(from #ffffff calc(l + 0.05) 0.1 30)){
.dsp-card{--dsp-tape-a:oklch(from var(--dsp-accent) min(calc(l + 0.08), 0.80) min(c, 0.09) h);--dsp-tape-b:oklch(from var(--dsp-accent) calc(l - 0.12) min(c, 0.09) h)}
}
.dsp-card:not(.dsp-claude):not([data-state="off"]):not([data-state="blocked"]){--dsp-tape-a:#f2b13c;--dsp-tape-b:#e8453c}
@property --dsp-tape-a{syntax:"<color>";inherits:true;initial-value:#f2b13c}
@property --dsp-tape-b{syntax:"<color>";inherits:true;initial-value:#e8453c}
@media (prefers-reduced-motion: reduce){.dsp-card{transition:none}}
.dsp-card[data-state="off"]{background:color-mix(in srgb, var(--dsp-fg) 2.5%, var(--dsp-bg))}
.dsp-card[data-state="fire"]{border-color:var(--dsp-danger)}
.dsp-card[data-state="blocked"]{--dsp-blocked:#7e8aa3;--dsp-blocked-soft:rgba(126,138,163,.16)}
.dsp-card[data-lum="light"][data-state="blocked"]{--dsp-blocked:#5a6b8c;--dsp-blocked-soft:rgba(90,107,140,.12)}
.dsp-card[data-state="blocked"][data-retry="1"]{--dsp-blocked:#6f8f7a;--dsp-blocked-soft:rgba(111,143,122,.16)}
.dsp-card[data-lum="light"][data-state="blocked"][data-retry="1"]{--dsp-blocked:#4a7059;--dsp-blocked-soft:rgba(74,112,89,.12)}
.dsp-chead{display:flex;align-items:center;gap:7px;height:22px;line-height:22px;flex:0 0 auto}
.dsp-live{width:6px;height:6px;border-radius:50%;flex:0 0 6px;align-self:center;background:var(--dsp-muted)}
.dsp-card[data-state="armed"] .dsp-live,.dsp-card[data-state="hold"] .dsp-live{background:var(--dsp-accent);box-shadow:0 0 8px var(--dsp-accent)}
.dsp-card[data-state="fire"] .dsp-live,.dsp-card[data-state="fired"] .dsp-live{background:var(--dsp-danger);animation:dsp-pulse-red .9s infinite}
.dsp-card[data-state="blocked"] .dsp-live{background:var(--dsp-blocked);box-shadow:0 0 0 3px var(--dsp-blocked-soft);animation:none}
.dsp-card[data-state="blocked"][data-retry="1"] .dsp-live{animation:dsp-wait 1.6s ease-in-out infinite}
.dsp-ctitle{flex:1 1 auto;min-width:0;font-size:12.5px;line-height:22px;color:var(--dsp-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-tag{flex:0 0 auto;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:9px;letter-spacing:.08em;padding:1px 5px;border-radius:5px;border:1px solid color-mix(in srgb, var(--dsp-muted) 40%, transparent);color:var(--dsp-muted)}
.dsp-card[data-state="armed"] .dsp-tag,.dsp-card[data-state="hold"] .dsp-tag{color:var(--dsp-accent);border-color:color-mix(in srgb, var(--dsp-accent) 50%, transparent)}
.dsp-card[data-state="fire"] .dsp-tag,.dsp-card[data-state="fired"] .dsp-tag{color:var(--dsp-danger);border-color:color-mix(in srgb, var(--dsp-danger) 50%, transparent)}
.dsp-card[data-state="blocked"] .dsp-tag{color:var(--dsp-blocked);border-color:var(--dsp-blocked-soft);background:var(--dsp-blocked-soft)}
#cardBody{display:flex;flex:1 1 auto;min-height:0;flex-direction:column}
.dsp-cbody{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;padding:10px 0 4px}
.dsp-v-a{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0}
.dsp-big{font-family:ui-monospace,"Cascadia Mono",Consolas,"Microsoft YaHei",monospace;font-size:26px;line-height:1.15;font-weight:650;letter-spacing:-.2px}
.dsp-card[data-state="fire"] .dsp-big{color:var(--dsp-danger)}
.dsp-meta{margin-top:5px;font-size:11.5px;line-height:16px;color:var(--dsp-muted);min-height:15px;white-space:pre-line;overflow-wrap:anywhere}
.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsp-accent)}
.dsp-card[data-state="blocked"] .dsp-big,.dsp-card[data-state="blocked"] .dsp-meta{color:var(--dsp-blocked)}
.dsp-cbtns{display:flex;align-items:center;gap:6px;padding:8px 0 10px;flex:0 0 auto}
.dsp-btn{flex:1 1 auto;min-width:0;height:30px;border-radius:8px;border:1px solid var(--dsp-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.dsp-btn:hover{background:color-mix(in srgb, var(--dsp-fg) 7%, transparent)}
.dsp-btn-primary{border-color:transparent;background:var(--dsp-accent);color:#1a1200;font-weight:600}
.dsp-btn-danger{border-color:color-mix(in srgb, var(--dsp-danger) 45%, transparent);color:var(--dsp-danger);background:color-mix(in srgb, var(--dsp-danger) 6%, transparent)}
.dsp-card[data-state="blocked"] .dsp-btn{border-color:color-mix(in srgb,var(--dsp-blocked) 55%,transparent);background:var(--dsp-blocked-soft)}
.dsp-btn:disabled{opacity:.55;cursor:progress}
.dsp-hazard{position:relative;height:10px;margin:0 -14px;overflow:hidden;flex:0 0 auto}
.dsp-hazard::before{content:"";position:absolute;top:0;bottom:0;left:-48px;right:-48px;background:repeating-linear-gradient(45deg,var(--dsp-tape-a) 0 10px,var(--dsp-tape-b) 10px 20px);opacity:.55;animation:dsp-slide 1.15s linear infinite}
.dsp-card[data-state="hold"] .dsp-hazard::before{animation-duration:2.6s;opacity:.9}
.dsp-card[data-state="fire"] .dsp-hazard::before{animation-duration:.42s}
.dsp-card[data-state="off"] .dsp-hazard::before,.dsp-card[data-state="fired"] .dsp-hazard::before,.dsp-card[data-state="blocked"] .dsp-hazard::before{animation-play-state:paused}
.dsp-card[data-state="off"] .dsp-hazard{opacity:.55}
.dsp-card[data-state="fired"] .dsp-hazard{opacity:.45}
.dsp-card[data-state="blocked"] .dsp-hazard{opacity:.28;filter:grayscale(1)}
/* variant B: radar scope */
.dsp-v-b{display:block;height:100%;padding:6px 0 0}
.dsp-disc{position:relative;height:100%;min-height:96px;border-radius:10px;border:1px solid var(--dsp-line);overflow:hidden;
background:radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--dsp-accent) 9%, transparent), transparent 66%), color-mix(in srgb, var(--dsp-bg) 94%, var(--dsp-fg))}
.dsp-sweep{position:absolute;left:50%;top:50%;width:320px;height:320px;margin:-160px 0 0 -160px;border-radius:50%;
background:conic-gradient(from 0deg,transparent 0deg,transparent 10deg,color-mix(in srgb, var(--dsp-accent) 8%, transparent) 22deg,color-mix(in srgb, var(--dsp-accent) 20%, transparent) 38deg,color-mix(in srgb, var(--dsp-accent) 34%, transparent) 54deg,color-mix(in srgb, var(--dsp-accent) 12%, transparent) 66deg,color-mix(in srgb, var(--dsp-accent) 4%, transparent) 72deg,transparent 78deg,transparent 360deg);
animation:dsp-spin 3.2s linear infinite;
-webkit-mask-image:radial-gradient(circle, #000 0 44%, transparent 74%);mask-image:radial-gradient(circle, #000 0 44%, transparent 74%)}
.dsp-card[data-state="hold"] .dsp-sweep{animation-duration:5.6s;opacity:.62}
.dsp-card[data-state="fire"] .dsp-sweep{animation-duration:1s}
.dsp-rings{position:absolute;inset:0}
.dsp-radar-svg{position:absolute;left:50%;top:50%;width:238px;height:202px;margin:-101px 0 0 -119px;pointer-events:none}
.dsp-dots{position:absolute;inset:0}
.dsp-ping{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--dsp-accent);z-index:2;box-shadow:0 0 12px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}
.dsp-card[data-state="fire"] .dsp-ping{background:var(--dsp-danger);box-shadow:0 0 12px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}
.dsp-rdot{position:absolute;width:5px;height:5px;border-radius:50%;transform:translate(-50%,-50%);z-index:2}
.dsp-rdot-run{background:var(--dsp-muted);box-shadow:0 0 6px color-mix(in srgb, var(--dsp-muted) 80%, transparent)}
.dsp-rdot-job{background:var(--dsp-accent);box-shadow:0 0 8px color-mix(in srgb, var(--dsp-accent) 95%, transparent)}
.dsp-rplus{position:absolute;right:8px;top:7px;z-index:3;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9px;line-height:14px;letter-spacing:.08em;padding:0 4px;border-radius:7px;color:var(--dsp-fg);background:color-mix(in srgb, var(--dsp-accent) 20%, transparent);border:1px solid color-mix(in srgb, var(--dsp-accent) 42%, transparent)}
.dsp-card[data-state="hold"] .dsp-rdot{animation:dsp-dotpulse 2.4s ease-in-out infinite}
.dsp-card[data-state="fire"] .dsp-rdot{opacity:.3}
.dsp-card[data-state="fired"] .dsp-rdot{opacity:.18}
.dsp-disc::after{content:"";position:absolute;left:0;right:0;bottom:0;height:42px;z-index:1;pointer-events:none;background:linear-gradient(0deg, color-mix(in srgb, var(--dsp-bg) 92%, transparent) 12%, transparent)}
.dsp-hud{position:absolute;left:9px;right:9px;bottom:7px;z-index:3;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;row-gap:1px;
font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--dsp-muted);text-shadow:0 1px 8px rgba(0,0,0,.5);white-space:nowrap;line-height:1.45}
.dsp-hud::before{content:"";width:4px;height:4px;border-radius:50%;background:var(--dsp-accent);flex:none;align-self:center;box-shadow:0 0 7px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}
.dsp-hud b{font-size:11px;letter-spacing:.1em;color:var(--dsp-fg);font-weight:600}
.dsp-card[data-state="fire"] .dsp-hud b{font-size:12px;color:color-mix(in srgb, var(--dsp-danger) 55%, #fff)}
.dsp-card[data-state="fire"] .dsp-hud::before{background:var(--dsp-danger);box-shadow:0 0 7px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}
.dsp-card[data-state="off"] .dsp-hud::before,.dsp-card[data-state="fired"] .dsp-hud::before{background:var(--dsp-muted);box-shadow:none}
.dsp-card[data-state="blocked"] .dsp-rings{opacity:.30;filter:grayscale(1)}
.dsp-card[data-state="blocked"] .dsp-sweep,.dsp-card[data-state="blocked"] .dsp-ping{display:none}
.dsp-card[data-state="blocked"] .dsp-rdot{opacity:.22}
.dsp-card[data-state="blocked"] .dsp-hud b{color:var(--dsp-blocked)}
.dsp-card[data-state="blocked"] .dsp-hud::before{background:var(--dsp-blocked);box-shadow:none}
/* variant C: terminal */
.dsp-v-c{display:flex;flex-direction:column;height:100%;padding:6px 0 0}
.dsp-screen{flex:1;min-height:0;border-radius:6px;padding:6px 8px;background:#0b0d10;border:1px solid rgba(255,255,255,.08);font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:9.5px;line-height:1.5;color:#9ef0a8;overflow:hidden}
.dsp-term-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9f7d2}
.dsp-pr{color:#5d8f6b;margin-right:4px}
.dsp-caret{display:inline-block;width:5px;height:9px;margin-left:2px;background:#9ef0a8;animation:dsp-blink 1s steps(1) infinite;vertical-align:-1px}
.dsp-card[data-state="fire"] .dsp-screen{background:#2a0d0d;border-color:rgba(255,77,79,.4);color:#ffb3b0}
.dsp-card[data-state="fire"] .dsp-term-line{color:#ffd0cc}
.dsp-card[data-state="fire"] .dsp-caret{background:#ff4d4f}
.dsp-led{display:flex;gap:4px;margin-top:6px;flex:0 0 auto}
.dsp-led-seg{flex:1 1 0;height:4px;border-radius:2px;background:var(--dsp-track)}
.dsp-led-seg.on{background:var(--dsp-accent)}
.dsp-card[data-state="fire"] .dsp-led-seg.on{background:var(--dsp-danger)}
.dsp-code{margin-top:5px;font-size:9px;line-height:12px;color:var(--dsp-muted);flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-card[data-state="blocked"] .dsp-screen{background:color-mix(in srgb,var(--dsp-blocked) 10%,#0b0d10);border-color:color-mix(in srgb,var(--dsp-blocked) 40%,transparent);color:#c3cbdc}
.dsp-card[data-state="blocked"] .dsp-pr{color:var(--dsp-blocked)}
.dsp-card[data-state="blocked"] .dsp-led-seg.on{background:var(--dsp-blocked)}
.dsp-card[data-state="blocked"] .dsp-code{color:var(--dsp-blocked)}
@keyframes dsp-slide{to{transform:translateX(28.28px)}}
@keyframes dsp-spin{to{transform:rotate(360deg)}}
@keyframes dsp-blink{50%{opacity:0}}
@keyframes dsp-dotpulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes dsp-pulse-red{0%{box-shadow:0 0 0 0 rgba(239,83,80,.7)}70%{box-shadow:0 0 0 6px rgba(239,83,80,0)}100%{box-shadow:0 0 0 0 rgba(239,83,80,0)}}
@keyframes dsp-wait{0%,100%{opacity:.45;box-shadow:0 0 0 2px var(--dsp-blocked-soft)}50%{opacity:1;box-shadow:0 0 0 5px transparent}}
.stats{font-size:11.5px;color:var(--pg-muted);text-align:center;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.err{padding:10px 12px;border-radius:10px;border:1px solid rgba(239,83,80,.4);background:rgba(239,83,80,.1);color:#e5484d;font-size:12.5px;overflow-wrap:anywhere}
.events{border-radius:14px;border:1px solid var(--pg-line);background:var(--pg-panel);overflow:hidden}
.events-head{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;font-size:11px;letter-spacing:.04em;color:var(--pg-muted);border-bottom:1px solid var(--pg-line)}
.live{color:#2f9e64;white-space:nowrap}
.live.offline{color:#d92d20}
#eventList{list-style:none;margin:0;padding:4px 0;max-height:38vh;overflow:auto}
#eventList li{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:6px 14px;font-size:12.5px;border-bottom:1px solid var(--pg-line)}
#eventList li:last-child{border-bottom:0}
#eventList li time{color:var(--pg-time);font-variant-numeric:tabular-nums}
#eventList li span{color:var(--pg-text);overflow-wrap:anywhere}
#eventList li.afk span{color:#2f7fd0}
#eventList li.config span{color:#7a5cd0}
.empty{padding:14px;font-size:12.5px;color:var(--pg-time)}
footer{margin-top:auto;padding-top:14px;border-top:1px solid var(--pg-line);font-size:12px;color:var(--pg-time);overflow-wrap:anywhere}
/* compact mode: the window is the card and nothing else — the brand bar, the
   stats line, the event list and the footer step aside, the page background goes
   transparent and the card floats. There is no switch here on purpose: compact is
   a host-held setting owned by the sidebar's settings row. */
html.compact,html.compact body{background:transparent}
html.compact .bar,html.compact .stats,html.compact .events,html.compact #note{display:none}
html.compact .wrap{max-width:none;min-height:100vh;padding:28px;justify-content:center;align-items:center;gap:14px}
[hidden]{display:none!important}
</style>
</head>
<body>
<div class="wrap">
  <div class="bar">
    <span class="dot s-off" id="dot" aria-hidden="true"></span>
    <span class="brand">dsh-shutdown-guard</span>
    <span class="pill" id="pill" aria-live="polite">connecting</span>
  </div>
  <section class="dsp-card" id="card" data-state="off" data-retry="0" data-variant="A" data-lum="dark">
    <div class="dsp-chead">
      <i class="dsp-live" aria-hidden="true"></i>
      <span class="dsp-ctitle" id="cardTitle"></span>
      <span class="dsp-tag" id="cardTag">OFF</span>
    </div>
    <div id="cardBody"></div>
    <div class="dsp-cbtns"><button type="button" class="dsp-btn dsp-btn-primary" id="cardBtn"></button></div>
    <div class="dsp-hazard" aria-hidden="true"></div>
  </section>
  <div class="stats" id="stats"></div>
  <div class="err" id="err" role="alert" hidden></div>
  <div class="events">
    <div class="events-head"><span id="eventsTitle">events</span><span class="live" id="live">live</span></div>
    <ul id="eventList"></ul>
    <div class="empty" id="empty" hidden>no events yet</div>
  </div>
  <footer id="note"></footer>
</div>
<script>window.__LANG__ = '${active}';</script>
<script>
(function () {
  'use strict'
  var BASE = '/api/dsh-shutdown-guard'
  var MSG = {
    zh: {
      title: '关机守夜 · 悬浮窗口',
      connecting: '连接中',
      live: '实时',
      offline: '连接中断，重试中',
      cardTitle: '任务完成后关机',
      viewOff: '未开启',
      viewArmed: '待命',
      viewHold: '等待中',
      viewFire: '倒计时中',
      viewFired: '已触发',
      viewBlocked: '已暂停',
      tagOff: 'OFF',
      tagArmed: 'ARMED',
      tagHold: 'WAIT',
      tagFire: 'FIRE',
      tagFired: 'DONE',
      tagBlocked: 'PAUSED',
      bigOff: '未开启',
      bigArmed: '待命',
      bigHold: '等待后台任务',
      bigFired: '已关机',
      bigRetry: '等待恢复',
      bigPaused: '已暂停',
      metaFire: '系统关机指令已下发',
      metaFired: '指令已生效，无法取消',
      metaArmed: '所有任务已结束 · 等待下一次触发',
      metaOff: '仅在点击「武装」后才会运行程序',
      metaHold: '{parts}，完成后关机',
      metaJobs: '{n} 个后台任务',
      metaSessions: '{n} 个会话',
      metaBlockedRetry: '将在 {sec} 秒后自动重试',
      btnArm: '武装',
      btnCancel: '取消关机',
      btnDisarm: '解除',
      hudHold: 'Holding',
      hudFired: 'Fired',
      hudOff: 'Offline',
      hudRetrying: 'Retrying',
      hudPaused: 'Paused',
      hudStandby: 'Standby',
      hudRetry: '第 {n} 次重试',
      hudManual: '需人工处理',
      unitJobs: 'jobs {n}',
      unitAgent: 'agent {n}',
      radarAria: '{total} 个 agent，其中 {running} 个在运行',
      termFire: 'T-minus {t}',
      termHold: 'holding',
      termOff: 'offline',
      termRetry: 'retrying',
      termHalted: 'halted',
      termDone: 'done',
      termWait: 'waiting',
      codeWaiting: 'waiting · 自动重试',
      codeHalted: 'halted · 需人工处理',
      codeGates: '条件 {n}/6 已满足',
      actionFailed: '操作失败：{error}',
      statsAgents: '会话',
      statsJobs: '后台任务',
      statsErrors: '出错会话',
      events: '最近事件',
      note: '关闭本窗口不影响守夜；连开启/关闭等操作请回到侧边栏的守夜卡片。'
    },
    en: {
      title: 'Shutdown guard · floating window',
      connecting: 'connecting',
      live: 'live',
      offline: 'disconnected, retrying',
      cardTitle: 'Auto shutdown',
      viewOff: 'off',
      viewArmed: 'armed',
      viewHold: 'holding',
      viewFire: 'counting down',
      viewFired: 'fired',
      viewBlocked: 'paused',
      tagOff: 'OFF',
      tagArmed: 'ARMED',
      tagHold: 'WAIT',
      tagFire: 'FIRE',
      tagFired: 'DONE',
      tagBlocked: 'PAUSED',
      bigOff: 'Off',
      bigArmed: 'Armed',
      bigHold: 'Waiting for background jobs',
      bigFired: 'Shutting down',
      bigRetry: 'Waiting to recover',
      bigPaused: 'Paused',
      metaFire: 'Shutdown command sent',
      metaFired: 'Command is live — no way back',
      metaArmed: 'Everything settled · waiting for the next batch',
      metaOff: 'Nothing runs until you click “Arm”',
      metaHold: '{parts}, shutdown after they finish',
      metaJobs: '{n} background jobs',
      metaSessions: '{n} sessions',
      metaBlockedRetry: 'retrying automatically in {sec}s',
      btnArm: 'Arm',
      btnCancel: 'Cancel shutdown',
      btnDisarm: 'Disarm',
      hudHold: 'Holding',
      hudFired: 'Fired',
      hudOff: 'Offline',
      hudRetrying: 'Retrying',
      hudPaused: 'Paused',
      hudStandby: 'Standby',
      hudRetry: 'retry {n}',
      hudManual: 'needs a human',
      unitJobs: '{n} jobs',
      unitAgent: '{n} agents',
      radarAria: '{total} agents, {running} running',
      termFire: 'T-minus {t}',
      termHold: 'holding',
      termOff: 'offline',
      termRetry: 'retrying',
      termHalted: 'halted',
      termDone: 'done',
      termWait: 'waiting',
      codeWaiting: 'waiting · auto-retry',
      codeHalted: 'halted · needs a human',
      codeGates: '{n}/6 conditions met',
      actionFailed: 'Action failed: {error}',
      statsAgents: 'agents',
      statsJobs: 'jobs',
      statsErrors: 'failed agents',
      events: 'recent events',
      note: 'Closing this window leaves the guard running; arm/disarm from the sidebar card.'
    },
    ru: {
      title: 'Сторож выключения · отдельное окно',
      connecting: 'подключение',
      live: 'онлайн',
      offline: 'нет связи, повтор',
      cardTitle: 'Автовыключение',
      viewOff: 'выключено',
      viewArmed: 'взведено',
      viewHold: 'ожидание',
      viewFire: 'идёт отсчёт',
      viewFired: 'сработало',
      viewBlocked: 'пауза',
      tagOff: 'ВЫКЛ',
      tagArmed: 'ВЗВЕД',
      tagHold: 'ОЖИД',
      tagFire: 'СТАРТ',
      tagFired: 'ГОТОВО',
      tagBlocked: 'ПАУЗА',
      bigOff: 'Выключено',
      bigArmed: 'Взведено',
      bigHold: 'Ждём фоновые задачи',
      bigFired: 'Выключение',
      bigRetry: 'Ждём восстановления',
      bigPaused: 'Приостановлено',
      metaFire: 'Команда на выключение отправлена',
      metaFired: 'Команда уже действует — отменить нельзя',
      metaArmed: 'Всё завершено · ждём следующую партию',
      metaOff: 'Ничего не запустится, пока вы не нажмёте «Взвести»',
      metaHold: '{parts}, выключение после них',
      metaJobs: 'фоновых задач: {n}',
      metaSessions: 'сессий: {n}',
      metaBlockedRetry: 'автоповтор через {sec} с',
      btnArm: 'Взвести',
      btnCancel: 'Отменить выключение',
      btnDisarm: 'Снять',
      hudHold: 'Ожидание',
      hudFired: 'Выполнено',
      hudOff: 'Офлайн',
      hudRetrying: 'Повтор',
      hudPaused: 'Пауза',
      hudStandby: 'Готов',
      hudRetry: 'попытка {n}',
      hudManual: 'нужен человек',
      unitJobs: '{n} задач',
      unitAgent: '{n} агентов',
      radarAria: '{total} агентов, {running} работают',
      termFire: 'Т-{t}',
      termHold: 'ожидание',
      termOff: 'офлайн',
      termRetry: 'повтор',
      termHalted: 'остановлено',
      termDone: 'готово',
      termWait: 'ожидание',
      codeWaiting: 'waiting · автоповтор',
      codeHalted: 'halted · нужен человек',
      codeGates: 'условий выполнено: {n}/6',
      actionFailed: 'Не удалось выполнить: {error}',
      statsAgents: 'агенты',
      statsJobs: 'задачи',
      statsErrors: 'сбои',
      events: 'последние события',
      note: 'Закрытие окна не отключает сторож; взвод и снятие — на карточке в боковой панели.'
    }
  }
  var VARIANTS = { A: 1, B: 1, C: 1 }
  var THEMES = { auto: 1, dark: 1, light: 1, claude: 1 }
  var LANGKEYS = { zh: 1, en: 1, ru: 1 }
  var KEY_VAR = 'dsh-shutdown-guard.variant'
  var KEY_THEME = 'dsh-shutdown-guard.theme'
  var KEY_LANG = 'dsh-shutdown-guard.lang'
  var KEY_COMPACT = 'dsh-shutdown-guard.compact'
  var hostLang = window.__LANG__ && MSG[window.__LANG__] ? window.__LANG__ : 'en'
  var settings = { variant: 'A', theme: 'auto', lang: 'auto', compact: true }
  var lang = hostLang
  var snap = null
  var view = 'off'
  var offset = 0
  var lastEventAt = 0
  var seen = []
  var fails = 0
  var busy = false
  var timer = null
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null

  function m (key, params) {
    var table = MSG[lang] || MSG.en
    var text = table[key]
    if (text === undefined) text = MSG.en[key]
    if (text === undefined) text = key
    if (params) {
      for (var name in params) text = text.split('{' + name + '}').join(String(params[name]))
    }
    return text
  }
  function el (id) { return document.getElementById(id) }
  function q (sel) { return el('cardBody').querySelector(sel) }
  function cap (s) { return s.charAt(0).toUpperCase() + s.slice(1) }
  function fmt2 (n) { return n > 99 ? '99+' : String(n) }

  // ---- settings: the host holds them (GET /state -> ui) because this window and
  // the sidebar can live in different browser storage partitions, where a
  // localStorage write in one is invisible in the other. The same keys are still
  // read once as a first-paint fallback so the page does not flash the defaults
  // while the first /state request is in flight; from then on the host wins. ----
  var hostUi = null
  function readSetting (key) {
    try { return window.localStorage.getItem(key) } catch (e) { return null }
  }
  function loadSettings () {
    var fromHost = hostUi || {}
    var v = fromHost.variant !== undefined ? fromHost.variant : readSetting(KEY_VAR)
    settings.variant = VARIANTS[v] ? v : 'A'
    var t = fromHost.theme !== undefined ? fromHost.theme : readSetting(KEY_THEME)
    settings.theme = THEMES[t] ? t : 'auto'
    var l = fromHost.lang !== undefined ? fromHost.lang : readSetting(KEY_LANG)
    settings.lang = l === 'auto' || LANGKEYS[l] ? l : 'auto'
    var c = fromHost.compact !== undefined ? (fromHost.compact === true) : readSetting(KEY_COMPACT) === '1'
    settings.compact = c === true
  }
  // Adopt the host snapshot. Returns true only when one of the values actually
  // moved, so the 1s poll repaints on change and stays quiet otherwise.
  function adoptUi (ui) {
    if (!ui || typeof ui !== 'object') return false
    if (ui.variant === undefined && ui.theme === undefined && ui.lang === undefined && ui.compact === undefined) return false
    var changed = !hostUi ||
      hostUi.variant !== ui.variant ||
      hostUi.theme !== ui.theme ||
      hostUi.lang !== ui.lang ||
      hostUi.compact !== (ui.compact === true)
    hostUi = { variant: ui.variant, theme: ui.theme, lang: ui.lang, compact: ui.compact === true }
    return changed
  }
  // Compact mode: keep the card, drop everything around it, and let the page
  // background go transparent so the window reads as a floating card. The
  // sidebar's folded flag is a different thing and is ignored here on purpose.
  // There is no toggle in this page: compact is owned by the settings row.
  function applyCompact () {
    document.documentElement.classList.toggle('compact', settings.compact === true)
  }
  // A pinned card language wins over the host language, exactly like the card:
  // the card can be pinned while the host keeps 'auto'.
  function effectiveLang () {
    if (settings.lang !== 'auto' && MSG[settings.lang]) return settings.lang
    return MSG[hostLang] ? hostLang : 'en'
  }
  function lum () {
    if (settings.theme === 'light') return 'light'
    if (settings.theme === 'auto') return mq && mq.matches ? 'light' : 'dark'
    return 'dark'
  }
  function applyTheme () {
    var L = lum()
    var root = document.documentElement
    root.setAttribute('data-lum', L)
    root.setAttribute('data-theme', settings.theme)
    var card = el('card')
    card.setAttribute('data-lum', L)
    card.classList.toggle('dsp-claude', settings.theme === 'claude')
    var retry = view === 'blocked' && snap && snap.retryAt > 0
    var css = getComputedStyle(card)
    document.body.style.setProperty('--blocked', css.getPropertyValue('--dsp-blocked').trim() || '#7e8aa3')
    document.body.style.setProperty('--blocked-soft', css.getPropertyValue('--dsp-blocked-soft').trim() || 'rgba(126,138,163,.28)')
    document.body.style.setProperty('--blocked-retry', retry ? (css.getPropertyValue('--dsp-blocked').trim() || '#6f8f7a') : (css.getPropertyValue('--dsp-blocked').trim() || '#7e8aa3'))
  }

  // ---- card body: three variants, copied from lib/client.js bodyHtml() ----
  function ringsHtml () {
    var out = '<svg class="dsp-radar-svg" viewBox="0 0 238 202" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
    for (var k = 0; k < 9; k += 1) {
      var op = Math.max(0.14, 0.42 - k * 0.032).toFixed(2)
      out += '<circle cx="119" cy="101" r="' + (23 + k * 12) + '" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="' + op + '"></circle>'
    }
    return out + '</svg>'
  }
  function variantHtml (variant) {
    if (variant === 'B') {
      return '<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">' +
        '<div class="dsp-sweep"></div><div class="dsp-rings">' + ringsHtml() + '</div>' +
        '<div class="dsp-ping"></div><div class="dsp-dots"></div>' +
        '<div class="dsp-hud"><b></b><span></span></div></div></div>'
    }
    if (variant === 'C') {
      var segs = ''
      for (var i = 0; i < 6; i += 1) segs += '<i class="dsp-led-seg" data-i="' + i + '"></i>'
      return '<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2"></span></div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3"></span><i class="dsp-caret"></i></div>' +
        '</div><div class="dsp-led">' + segs + '</div><div class="dsp-code"></div></div>'
    }
    return '<div class="dsp-cbody dsp-v-a"><div class="dsp-big"></div><div class="dsp-meta"></div></div>'
  }
  function applyVariant () {
    var card = el('card')
    card.setAttribute('data-variant', settings.variant)
    el('cardBody').innerHTML = variantHtml(settings.variant)
    paintCard()
  }

  // Same precedence as lib/client.js viewOf(): blocked outranks everything,
  // because a parked guard never disarms itself; "off" is distinguishable from
  // "hold" (armed but still waiting on sessions or jobs).
  function viewOf (s) {
    if (!s) return 'off'
    if (s.blocked) return 'blocked'
    if (!s.armed) return 'off'
    if (s.state === 'fired') return 'fired'
    if (s.state === 'countdown') return 'fire'
    if (Number(s.jobsRunning) > 0 || Number(s.runningCount) > 0) return 'hold'
    return 'armed'
  }

  function remainingSec () {
    if (!snap || snap.state !== 'countdown' || !snap.deadline) return 0
    return Math.max(0, Math.ceil((snap.deadline - (Date.now() + offset)) / 1000))
  }
  function mmss (sec) {
    var mnt = Math.floor(sec / 60)
    var secs = Math.max(0, sec % 60)
    return (mnt < 10 ? '0' : '') + mnt + ':' + (secs < 10 ? '0' : '') + secs
  }
  function retrySec () {
    if (!snap || !snap.retryAt) return 0
    return Math.max(0, Math.ceil((snap.retryAt - (Date.now() + offset)) / 1000))
  }

  function bigText () {
    if (view === 'blocked') return snap.retryAt > 0 ? m('bigRetry') : m('bigPaused')
    if (view === 'fire') return mmss(remainingSec())
    if (view === 'fired') return m('bigFired')
    if (view === 'hold') return m('bigHold')
    if (view === 'armed') return m('bigArmed')
    return m('bigOff')
  }

  function metaText () {
    if (!snap) return ''
    if (view === 'blocked') {
      var text = String(snap.blocked || '')
      if (snap.retryAt) text = text + '\\n' + m('metaBlockedRetry', { sec: retrySec() })
      return text
    }
    if (view === 'fire') return m('metaFire')
    if (view === 'fired') return m('metaFired')
    if (view === 'hold') {
      var parts = []
      if (Number(snap.jobsRunning) > 0) parts.push(m('metaJobs', { n: fmt2(snap.jobsRunning) }))
      // The card counts every live agent here (agentTotal), not just roots.
      if (agentTotal() > 0) parts.push(m('metaSessions', { n: fmt2(agentTotal()) }))
      return m('metaHold', { parts: parts.join(' · ') })
    }
    if (view === 'armed') return m('metaArmed')
    return m('metaOff')
  }

  // The radar dots have no live source: client.js scatters them randomly and
  // keeps them until the counts change. Here the placement is deterministic
  // (golden-angle spiral) so a re-render never makes them jump.
  function dotHtml (count, kind) {
    var out = ''
    for (var i = 0; i < Math.min(count, 40); i += 1) {
      var a = (i * 137.5) * Math.PI / 180
      var r = 16 + (i % 5) * 11
      var x = Math.cos(a) * r
      var y = Math.sin(a) * r * 0.84
      out += '<i class="dsp-rdot dsp-rdot-' + kind + '" style="left:calc(50% + ' + x.toFixed(1) + 'px);top:calc(50% + ' + y.toFixed(1) + 'px)"></i>'
    }
    return out
  }

  function hudKey () {
    if (view === 'hold') return 'hudHold'
    if (view === 'fired') return 'hudFired'
    if (view === 'off') return 'hudOff'
    if (view === 'blocked') return snap && snap.retryAt > 0 ? 'hudRetrying' : 'hudPaused'
    return 'hudStandby'
  }

  // Run dots get one entry per *live* agent, not per root session: a Team lead is
  // one root, but its children are the activity the radar is meant to show. Same
  // source as the card's syncDots(), with the same fallback for hosts that do not
  // report the wider counters yet.
  var DOT_CAP = 12

  function agentRunning () {
    if (!snap) return 0
    var n = snap.agentRunningTotal !== undefined ? snap.agentRunningTotal : snap.runningCount
    return Math.max(0, Number(n) || 0)
  }

  function agentTotal () {
    if (!snap) return 0
    var total = snap.agentTotal !== undefined ? snap.agentTotal : snap.rootsCount
    return Math.max(agentRunning(), Number(total) || 0)
  }

  // variant B: HUD + scatter plot
  function paintRadar () {
    var hud = q('.dsp-hud')
    if (hud) {
      var b = hud.querySelector('b')
      var s = hud.querySelector('span')
      if (b) b.textContent = view === 'fire' ? mmss(remainingSec()) : m(hudKey())
      if (s) {
        s.textContent = view === 'blocked'
          ? (snap && snap.retryAt > 0 ? m('hudRetry', { n: snap.retryAttempt }) : m('hudManual'))
          : m('unitJobs', { n: fmt2(snap ? snap.jobsRunning : 0) }) + ' · ' + m('unitAgent', { n: fmt2(agentRunning()) })
      }
    }
    var dots = q('.dsp-dots')
    if (dots) {
      var running = agentRunning()
      var html = dotHtml(Math.min(running, DOT_CAP), 'run') + dotHtml(snap ? Number(snap.jobsRunning) || 0 : 0, 'job')
      // Never truncate silently: the badge counts the agents past the cap, so a
      // team of 20 cannot look like 12 (same markup and class as the card).
      if (running > DOT_CAP) {
        html += '<span class="dsp-rplus" aria-hidden="true">+' + fmt2(running - DOT_CAP) + '</span>'
      }
      if (dots.innerHTML !== html) dots.innerHTML = html
      dots.setAttribute('role', 'img')
      var label = m('radarAria', { total: fmt2(agentTotal()), running: fmt2(running) })
      if (dots.getAttribute('aria-label') !== label) dots.setAttribute('aria-label', label)
    }
  }

  // variant C: terminal + LED segments + code line
  function paintTerminal () {
    var l2 = q('.dsp-l2')
    if (l2) l2.textContent = m('unitJobs', { n: fmt2(snap ? snap.jobsRunning : 0) }) + ' · ' + m('unitAgent', { n: fmt2(agentRunning()) })
    var l3 = q('.dsp-l3')
    if (l3) {
      var key = view === 'hold' ? 'termHold'
        : view === 'off' ? 'termOff'
          : view === 'blocked' ? (snap && snap.retryAt > 0 ? 'termRetry' : 'termHalted')
            : view === 'fired' ? 'termDone' : 'termWait'
      l3.textContent = view === 'fire' ? m('termFire', { t: mmss(remainingSec()) }) : m(key)
    }
    var led = [view !== 'off', true, !snap || Number(snap.runningCount) === 0, !snap || Number(snap.jobsRunning) === 0, !snap || Number(snap.erroredCount) === 0, view === 'fire']
    var segs = el('cardBody').querySelectorAll('.dsp-led-seg')
    for (var i = 0; i < segs.length; i += 1) segs[i].classList.toggle('on', !!led[i])
    var code = q('.dsp-code')
    if (code) {
      code.textContent = view === 'blocked'
        ? (snap && snap.retryAt > 0 ? m('codeWaiting') : m('codeHalted'))
        : m('codeGates', { n: led.filter(Boolean).length })
    }
  }

  function paintCard () {
    var card = el('card')
    card.setAttribute('data-state', view)
    card.setAttribute('data-retry', view === 'blocked' && snap && snap.retryAt > 0 ? '1' : '0')
    el('cardTitle').textContent = m('cardTitle')
    el('cardTag').textContent = m('tag' + cap(view))
    if (settings.variant === 'B') paintRadar()
    else if (settings.variant === 'C') paintTerminal()
    else {
      var big = q('.dsp-big')
      var meta = q('.dsp-meta')
      if (big) big.textContent = bigText()
      if (meta) meta.textContent = metaText()
    }
    var btn = el('cardBtn')
    var isOff = view === 'off'
    var isFire = view === 'fire'
    btn.textContent = isOff ? m('btnArm') : isFire ? m('btnCancel') : m('btnDisarm')
    btn.className = 'dsp-btn ' + (isOff ? 'dsp-btn-primary' : 'dsp-btn-danger')
    btn.disabled = busy
  }

  function paintChrome () {
    el('pill').textContent = m('view' + cap(view))
    var dot = el('dot')
    dot.className = 'dot s-' + view
    dot.setAttribute('data-retry', view === 'blocked' && snap && snap.retryAt > 0 ? '1' : '0')
    var live = el('live')
    live.textContent = fails > 0 ? m('offline') : m('live')
    live.className = 'live' + (fails > 0 ? ' offline' : '')
    el('eventsTitle').textContent = m('events')
    el('note').textContent = m('note')
    document.title = m('title')
    if (snap) {
      // Same source as the card's "N sessions": live agents, children included.
      el('stats').textContent = m('statsAgents') + ' ' + String(agentRunning()) + '/' + String(agentTotal()) +
        ' · ' + m('statsJobs') + ' ' + String(snap.jobsRunning) + '/' + String(snap.jobsTotal) +
        ' · ' + m('statsErrors') + ' ' + String(snap.erroredCount)
    }
  }

  function showError (text) {
    var box = el('err')
    box.hidden = !text
    box.textContent = text || ''
  }

  function eventTime (at) {
    var locale = lang === 'zh' ? 'zh-CN' : lang === 'ru' ? 'ru-RU' : 'en-US'
    try { return new Date(at).toLocaleTimeString(locale, { hour12: false }) } catch (e) { return '' }
  }

  function renderEvents () {
    var list = el('eventList')
    el('empty').hidden = seen.length > 0
    list.textContent = ''
    for (var i = 0; i < seen.length; i += 1) {
      var item = seen[i]
      var li = document.createElement('li')
      if (item.kind === 'afk' || item.kind === 'config') li.className = item.kind
      var time = document.createElement('time')
      time.textContent = eventTime(item.at)
      var text = document.createElement('span')
      text.textContent = String(item.text === undefined ? '' : item.text)
      li.appendChild(time)
      li.appendChild(text)
      list.appendChild(li)
    }
  }

  function mergeEvents (incoming) {
    if (!incoming || !incoming.length) return
    var merged = incoming.concat(seen)
    merged.sort(function (a, b) { return Number(b.at) - Number(a.at) })
    var out = []
    var last = 0
    for (var i = 0; i < merged.length && out.length < 20; i += 1) {
      var item = merged[i]
      if (!item || !item.at || item.at === last) continue
      last = item.at
      out.push(item)
    }
    seen = out
    if (seen.length) lastEventAt = seen[0].at
  }

  function applyState (body) {
    if (!body || typeof body !== 'object') throw new Error('bad payload')
    fails = 0
    offset = (Number(body.serverTime) || Date.now()) - Date.now()
    snap = body
    if (body.lang && MSG[body.lang]) hostLang = body.lang
    // Host settings are adopted before the repaint below so effectiveLang() and
    // the paint helpers already see the new values; onSettingsChanged() owns the
    // language-change reset (drop events, refetch in the new language).
    if (adoptUi(body.ui)) onSettingsChanged()
    var next = effectiveLang()
    var reset = false
    if (next !== lang) {
      // Host output is rendered per language; drop the history and refetch it
      // so the list does not mix two languages.
      lang = next
      seen = []
      lastEventAt = 0
      reset = true
    }
    if (!reset) mergeEvents(body.events || [])
    view = viewOf(snap)
    paintChrome()
    paintCard()
    renderEvents()
  }

  function fetchState () {
    return fetch(BASE + '/state?since=' + lastEventAt, { cache: 'no-store' })
      .then(function (res) {
        // A 5xx must not freeze the page: treat it like any other failure and
        // keep the last snapshot on screen while retrying.
        if (!res.ok) throw new Error('http ' + res.status)
        return res.json()
      })
      .then(applyState)
  }

  function schedule (delay) {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(poll, delay)
  }

  function poll () {
    fetchState()
      .then(function () { schedule(1000) })
      .catch(function () {
        fails += 1
        paintChrome()
        schedule(Math.min(1000 * fails, 5000))
      })
  }

  function post (path, payload) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status)
      return res.json()
    }).then(function (body) {
      if (body && typeof body === 'object') applyState(body)
      return body
    })
  }

  // Mirrors lib/client.js act(): a blocked card clears the park and re-arms in
  // one click, everything else stays a single request.
  function actionPaths () {
    if (view === 'blocked') return ['/disarm', '/arm']
    if (view === 'off') return ['/arm']
    if (view === 'fire') return ['/cancel']
    return ['/disarm']
  }

  function act () {
    if (busy) return
    busy = true
    showError('')
    paintCard()
    var paths = actionPaths()
    var chain = Promise.resolve()
    for (var i = 0; i < paths.length; i += 1) {
      (function (path) { chain = chain.then(function () { return post(path) }) })(paths[i])
    }
    chain
      .then(function () { return fetchState() })
      .then(function () { return schedule(1000) })
      .catch(function (err) {
        showError(m('actionFailed', { error: err && err.message ? err.message : String(err) }))
      })
      .then(function () { busy = false; paintCard() })
  }

  // The sidebar writes the three settings keys from another window, so the
  // 'storage' event (not the poll) is what keeps this page in sync.
  function onSettingsChanged () {
    var prevLang = lang
    var prevVariant = settings.variant
    loadSettings()
    applyTheme()
    applyCompact()
    if (settings.variant !== prevVariant) applyVariant()
    lang = effectiveLang()
    if (lang !== prevLang) {
      seen = []
      lastEventAt = 0
      renderEvents()
      poll()
    }
    paintChrome()
    paintCard()
  }

  window.addEventListener('storage', function (e) {
    if (!e || !e.key) return
    if (e.key === KEY_VAR || e.key === KEY_THEME || e.key === KEY_LANG) onSettingsChanged()
  })
  if (mq) {
    var onLumChange = function () { if (settings.theme === 'auto') { applyTheme(); paintCard() } }
    if (mq.addEventListener) mq.addEventListener('change', onLumChange)
    else if (mq.addListener) mq.addListener(onLumChange)
  }

  loadSettings()
  lang = effectiveLang()
  applyTheme()
  applyCompact()
  el('cardBody').innerHTML = variantHtml(settings.variant)
  el('card').setAttribute('data-variant', settings.variant)
  el('cardBtn').addEventListener('click', act)
  paintChrome()
  paintCard()
  poll()
  // The countdown line inside the card ticks without refetching state.
  setInterval(function () {
    if (view !== 'fire') return
    if (settings.variant === 'B') {
      var b = q('.dsp-hud b')
      if (b) b.textContent = mmss(remainingSec())
    } else if (settings.variant === 'C') {
      var l3 = q('.dsp-l3')
      if (l3) l3.textContent = m('termFire', { t: mmss(remainingSec()) })
    } else {
      var big = q('.dsp-big')
      if (big) big.textContent = bigText()
    }
  }, 250)
})()
</script>
</body>
</html>`
}


export function apply(ctx, rawConfig) {
  if (process.platform !== 'win32') {
    log(resolveLang('auto'), 'log.platformUnsupported', { platform: process.platform })
    return
  }

  const baseline = baselineConfig(rawConfig)
  // A 1.5.2 install kept the four notification switches in ui.json; adopt them
  // into the profile store once, before the store is built.
  const legacyNotify = takeLegacyUiNotify()
  // The system-derived language is the only thing available before the stored
  // preference is read; loadStore seeds the slot names with it.
  const store = loadStore(baseline, resolveLang('auto'), rawConfig && rawConfig.language, legacyNotify)
  // The active language: 'auto' follows the OS locale. Everything the host
  // generates — log lines, skip reasons, blocked reasons — is rendered in it, so
  // the client never has to translate host output.
  let lang = resolveLang(store.language)
  // `cfg` stays a plain object so the rest of the state machine can read it
  // synchronously; it is refreshed from the active profile after every write.
  let cfg = normalizeProfile(activeProfile(store), baseline)
  // Shared UI preferences for the sidebar card and the floating window.
  const ui = loadUi()

  // ---------- action capability ----------
  // Probed once at mount (and on demand via `POST /config {recheck:true}`); no
  // polling. Each entry is `{available: true|false|'unknown', reason}`:
  //   true      the command resolves and the OS has no further say
  //   false     no honest command on this platform, or the command is missing
  //   'unknown' the command exists but macOS (TCC) or Linux (polkit) may still
  //             refuse it at the deadline — claiming `true` there would lie
  let actionAvailability = {}
  let actionProbe = null
  // The last command this process actually sent (diagnostics only, see spawnAction).
  let lastAction = null

  async function argvReachable(argv) {
    if (!Array.isArray(argv) || argv.length === 0) return { available: false, reason: ACTION_REASON.noCli }
    const head = argv[0]
    if (looksLikePath(head)) return { available: true, reason: null }
    let exe = ''
    try {
      exe = await subprocess.resolveExecutable(head)
    } catch {
      exe = ''
    }
    return typeof exe === 'string' && exe.length > 0
      ? { available: true, reason: null }
      : { available: false, reason: ACTION_REASON.noCli }
  }

  /** Rebuild the whole availability map once; safe to call repeatedly. */
  async function probeActions() {
    const next = {}
    for (const id of ACTION_IDS) {
      // `custom` has no table row: its command lives in the active profile, so an
      // empty argv is the honest "nothing to run" case, not "unsupported".
      if (id === 'custom') {
        const argv = cfg && Array.isArray(cfg.customArgv)
          ? cfg.customArgv.filter((s) => typeof s === 'string' && s.length > 0)
          : []
        next[id] = argv.length === 0 ? { available: false, reason: ACTION_REASON.noCustom } : await argvReachable(argv)
        continue
      }
      const spec = actionSpecFor(id, cfg)
      if (!spec || typeof spec.argv !== 'function') {
        next[id] = { available: false, reason: (spec && spec.reason) || ACTION_REASON.unsupported }
        continue
      }
      const base = await argvReachable(spec.argv(0))
      if (base.available !== true) {
        next[id] = base
        continue
      }
      // A resolvable command is not a promise. On win32 the row's argv is the
      // documented way to do it; elsewhere the OS holds a veto (consent dialogs,
      // polkit). Reporting 'unknown' keeps the UI honest and still lets arming
      // go ahead — the failure, if any, shows up in the event log.
      next[id] = process.platform === 'win32'
        ? { available: true, reason: null }
        : { available: 'unknown', reason: ACTION_REASON.needsElevation }
    }
    actionAvailability = next
    return next
  }

  /** Kick a probe and keep the promise so a recheck can await the same run. */
  function recheckActions() {
    actionProbe = probeActions().catch(() => actionAvailability)
    return actionProbe
  }

  /** The active action is armed only when the probe did not mark it unavailable. */
  function actionReadyNow() {
    const entry = actionAvailability[resolveAction()]
    if (!entry) return true
    return entry.available !== false
  }

  function syncCfg() {
    if (!store.customEnabled) {
      // Remember the custom profile we are leaving before the fallback, so that
      // turning custom profiles back on restores it.
      rememberCustomProfile(store)
      store.activeProfileId = DEFAULT_PROFILE_ID
    }
    lockDefaultProfile(store)
    cfg = normalizeProfile(activeProfile(store), baseline)
    return cfg
  }

  /**
   * Mirror the halted block into the store and flush it. This is the single
   * place that writes `parked`: every caller either sets or clears `blocked` and
   * then calls this, so the file can never disagree with the live state.
   * A `waiting` block is never persisted (its retry timer heals it).
   */
  function syncParked() {
    const next = blocked && blocked.level === 'halted'
      ? { code: blocked.code, level: 'halted', reasonKey: blocked.reasonKey, at: blocked.at || Date.now() }
      : null
    const before = store.parked || null
    if (JSON.stringify(next) === JSON.stringify(before)) return
    store.parked = next
    saveStore(store, lang)
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
    log(lang, 'log.servicesMissing')
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
  // A block read back from config.json starts here too: the original event is
  // already in events.log, so restoring it deliberately writes no new line
  // (otherwise every boot would append the same failure again).
  let blocked = store.parked
    ? { level: 'halted', code: store.parked.code, reasonKey: store.parked.reasonKey, reasonParams: null, attempt: 0, delaySec: 0, at: store.parked.at }
    : null
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
  // Holds the deadline timer of an 'inline' action (see ACTIONS): the command is
  // sent from here, so cancelling before it fires leaves nothing behind.
  let actionTimer = null

  // ---------- localization helpers ----------
  // These live outside the HTTP block: the state machine itself reports skip
  // reasons and stop signs, and every report has to be in the active language.

  /** Re-render the built-in profile names in the active language. */
  function localizeProfiles() {
    return store.profiles.map((p) => {
      if (p.labelAuto === false) return p
      const label = p.id === DEFAULT_PROFILE_ID
        ? t(lang, 'profile.default')
        : t(lang, 'profile.custom', { n: Number(String(p.id).replace(/^c/, '')) || 0 })
      return Object.assign({}, p, { label })
    })
  }

  /** Render the current stop sign in the active language. */
  function blockedText() {
    if (!blocked) return ''
    const reason = t(lang, blocked.reasonKey, blocked.reasonParams)
    if (blocked.level !== 'waiting') return t(lang, 'blocked.halted', { reason })
    return t(lang, 'blocked.waiting', { reason }) + t(lang, 'blocked.retrySuffix', {
      n: blocked.attempt,
      sec: blocked.delaySec,
    })
  }

  /**
   * The same stop sign as an event reference instead of a finished sentence.
   * A log line that stored `blockedText()` froze the reason in whatever language
   * was active at that moment; storing the reference lets every later render —
   * including the history after a language switch — translate the inner part too.
   */
  function blockedEventRef() {
    if (!blocked) return ''
    const reason = { key: blocked.reasonKey, params: blocked.reasonParams || null }
    if (blocked.level !== 'waiting') return { key: 'blocked.halted', params: { reason } }
    return [
      { key: 'blocked.waiting', params: { reason } },
      { key: 'blocked.retrySuffix', params: { n: blocked.attempt, sec: blocked.delaySec } },
    ]
  }

  /** Render the last skip; the client shows 'reason', tests read the key. */
  function lastSkipPayload() {
    if (!lastSkip) return null
    return {
      at: lastSkip.at,
      key: lastSkip.key,
      params: lastSkip.params || null,
      reason: lastSkip.key ? t(lang, lastSkip.key, lastSkip.params) : lastSkip.reason,
    }
  }

  function roots() {
    try { return agents.roots() || [] } catch { return [] }
  }

  /**
   * Every live agent: roots plus the child agents (teammates, subagents) that
   * own their own session. `roots()` alone hides those children, which is why a
   * Team lead can look idle while its teammates are still running.
   * Falls back to the roots when the service has no `list()`.
   */
  function liveAgents() {
    try {
      if (typeof agents.list === 'function') {
        const all = agents.list()
        if (Array.isArray(all)) return all
      }
    } catch { /* fall back to roots */ }
    return roots()
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
    return (job && job.id) || t(lang, 'job.fallbackLabel')
  }

  function onJobEvent(event) {
    const type = event && event.type
    const job = event && event.job
    if (!job || typeof job.id !== 'string') return
    if (type === 'registered' || type === 'stopping') {
      liveJobs.set(job.id, job)
      if (type === 'registered' && state === 'countdown') {
        log(lang, 'log.jobDuringCountdown', { label: jobLabel(job) })
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
  function scheduleRetry(agent, reasonKey, reasonParams, code) {
    const { policy, delaySec } = retryDelaySec(code)
    retryAttempt += 1
    retryAt = Date.now() + delaySec * 1000
    blocked = {
      level: 'waiting',
      code,
      reasonKey,
      reasonParams: reasonParams || null,
      attempt: retryAttempt,
      delaySec,
    }
    log(lang, 'log.retryScheduled', {
      code,
      policy,
      reason: blockedEventRef(),
    }, 'afk')
    if (retryTimer !== null) { try { retryTimer() } catch { /* ignore */ } retryTimer = null }
    retryTimer = ctx.setTimeout(() => {
      retryTimer = null
      // Clear the park, wake the agent, and let the next idle decide again.
      blocked = null
      retryAt = 0
      if (!armed) { retryAttempt = 0; return }
      const target = agent || roots()[0]
      if (target) nudgeAgent(target, afkRetryText(lang))
      else tryArm()
    }, delaySec * 1000)
    if (typeof retryTimer === 'function') disposers.push(retryTimer)
  }

  function attachJobs(service) {
    if (!service || !service.events || typeof service.events.subscribe !== 'function') {
      log(lang, 'log.jobsNoStream')
      return
    }
    if (offJobEvents !== null) return
    try {
      offJobEvents = service.events.subscribe({ owners: 'all' }, onJobEvent)
      if (typeof offJobEvents !== 'function') offJobEvents = true
      log(lang, 'log.jobsSubscribed')
    } catch (err) {
      log(lang, 'log.jobsSubscribeFailed', { error: err && err.message ? err.message : err })
    }
  }

  /** Decide whether an idle batch may arm the shutdown; skips leave a reason. */
  function tryArm() {
    if (blocked) {
      // Halted means "a human has to fix this" (quota, credentials). If this
      // profile says to shut down anyway, the halt must not park the machine
      // forever: keep it visible until here, then clear it as the countdown
      // starts so the next boot does not greet the user with a stale halt.
      if (blocked.level === 'halted' && effectiveShutdownOnHalt(cfg)) {
        blocked = null
        syncParked()
      } else {
        lastSkip = { at: Date.now(), key: blocked.reasonKey, params: blocked.reasonParams }
        return false
      }
    }
    if (!armed || state !== 'idle') return false
    if (rootsRunning() > 0) return false
    // The chosen action has no usable command on this machine. Refuse to arm and
    // say why through the skip line: silently lit but never firing is the one
    // failure mode a user cannot diagnose.
    if (!actionReadyNow()) {
      const entry = actionAvailability[resolveAction()] || {}
      lastSkip = {
        at: Date.now(),
        key: 'log.spawnFailed',
        params: { error: 'action unavailable: ' + resolveAction() + (entry.reason ? ' (' + entry.reason + ')' : '') },
      }
      return false
    }
    const pendingJobs = cfg.blockOnJobs ? jobsPending() : 0
    if (pendingJobs > 0) {
      lastSkip = { at: Date.now(), key: 'skip.jobs', params: { n: pendingJobs } }
      log(lang, lastSkip.key, lastSkip.params)
      return false
    }
    if (errored.size > 0 && (cfg.onlyOnSuccess || cfg.afkAutoAnswer !== false)) {
      lastSkip = {
        at: Date.now(),
        key: cfg.onlyOnSuccess ? 'skip.errorsSuccess' : 'skip.errorsAfk',
        params: { n: errored.size },
      }
      log(lang, lastSkip.key, lastSkip.params)
      return false
    }
    armShutdown()
    return true
  }

  /**
   * Run one argv. `resolveExecutable` only works on a bare command name, so it is
   * applied to argv[0] and skipped for absolute paths (a user-supplied custom
   * command may already carry one).
   */
  async function spawnArgv(argv, label, stamp) {
    if (!Array.isArray(argv) || argv.length === 0) return
    const note = (code, error) => {
      // Only the action that started this spawn may update its record; a cancel
      // (`/a`) that lands later must not rewrite the fire result.
      if (!stamp || !lastAction || lastAction.at !== stamp) return
      lastAction.code = code
      if (error) lastAction.error = error
    }
    let full = argv
    const head = argv[0]
    if (typeof head === 'string' && head.length > 0 && !head.includes('/') && !head.includes('\\')) {
      try {
        const exe = await subprocess.resolveExecutable(head)
        if (typeof exe === 'string' && exe.length > 0) full = [exe, ...argv.slice(1)]
      } catch {
        /* fall back to the bare command name (PATH / System32) */
      }
    }
    try {
      const handle = subprocess.spawn({
        argv: full,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
        graceMs: 15000,
      })
      if (handle && handle.done && typeof handle.done.then === 'function') {
        handle.done
          .then((outcome) => {
            log(lang, 'log.shutdownExit', { args: label, outcome: JSON.stringify(outcome) })
            const code = outcome && typeof outcome === 'object'
              ? (typeof outcome.code === 'number' ? outcome.code : (typeof outcome.exitCode === 'number' ? outcome.exitCode : null))
              : null
            note(code, '')
          })
          .catch((err) => {
            log(lang, 'log.shutdownSpawnFailed', { error: err && err.message ? err.message : err })
            note(null, err && err.message ? err.message : String(err))
          })
      }
    } catch (err) {
      log(lang, 'log.spawnFailed', { error: err && err.message ? err.message : err })
      note(null, err && err.message ? err.message : String(err))
    }
  }

  /** Send the configured action now, using this platform's row for it. */
  function spawnAction(action, sec) {
    const spec = actionSpecFor(action, cfg)
    const id = normalizeActionId(action)
    if (!spec || typeof spec.argv !== 'function') {
      // No honest command on this platform: say so in the event log instead of
      // pretending something happened. The UI learns about it from /state later
      // (capability reporting), which is why no arm is attempted here either.
      lastAction = { action: id, at: Date.now(), argv: null, code: null, error: 'action unavailable' }
      log(lang, 'log.spawnFailed', { error: 'action unavailable: ' + id })
      return
    }
    const argv = spec.argv(sec)
    const at = Date.now()
    // Diagnostics only: the card never draws this, but "what did it actually run
    // and what did the OS answer" is the first question after a bad shutdown.
    lastAction = { action: id, at, timing: spec.timing, argv, code: null }
    void spawnArgv(argv, id + ' ' + argv.join(' '), at)
  }

  /** The deferred timer only: inline actions were never handed to the OS. */
  function cancelAction() {
    const spec = actionSpecFor(resolveAction(), cfg)
    if (!spec || !Array.isArray(spec.cancel)) return
    void spawnArgv(spec.cancel, normalizeActionId(resolveAction()) + ' cancel')
  }

  function resolveAction() {
    return normalizeActionId(cfg && cfg.action)
  }

  function reset() {
    state = 'idle'
    deadline = 0
    if (actionTimer !== null) {
      try { actionTimer() } catch { /* ignore */ }
      actionTimer = null
    }
    if (firedTimer !== null) {
      try { firedTimer() } catch { /* ignore */ }
      firedTimer = null
    }
  }

  function armShutdown() {
    if (state !== 'idle') return
    state = 'countdown'
    deadline = Date.now() + cfg.countdownSec * 1000
    log(lang, 'log.countdownStart', { sec: cfg.countdownSec })
    const action = resolveAction()
    const spec = actionSpecFor(action, cfg)
    if (spec && spec.timing === 'defer') {
      // The OS holds the timer; `/t` already carries the margin, and `cancel`
      // can still take the whole thing back.
      spawnAction(action, cfg.countdownSec + cfg.marginSec)
    } else {
      // Nothing is sent yet, so a countdown cancel is a real cancel. `margin`
      // only pads a system-held timer; inline actions fire at the deadline.
      actionTimer = ctx.setTimeout(() => {
        actionTimer = null
        // A stale handle must never fire after a cancel reset the machine.
        if (state !== 'countdown') return
        spawnAction(action, 0)
      }, cfg.countdownSec * 1000)
      if (typeof actionTimer === 'function') disposers.push(actionTimer)
    }
    firedTimer = ctx.setTimeout(() => {
      state = 'fired'
      log(lang, 'log.fired')
    }, (cfg.countdownSec + cfg.marginSec + 5) * 1000)
  }

  /**
   * Cancel the pending action. `disarm` decides whether the mode keeps watching
   * for the next idle batch (a new task starting must keep it armed).
   *
   * Only a 'defer' action was ever handed to the OS, and only win32 carries a
   * real undo (`shutdown /a`). For an 'inline' action nothing left the process
   * before the deadline, so `cancelAction()` is a no-op by design.
   */
  function cancelShutdown(disarm) {
    const wasPending = state === 'countdown' || state === 'fired'
    if (wasPending) {
      cancelAction()
      reset()
    }
    if (disarm && armed) {
      armed = false
      errored = new Set()
    }
    if (wasPending) log(lang, disarm ? 'log.cancelledDisarmed' : 'log.cancelledArmed')
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
    syncParked()
    interrupted = false
    retryAttempt = 0
    retryAt = 0
    if (retryTimer !== null) { try { retryTimer() } catch { /* ignore */ } retryTimer = null }
    if (!value) cancelShutdown(true)
    log(lang, armed ? 'log.armedOn' : 'log.armedOff')
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
        log(lang, 'log.retryRecovered', null, 'afk')
        blocked = null
        syncParked()
        retryAttempt = 0
      }
      interrupted = false
      if (state === 'countdown') {
        log(lang, 'log.taskDuringCountdown')
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
      log(lang, 'log.afkWrapDone', { id })
    }
    if (!armed || state !== 'idle') return
    if (rootsRunning() > 0) return
    if (interrupted) {
      lastSkip = { at: Date.now(), key: 'skip.interrupted', params: null }
      log(lang, lastSkip.key, lastSkip.params, 'afk')
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
        log(lang, 'log.interruptDetected', { kind: t(lang, silentTurn ? 'log.interruptNoReply' : 'log.interruptWithCause'), blob: blob.slice(0, 100) }, 'afk')
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
      log(lang, 'log.afkFollowupFailed', { error: err && err.message ? err.message : err }, 'afk')
    }
    try {
      if (typeof agent.steer === 'function') {
        agent.steer(message)
        return true
      }
    } catch (err) {
      log(lang, 'log.afkSteerFailed', { error: err && err.message ? err.message : err }, 'afk')
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
      log(lang, 'log.sessionCancelled', { id }, 'afk')
      return
    }
    errored.add(id)
    log(lang, 'log.rootError', { id, codeSuffix: error && error.code ? ' (' + error.code + ')' : '' })
    if (HALTED_CODES.has(code)) {
      const reasonKey = HALTED_CODES.has(code) ? 'halted.' + code : 'halted.unknown'
      const reasonParams = HALTED_CODES.has(code) ? null : { code }
      if (!blocked || blocked.reasonKey !== reasonKey) {
        log(lang, 'log.blockedSelfHealFailed', { id, code, reason: { key: reasonKey, params: reasonParams } }, 'afk')
      }
      blocked = { level: 'halted', code, reasonKey, reasonParams, attempt: 0, delaySec: 0, at: Date.now() }
      syncParked()
      return
    }
    // Provider-side failures need patience, not a human: keep the plugin parked
    // and let a timer retry the batch. A successful run clears it again.
    if (WAITING_CODES.has(code)) {
      const reasonKey = WAITING_CODES.has(code) ? 'waiting.' + code : 'waiting.unknown'
      scheduleRetry(agent, reasonKey, WAITING_CODES.has(code) ? null : { code }, code)
      return
    }
    // AFK recovery: instead of letting this failure block the shutdown (or
    // shutting down on a half-done job), tell the agent to look into it and
    // carry on. A second failure turns into "write the report and stop".
    if (!armed || cfg.afkAutoAnswer === false) return
    const attempts = afkRecovered.get(id) || 0
    if (attempts >= 2) {
      log(lang, 'log.afkRetryExhausted', { id }, 'afk')
      return
    }
    afkRecovered.set(id, attempts + 1)
    const text = attempts === 0 ? afkRecoverText(lang) : afkFinalText(lang)
    if (nudgeAgent(agent, text)) {
      if (attempts === 0) {
        log(lang, 'log.afkRecoverAsked', { id }, 'afk')
      } else {
        log(lang, 'log.afkFinalAsked', { id }, 'afk')
        // With "skip on error" off, this batch may still shut down: the failure
        // stops counting as soon as the wrap-up turn ends (see agent/status).
        if (cfg.onlyOnSuccess === false) afkWrapping.add(id)
      }
    } else {
      log(lang, 'log.afkInjectFailed', { id }, 'afk')
    }
  }

  const offError = ctx.on('agent/error', ({ agent, error }) => {
    try {
      handleAgentError(agent, error)
    } catch (err) {
      log(lang, 'log.afkErrorHandlerFailed', { error: err && err.message ? err.message : err }, 'afk')
    }
  })
  if (typeof offError === 'function') disposers.push(offError)

  // ---------- background jobs ----------

  if (jobs) {
    attachJobs(jobs)
  } else {
    log(lang, 'log.jobsMissing')
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
      if (!armed || cfg.afkAutoAnswer === false) return next()
      const questions = request && Array.isArray(request.questions) ? request.questions : []
      if (questions.length === 0) return next()
      log(lang, 'log.afkAnswered', { n: questions.length }, 'afk')
      return {
        answers: questions.map((q) => ({ id: q.id, selected: [], custom: afkReply(lang) })),
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
    log(lang, 'log.webServerMissing')
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
      blocked: blocked ? blockedText() : null,
      blockedLevel: blocked ? blocked.level : null,
      blockedCode: blocked ? blocked.code : null,
      // When the halt started, so the UI can show "last halted 3h ago" instead of
      // only the reason. Null while nothing is parked.
      parkedAt: blocked && blocked.level === 'halted' ? (blocked.at || null) : null,
      retryAttempt,
      retryAt,
      lastSkip: lastSkipPayload(),
      lang,
      language: store.language,
      ui: {
        variant: ui.variant,
        theme: ui.theme,
        lang: ui.lang,
        compact: ui.compact === true,
      },
      runningCount: rootsRunning(),
      rootsCount: roots().length,
      agentTotal: liveAgents().length,
      agentRunningTotal: liveAgents().filter((a) => a && a.status === 'running').length,
      jobsRunning: jobsPending(),
      jobsTotal: liveJobs.size,
      customEnabled: store.customEnabled,
      activeProfileId: store.activeProfileId,
      // Internal memory, exposed only to make a bad restore diagnosable; the card
      // does not read it.
      lastCustomProfileId: store.lastCustomProfileId || null,
      afkAutoAnswer: cfg.afkAutoAnswer !== false,
      // Capability map, keyed by the same ids `profile.action` uses (hyphen
      // included). `{}` until the first probe settles; `recheck` refreshes it.
      actions: actionAvailability,
      actionReady: actionReadyNow(),
      lastAction,
      // The stored switch with the parent gate applied; the settings page greys
      // the control out on `false` while leaving the stored value alone.
      shutdownOnHaltEffective: effectiveShutdownOnHalt(cfg),
      notify: normalizeNotify(cfg.notify, NOTIFY_DEFAULT),
      countdownLocked: store.activeProfileId === DEFAULT_PROFILE_ID,
      profiles: localizeProfiles(),
      events: recentEvents(lang, since),
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
            log(lang, 'log.requestFailed', { suffix, error: err && err.message ? err.message : err })
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
    // Read-only page for the floating window. Registered beside /state so both
    // live and die with the plugin disposer. No origin check is applied to a
    // top-level GET navigation (browsers send no Origin for it); the page only
    // reads state and never mutates anything, so a same-machine reader that
    // guesses the URL gains nothing it could not already GET from /state.
    disposers.push(webServer.register({
      kind: 'exact',
      path: BASE + '/window',
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        try {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            // Fully self-contained page: inline style/script, same-origin fetch.
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:",
          })
          res.end(windowHtml(lang))
        } catch (err) {
          log(lang, 'log.requestFailed', { suffix: '/window', error: err && err.message ? err.message : err })
          try {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            res.end('window page failed')
          } catch {
            // The socket is already gone; nothing left to tell the client.
          }
        }
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
        log(lang, 'log.debugSimulatedError', { id: String(root.id), codeSuffix: code ? ' (' + code + ')' : '' }, 'afk')
        handleAgentError(root, code ? { code, message: 'simulated ' + code } : undefined)
        json(res, 200, { ok: true, ...statePayload() })
      })
    }
    // Writes land in data/config.json so profiles survive a restart.
    //
    // Two shapes are accepted. The legacy one ({customEnabled}, {activeProfileId},
    // {profileId, patch}, {afkAutoAnswer}, {language}) keeps the old client
    // working; the v2 commands below are what the settings page uses:
    //   {createProfile:{label?,from?}} {renameProfile:{id,label}}
    //   {deleteProfile:id} {setDefault:id} {updateProfile:{id,patch}}
    postRoute('/config', (req, res) => {
      readJsonBody(req, (body) => {
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'body is not JSON', ...statePayload() })

        // Manual re-probe ("check again" in the settings page). It is a command
        // of its own, so it answers with the refreshed snapshot and writes nothing.
        if (body.recheck === true) {
          void recheckActions().then(() => {
            try {
              json(res, 200, { ok: true, ...statePayload() })
            } catch { /* socket already gone */ }
          })
          return
        }

        /** A profile the caller is allowed to address, or null plus a response. */
        const pick = (id, res2) => {
          const target = store.profiles.find((p) => p.id === id)
          if (!target) {
            json(res2, 400, { error: 'unknown profile', ...statePayload() })
            return null
          }
          return target
        }

        /** Reject a write that would loosen the default profile. */
        const lockedBy = (id, patch) => {
          if (id !== DEFAULT_PROFILE_ID) return ''
          for (const field of PROFILE_LOCKED_FIELDS) {
            if (patch && patch[field] !== undefined) return field
          }
          return ''
        }

        /** Apply a whitelisted patch; unknown keys are ignored on purpose so a
         *  newer client cannot break an older host. Returns an error string. */
        const applyPatch = (target, patch) => {
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ''
          const locked = lockedBy(target.id, patch)
          if (locked) return `default profile is locked: ${locked} cannot change`
          if (patch.notify !== undefined) {
            const bad = badNotifyKind(patch.notify)
            if (bad === '*') return 'notify is not a boolean or an object'
            if (bad) return `notify.${bad} is not a boolean`
          }
          if (patch.action !== undefined && !ACTION_IDS.includes(patch.action)) return 'unknown action'
          if (patch.customArgv !== undefined) {
            const bad = badCustomArgv(patch.customArgv)
            if (bad) return bad
          }
          if (patch.shutdownOnHalt !== undefined && typeof patch.shutdownOnHalt !== 'boolean') {
            return 'shutdownOnHalt is not a boolean'
          }
          const next = Object.assign({}, target)
          for (const field of PROFILE_PATCH_FIELDS) {
            if (patch[field] === undefined) continue
            if (field === 'notify') next.notify = normalizeNotify(patch.notify, target.notify)
            else if (field === 'customArgv') next.customArgv = normalizeCustomArgv(patch.customArgv, target.customArgv)
            else next[field] = patch[field]
          }
          // `custom` without a command would arm and then have nothing to run.
          if (next.action === 'custom' && (!Array.isArray(next.customArgv) || next.customArgv.length === 0)) {
            return 'customArgv is required when action is custom'
          }
          Object.assign(target, normalizeProfile(next, target))
          lockDefaultProfile(store)
          return ''
        }

        if (typeof body.language === 'string') {
          const next = body.language === 'auto' ? 'auto' : String(body.language).toLowerCase()
          if (next !== 'auto' && !LANGS.includes(next)) {
            return json(res, 400, { error: 'unknown language', ...statePayload() })
          }
          store.language = next
          lang = resolveLang(next)
        }
        if (typeof body.customEnabled === 'boolean') {
          store.customEnabled = body.customEnabled
          if (store.customEnabled) restoreLastCustomProfile(store)
          log(lang, body.customEnabled ? 'log.customEnabled' : 'log.customDisabled', null, 'config')
        }
        if (typeof body.activeProfileId === 'string') {
          const target = pick(body.activeProfileId, res)
          if (!target) return
          if (!store.customEnabled && target.id !== DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'custom profiles are disabled', ...statePayload() })
          }
          store.activeProfileId = target.id
          log(lang, 'log.profileSwitched', { label: target.label }, 'config')
        }

        // `afkAutoAnswer` used to be global; it is now part of the active
        // profile, so the legacy field writes there.
        if (typeof body.afkAutoAnswer === 'boolean') {
          const active = activeProfile(store)
          if (active.id === DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'default profile is locked: afkAutoAnswer cannot change', ...statePayload() })
          }
          active.afkAutoAnswer = body.afkAutoAnswer
          log(lang, body.afkAutoAnswer ? 'log.afkEnabled' : 'log.afkDisabled', null, 'config')
        }

        if (typeof body.profileId === 'string') {
          const target = pick(body.profileId, res)
          if (!target) return
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : body
          const locked = lockedBy(target.id, patch)
          if (locked) {
            return json(res, 400, { error: `default profile is locked: ${locked} cannot change`, ...statePayload() })
          }
          if (typeof body.label === 'string' && body.label.trim().length > 0) {
            target.label = body.label.trim().slice(0, 24)
            target.labelAuto = false
          }
          const err = applyPatch(target, patch)
          if (err) return json(res, 400, { error: err, ...statePayload() })
          log(lang, 'log.profileUpdated', { label: target.label, sec: target.countdownSec, onlyOnSuccess: target.onlyOnSuccess, blockOnJobs: target.blockOnJobs }, 'config')
        }

        if (body.updateProfile && typeof body.updateProfile === 'object') {
          const target = pick(body.updateProfile.id, res)
          if (!target) return
          const err = applyPatch(target, body.updateProfile.patch)
          if (err) return json(res, 400, { error: err, ...statePayload() })
          log(lang, 'log.profileUpdated', { label: target.label, sec: target.countdownSec, onlyOnSuccess: target.onlyOnSuccess, blockOnJobs: target.blockOnJobs }, 'config')
        }

        if (body.renameProfile && typeof body.renameProfile === 'object') {
          const target = pick(body.renameProfile.id, res)
          if (!target) return
          const label = typeof body.renameProfile.label === 'string' ? body.renameProfile.label.trim().slice(0, 24) : ''
          if (!label) return json(res, 400, { error: 'label is empty', ...statePayload() })
          target.label = label
          target.labelAuto = false
        }

        if (body.createProfile && typeof body.createProfile === 'object') {
          // Slots are no longer pre-created: take the first free `cN` id so the
          // id space stays predictable, then build the profile on demand.
          const id = freeCustomProfileId(store)
          if (!id) return json(res, 400, { error: 'no free profile slot', ...statePayload() })
          const n = Number(id.slice(1))
          const slot = emptyProfile(id, t(lang, 'profile.custom', { n }))
          // A created profile is user-made even when it still carries every
          // default value: labelAuto=false keeps the loader from pruning it as an
          // untouched pre-seeded slot, and tells the settings page to show it.
          slot.labelAuto = false
          const label = typeof body.createProfile.label === 'string' ? body.createProfile.label.trim().slice(0, 24) : ''
          const from = body.createProfile.from
          if (typeof from === 'string') {
            const source = pick(from, res)
            if (!source) return
            Object.assign(slot, normalizeProfile(source, slot))
          }
          if (label) {
            slot.label = label
            slot.labelAuto = false
          }
          store.profiles.push(slot)
          log(lang, 'log.profileUpdated', { label: slot.label, sec: slot.countdownSec, onlyOnSuccess: slot.onlyOnSuccess, blockOnJobs: slot.blockOnJobs }, 'config')
        }

        if (typeof body.deleteProfile === 'string') {
          if (body.deleteProfile === DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'default profile cannot be deleted', ...statePayload() })
          }
          const target = pick(body.deleteProfile, res)
          if (!target) return
          const index = store.profiles.indexOf(target)
          if (index >= 0) store.profiles.splice(index, 1)
          if (store.activeProfileId === target.id) store.activeProfileId = DEFAULT_PROFILE_ID
          if (store.lastCustomProfileId === target.id) store.lastCustomProfileId = null
        }

        if (typeof body.setDefault === 'string') {
          const target = pick(body.setDefault, res)
          if (!target) return
          if (!store.customEnabled && target.id !== DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'custom profiles are disabled', ...statePayload() })
          }
          store.activeProfileId = target.id
          log(lang, 'log.profileSwitched', { label: target.label }, 'config')
        }

        syncCfg()
        saveStore(store, lang)
        json(res, 200, statePayload())
      })
    })
    // UI preferences written by the settings surface. Validation is strict and
    // rejects unknown values with 400 instead of falling back to a default: a
    // client that sends a typo must be able to see it, not silently get A/auto.
    // Only the provided fields are replaced; omitted ones keep their value.
    // `compact` is the floating window's own switch (card only, no chrome).
    postRoute('/ui', (req, res) => {
      readJsonBody(req, (body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return json(res, 400, { error: 'body is not JSON', ...statePayload() })
        }
        if (body.variant !== undefined && !UI_VARIANTS.includes(body.variant)) {
          return json(res, 400, { error: 'unknown variant', ...statePayload() })
        }
        if (body.theme !== undefined && !UI_THEMES.includes(body.theme)) {
          return json(res, 400, { error: 'unknown theme', ...statePayload() })
        }
        if (body.lang !== undefined && !UI_LANGS.includes(body.lang)) {
          return json(res, 400, { error: 'unknown ui language', ...statePayload() })
        }
        if (body.compact !== undefined && typeof body.compact !== 'boolean') {
          return json(res, 400, { error: 'compact is not a boolean', ...statePayload() })
        }
        // Notifications are behaviour, so they moved into the profile store.
        // Answering 400 beats storing half a setting the host would never read.
        if (body.notify !== undefined) {
          return json(res, 400, { error: 'notify belongs to the active profile; use /config updateProfile', ...statePayload() })
        }
        if (body.variant !== undefined) ui.variant = body.variant
        if (body.theme !== undefined) ui.theme = body.theme
        if (body.lang !== undefined) ui.lang = body.lang
        if (body.compact !== undefined) ui.compact = body.compact
        const saved = saveUi(ui, lang)
        json(res, 200, { ok: saved, ...statePayload() })
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
        json(res, 200, { events: recentEvents(lang, since).slice(-limit), serverTime: Date.now() })
      },
    }))

    log(lang, 'log.routesRegistered')
  }

  log(lang, 'log.mounted', { roots: roots().length, running: rootsRunning() })

  // Probe once, off the mount path: a slow `resolveExecutable` must not delay the
  // plugin's own registration. `recheck` is the only other trigger (no polling).
  void recheckActions()

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
