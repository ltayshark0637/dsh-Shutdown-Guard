/* dsh-shutdown-panel — client half (prebuilt bundle, no build step).
 *
 * v1.0: contributes one card to `sidebar.workspaces` (above the session list)
 * plus one section to `settings.section` for appearance. The card drives the
 * host half through /api/dsh-shutdown-panel/{state,arm,disarm,cancel}.
 */
;(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-shutdown-panel',
    factory: function (require) {
      var React = require('react')
      if (!React || !React.createElement) return { name: 'dsh-shutdown-panel', apply: function () {}, inject: [] }

      var BASE = '/api/dsh-shutdown-panel'
      var POLL_MS = 1000
      var h = React.createElement
      var VARIANTS = ['A', 'B', 'C']
      var VAR_KEY = 'dsh-shutdown-panel.variant'
      var FOLD_KEY = 'dsh-shutdown-panel.folded'

      // ---------------- store ----------------

      var snapshot = {
        ready: false,
        armed: false,
        state: 'idle',
        deadline: 0,
        countdownSec: 60,
        erroredCount: 0,
        lastSkip: null,
        runningCount: 0,
        rootsCount: 0,
        jobsRunning: 0,
        jobsTotal: 0,
      }
      var listeners = new Set()
      var pollTimer = null
      var inflight = false
      var ui = { variant: 'A', folded: false }
      var uiListeners = new Set()

      function readStored() {
        try {
          var v = localStorage.getItem(VAR_KEY)
          if (VARIANTS.indexOf(v) >= 0) ui.variant = v
          ui.folded = localStorage.getItem(FOLD_KEY) === '1'
        } catch (e) { /* ignore */ }
      }
      readStored()

      function emitUi() {
        uiListeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }
      function subscribeUi(fn) {
        uiListeners.add(fn)
        return function () { uiListeners.delete(fn) }
      }
      function getUi() { return ui }
      function setVariant(v) {
        if (VARIANTS.indexOf(v) < 0 || ui.variant === v) return
        ui.variant = v
        try { localStorage.setItem(VAR_KEY, v) } catch (e) { /* ignore */ }
        emitUi()
      }
      function setFolded(next) {
        var v = !!next
        if (ui.folded === v) return
        ui.folded = v
        try { localStorage.setItem(FOLD_KEY, v ? '1' : '0') } catch (e) { /* ignore */ }
        emitUi()
      }

      function emit() {
        listeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }

      function subscribe(fn) {
        listeners.add(fn)
        ensurePolling()
        return function () {
          listeners.delete(fn)
          if (listeners.size === 0) stopPolling()
        }
      }

      function getSnapshot() { return snapshot }

      function normalize(body) {
        return {
          ready: true,
          armed: body.armed === true,
          state: typeof body.state === 'string' ? body.state : 'idle',
          deadline: Number(body.deadline) || 0,
          countdownSec: Number(body.countdownSec) || 60,
          erroredCount: Number(body.erroredCount) || 0,
          lastSkip: body.lastSkip || null,
          runningCount: Number(body.runningCount) || 0,
          rootsCount: Number(body.rootsCount) || 0,
          jobsRunning: Number(body.jobsRunning) || 0,
          jobsTotal: Number(body.jobsTotal) || 0,
        }
      }

      function setSnapshot(next) {
        snapshot = next
        emit()
      }

      function refresh() {
        if (inflight) return Promise.resolve(snapshot)
        inflight = true
        return fetch(BASE + '/state', { cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (body) {
            if (body && typeof body === 'object') setSnapshot(normalize(body))
            return snapshot
          })
          .catch(function () { return snapshot })
          .then(function (value) {
            inflight = false
            return value
          })
      }

      function post(path) {
        return fetch(BASE + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          cache: 'no-store',
        })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (body) {
            if (body && typeof body === 'object') setSnapshot(normalize(body))
            return refresh()
          })
          .catch(function () { return refresh() })
      }

      function ensurePolling() {
        if (pollTimer !== null) return
        refresh()
        pollTimer = setInterval(refresh, POLL_MS)
      }

      function stopPolling() {
        if (pollTimer === null) return
        clearInterval(pollTimer)
        pollTimer = null
      }

      // ---------------- derived ----------------

      function remainingSec(snap) {
        if (snap.state !== 'countdown' || !snap.deadline) return 0
        return Math.max(0, Math.ceil((snap.deadline - Date.now()) / 1000))
      }

      function viewOf(snap) {
        if (!snap.armed) return 'off'
        if (snap.state === 'fired') return 'fired'
        if (snap.state === 'countdown') return 'fire'
        if (snap.jobsRunning > 0 || snap.runningCount > 0) return 'hold'
        return 'armed'
      }

      function fmt2(n) { return n > 99 ? '99+' : String(n) }
      function mmss(sec) {
        var m = Math.floor(sec / 60)
        var s = Math.max(0, sec % 60)
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
      }

      function metaText(snap, view) {
        if (view === 'fire') return '系统关机指令已下发'
        if (view === 'fired') return '指令已生效，无法取消'
        if (view === 'hold') {
          var parts = []
          if (snap.jobsRunning > 0) parts.push(fmt2(snap.jobsRunning) + ' 个后台任务')
          if (snap.runningCount > 0) parts.push(fmt2(snap.runningCount) + ' 个会话')
          return parts.join(' · ') + '，完成后关机'
        }
        if (view === 'armed') return '所有任务已结束 · 等待下一次触发'
        return '仅在点击「武装」后才会运行程序'
      }

      function bigText(snap, view) {
        if (view === 'fire') return mmss(remainingSec(snap))
        if (view === 'fired') return '已关机'
        if (view === 'hold') return '等待后台任务'
        if (view === 'armed') return '待命'
        return '未开启'
      }

      var TAG = { off: 'OFF', armed: 'ARMED', hold: 'WAIT', fire: 'FIRE', fired: 'DONE' }

      // ---------------- radar dots (stable, incremental) ----------------

      var dotStore = { run: [], job: [] }
      var dotCounts = { run: 0, job: 0 }

      function sampleDot(taken) {
        var W = 226, H = 88, R = 23, R5 = 71
        for (var guard = 0; guard < 4000; guard++) {
          var x = (Math.random() - .5) * (W - 30)
          var y = (Math.random() - .5) * (H - 22)
          var r = Math.sqrt(x * x + y * y)
          if (r < R && Math.random() > 0.05) continue
          if (r > R5 && Math.random() > 1 / 80) continue
          var px = x + W / 2, py = y + H / 2
          if (px < W * 0.78 && py > H * 0.70) continue
          if (r > 112) continue
          var hit = false
          for (var i = 0; i < taken.length; i++) {
            var dx = taken[i].x - x, dy = taken[i].y - y
            if (Math.sqrt(dx * dx + dy * dy) < 8) { hit = true; break }
          }
          if (hit) continue
          return { x: x, y: y }
        }
        return null
      }

      function syncDots(kind, n) {
        var arr = dotStore[kind]
        var cap = Math.min(n, 40)
        while (arr.length > cap) arr.pop()
        while (arr.length < cap) {
          var p = sampleDot(dotStore.run.concat(dotStore.job))
          if (!p) break
          arr.push(p)
        }
        dotCounts[kind] = n
      }

      function RadarDots(props) {
        syncDots('run', Math.min(props.running, 40))
        syncDots('job', Math.min(props.jobs, 40))
        var nodes = []
        dotStore.run.forEach(function (p, i) {
          nodes.push(h('i', {
            key: 'r' + i,
            className: 'dsp-rdot dsp-rdot-run',
            style: { left: 'calc(50% + ' + p.x.toFixed(1) + 'px)', top: 'calc(50% + ' + p.y.toFixed(1) + 'px)' },
          }))
        })
        dotStore.job.forEach(function (p, i) {
          nodes.push(h('i', {
            key: 'j' + i,
            className: 'dsp-rdot dsp-rdot-job',
            style: { left: 'calc(50% + ' + p.x.toFixed(1) + 'px)', top: 'calc(50% + ' + p.y.toFixed(1) + 'px)' },
          }))
        })
        return h('div', { key: 'dots', className: 'dsp-dots' }, nodes)
      }

      // ---------------- card ----------------

      function Card() {
        var snap = React.useSyncExternalStore(subscribe, getSnapshot)
        var uiState = React.useSyncExternalStore(subscribeUi, getUi)
        var view = viewOf(snap)
        var variant = uiState.variant
        var folded = uiState.folded
        var sec = remainingSec(snap)

        function act(path) { void post(path) }

        var action
        if (view === 'off') action = h('button', { key: 'a', type: 'button', className: 'dsp-btn dsp-btn-primary', onClick: function () { act('/arm') } }, '武装')
        else if (view === 'fire') action = h('button', { key: 'a', type: 'button', className: 'dsp-btn dsp-btn-danger', onClick: function () { act('/cancel') } }, '取消关机')
        else if (view === 'fired') action = h('button', { key: 'a', type: 'button', className: 'dsp-btn', onClick: function () { act('/disarm') } }, '解除')
        else action = h('button', { key: 'a', type: 'button', className: 'dsp-btn dsp-btn-danger', onClick: function () { act('/disarm') } }, '解除')

        var head = h('div', {
          key: 'head',
          className: 'dsp-chead',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': !folded,
          onClick: function () { setFolded(!folded) },
          onKeyDown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFolded(!folded) }
          },
        },
        h('i', { key: 'dot', className: 'dsp-live', 'aria-hidden': 'true' }),
        h('span', { key: 't', className: 'dsp-ctitle' }, '任务完成后关机'),
        h('span', { key: 'tag', className: 'dsp-tag' }, TAG[view]),
        h('svg', {
          key: 'chev',
          className: 'dsp-chev' + (folded ? ' is-folded' : ''),
          width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': 'true',
        }, h('path', { d: 'M6 9l6 6 6-6' })))

        var body
        if (variant === 'B') {
          body = h('div', { key: 'body', className: 'dsp-cbody dsp-v-b' },
            h('div', { key: 'disc', className: 'dsp-disc' },
              h('div', { key: 'sweep', className: 'dsp-sweep' }),
              h('div', { key: 'rings', className: 'dsp-rings' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (k) {
                return h('i', { key: k, className: 'dsp-ring', style: { width: (46 + (k - 1) * 24) + 'px', height: (46 + (k - 1) * 24) + 'px', opacity: Math.max(0.14, 0.42 - (k - 1) * 0.032) } })
              })),
              h('div', { key: 'ping', className: 'dsp-ping' }),
              h(RadarDots, { key: 'dots', running: snap.runningCount, jobs: snap.jobsRunning }),
              h('div', { key: 'hud', className: 'dsp-hud' },
                h('b', null, view === 'fire' ? mmss(sec) : view === 'hold' ? 'Holding' : view === 'fired' ? 'Fired' : view === 'off' ? 'Offline' : 'Standby'),
                h('span', null, 'jobs ' + fmt2(snap.jobsRunning) + ' · agent ' + fmt2(snap.runningCount)))))
        } else if (variant === 'C') {
          var led = [view !== 'off', true, snap.runningCount === 0, snap.jobsRunning === 0, snap.erroredCount === 0, view === 'fire']
          body = h('div', { key: 'body', className: 'dsp-cbody dsp-v-c' },
            h('div', { key: 'screen', className: 'dsp-screen' },
              h('div', { key: 'l1', className: 'dsp-term-line' }, h('span', { className: 'dsp-pr' }, '>'), 'shutdown --when idle'),
              h('div', { key: 'l2', className: 'dsp-term-line' }, h('span', { className: 'dsp-pr' }, '>'), 'jobs ' + fmt2(snap.jobsRunning) + ' · agent ' + fmt2(snap.runningCount)),
              h('div', { key: 'l3', className: 'dsp-term-line' },
                h('span', { className: 'dsp-pr' }, '>'),
                view === 'fire' ? ('T-minus ' + mmss(sec)) : view === 'hold' ? 'holding' : view === 'off' ? 'offline' : view === 'fired' ? 'done' : 'waiting',
                h('i', { className: 'dsp-caret' }))),
            h('div', { key: 'led', className: 'dsp-led' }, led.map(function (on, i) {
              return h('i', { key: i, className: 'dsp-led-seg' + (on ? ' on' : '') })
            })),
            h('div', { key: 'code', className: 'dsp-code' }, '条件 ' + led.filter(Boolean).length + '/6 已满足'))
        } else {
          body = h('div', { key: 'body', className: 'dsp-cbody dsp-v-a' },
            h('div', { key: 'big', className: 'dsp-big' }, bigText(snap, view)),
            h('div', { key: 'meta', className: 'dsp-meta' }, metaText(snap, view)))
        }

        return h('div', {
          key: 'card',
          className: 'dsp-card' + (folded ? ' is-folded' : ''),
          'data-state': view,
          'data-variant': variant,
          'aria-label': '任务完成后关机：' + TAG[view],
        },
        head,
        folded ? null : body,
        folded ? null : h('div', { key: 'btns', className: 'dsp-cbtns' }, action,
          h('span', { key: 'note', className: 'dsp-note' }, view === 'fire' ? '点取消可撤销本次' : view === 'hold' ? '等任务结束' : view === 'off' ? '未运行' : '守候中')),
        folded ? null : h('div', { key: 'hazard', className: 'dsp-hazard', 'aria-hidden': 'true' }))
      }

      // ---------------- settings section ----------------

      function SettingsSection() {
        var uiState = React.useSyncExternalStore(subscribeUi, getUi)
        return h('div', { className: 'dsp-settings' },
          h('div', { key: 'row', className: 'dsp-srow' },
            h('span', null, '卡片外观'),
            h('div', { className: 'dsp-seg' }, VARIANTS.map(function (v) {
              return h('button', {
                key: v,
                type: 'button',
                className: 'dsp-segbtn' + (uiState.variant === v ? ' on' : ''),
                onClick: function () { setVariant(v) },
              }, v === 'A' ? 'A 警戒带' : v === 'B' ? 'B 雷达' : 'C 终端')
            }))),
          h('div', { key: 'fold', className: 'dsp-srow' },
            h('span', null, '默认折叠'),
            h('button', {
              type: 'button',
              className: 'dsp-switch' + (uiState.folded ? ' on' : ''),
              'aria-pressed': uiState.folded,
              onClick: function () { setFolded(!uiState.folded) },
            }, h('i', null))),
          h('div', { key: 'hint', className: 'dsp-shint' }, '折叠后只保留标题和状态，悬停或点击标题展开。三种外观只是皮相，判定逻辑完全一致。'))
      }

      // ---------------- css ----------------

      var CSS = [
        '.dsp-card{position:relative;box-sizing:border-box;margin:6px 8px 8px;padding:10px 10px 0;border-radius:12px;',
        'border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.22));',
        'background:var(--dsw-alias-bg-layer-2, #1e1e1d);color:var(--dsw-alias-label-primary, #f4f4f5);',
        'font-family:var(--dsw-font-family, system-ui);overflow:hidden;transition:height .18s ease}',
        '.dsp-card[data-state="off"]{background:color-mix(in srgb, var(--dsw-alias-label-primary, #fff) 2.5%, var(--dsw-alias-bg-layer-2, #1e1e1d))}',
        '.dsp-card[data-state="fire"]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff4d4f) 55%, transparent)}',
        '.dsp-card.is-folded{padding-bottom:10px}',
        '.dsp-chead{display:flex;align-items:center;gap:7px;height:22px;cursor:pointer;user-select:none}',
        '.dsp-live{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary, #9a9a96)}',
        '.dsp-card[data-state="armed"] .dsp-live,.dsp-card[data-state="hold"] .dsp-live{background:var(--dsw-alias-button-primary-fill, #f5a623);box-shadow:0 0 8px color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 70%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-live,.dsp-card[data-state="fired"] .dsp-live{background:var(--dsw-alias-state-error-primary, #ff4d4f);animation:dsp-pulse-red .9s infinite}',
        '.dsp-ctitle{flex:1 1 auto;min-width:0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary, #b0aea5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsp-tag{flex:0 0 auto;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9px;letter-spacing:.08em;',
        'padding:1px 5px;border-radius:5px;border:1px solid color-mix(in srgb, var(--dsw-alias-label-secondary, #b0aea5) 40%, transparent);',
        'color:var(--dsw-alias-label-secondary, #b0aea5)}',
        '.dsp-card[data-state="armed"] .dsp-tag,.dsp-card[data-state="hold"] .dsp-tag{color:var(--dsw-alias-button-primary-fill, #f5a623);border-color:color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 45%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-tag,.dsp-card[data-state="fired"] .dsp-tag{color:var(--dsw-alias-state-error-primary, #ff4d4f);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff4d4f) 45%, transparent)}',
        '.dsp-chev{flex:0 0 auto;color:var(--dsw-alias-label-secondary, #9a9a96);transition:transform .18s}',
        '.dsp-chev.is-folded{transform:rotate(-90deg)}',
        '.dsp-cbody{position:relative}',
        '.dsp-v-a{padding:6px 0 0}',
        '.dsp-big{font-family:ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;font-size:25px;line-height:1.15;font-weight:650;letter-spacing:-.5px}',
        '.dsp-card[data-state="fire"] .dsp-big{color:var(--dsw-alias-state-error-primary, #ff4d4f)}',
        '.dsp-meta{margin-top:4px;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-secondary, #b0aea5);min-height:15px}',
        '.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsw-alias-button-primary-fill, #f5a623)}',
        '.dsp-cbtns{display:flex;align-items:center;gap:8px;padding:7px 0 10px}',
        '.dsp-btn{flex:1 1 auto;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer}',
        '.dsp-btn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary, #fff) 6%, transparent)}',
        '.dsp-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill, #f5a623);color:var(--dsw-alias-label-inverse, #201500);font-weight:600}',
        '.dsp-btn-danger{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff4d4f) 40%, transparent);color:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff4d4f) 72%, var(--dsw-alias-label-primary, #fff))}',
        '.dsp-note{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary, #9a9a96)}',
        '.dsp-hazard{height:8px;margin:0 -10px;background:repeating-linear-gradient(115deg,',
        'color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 78%, transparent) 0 10px,',
        'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff4d4f) 62%, transparent) 10px 20px);',
        'background-size:34px 100%;animation:dsp-slide 1.15s linear infinite;opacity:.85}',
        '.dsp-card[data-state="hold"] .dsp-hazard{filter:saturate(.55) brightness(.85);animation-duration:2.6s}',
        '.dsp-card[data-state="fire"] .dsp-hazard{animation-duration:.42s}',
        '.dsp-card[data-state="off"] .dsp-hazard{animation:none;opacity:.24;filter:grayscale(.55)}',
        '.dsp-card[data-state="fired"] .dsp-hazard{animation:none;opacity:.3}',
        // radar
        '.dsp-v-b{display:flex;align-items:stretch;padding:6px 0 2px}',
        '.dsp-disc{position:relative;flex:1 1 auto;height:96px;border-radius:8px;overflow:hidden;background:radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 22%, transparent), transparent 62%)}',
        '.dsp-sweep{position:absolute;inset:-60%;border-radius:50%;background:conic-gradient(from 0deg, transparent 0deg, transparent 300deg, color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 26%, transparent) 338deg, color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 46%, transparent) 352deg, transparent 360deg);animation:dsp-spin 5.2s linear infinite}',
        '.dsp-ring{position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);border:1px solid color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 34%, transparent)}',
        '.dsp-ping{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--dsw-alias-button-primary-fill, #f5a623);box-shadow:0 0 10px color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 90%, transparent)}',
        '.dsp-rdot{position:absolute;width:4.5px;height:4.5px;border-radius:50%;transform:translate(-50%,-50%)}',
        '.dsp-rdot-run{background:var(--dsw-alias-label-secondary, #9a9a96)}',
        '.dsp-rdot-job{background:var(--dsw-alias-button-primary-fill, #f5a623);box-shadow:0 0 6px color-mix(in srgb, var(--dsw-alias-button-primary-fill, #f5a623) 85%, transparent)}',
        '.dsp-card[data-state="hold"] .dsp-rdot{animation:dsp-dotpulse 2.4s ease-in-out infinite}',
        '.dsp-card[data-state="fire"] .dsp-rdot{opacity:.3}',
        '.dsp-hud{position:absolute;left:8px;right:8px;bottom:4px;display:flex;align-items:baseline;gap:6px;',
        'font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;',
        'color:var(--dsw-alias-label-secondary, #b0aea5)}',
        '.dsp-hud b{font-size:9.5px;font-weight:700;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        // terminal
        '.dsp-v-c{padding:6px 0 0}',
        '.dsp-screen{border-radius:6px;padding:6px 7px;background:color-mix(in srgb, #000 78%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-label-secondary, #9a9a96) 22%, transparent);font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9.5px;line-height:1.5;color:#9ef0a8;min-height:58px}',
        '.dsp-term-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9f7d2}',
        '.dsp-pr{color:#5d8f6b;margin-right:4px}',
        '.dsp-caret{display:inline-block;width:5px;height:9px;margin-left:2px;background:#9ef0a8;animation:dsp-blink 1s steps(1) infinite;vertical-align:-1px}',
        '.dsp-card[data-state="fire"] .dsp-screen{background:#2a0d0d;border-color:rgba(255,77,79,.4);color:#ffb3b0}',
        '.dsp-card[data-state="fire"] .dsp-term-line{color:#ffd0cc}',
        '.dsp-card[data-state="fire"] .dsp-caret{background:#ff4d4f}',
        '.dsp-led{display:flex;gap:4px;margin-top:6px}',
        '.dsp-led-seg{flex:1 1 0;height:3px;border-radius:2px;background:color-mix(in srgb, var(--dsw-alias-label-secondary, #9a9a96) 22%, transparent)}',
        '.dsp-led-seg.on{background:var(--dsw-alias-button-primary-fill, #f5a623)}',
        '.dsp-card[data-state="fire"] .dsp-led-seg.on{background:var(--dsw-alias-state-error-primary, #ff4d4f)}',
        '.dsp-code{margin-top:5px;font-size:9px;color:var(--dsw-alias-label-secondary, #9a9a96)}',
        // settings
        '.dsp-settings{display:flex;flex-direction:column;gap:10px;font-size:12px;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-srow{display:flex;align-items:center;justify-content:space-between;gap:12px}',
        '.dsp-seg{display:flex;gap:4px;padding:2px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-label-primary, #fff) 5%, transparent)}',
        '.dsp-segbtn{border:none;background:transparent;color:inherit;font:inherit;font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;opacity:.7}',
        '.dsp-segbtn.on{background:var(--dsw-alias-bg-layer-2, #2a2a28);opacity:1}',
        '.dsp-switch{width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3));background:transparent;position:relative;cursor:pointer;padding:0}',
        '.dsp-switch i{position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary, #9a9a96);transition:.16s}',
        '.dsp-switch.on{background:var(--dsw-alias-button-primary-fill, #f5a623);border-color:transparent}',
        '.dsp-switch.on i{left:16px;background:var(--dsw-alias-label-inverse, #201500)}',
        '.dsp-shint{font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary, #9a9a96)}',
        // keyframes
        '@keyframes dsp-slide{to{background-position:-34px 0}}',
        '@keyframes dsp-spin{to{transform:rotate(360deg)}}',
        '@keyframes dsp-blink{50%{opacity:0}}',
        '@keyframes dsp-dotpulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '@keyframes dsp-pulse-red{0%{box-shadow:0 0 0 0 rgba(255,77,79,.7)}70%{box-shadow:0 0 0 6px rgba(255,77,79,0)}100%{box-shadow:0 0 0 0 rgba(255,77,79,0)}}',
        '@keyframes dsp-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}}',
        '.dsp-card[data-state="fire"] .dsp-big{animation:dsp-shake 1s infinite}',
      ].join('')

      function apply(ctx) {
        try {
          ctx.effect(function () {
            var style = document.createElement('style')
            style.setAttribute('data-dsh-shutdown-panel', '')
            style.textContent = CSS
            document.head.appendChild(style)
            return function () { style.remove() }
          }, 'shutdown-panel: styles')
        } catch (e) { /* ignore */ }

        ctx.slots.inject('sidebar.workspaces', function () {
          return ctx.slots.register({
            name: 'sidebar.workspaces',
            id: 'shutdown-panel-card',
            order: -100,
            label: '任务完成后关机',
          }, function () { return h(Card) })
        })

        try {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'shutdown-panel-settings',
              order: 40,
              label: '任务完成后关机',
            }, function () { return h(SettingsSection) })
          })
        } catch (e) { /* slot unavailable */ }
      }

      return {
        name: 'dsh-shutdown-panel',
        apply: apply,
        inject: ['slots'],
      }
    },
  })
})()
