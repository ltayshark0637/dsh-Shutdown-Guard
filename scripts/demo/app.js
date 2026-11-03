// Interactive demo for the sidebar card.
// Everything here mirrors lib/client.js: same class names, same markup shape,
// same state names. Only the data source differs — this one is a dice roll.
;(function () {
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
    waiting: ['等待恢复', '请求过于频繁，30 秒后自动重试'],
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n) }
  function clock(sec) { return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60) }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  }

  // ---------------------------------------------------------------- body
  function bodyHtml(s) {
    var v = s.view
    var jobs = s.jobs
    var agent = s.agent

    if (s.variant === 'B') {
      var hud
      if (v === 'blocked') {
        hud = '<b>' + (s.blocked === 'waiting' ? 'Retrying' : 'Paused') + '</b><span>' +
          (s.blocked === 'waiting' ? '30 秒后重试' : '需人工处理') + '</span>'
      } else if (v === 'hold') {
        hud = '<b>Holding</b><span>jobs ' + jobs + ' · agent ' + agent + '</span>'
      } else if (v === 'fire') {
        hud = '<b>' + clock(s.sec) + '</b><span>T-minus</span>'
      } else if (v === 'fired') {
        hud = '<b>Fired</b><span>已下发</span>'
      } else if (v === 'off') {
        hud = '<b>Offline</b><span>jobs 0 · agent 0</span>'
      } else {
        hud = '<b>Standby</b><span>jobs 0 · agent 0</span>'
      }
      return '<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">' +
        '<div class="dsp-sweep"></div>' +
        '<div class="dsp-rings"><svg class="dsp-radar-svg" viewBox="0 0 238 202">' + RINGS + '</svg></div>' +
        '<div class="dsp-ping"></div>' +
        '<div class="dsp-dots">' + dots(s) + '</div>' +
        '<div class="dsp-hud">' + hud + '</div></div></div>'
    }

    if (s.variant === 'C') {
      var l2 = 'jobs ' + jobs + ' · agent ' + agent
      var l3 = v === 'fire' ? 'T-minus ' + clock(s.sec)
        : v === 'hold' ? 'holding'
          : v === 'off' ? 'offline'
            : v === 'blocked' ? (s.blocked === 'waiting' ? 'retrying' : 'halted')
              : v === 'fired' ? 'done' : 'waiting'
      var lines =
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2">' + l2 + '</span></div>' +
        '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3">' + l3 + '</span><i class="dsp-caret"></i></div>'
      var ledState = [v !== 'off', true, agent === 0, jobs === 0, v !== 'blocked', v === 'fire']
      var led = ''
      for (var i = 0; i < 6; i++) {
        led += '<i class="dsp-led-seg' + (ledState[i] ? ' on' : '') + '" data-i="' + i + '"></i>'
      }
      var code = v === 'blocked'
        ? (s.blocked === 'waiting' ? 'waiting · 自动重试' : 'halted · 需人工处理')
        : '条件 ' + ledState.filter(Boolean).length + '/6 已满足'
      return '<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">' + lines + '</div>' +
        '<div class="dsp-led">' + led + '</div><div class="dsp-code">' + code + '</div></div>'
    }

    var text
    if (v === 'blocked') text = BLOCK_TEXT[s.blocked]
    else if (v === 'fire') text = [clock(s.sec), '系统即将关机 · 可撤销']
    else if (v === 'hold') {
      var bits = []
      if (jobs) bits.push(jobs + ' 个后台任务')
      if (agent) bits.push(agent + ' 个会话')
      text = ['等待后台任务', bits.join(' · ') + '，完成后关机']
    } else text = A_TEXT[v]

    return '<div class="dsp-cbody dsp-v-a"><div class="dsp-big">' + esc(text[0]) +
      '</div><div class="dsp-meta">' + esc(text[1]) + '</div></div>'
  }

  // Radar dots: one per running session and per background job, spread over
  // three bands so a few dots do not pile up in the middle.
  function dots(s) {
    var out = ''
    var total = Math.min(s.jobs, 9)
    var runs = Math.min(s.agent, 9)
    var i
    for (i = 0; i < total; i++) {
      var a = (i / Math.max(total, 1)) * Math.PI * 2 + 0.6
      var r = 18 + ((i * 7) % 22)
      out += '<i class="dsp-rdot dsp-rdot-job" style="left:calc(50% + ' + (Math.cos(a) * r).toFixed(1) +
        'px);top:calc(50% + ' + (Math.sin(a) * r * 0.62).toFixed(1) + 'px)"></i>'
    }
    for (i = 0; i < runs; i++) {
      var b = (i / Math.max(runs, 1)) * Math.PI * 2 + 2.1
      var r2 = 26 + ((i * 11) % 26)
      out += '<i class="dsp-rdot dsp-rdot-run" style="left:calc(50% + ' + (Math.cos(b) * r2).toFixed(1) +
        'px);top:calc(50% + ' + (Math.sin(b) * r2 * 0.62).toFixed(1) + 'px)"></i>'
    }
    return out
  }

  // ---------------------------------------------------------------- card
  function card(s) {
    var v = s.view
    var tag = v === 'blocked' ? (s.blocked === 'waiting' ? 'RETRY' : 'PAUSED') : TAG[v]
    var btn
    if (v === 'off') btn = '<button class="dsp-btn dsp-btn-primary">武装</button>'
    else if (v === 'fire') btn = '<button class="dsp-btn dsp-btn-danger">取消关机</button>'
    else if (v === 'blocked') {
      btn = '<button class="dsp-btn">' + (s.blocked === 'halted' ? '解除并重试' : '解除') + '</button>'
    } else btn = '<button class="dsp-btn dsp-btn-danger">解除</button>'

    return '<div class="dsp-card" data-state="' + v + '" data-variant="' + s.variant +
      '" data-lum="dark" data-retry="' + ((v === 'blocked' && s.blocked === 'waiting') ? '1' : '0') + '">' +
      '<div class="dsp-chead"><i class="dsp-live"></i><span class="dsp-ctitle">任务完成后关机</span>' +
      '<span class="dsp-tag">' + tag + '</span>' + CHEV + '</div>' +
      bodyHtml(s) +
      '<div class="dsp-cbtns">' + btn + '</div>' +
      '<div class="dsp-hazard"></div></div>'
  }

  // ---------------------------------------------------------------- state
  var state = { variant: 'A', view: 'armed', blocked: null, jobs: 0, agent: 0, sec: 42 }
  var timer = null

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

  var slot, nowEl, logEl

  function paint() {
    slot.innerHTML = card(state)
    nowEl.className = 'now ' + tone(state)
    nowEl.innerHTML = '正在模拟 <b>' + esc(describe(state)) + '</b>'
  }

  function stamp() {
    var d = new Date()
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  }

  var KINDS = ['armed', 'fire', 'wait', 'halted']

  function log(text, kind) {
    var empty = logEl.querySelector('.empty')
    if (empty) empty.parentNode.removeChild(empty)
    var li = document.createElement('li')
    li.innerHTML = '<span class="t">' + stamp() + '</span><span class="k ' + (kind || '') +
      '"></span><span>' + esc(text) + '</span>'
    logEl.insertBefore(li, logEl.firstChild)
    while (logEl.children.length > 7) logEl.removeChild(logEl.lastChild)
  }

  // ---------------------------------------------------------------- dice
  function rnd(n) { return Math.floor(Math.random() * n) }

  function roll() {
    var s = { variant: state.variant, jobs: rnd(10), agent: rnd(10), sec: 5 + rnd(56) }

    if (Math.random() < 0.3) {
      s.view = 'blocked'
      s.blocked = Math.random() < 0.5 ? 'halted' : 'waiting'
      s.jobs = 0
      s.agent = 0
      return s
    }

    s.blocked = null
    var pick = Math.random()
    if (pick < 0.18) {
      s.view = 'off'
      s.jobs = 0
      s.agent = 0
    } else if (pick < 0.82) {
      // armed or holding, decided by whether anything is still running
      s.view = (s.jobs > 0 || s.agent > 0) ? 'hold' : 'armed'
    } else if (pick < 0.92) {
      s.view = 'fire'
      // the countdown only starts once nothing is left running
      s.jobs = 0
      s.agent = 0
    } else {
      s.view = 'fired'
      s.jobs = 0
      s.agent = 0
    }
    return s
  }

  function applyRoll() {
    if (timer) { clearInterval(timer); timer = null }
    state = roll()
    paint()
    log('抽取结果：' + describe(state), state.view === 'blocked' ? 'halted'
      : state.view === 'fire' ? 'fire'
        : state.view === 'hold' ? 'wait'
          : state.view === 'armed' ? 'armed' : '')

    if (state.view === 'fire') {
      timer = setInterval(function () {
        state.sec -= 1
        if (state.sec <= 0) {
          clearInterval(timer); timer = null
          state.view = 'fired'
          paint()
          log('倒计时结束，关机指令已下发')
          return
        }
        paint()
      }, 1000)
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
    if (name === 'try') paint()
    if (history.replaceState) {
      history.replaceState(null, '', name === 'try' ? '#try' : '#about')
    }
  }

  // ---------------------------------------------------------------- boot
  function start() {
    slot = document.getElementById('card-slot')
    nowEl = document.getElementById('now')
    logEl = document.getElementById('log')

    var wrap = document.getElementById('variants')
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button')
      if (b) setVariant(b.getAttribute('data-v'))
    })
    document.getElementById('roll').addEventListener('click', applyRoll)

    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab')
      if (b) setPane(b.getAttribute('data-pane'))
    })

    state = { variant: 'A', view: 'hold', blocked: null, jobs: 2, agent: 3, sec: 42 }
    paint()
    log('演示已就绪，点「随机一个状态」开始', 'armed')

    // #try opens the playground directly — that is the link the README points at.
    if (location.hash === '#try') setPane('try')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
