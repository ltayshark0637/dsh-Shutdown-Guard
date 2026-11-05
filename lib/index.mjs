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
    retrySec: 30,
    retryPolicies: null,
    retryAssign: null,
  }
}

function profileList(lang) {
  const list = [emptyProfile(DEFAULT_PROFILE_ID, t(lang, 'profile.default'))]
  for (let i = 1; i <= CUSTOM_SLOT_COUNT; i += 1) {
    list.push(emptyProfile('c' + i, t(lang, 'profile.custom', { n: i })))
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

/**
 * Record one event. `key`/`params` are kept alongside the rendered text so the
 * client can re-render the history after the language changes; the file on disk
 * gets whatever language was active when the line was written.
 */
function log(lang, key, params, kind) {
  const at = Date.now()
  const text = t(lang, key, params)
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
      text: e.key ? t(lang, e.key, e.params) : e.text,
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

/** 'auto' or one of LANGS; anything else falls back to following the system. */
function normalizeLanguage(value) {
  if (value === 'auto') return 'auto'
  if (typeof value === 'string' && LANGS.includes(value.toLowerCase())) return value.toLowerCase()
  return 'auto'
}

function loadStore(baseline, initialLang, preferredLanguage) {
  const slots = profileList(initialLang)
  const store = {
    activeProfileId: DEFAULT_PROFILE_ID,
    customEnabled: false,
    afkAutoAnswer: true,
    language: normalizeLanguage(preferredLanguage),
    profiles: slots,
  }
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
        if (typeof item.label === 'string' && item.label.trim().length > 0) {
          slot.label = item.label.trim().slice(0, 24)
          slot.labelAuto = item.labelAuto === true
        }
        Object.assign(slot, normalizeProfile(item, slot))
      }
    }
    if (typeof raw.activeProfileId === 'string' && store.profiles.some((p) => p.id === raw.activeProfileId)) {
      store.activeProfileId = raw.activeProfileId
    }
    store.customEnabled = raw.customEnabled === true
    store.afkAutoAnswer = raw.afkAutoAnswer !== false
    if (typeof raw.language === 'string' && (raw.language === 'auto' || LANGS.includes(raw.language))) {
      store.language = raw.language
    }
  }
  if (!store.customEnabled) store.activeProfileId = DEFAULT_PROFILE_ID
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
      version: 1,
      activeProfileId: store.activeProfileId,
      customEnabled: store.customEnabled,
      afkAutoAnswer: store.afkAutoAnswer !== false,
      language: store.language,
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
 * big state line, meta line, one action button, hazard tape). It deliberately
 * mirrors lib/client.js instead of inventing a second vocabulary: `viewOf()`
 * uses the same precedence as the card, the dot colours come from the same
 * variables, and the button sends the same arm/disarm/cancel requests. The
 * floating window is for watching on a second screen, so the card stays 1:1
 * and the extra stats line is the only thing the sidebar does not have.
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
<html lang="${active}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>dsh-shutdown-guard</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:radial-gradient(120% 120% at 20% 0%,#1a2030 0%,#0d1017 55%,#080a0f 100%);color:#e7eaf2;font:14px/1.5 "Segoe UI","Microsoft YaHei","PingFang SC",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:22px 22px 30px;min-height:100vh;display:flex;flex-direction:column;gap:16px}
.bar{display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;flex:none;background:#a7abb4}
.dot.s-armed,.dot.s-hold{background:#f0a83a;box-shadow:0 0 0 4px rgba(240,168,58,.16),0 0 12px rgba(240,168,58,.5)}
.dot.s-fire,.dot.s-fired{background:#ef5350;animation:dsp-pulse-red .9s infinite}
.dot.s-blocked{background:#7e8aa3;box-shadow:0 0 0 3px rgba(126,138,163,.28)}
.dot.s-blocked[data-retry="1"]{background:#6f8f7a;animation:dsp-wait 1.6s ease-in-out infinite}
.brand{font-size:13px;letter-spacing:.04em;color:#8b93a7;flex:1}
.pill{font-size:12px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#cfd5e4;white-space:nowrap}
/* The card below mirrors lib/client.js: same variables, same state machine. */
.dsp-card{--dsp-bg:#1c1e22;--dsp-fg:#f3f4f6;--dsp-muted:#a7abb4;--dsp-line:rgba(255,255,255,.14);--dsp-accent:#f0a83a;--dsp-danger:#ef5350;--dsp-blocked:#7e8aa3;--dsp-blocked-soft:rgba(126,138,163,.16);--dsp-tape-a:#f2b13c;--dsp-tape-b:#e8453c;
position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:420px;margin:0 auto;min-height:186px;padding:12px 14px 0;border-radius:12px;overflow:hidden;
border:1px solid var(--dsp-line);background:var(--dsp-bg);color:var(--dsp-fg);font-family:var(--dsw-font-family,system-ui,sans-serif)}
.dsp-card[data-state="off"]{background:color-mix(in srgb, var(--dsp-fg) 2.5%, var(--dsp-bg))}
.dsp-card[data-state="fire"]{border-color:var(--dsp-danger)}
.dsp-card[data-state="blocked"][data-retry="1"]{--dsp-blocked:#6f8f7a;--dsp-blocked-soft:rgba(111,143,122,.16)}
.dsp-chead{display:flex;align-items:center;gap:7px;height:22px;line-height:22px}
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
.dsp-cbody{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;padding:10px 0 4px}
.dsp-big{font-family:ui-monospace,"Cascadia Mono",Consolas,"Microsoft YaHei",monospace;font-size:26px;line-height:1.15;font-weight:650;letter-spacing:-.2px}
.dsp-card[data-state="fire"] .dsp-big{color:var(--dsp-danger)}
.dsp-meta{margin-top:5px;font-size:11.5px;line-height:16px;color:var(--dsp-muted);min-height:15px;white-space:pre-line;overflow-wrap:anywhere}
.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsp-accent)}
.dsp-cbtns{display:flex;align-items:center;gap:6px;padding:4px 0 10px}
.dsp-btn{flex:1 1 auto;min-width:0;height:30px;border-radius:8px;border:1px solid var(--dsp-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.dsp-btn:hover{background:color-mix(in srgb, var(--dsp-fg) 7%, transparent)}
.dsp-btn-primary{border-color:transparent;background:var(--dsp-accent);color:#1a1200;font-weight:600}
.dsp-btn-danger{border-color:color-mix(in srgb, var(--dsp-danger) 45%, transparent);color:var(--dsp-danger);background:color-mix(in srgb, var(--dsp-danger) 6%, transparent)}
.dsp-card[data-state="blocked"] .dsp-btn{border-color:color-mix(in srgb,var(--dsp-blocked) 55%,transparent);background:var(--dsp-blocked-soft)}
.dsp-btn:disabled{opacity:.55;cursor:progress}
.dsp-hazard{position:relative;height:10px;margin:0 -14px;overflow:hidden}
.dsp-hazard::before{content:"";position:absolute;top:0;bottom:0;left:-48px;right:-48px;background:repeating-linear-gradient(45deg,var(--dsp-tape-a) 0 10px,var(--dsp-tape-b) 10px 20px);opacity:.55;animation:dsp-slide 1.15s linear infinite}
.dsp-card[data-state="hold"] .dsp-hazard::before{animation-duration:2.6s;opacity:.9}
.dsp-card[data-state="fire"] .dsp-hazard::before{animation-duration:.42s}
.dsp-card[data-state="off"] .dsp-hazard::before,.dsp-card[data-state="fired"] .dsp-hazard::before,.dsp-card[data-state="blocked"] .dsp-hazard::before{animation-play-state:paused}
@keyframes dsp-slide{to{transform:translateX(28.28px)}}
@keyframes dsp-pulse-red{0%{box-shadow:0 0 0 0 rgba(239,83,80,.7)}70%{box-shadow:0 0 0 6px rgba(239,83,80,0)}100%{box-shadow:0 0 0 0 rgba(239,83,80,0)}}
@keyframes dsp-wait{0%,100%{opacity:.45;box-shadow:0 0 0 2px var(--dsp-blocked-soft)}50%{opacity:1;box-shadow:0 0 0 5px transparent}}
.stats{font-size:11.5px;color:#8b93a7;text-align:center;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.err{padding:10px 12px;border-radius:10px;border:1px solid rgba(239,83,80,.4);background:rgba(239,83,80,.1);color:#ffb3a8;font-size:12.5px;overflow-wrap:anywhere}
.events{border-radius:14px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.02);overflow:hidden}
.events-head{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;font-size:11px;letter-spacing:.04em;color:#8b93a7;border-bottom:1px solid rgba(255,255,255,.06)}
.live{color:#37c978;white-space:nowrap}
.live.offline{color:#ef5350}
#eventList{list-style:none;margin:0;padding:4px 0;max-height:38vh;overflow:auto}
#eventList li{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:6px 14px;font-size:12.5px;border-bottom:1px solid rgba(255,255,255,.035)}
#eventList li:last-child{border-bottom:0}
#eventList li time{color:#6f7789;font-variant-numeric:tabular-nums}
#eventList li span{color:#dbe0ec;overflow-wrap:anywhere}
#eventList li.afk span{color:#9fd0ff}
#eventList li.config span{color:#c7b8ff}
.empty{padding:14px;font-size:12.5px;color:#6f7789}
footer{margin-top:auto;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#6f7789;overflow-wrap:anywhere}
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
  <section class="dsp-card" id="card" data-state="off" data-retry="0">
    <div class="dsp-chead">
      <i class="dsp-live" aria-hidden="true"></i>
      <span class="dsp-ctitle" id="cardTitle"></span>
      <span class="dsp-tag" id="cardTag">OFF</span>
    </div>
    <div class="dsp-cbody"><div class="dsp-big" id="cardBig">--</div><div class="dsp-meta" id="cardMeta"></div></div>
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
      actionFailed: 'Не удалось выполнить: {error}',
      statsAgents: 'агенты',
      statsJobs: 'задачи',
      statsErrors: 'сбои',
      events: 'последние события',
      note: 'Закрытие окна не отключает сторож; взвод и снятие — на карточке в боковой панели.'
    }
  }
  var lang = window.__LANG__ || 'en'
  var snap = null
  var view = 'off'
  var offset = 0
  var lastEventAt = 0
  var seen = []
  var fails = 0
  var busy = false
  var timer = null

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
  function cap (s) { return s.charAt(0).toUpperCase() + s.slice(1) }
  function fmt2 (n) { return n > 99 ? '99+' : String(n) }

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
      if (Number(snap.runningCount) > 0) parts.push(m('metaSessions', { n: fmt2(snap.runningCount) }))
      return m('metaHold', { parts: parts.join(' · ') })
    }
    if (view === 'armed') return m('metaArmed')
    return m('metaOff')
  }

  function paintCard () {
    var card = el('card')
    card.setAttribute('data-state', view)
    card.setAttribute('data-retry', view === 'blocked' && snap && snap.retryAt > 0 ? '1' : '0')
    el('cardTitle').textContent = m('cardTitle')
    el('cardTag').textContent = m('tag' + cap(view))
    el('cardBig').textContent = bigText()
    el('cardMeta').textContent = metaText()
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
      el('stats').textContent = m('statsAgents') + ' ' + String(snap.runningCount) + '/' + String(snap.rootsCount) +
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
    var reset = false
    if (body.lang && body.lang !== lang) {
      // Host output is rendered per language; drop the history and refetch it
      // so the list does not mix two languages.
      lang = MSG[body.lang] ? body.lang : 'en'
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

  function post (path) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
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

  el('cardBtn').addEventListener('click', act)
  paintChrome()
  paintCard()
  poll()
  // The countdown line inside the card ticks without refetching state.
  setInterval(function () { if (view === 'fire') el('cardBig').textContent = bigText() }, 250)
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
  // The system-derived language is the only thing available before the stored
  // preference is read; loadStore seeds the slot names with it.
  const store = loadStore(baseline, resolveLang('auto'), rawConfig && rawConfig.language)
  // The active language: 'auto' follows the OS locale. Everything the host
  // generates — log lines, skip reasons, blocked reasons — is rendered in it, so
  // the client never has to translate host output.
  let lang = resolveLang(store.language)
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
      reason: blockedText(),
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
      lastSkip = { at: Date.now(), key: blocked.reasonKey, params: blocked.reasonParams }
      return false
    }
    if (!armed || state !== 'idle') return false
    if (rootsRunning() > 0) return false
    const pendingJobs = cfg.blockOnJobs ? jobsPending() : 0
    if (pendingJobs > 0) {
      lastSkip = { at: Date.now(), key: 'skip.jobs', params: { n: pendingJobs } }
      log(lang, lastSkip.key, lastSkip.params)
      return false
    }
    if (errored.size > 0 && (cfg.onlyOnSuccess || store.afkAutoAnswer !== false)) {
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
          .then((outcome) => log(lang, 'log.shutdownExit', { args: args.join(' '), outcome: JSON.stringify(outcome) }))
          .catch((err) => log(lang, 'log.shutdownSpawnFailed', { error: err && err.message ? err.message : err }))
      }
    } catch (err) {
      log(lang, 'log.spawnFailed', { error: err && err.message ? err.message : err })
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
    log(lang, 'log.countdownStart', { sec: cfg.countdownSec })
    void spawnShutdown(['/s', '/t', String(cfg.countdownSec + cfg.marginSec)])
    firedTimer = ctx.setTimeout(() => {
      state = 'fired'
      log(lang, 'log.fired')
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
        log(lang, 'log.blockedSelfHealFailed', { id, code, reason: t(lang, reasonKey, reasonParams) }, 'afk')
      }
      blocked = { level: 'halted', code, reasonKey, reasonParams, attempt: 0, delaySec: 0 }
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
    if (!armed || store.afkAutoAnswer === false) return
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
      if (!armed || store.afkAutoAnswer === false) return next()
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
      retryAttempt,
      retryAt,
      lastSkip: lastSkipPayload(),
      lang,
      language: store.language,
      runningCount: rootsRunning(),
      rootsCount: roots().length,
      jobsRunning: jobsPending(),
      jobsTotal: liveJobs.size,
      customEnabled: store.customEnabled,
      activeProfileId: store.activeProfileId,
      afkAutoAnswer: store.afkAutoAnswer !== false,
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
    // Writes land in data/config.json so custom profiles survive a restart.
    postRoute('/config', (req, res) => {
      readJsonBody(req, (body) => {
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'body is not JSON', ...statePayload() })

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
          log(lang, body.customEnabled ? 'log.customEnabled' : 'log.customDisabled', null, 'config')
        }
        if (typeof body.activeProfileId === 'string') {
          const target = store.profiles.find((p) => p.id === body.activeProfileId)
          if (!target) return json(res, 400, { error: 'unknown profile', ...statePayload() })
          if (!store.customEnabled && target.id !== DEFAULT_PROFILE_ID) {
            return json(res, 400, { error: 'custom profiles are disabled', ...statePayload() })
          }
          store.activeProfileId = target.id
          log(lang, 'log.profileSwitched', { label: target.label }, 'config')
        }
        if (typeof body.afkAutoAnswer === 'boolean') {
          store.afkAutoAnswer = body.afkAutoAnswer
          log(lang, body.afkAutoAnswer ? 'log.afkEnabled' : 'log.afkDisabled', null, 'config')
        }
        if (typeof body.profileId === 'string') {
          const target = store.profiles.find((p) => p.id === body.profileId)
          if (!target) return json(res, 400, { error: 'unknown profile', ...statePayload() })
          if (typeof body.label === 'string' && body.label.trim().length > 0) {
            target.label = body.label.trim().slice(0, 24)
            target.labelAuto = false
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
            log(lang, 'log.defaultLocked', null, 'config')
          }
          log(lang, 'log.profileUpdated', { label: target.label, sec: target.countdownSec, onlyOnSuccess: target.onlyOnSuccess, blockOnJobs: target.blockOnJobs }, 'config')
        }
        syncCfg()
        saveStore(store, lang)
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
        json(res, 200, { events: recentEvents(lang, since).slice(-limit), serverTime: Date.now() })
      },
    }))

    log(lang, 'log.routesRegistered')
  }

  log(lang, 'log.mounted', { roots: roots().length, running: rootsRunning() })

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
