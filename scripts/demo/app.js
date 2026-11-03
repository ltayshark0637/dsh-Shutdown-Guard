// Interactive demo for the sidebar card.
// Everything here mirrors lib/client.js: same class names, same markup shape,
// same state names. Only the data source differs — this one is a simulation.
; (function () {
  'use strict'

  var CHEV =
    '<svg class="dsp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'

  var RINGS = (function () {
    var out = ''
    for (var k = 0; k < 9; k++) {
      out +=
        '<circle cx="119" cy="101" r="' + (23 + k * 12) + '" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="' +
        Math.max(0.14, 0.42 - k * 0.032).toFixed(2) + '"></circle>'
    }
    return out
  })()

  var TAG = { off: 'OFF', armed: 'ARMED', hold: 'WAIT', fire: 'FIRE', fired: 'FIRED' }
  var A_TEXT = {
    off: ['未开启', '仅在点击「武装」后才会运行程序'],
    armed: ['待命', '所有任务已结束 · 等待下一次触发'],
    fired: ['已下发', '关机指令已生效，无法取消'],
  }
  var BLOCK_TEXT = {
    halted: ['已暂停', '账户额度不足，需充值后解除'],
    waiting: ['等待恢复', '请求过于频繁，稍后自动重试'],
  }

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
    var agent = s.agent || 0
    if (v === 'blocked') {
      return '<b>' + (s.blocked === 'waiting' ? 'Retrying' : 'Paused') + '</b><span>' +
        (s.blocked === 'waiting' ? '稍后重试' : '需人工处理') + '</span>'
    }
    if (v === 'hold') return '<b>Holding</b><span>jobs ' + jobs + ' · agent ' + agent + '</span>'
    if (v === 'fire') return '<b>' + clock(s.sec || 0) + '</b><span>T-minus</span>'
    if (v === 'fired') return '<b>Fired</b><span>已下发</span>'
    if (v === 'off') return '<b>Offline</b><span>jobs 0 · agent 0</span>'
    return '<b>Standby</b><span>jobs 0 · agent 0</span>'
  }

  // Variant A: two lines of copy.
  function aText(s) {
    var v = s.view
    var jobs = s.jobs || 0
    var agent = s.agent || 0
    if (v === 'blocked') return BLOCK_TEXT[s.blocked]
    if (v === 'fire') return [clock(s.sec || 0), '系统即将关机 · 可撤销']
    if (v === 'hold') {
      var bits = []
      if (jobs) bits.push(jobs + ' 个后台任务')
      if (agent) bits.push(agent + ' 个会话')
      return ['等待后台任务', bits.join(' · ') + '，完成后关机']
    }
    return A_TEXT[v]
  }

  // Variant C: terminal lines, LEDs and the footer string.
  function cL2(s) { return 'jobs ' + (s.jobs || 0) + ' · agent ' + (s.agent || 0) }

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
    return [v !== 'off', true, (s.agent || 0) === 0, (s.jobs || 0) === 0, v !== 'blocked', v === 'fire']
  }

  function cCode(s) {
    if (s.view === 'blocked') {
      return s.blocked === 'waiting' ? 'waiting · 自动重试' : 'halted · 需人工处理'
    }
    return '条件 ' + ledState(s).filter(Boolean).length + '/6 已满足'
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

  function dotMarkup(kind, n) {
    var out = ''
    for (var i = 0; i < n; i++) {
      var p = seedFor(kind, i)
      out += '<i class="dsp-rdot dsp-rdot-' + kind + '" style="left:calc(50% + ' +
        p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
    }
    return out
  }

  function dots(s) {
    return dotMarkup('job', Math.min(s.jobs || 0, 9)) + dotMarkup('run', Math.min(s.agent || 0, 9))
  }

  // Add or remove only the difference; the surviving nodes keep their identity.
  function syncDots(wrap, s) {
    var wanted = { job: Math.min(s.jobs || 0, 9), run: Math.min(s.agent || 0, 9) }
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
      '<div class="dsp-chead"><i class="dsp-live"></i><span class="dsp-ctitle">任务完成后关机</span>' +
      '<span class="dsp-tag">' + tagOf(s) + '</span>' + CHEV + '</div>' +
      bodyHtml(s) +
      '<div class="dsp-cbtns">' + buttonOf(s) + '</div>' +
      '<div class="dsp-hazard"></div></div>'
  }

  function tagOf(s) {
    var v = s.view
    return v === 'blocked' ? (s.blocked === 'waiting' ? 'RETRY' : 'PAUSED') : TAG[v]
  }

  function buttonOf(s) {
    var v = s.view
    var hint = s.btnHint ? ' dsp-btn-hint' : ''
    if (v === 'off') return '<button class="dsp-btn dsp-btn-primary' + hint + '" data-act="arm">武装</button>'
    if (v === 'fire') return '<button class="dsp-btn dsp-btn-danger" data-act="cancel">取消关机</button>'
    if (v === 'blocked') {
      return '<button class="dsp-btn" data-act="' + (s.blocked === 'halted' ? 'retry' : 'disarm') + '">' +
        (s.blocked === 'halted' ? '解除并重试' : '解除') + '</button>'
    }
    return '<button class="dsp-btn dsp-btn-danger" data-act="disarm">解除</button>'
  }

  // ---------------------------------------------------------------- state
  // phase walks the story the demo is telling:
  //   idle → ready → detect → countdown → fired
  //                     ↘ blocked → (retry) → detect
  var COUNTDOWN = 12      // seconds; the real plugin defaults to 60
  var TICK_MS = 1100      // how fast jobs/sessions drain
  var BLOCK_ODDS = 0.06   // per tick, only while detecting

  var state = { variant: 'A', view: 'off', blocked: null, jobs: 0, agent: 0, sec: 0, phase: 'idle', btnHint: false }
  var showVariant = 'A'
  var ticker = null
  var counter = null
  var retrier = null

  var LABEL = {
    off: '未开启', armed: '待命', hold: '等待后台任务', fire: '倒计时', fired: '已下发',
  }

  function describe(s) {
    if (s.view === 'blocked') return s.blocked === 'halted' ? '阻断 · 需人工处理' : '阻断 · 等待自动恢复'
    if (s.view === 'hold') {
      var bits = []
      if (s.jobs) bits.push('后台任务 ' + s.jobs)
      if (s.agent) bits.push('会话 ' + s.agent)
      return '等待后台任务（' + bits.join(' · ') + '）'
    }
    if (s.view === 'fire') return '倒计时 ' + clock(s.sec)
    return LABEL[s.view]
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
    var cardEl = slot.querySelector('.dsp-card')
    if (!cardEl) {
      slot.innerHTML = card(state)
      return
    }

    var v = state.view
    cardEl.setAttribute('data-state', v)
    cardEl.setAttribute('data-variant', state.variant || 'A')
    cardEl.setAttribute('data-retry', (v === 'blocked' && state.blocked === 'waiting') ? '1' : '0')

    var tagEl = cardEl.querySelector('.dsp-tag')
    var nextTag = tagOf(state)
    if (tagEl && tagEl.textContent !== nextTag) tagEl.textContent = nextTag

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

    nowEl.className = 'now ' + tone(state)
    nowEl.innerHTML = '当前 <b>' + esc(describe(state)) + '</b>'
    if (hintEl) {
      // the nudge appears only while the card is waiting for the 武装 click
      hintEl.hidden = state.phase !== 'ready'
    }
    if (stopEl) {
      // nothing to stop while idle or already fired
      var idle = state.phase === 'idle' || state.phase === 'ready' || state.phase === 'fired'
      stopEl.disabled = idle
      stopEl.textContent = state.phase === 'fired' ? '已下发，无需解除' : '解除'
    }
  }

  function stamp() {
    var d = new Date()
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  }

  function log(text, kind) {
    var empty = logEl.querySelector('.empty')
    if (empty) empty.parentNode.removeChild(empty)
    var li = document.createElement('li')
    li.innerHTML = '<span class="t">' + stamp() + '</span><span class="k ' + (kind || '') +
      '"></span><span>' + esc(text) + '</span>'
    // newest at the bottom, and the window follows it
    logEl.appendChild(li)
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild)
    logEl.scrollTop = logEl.scrollHeight
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
    state.jobs = 2 + rnd(7)          // 2..8 background jobs
    state.agent = 1 + rnd(6)         // 1..6 running sessions
    state.view = 'off'
    state.blocked = null
    state.sec = 0
    state.phase = 'ready'
    state.btnHint = true
    paint()
    log('随机成功：' + state.jobs + ' 个后台任务、' + state.agent + ' 个会话在跑', 'armed')
    log('点卡片上的「武装」开始检测', 'armed')
  }

  function arm() {
    if (state.phase !== 'ready' && state.phase !== 'idle') return
    state.phase = 'detect'
    state.btnHint = false
    sync()
    log('已武装，开始检测：等所有任务结束再关机', 'armed')
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
        log('一个后台任务结束，还剩 ' + state.jobs + ' 个', 'wait')
      } else {
        state.agent -= 1
        log('一个会话结束，还剩 ' + state.agent + ' 个', 'wait')
      }
    } else if (state.jobs > 0) {
      state.jobs -= 1
      log('一个后台任务结束，还剩 ' + state.jobs + ' 个', 'wait')
    } else if (state.agent > 0) {
      state.agent -= 1
      log('一个会话结束，还剩 ' + state.agent + ' 个', 'wait')
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
    log('全部任务已结束，开始倒计时 ' + COUNTDOWN + ' 秒', 'fire')
    counter = setInterval(function () {
      state.sec -= 1
      if (state.sec <= 0) {
        if (counter) { clearInterval(counter); counter = null }
        state.phase = 'fired'
        state.view = 'fired'
        state.sec = 0
        paint()
        log('倒计时结束，关机指令已下发', 'fire')
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
      log('阻断：账户额度不足，需人工处理后点「解除并重试」', 'halted')
      return
    }
    log('阻断：请求过于频繁，4 秒后自动重试', 'wait')
    retrier = setTimeout(function () {
      retrier = null
      state.phase = 'detect'
      state.blocked = null
      sync()
      paint()
      log('自动重试：继续检测', 'wait')
      startDetect()
    }, 4000)
  }

  function cancelCountdown() {
    if (state.phase !== 'countdown') return
    if (counter) { clearInterval(counter); counter = null }
    state.sec = 0
    log('已取消本次倒计时，模式仍保持武装', 'armed')
    if (state.jobs === 0 && state.agent === 0) {
      // Nothing left to wait for. Resting armed with an empty queue is a valid
      // state — and re-arming the countdown here would fire again in 12s, which
      // is exactly what the user just cancelled. Park instead.
      state.phase = 'parked'
      state.view = 'armed'
      paint()
      log('队列已空，停在待命；点「解除」退出，或重新随机一轮', 'armed')
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
    log('已解除，停止检测', 'armed')
  }

  function retryHalted() {
    if (state.phase !== 'blocked') return
    state.blocked = null
    state.phase = 'detect'
    sync()
    paint()
    log('已解除阻断，继续检测', 'armed')
    if (state.jobs === 0 && state.agent === 0) beginCountdown()
    else startDetect()
  }

  // ---------------------------------------------------------------- card clicks
  function onCardClick(e) {
    var b = e.target.closest('[data-act]')
    if (!b) return
    var act = b.getAttribute('data-act')
    if (act === 'arm') {
      if (state.phase === 'idle') log('先点「随机一个场景」', 'armed')
      else arm()
    } else if (act === 'cancel') cancelCountdown()
    else if (act === 'retry') retryHalted()
    else if (act === 'disarm') disarm()
  }

  // ---------------------------------------------------------------- showcase
  // The 三种外观 and 六种状态 blocks render the same markup as the card, so what
  // you see there is what the plugin ships.
  var SHOW_STATES = [
    ['off', '未开启', '什么都没做'],
    ['armed', '待命', '已武装，等任务结束'],
    ['hold', '等待后台任务', '任务还在跑，先不关'],
    ['fire', '倒计时', '已下发，可撤销'],
    ['fired', '已下发', '指令生效，无法取消'],
    ['blocked', '阻断', '遇到必须人处理的事'],
  ]

  function showcaseSpec(view) {
    if (view === 'hold') return { view: 'hold', jobs: 2, agent: 3 }
    if (view === 'fire') return { view: 'fire', sec: 42 }
    if (view === 'blocked') return { view: 'blocked', blocked: 'halted' }
    return { view: view }
  }

  function renderVariants() {
    var host = document.getElementById('show-variants')
    if (!host) return
    host.innerHTML = ['A', 'B', 'C'].map(function (v) {
      var s = v === 'A' ? { view: 'hold', jobs: 2, agent: 3 }
        : v === 'B' ? { view: 'armed' }
          : { view: 'armed', jobs: 2, agent: 3 }
      s.variant = v
      return '<div class="cell">' + card(s) + '<span class="cell-cap"><b>' + v + ' · ' +
        (v === 'A' ? '警戒带' : v === 'B' ? '雷达' : '终端') + '</b>' +
        (v === 'A' ? '大字状态 + 底部红黄斜纹' : v === 'B' ? '同心圆 + 扫描光束' : '命令行摘要 + 六段指示灯') +
        '</span></div>'
    }).join('')
  }

  function renderStates() {
    var host = document.getElementById('show-states')
    if (!host) return
    host.innerHTML = SHOW_STATES.map(function (row) {
      var s = showcaseSpec(row[0])
      s.variant = showVariant
      return '<div class="cell">' + card(s) + '<span class="cell-cap"><b>' + row[1] + '</b>' + row[2] + '</span></div>'
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
    log('切换外观：' + v, 'armed')
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

    renderVariants()
    renderStates()

    state = { variant: 'A', view: 'off', blocked: null, jobs: 0, agent: 0, sec: 0, phase: 'idle', btnHint: false }
    paint()
    log('点「随机一个场景」开始', 'armed')

    // #try opens the playground directly — that is the link the README points at.
    if (location.hash === '#try') setPane('try')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
