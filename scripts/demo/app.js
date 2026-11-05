// Interactive demo for the sidebar card.
// Everything here mirrors lib/client.js: same class names, same markup shape,
// same state names. Only the data source differs — this one is a simulation.
//
// All user-facing copy comes from scripts/demo/i18n.js; the strings that must
// stay verbatim in every language (Holding, Standby, `shutdown --when idle`,
// `jobs 3 · agent 2`) are built here and never translated.
; (function () {
  'use strict'

  var I18N = typeof window !== 'undefined' ? window.DEMO_I18N : null
  var LANG = I18N ? I18N.currentLang() : 'zh'

  function T(key, params) {
    return I18N ? I18N.dt(LANG, key, params) : key
  }

  var CHEV =
    '<svg class="dsp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'

  // Same "open in a window" glyph the card uses (lib/client.js FLOAT_ICON).
  var FLOAT_ICON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>'

  var RINGS = (function () {
    var out = ''
    for (var k = 0; k < 9; k++) {
      out +=
        '<circle cx="119" cy="101" r="' + (23 + k * 12) + '" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="' +
        Math.max(0.14, 0.42 - k * 0.032).toFixed(2) + '"></circle>'
    }
    return out
  })()

  // Tags mirror lib/client.js's MSG (`tag.*`): `fired` reads DONE there, and a
  // blocked card carries PAUSED in both of its sub-states — the Retrying /
  // Paused split lives in the HUD line and the retry button, not in the tag.
  var TAG = { off: 'OFF', armed: 'ARMED', hold: 'WAIT', fire: 'FIRE', fired: 'DONE' }

  function pad2(n) { return n < 10 ? '0' + n : String(n) }
  function clock(sec) { return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60) }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  }

  // ---------------------------------------------------------------- body
  // HUD line inside the radar. Kept separate so a tick can rewrite just this
  // node instead of the whole body.
  function hudHtml(s) {
    var v = s.view
    var jobs = s.jobs || 0
    var agent = runCount(s)
    if (v === 'blocked') {
      return '<b>' + (s.blocked === 'waiting' ? 'Retrying' : 'Paused') + '</b><span>' +
        T(s.blocked === 'waiting' ? 'card.hud.retry' : 'card.hud.manual') + '</span>'
    }
    if (v === 'hold') return '<b>Holding</b><span>jobs ' + jobs + ' · agent ' + agent + '</span>'
    if (v === 'fire') return '<b>' + clock(s.sec || 0) + '</b><span>T-minus</span>'
    if (v === 'fired') return '<b>Fired</b><span>' + T('card.hud.fired') + '</span>'
    if (v === 'off') return '<b>Offline</b><span>jobs 0 · agent 0</span>'
    return '<b>Standby</b><span>jobs 0 · agent 0</span>'
  }

  // Variant A: two lines of copy.
  function aText(s) {
    var v = s.view
    var jobs = s.jobs || 0
    var agent = runCount(s)
    if (v === 'blocked') {
      return [
        T('card.a.blocked.' + s.blocked + '.big'),
        T('card.a.blocked.' + s.blocked + '.meta'),
      ]
    }
    if (v === 'fire') return [clock(s.sec || 0), T('card.a.fire.meta')]
    if (v === 'hold') {
      var bits = []
      if (jobs) bits.push(T('card.a.hold.jobs', { n: jobs }))
      if (agent) bits.push(T('card.a.hold.agents', { n: agent }))
      return [T('card.a.hold.big'), T('card.a.hold.meta', { bits: bits.join(' · ') })]
    }
    if (v === 'fired') return [T('card.a.fired.big'), T('card.a.fired.meta')]
    if (v === 'off') return [T('card.a.off.big'), T('card.a.off.meta')]
    return [T('card.a.armed.big'), T('card.a.armed.meta')]
  }

  // Variant C: terminal lines, LEDs and the footer string.
  function cL2(s) { return 'jobs ' + (s.jobs || 0) + ' · agent ' + runCount(s) }

  function cL3(s) {
    var v = s.view
    if (v === 'fire') return 'T-minus ' + clock(s.sec || 0)
    if (v === 'hold') return 'holding'
    if (v === 'off') return 'offline'
    if (v === 'blocked') return s.blocked === 'waiting' ? 'retrying' : 'halted'
    if (v === 'fired') return 'done'
    return 'waiting'
  }

  function ledState(s) {
    var v = s.view
    return [v !== 'off', true, runCount(s) === 0, (s.jobs || 0) === 0, v !== 'blocked', v === 'fire']
  }

  function cCode(s) {
    if (s.view === 'blocked') {
      return T(s.blocked === 'waiting' ? 'card.c.waiting' : 'card.c.halted')
    }
    return T('card.c.cond', { n: ledState(s).filter(Boolean).length })
  }

  // Radar dots: one per background job and per running session. Positions come
  // from a fixed golden-angle sequence so adding or removing one dot never
  // moves the dots that are already on screen.
  var DOT_SEEDS = { job: [], run: [] }

  function seedFor(kind, i) {
    var cache = DOT_SEEDS[kind]
    if (!cache[i]) {
      var angle = 2.39996 * (i + (kind === 'run' ? 4 : 0)) + 0.6
      var radius = kind === 'run' ? 24 + (i % 4) * 8 : 15 + (i % 5) * 7
      cache[i] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.62,
      }
    }
    return cache[i]
  }

  // Radar dots follow lib/client.js: one run dot per *running* agent (a root
  // session plus the sub-agents it spawned all count as agents), capped at
  // DOT_CAP with a "+N" badge, and one dot per background job. `agentTotal` is
  // the inventory behind the dots (running + spawned-and-idle) and only feeds
  // the aria-label, exactly like `snap.agentTotal` does in the card.
  var DOT_CAP = 12

  function runCount(s) {
    return Math.max(0, Number(s.agent) || 0)
  }

  function dotMarkup(kind, n) {
    var out = ''
    for (var i = 0; i < n; i++) {
      var p = seedFor(kind, i)
      out += '<i class="dsp-rdot dsp-rdot-' + kind + '" style="left:calc(50% + ' +
        p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
    }
    return out
  }

  function plusMarkup(s) {
    var over = runCount(s) - DOT_CAP
    return over > 0 ? '<span class="dsp-rplus" aria-hidden="true">+' + over + '</span>' : ''
  }

  function dots(s) {
    return dotMarkup('job', Math.max(0, s.jobs || 0)) +
      dotMarkup('run', Math.min(runCount(s), DOT_CAP)) + plusMarkup(s)
  }

  // Add or remove only the difference; the surviving nodes keep their identity.
  function syncDots(wrap, s) {
    var wanted = { job: Math.max(0, s.jobs || 0), run: Math.min(runCount(s), DOT_CAP) }
    Object.keys(wanted).forEach(function (kind) {
      var nodes = wrap.querySelectorAll('.dsp-rdot-' + kind)
      var n = wanted[kind]
      for (var i = nodes.length; i < n; i++) {
        var p = seedFor(kind, i)
        var el = document.createElement('i')
        el.className = 'dsp-rdot dsp-rdot-' + kind
        el.style.left = 'calc(50% + ' + p.x.toFixed(1) + 'px)'
        el.style.top = 'calc(50% + ' + p.y.toFixed(1) + 'px)'
        wrap.appendChild(el)
      }
      for (var j = nodes.length - 1; j >= n; j--) {
        nodes[j].parentNode.removeChild(nodes[j])
      }
    })
    var plus = wrap.querySelector('.dsp-rplus')
    if (plus) plus.parentNode.removeChild(plus)
    var over = runCount(s) - DOT_CAP
    if (over > 0) {
      var badge = document.createElement('span')
      badge.className = 'dsp-rplus'
      badge.setAttribute('aria-hidden', 'true')
      badge.textContent = '+' + over
      wrap.appendChild(badge)
    }
    var total = Math.max(runCount(s), Number(s.agentTotal) || 0)
    wrap.setAttribute('role', 'img')
    wrap.setAttribute('aria-label', T('radar.aria', { total: total, running: runCount(s) }))
  }

  function bodyHtml(s) {
    var v = s.view
    var variant = s.variant || 'A'

    if (variant === 'B') {
      return '<div class="dsp-cbody dsp-v-b" data-v="B"><div class="dsp-disc">' +
        '<div class="dsp-sweep"></div>' +
        '<div class="dsp-rings"><svg class="dsp-radar-svg" viewBox="0 0 238 202">' + RINGS + '</svg></div>' +
        '<div class="dsp-ping"></div>' +
        '<div class="dsp-dots">' + dots(s) + '</div>' +
        '<div class="dsp-hud">' + hudHtml(s) + '</div></div></div>'
    }

    if (variant === 'C') {
      var led = ''
      var on = ledState(s)
      for (var i = 0; i < 6; i++) {
        led += '<i class="dsp-led-seg' + (on[i] ? ' on' : '') + '" data-i="' + i + '"></i>'
      }
      return '<div class="dsp-cbody dsp-v-c" data-v="C"><div class="dsp-screen">' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2">' + esc(cL2(s)) + '</span></div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3">' + esc(cL3(s)) + '</span><i class="dsp-caret"></i></div>' +
        '</div><div class="dsp-led">' + led + '</div>' +
        '<div class="dsp-code">' + esc(cCode(s)) + '</div></div>'
    }

    var text = aText(s)
    return '<div class="dsp-cbody dsp-v-a" data-v="A"><div class="dsp-big">' + esc(text[0]) +
      '</div><div class="dsp-meta">' + esc(text[1]) + '</div></div>'
  }

  // Update the body in place. Rewriting .dsp-cbody on every tick restarted the
  // radar sweep animation and re-created the dots, which read as a visible
  // jump — the same failure mode the hazard strip had.
  function updateBody(body, s) {
    var variant = s.variant || 'A'

    if (variant === 'B') {
      var hud = body.querySelector('.dsp-hud')
      if (hud) {
        var next = hudHtml(s)
        if (hud.innerHTML !== next) hud.innerHTML = next
      }
      var wrap = body.querySelector('.dsp-dots')
      if (wrap) syncDots(wrap, s)
      return
    }

    if (variant === 'C') {
      var l2 = body.querySelector('.dsp-l2')
      if (l2 && l2.textContent !== cL2(s)) l2.textContent = cL2(s)
      var l3 = body.querySelector('.dsp-l3')
      if (l3 && l3.textContent !== cL3(s)) l3.textContent = cL3(s)
      var on = ledState(s)
      var segs = body.querySelectorAll('.dsp-led-seg')
      for (var i = 0; i < segs.length; i++) {
        segs[i].classList.toggle('on', !!on[i])
      }
      var code = body.querySelector('.dsp-code')
      if (code && code.textContent !== cCode(s)) code.textContent = cCode(s)
      return
    }

    var text = aText(s)
    var big = body.querySelector('.dsp-big')
    if (big && big.textContent !== text[0]) big.textContent = text[0]
    var meta = body.querySelector('.dsp-meta')
    if (meta && meta.textContent !== text[1]) meta.textContent = text[1]
  }

  // ---------------------------------------------------------------- card
  // The card is built once per paint, but the hazard strip is kept alive across
  // updates: replacing it restarts its CSS animation, which made the tape look
  // like it jumped every time a counter ticked.
  function card(s) {
    var v = s.view
    return '<div class="dsp-card" data-state="' + v + '" data-variant="' + (s.variant || 'A') +
      '" data-lum="dark" data-retry="' + ((v === 'blocked' && s.blocked === 'waiting') ? '1' : '0') + '">' +
      // Same split as lib/client.js: the float button sits beside the fold
      // header, never inside it — the header is one click target.
      '<div class="dsp-hrow">' +
      '<div class="dsp-chead" role="button" tabindex="0"><i class="dsp-live"></i><span class="dsp-ctitle">' + esc(T('card.title')) + '</span>' +
      '<span class="dsp-tag">' + tagOf(s) + '</span>' + CHEV + '</div>' +
      '<button type="button" class="dsp-float" data-act="float" title="' + esc(T('card.float')) + '" aria-label="' + esc(T('card.float')) + '">' + FLOAT_ICON + '</button>' +
      '</div>' +
      bodyHtml(s) +
      '<div class="dsp-cbtns">' + buttonOf(s) + '</div>' +
      '<div class="dsp-hazard"></div></div>'
  }

  function tagOf(s) {
    var v = s.view
    return v === 'blocked' ? 'PAUSED' : TAG[v]
  }

  function buttonOf(s) {
    var v = s.view
    var hint = s.btnHint ? ' dsp-btn-hint' : ''
    if (v === 'off') return '<button class="dsp-btn dsp-btn-primary' + hint + '" data-act="arm">' + esc(T('card.arm')) + '</button>'
    if (v === 'fire') return '<button class="dsp-btn dsp-btn-danger" data-act="cancel">' + esc(T('card.cancel')) + '</button>'
    if (v === 'blocked') {
      return '<button class="dsp-btn" data-act="' + (s.blocked === 'halted' ? 'retry' : 'disarm') + '">' +
        esc(s.blocked === 'halted' ? T('card.retry') : T('card.disarm')) + '</button>'
    }
    return '<button class="dsp-btn dsp-btn-danger" data-act="disarm">' + esc(T('card.disarm')) + '</button>'
  }

  // ---------------------------------------------------------------- state
  // phase walks the story the demo is telling:
  //   idle → ready → detect → countdown → fired
  //                     ↘ blocked → (retry) → detect
  var COUNTDOWN = 12      // seconds; the real plugin defaults to 60
  var TICK_MS = 1100      // how fast jobs/sessions drain
  var BLOCK_ODDS = 0.06   // per tick, only while detecting

  var state = { variant: 'A', view: 'off', blocked: null, jobs: 0, agent: 0, agentTotal: 0, sec: 0, phase: 'idle', btnHint: false }
  var showVariant = 'A'
  var ticker = null
  var counter = null
  var retrier = null

  function describe(s) {
    if (s.view === 'blocked') return T(s.blocked === 'halted' ? 'now.blocked.halted' : 'now.blocked.waiting')
    if (s.view === 'hold') {
      var bits = []
      if (s.jobs) bits.push(T('now.hold.jobs', { n: s.jobs }))
      if (s.agent) bits.push(T('now.hold.agents', { n: s.agent }))
      return T('now.hold', { bits: bits.join(' · ') })
    }
    if (s.view === 'fire') return T('now.countdown', { sec: clock(s.sec) })
    return T('state.' + s.view + '.t')
  }

  function tone(s) {
    if (s.view === 'blocked') return s.blocked === 'halted' ? 'tone-halted' : 'tone-waiting'
    if (s.view === 'fire') return 'tone-fire'
    if (s.view === 'armed' || s.view === 'hold') return 'tone-armed'
    return ''
  }

  var slot, nowEl, logEl, hintEl, stopEl

  // Update the card in place instead of replacing it. A full innerHTML rewrite
  // would recreate .dsp-hazard on every tick and its scrolling tape would
  // restart from the left — one visible "jump" per tick. Only the parts that
  // actually change are touched; the strip is never rebuilt.
  function paint() {
    if (!slot) return
    var cardEl = slot.querySelector('.dsp-card')
    if (!cardEl) {
      slot.innerHTML = card(state)
      cardEl = slot.querySelector('.dsp-card')
    }

    var v = state.view
    cardEl.setAttribute('data-state', v)
    cardEl.setAttribute('data-variant', state.variant || 'A')
    cardEl.setAttribute('data-retry', (v === 'blocked' && state.blocked === 'waiting') ? '1' : '0')

    var tagEl = cardEl.querySelector('.dsp-tag')
    var nextTag = tagOf(state)
    if (tagEl && tagEl.textContent !== nextTag) tagEl.textContent = nextTag

    var titleEl = cardEl.querySelector('.dsp-ctitle')
    var nextTitle = T('card.title')
    if (titleEl && titleEl.textContent !== nextTitle) titleEl.textContent = nextTitle

    var oldBody = cardEl.querySelector('.dsp-cbody')
    if (!oldBody || oldBody.getAttribute('data-v') !== (state.variant || 'A')) {
      if (oldBody) oldBody.outerHTML = bodyHtml(state)
      else cardEl.insertAdjacentHTML('afterbegin', bodyHtml(state))
      oldBody = cardEl.querySelector('.dsp-cbody')
    } else {
      updateBody(oldBody, state)
    }

    var btns = cardEl.querySelector('.dsp-cbtns')
    if (btns) btns.innerHTML = buttonOf(state)

    if (nowEl) {
      nowEl.className = 'now ' + tone(state)
      nowEl.innerHTML = T('try.now', { state: esc(describe(state)) })
    }
    if (hintEl) {
      // the nudge appears only while the card is waiting for the 武装 click
      hintEl.hidden = state.phase !== 'ready'
    }
    if (stopEl) {
      // nothing to stop while idle or already fired
      var idle = state.phase === 'idle' || state.phase === 'ready' || state.phase === 'fired'
      stopEl.disabled = idle
      stopEl.textContent = state.phase === 'fired' ? T('try.stopFired') : T('try.stop')
    }
  }

  function stamp() {
    var d = new Date()
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  }

  // The log keeps message keys rather than finished strings, so switching the
  // page language re-renders the existing entries in the new language.
  var entries = []

  function renderLog() {
    if (!logEl) return
    var out = ''
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      out += '<li><span class="t">' + e.time + '</span><span class="k ' + e.kind +
        '"></span><span>' + esc(T(e.key, e.params)) + '</span></li>'
    }
    logEl.innerHTML = out
    logEl.scrollTop = logEl.scrollHeight
  }

  function log(key, params, kind) {
    entries.push({ key: key, params: params || null, kind: kind || '', time: stamp() })
    while (entries.length > 40) entries.shift()
    renderLog()
  }

  // ---------------------------------------------------------------- timers
  function stopAll() {
    if (ticker) { clearInterval(ticker); ticker = null }
    if (counter) { clearInterval(counter); counter = null }
    if (retrier) { clearTimeout(retrier); retrier = null }
  }

  function rnd(n) { return Math.floor(Math.random() * n) }

  // ---------------------------------------------------------------- steps
  function randomize() {
    stopAll()
    // One in ten rolls is a "team" scene: more agents than the radar can draw,
    // so the +N badge shows up instead of a field of overlapping dots.
    if (Math.random() < 0.1) {
      state.jobs = 1 + rnd(3)
      state.agent = DOT_CAP + 1 + rnd(3)
      state.agentTotal = state.agent + 2
    } else {
      state.jobs = 2 + rnd(7)          // 2..8 background jobs
      state.agent = 1 + rnd(6)         // 1..6 running agents
      // A root session plus the sub-agents it spawned: `agentTotal` is the
      // inventory behind the dots and only feeds the aria-label.
      state.agentTotal = state.agent + (Math.random() < 0.35 ? 1 + rnd(2) : 0)
    }
    state.view = 'off'
    state.blocked = null
    state.sec = 0
    state.phase = 'ready'
    state.btnHint = true
    paint()
    log('log.rolled', { jobs: state.jobs, agent: state.agent }, 'armed')
    log('log.hintArm', null, 'armed')
  }

  function arm() {
    if (state.phase !== 'ready' && state.phase !== 'idle') return
    state.phase = 'detect'
    state.btnHint = false
    sync()
    log('log.armed', null, 'armed')
    startDetect()
  }

  function sync() {
    // view follows the counters; this is the same rule the real card uses
    if (state.phase === 'blocked') return
    if (state.phase === 'fired') { state.view = 'fired'; return }
    if (state.phase === 'countdown') { state.view = 'fire'; return }
    if (state.phase === 'parked') { state.view = 'armed'; return }
    if (state.phase === 'detect') {
      state.view = (state.jobs > 0 || state.agent > 0) ? 'hold' : 'armed'
      return
    }
    state.view = 'off'
  }

  function startDetect() {
    stopAll()
    ticker = setInterval(step, TICK_MS)
  }

  function step() {
    if (state.phase !== 'detect') return

    if (Math.random() < BLOCK_ODDS) {
      enterBlocked(Math.random() < 0.5 ? 'halted' : 'waiting')
      return
    }

    if (state.jobs > 0 && state.agent > 0) {
      // Pick a category at random (weighted by how many of each are left) and
      // drain one from it. Draining every job before touching the sessions
      // looked scripted — real work finishes in whatever order it finishes.
      var jobsLeft = state.jobs
      var agentsLeft = state.agent
      if (Math.random() < jobsLeft / (jobsLeft + agentsLeft)) {
        state.jobs -= 1
        log('log.jobDone', { n: state.jobs }, 'wait')
      } else {
        state.agent -= 1
        log('log.agentDone', { n: state.agent }, 'wait')
      }
    } else if (state.jobs > 0) {
      state.jobs -= 1
      log('log.jobDone', { n: state.jobs }, 'wait')
    } else if (state.agent > 0) {
      state.agent -= 1
      log('log.agentDone', { n: state.agent }, 'wait')
    } else {
      beginCountdown()
      return
    }

    if (state.jobs === 0 && state.agent === 0) {
      sync()
      paint()
      beginCountdown()
      return
    }

    sync()
    paint()
  }

  function beginCountdown() {
    if (ticker) { clearInterval(ticker); ticker = null }
    state.phase = 'countdown'
    state.view = 'fire'
    state.sec = COUNTDOWN
    paint()
    log('log.countdown', { sec: COUNTDOWN }, 'fire')
    counter = setInterval(function () {
      state.sec -= 1
      if (state.sec <= 0) {
        if (counter) { clearInterval(counter); counter = null }
        state.phase = 'fired'
        state.view = 'fired'
        state.sec = 0
        paint()
        log('log.fired', null, 'fire')
        return
      }
      paint()
    }, 1000)
  }

  function enterBlocked(level) {
    if (ticker) { clearInterval(ticker); ticker = null }
    state.phase = 'blocked'
    state.blocked = level
    state.view = 'blocked'
    paint()
    if (level === 'halted') {
      log('log.blockHalted', null, 'halted')
      return
    }
    log('log.blockWaiting', null, 'wait')
    retrier = setTimeout(function () {
      retrier = null
      state.phase = 'detect'
      state.blocked = null
      sync()
      paint()
      log('log.retried', null, 'wait')
      startDetect()
    }, 4000)
  }

  function cancelCountdown() {
    if (state.phase !== 'countdown') return
    if (counter) { clearInterval(counter); counter = null }
    state.sec = 0
    log('log.cancelled', null, 'armed')
    if (state.jobs === 0 && state.agent === 0) {
      // Nothing left to wait for. Resting armed with an empty queue is a valid
      // state — and re-arming the countdown here would fire again in 12s, which
      // is exactly what the user just cancelled. Park instead.
      state.phase = 'parked'
      state.view = 'armed'
      paint()
      log('log.parked', null, 'armed')
      return
    }
    state.phase = 'detect'
    sync()
    paint()
    startDetect()
  }

  function disarm() {
    stopAll()
    state.phase = 'idle'
    state.view = 'off'
    state.blocked = null
    state.jobs = 0
    state.agent = 0
    state.sec = 0
    state.btnHint = false
    paint()
    log('log.disarmed', null, 'armed')
  }

  function retryHalted() {
    if (state.phase !== 'blocked') return
    state.blocked = null
    state.phase = 'detect'
    sync()
    paint()
    log('log.retryResumed', null, 'armed')
    if (state.jobs === 0 && state.agent === 0) beginCountdown()
    else startDetect()
  }

  // ---------------------------------------------------------------- card clicks
  function onCardClick(e) {
    var b = e.target.closest('[data-act]')
    if (!b) return
    var act = b.getAttribute('data-act')
    if (act === 'arm') {
      if (state.phase === 'idle') log('log.armFirst', null, 'armed')
      else arm()
    } else if (act === 'cancel') cancelCountdown()
    else if (act === 'retry') retryHalted()
    else if (act === 'float') log('log.float', null, 'armed')
    else if (act === 'disarm') disarm()
  }

  // ---------------------------------------------------------------- showcase
  // The 三种外观 and 六种状态 blocks render the same markup as the card, so what
  // you see there is what the plugin ships.
  var SHOW_STATES = ['off', 'armed', 'hold', 'fire', 'fired', 'blocked']

  function showcaseSpec(view) {
    if (view === 'hold') return { view: 'hold', jobs: 2, agent: 3, agentTotal: 4 }
    if (view === 'fire') return { view: 'fire', sec: 42 }
    if (view === 'blocked') return { view: 'blocked', blocked: 'halted' }
    return { view: view }
  }

  function renderVariants() {
    var host = document.getElementById('show-variants')
    if (!host) return
    host.innerHTML = ['A', 'B', 'C'].map(function (v) {
      var s = v === 'A' ? { view: 'hold', jobs: 2, agent: 3, agentTotal: 4 }
        : v === 'B' ? { view: 'armed' }
          : { view: 'armed', jobs: 2, agent: 3, agentTotal: 3 }
      s.variant = v
      return '<div class="cell">' + card(s) + '<span class="cell-cap"><b>' + v + ' · ' +
        esc(T('var.' + v + '.name')) + '</b>' +
        esc(T('var.' + v + '.desc')) +
        '</span></div>'
    }).join('')
  }

  // Section 07 shows the card inside two static sidebars. They are live markup
  // (not screenshots) so the sidebar chrome and the card follow the language.
  function fillSidebars() {
    ;[
      ['card-slot-hold', { view: 'hold', jobs: 2, agent: 3, agentTotal: 4 }],
      ['card-slot-fire', { view: 'fire', sec: 42, jobs: 0, agent: 0, agentTotal: 0 }],
    ].forEach(function (pair) {
      var host = document.getElementById(pair[0])
      if (!host) return
      var s = pair[1]
      s.variant = 'A'
      host.innerHTML = card(s)
    })
  }

  function renderStates() {
    var host = document.getElementById('show-states')
    if (!host) return
    host.innerHTML = SHOW_STATES.map(function (view) {
      var s = showcaseSpec(view)
      s.variant = showVariant
      return '<div class="cell">' + card(s) + '<span class="cell-cap"><b>' + esc(T('state.' + view + '.t')) +
        '</b>' + esc(T('state.' + view + '.d')) + '</span></div>'
    }).join('')
    var btns = document.querySelectorAll('#show-variant-pills button')
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-v') === showVariant)
    }
  }

  function setShowVariant(v) {
    showVariant = v
    renderStates()
  }

  // ---------------------------------------------------------------- tabs
  // Two panes, one visible at a time. The tab bar sits under the hero so the
  // page can carry both the "what is this" copy and the playground without
  // one burying the other.
  function setPane(name) {
    var tabs = document.querySelectorAll('.tabs .tab')
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-pane') === name
      tabs[i].classList.toggle('on', on)
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false')
    }
    var panes = document.querySelectorAll('.pane')
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].id !== 'pane-' + name
    }
    if (history.replaceState) {
      history.replaceState(null, '', name === 'try' ? '#try' : '#about')
    }
  }

  function setVariant(v) {
    state.variant = v
    var btns = document.querySelectorAll('#variants button')
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-v') === v)
    }
    paint()
    log('log.variant', { v: v }, 'armed')
  }

  // ---------------------------------------------------------------- boot
  function start() {
    slot = document.getElementById('card-slot')
    nowEl = document.getElementById('now')
    logEl = document.getElementById('log')
    hintEl = document.getElementById('arm-hint')
    stopEl = document.getElementById('stop')

    slot.addEventListener('click', onCardClick)

    var wrap = document.getElementById('variants')
    if (wrap) {
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('button')
        if (b) setVariant(b.getAttribute('data-v'))
      })
    }

    var rollBtn = document.getElementById('roll')
    if (rollBtn) rollBtn.addEventListener('click', randomize)

    var stopBtn = document.getElementById('stop')
    if (stopBtn) stopBtn.addEventListener('click', disarm)
    var pills = document.getElementById('show-variant-pills')
    if (pills) {
      pills.addEventListener('click', function (e) {
        var b = e.target.closest('button')
        if (b) setShowVariant(b.getAttribute('data-v'))
      })
    }

    var tabsEl = document.querySelector('.tabs')
    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        var b = e.target.closest('.tab')
        if (b) setPane(b.getAttribute('data-pane'))
      })
    }

    // the button at the end of the 了解 pane, and any #try link in the copy
    document.addEventListener('click', function (e) {
      var go = e.target.closest('[data-goto]')
      if (go) { e.preventDefault(); setPane(go.getAttribute('data-goto')); return }
      var a = e.target.closest('a[href="#try"]')
      if (a) { e.preventDefault(); setPane('try') }
    })

    // A language switch must not restart the simulation: paint() rewrites the
    // copy in place, and the log re-renders from its stored keys, so an
    // in-flight countdown keeps ticking.
    if (I18N && I18N.onChange) {
      I18N.onChange(function (lang) {
        LANG = lang
        paint()
        renderVariants()
        renderStates()
        renderLog()
        fillSidebars()
        syncThumbs()
      })
    }

    // The settings mock is static, but its thumbnails are per-language files:
    // variant-<v>-<lang>-dark.png, the same 18 renders the panel inlines.
    function syncThumbs() {
      var imgs = document.querySelectorAll('img[data-thumb]')
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].src = '../assets/variant-' + imgs[i].getAttribute('data-thumb') + '-' + LANG + '-dark.png'
      }
    }

    function wireSettingsTabs() {
      var bar = document.getElementById('demo-tabs')
      if (!bar) return
      // The product measures the pill with getBoundingClientRect(); the four tabs
      // here are equal-width, so a calc() keeps the pill under the active one.
      function movePill(index) {
        var w = 'calc((100% - 4px) / 4)'
        bar.style.setProperty('--tab-w', w)
        bar.style.setProperty('--tab-h', '32px')
        bar.style.setProperty('--tab-y', '2px')
        bar.style.setProperty('--tab-x', index === 0 ? '2px' : 'calc(2px + ' + index + ' * (' + w + ' + 2px))')
      }
      movePill(0)
      bar.addEventListener('click', function (e) {
        var btn = e.target.closest('.dsp-tab')
        if (!btn || !bar.contains(btn)) return
        var id = btn.getAttribute('data-tab')
        var tabs = bar.querySelectorAll('.dsp-tab')
        for (var i = 0; i < tabs.length; i++) {
          var on = tabs[i] === btn
          tabs[i].classList.toggle('on', on)
          tabs[i].setAttribute('aria-selected', on ? 'true' : 'false')
          if (on) movePill(i)
        }
        var panes = document.querySelectorAll('.dsp-tabpanel[data-pane]')
        for (var j = 0; j < panes.length; j++) {
          panes[j].hidden = panes[j].getAttribute('data-pane') !== id
        }
      })
    }

    renderVariants()
    renderStates()
    fillSidebars()
    syncThumbs()
    wireSettingsTabs()

    state = { variant: 'A', view: 'off', blocked: null, jobs: 0, agent: 0, agentTotal: 0, sec: 0, phase: 'idle', btnHint: false }
    paint()
    log('log.boot', null, 'armed')

    // #try opens the playground directly — that is the link the README points at.
    if (location.hash === '#try') setPane('try')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
