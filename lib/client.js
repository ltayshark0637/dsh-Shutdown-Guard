/* dsh-shutdown-panel — client half (prebuilt bundle, no build step).
 *
 * v1.1: the card is mounted as a DOM node at the top of the sidebar's
 * workspace region (`[class*="regionArea"]`), directly under the panel rows
 * (技能中心) and above the session list. The sidebar exposes only a single
 * `sidebar.workspaces` slot, which the session browser owns, so a slot
 * registration there would shadow the session list; a detached host node
 * leaves React's tree untouched. The appearance section still uses
 * `settings.section`.
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
      var THEMES = ['auto', 'dark', 'light', 'claude']
      var VAR_KEY = 'dsh-shutdown-panel.variant'
      var FOLD_KEY = 'dsh-shutdown-panel.folded'
      var THEME_KEY = 'dsh-shutdown-panel.theme'

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
      var ui = { variant: 'A', folded: false, theme: 'auto' }
      var uiListeners = new Set()

      function readStored() {
        try {
          var v = localStorage.getItem(VAR_KEY)
          if (VARIANTS.indexOf(v) >= 0) ui.variant = v
          var t = localStorage.getItem(THEME_KEY)
          if (THEMES.indexOf(t) >= 0) ui.theme = t
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
        paint()
      }
      function setFolded(next) {
        var v = !!next
        if (ui.folded === v) return
        ui.folded = v
        try { localStorage.setItem(FOLD_KEY, v ? '1' : '0') } catch (e) { /* ignore */ }
        emitUi()
        paint()
      }
      function setTheme(t) {
        if (THEMES.indexOf(t) < 0 || ui.theme === t) return
        ui.theme = t
        try { localStorage.setItem(THEME_KEY, t) } catch (e) { /* ignore */ }
        lumAt = 0
        emitUi()
        paint()
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

      function post(path, payload) {
        return fetch(BASE + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
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
      var dotSig = ''

      function sampleDot(taken) {
        // 只在可见面板内撒点：面板 238 x 86，留 4px 边距，半径不超过第 9 环（119）
        var W = 222, H = 78, R = 23, R5 = 71
        for (var guard = 0; guard < 4000; guard++) {
          var x = (Math.random() - .5) * W
          var y = (Math.random() - .5) * H
          var r = Math.sqrt(x * x + y * y)
          if (r < R && Math.random() > 0.05) continue
          if (r > R5 && Math.random() > 1 / 80) continue
          var px = x + W / 2, py = y + H / 2
          if (px < W * 0.78 && py > H * 0.66) continue
          if (r > 108) continue
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
      }

      // ---------------- card DOM ----------------

      var host = null
      var card = null
      var builtSig = ''

      var CHEV = '<svg class="dsp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'

      function headHtml() {
        return '<div class="dsp-chead" role="button" tabindex="0">' +
          '<i class="dsp-live" aria-hidden="true"></i>' +
          '<span class="dsp-ctitle">任务完成后关机</span>' +
          '<span class="dsp-tag"></span>' + CHEV + '</div>'
      }

      function ringsHtml() {
        var out = '<svg class="dsp-radar-svg" viewBox="0 0 238 202" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
        for (var k = 0; k < 9; k++) {
          var op = Math.max(0.14, 0.42 - k * 0.032).toFixed(2)
          out += '<circle cx="119" cy="101" r="' + (23 + k * 12) + '" fill="none" stroke="var(--dsp-accent)" stroke-width="1" stroke-opacity="' + op + '"></circle>'
        }
        return out + '</svg>'
      }

      function bodyHtml(variant) {
        if (variant === 'B') {
          return '<div class="dsp-cbody dsp-v-b"><div class="dsp-disc">' +
            '<div class="dsp-sweep"></div><div class="dsp-rings">' + ringsHtml() + '</div>' +
            '<div class="dsp-ping"></div><div class="dsp-dots"></div>' +
            '<div class="dsp-hud"><b></b><span></span></div></div></div>'
        }
        if (variant === 'C') {
          return '<div class="dsp-cbody dsp-v-c"><div class="dsp-screen">' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span>shutdown --when idle</div>' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l2"></span></div>' +
            '<div class="dsp-term-line"><span class="dsp-pr">&gt;</span><span class="dsp-l3"></span><i class="dsp-caret"></i></div>' +
            '</div><div class="dsp-led">' + [0, 1, 2, 3, 4, 5].map(function (i) {
              return '<i class="dsp-led-seg" data-i="' + i + '"></i>'
            }).join('') + '</div><div class="dsp-code"></div></div>'
        }
        return '<div class="dsp-cbody dsp-v-a">' +
          '<div class="dsp-big"></div><div class="dsp-meta"></div></div>'
      }

      function buildCard() {
        card = document.createElement('div')
        card.className = 'dsp-card'
        card.setAttribute('data-variant', ui.variant)
        card.setAttribute('aria-label', '任务完成后关机')
        card.innerHTML = headHtml() +
          (ui.folded ? '' : bodyHtml(ui.variant) +
            '<div class="dsp-cbtns"><button type="button" class="dsp-btn"></button><span class="dsp-note"></span></div>' +
            '<div class="dsp-hazard" aria-hidden="true"></div>')

        var chead = card.querySelector('.dsp-chead')
        chead.addEventListener('click', function () { setFolded(!ui.folded) })
        chead.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFolded(!ui.folded) }
        })
        var btn = card.querySelector('.dsp-btn')
        if (btn) btn.addEventListener('click', function () { void post(actionPath()) })
      }

      function actionPath() {
        var view = viewOf(snapshot)
        if (view === 'off') return '/arm'
        if (view === 'fire') return '/cancel'
        return '/disarm'
      }

      function ensureHost() {
        var region = document.querySelector('[class*="regionArea"]')
        if (!region) return null
        if (host && host.isConnected) return host
        if (!host) {
          host = document.createElement('div')
          host.className = 'dsp-host'
          host.setAttribute('data-dsh-shutdown-panel', '')
        }
        if (!card) buildCard()
        host.appendChild(card)
        region.insertBefore(host, region.firstChild)
        return host
      }

      // the card carries its own palette; only the luminance of the host surface is borrowed
      var lumAt = 0
      function detectLum() {
        var probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;background:var(--dsw-alias-bg-layer-1, #000)'
        document.body.appendChild(probe)
        var raw = ''
        try { raw = getComputedStyle(probe).backgroundColor } finally { probe.remove() }
        var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw || '')
        if (!m) return 'dark'
        var l = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255
        return l > 0.55 ? 'light' : 'dark'
      }

      function paint() {
        if (!ensureHost() || !card) return
        var snap = snapshot
        var view = viewOf(snap)
        var sec = remainingSec(snap)
        var sig = [ui.variant, ui.folded, view, snap.runningCount, snap.jobsRunning].join('|')
        if (sig !== builtSig) {
          // structure depends on variant / fold; counts only affect dots and hud text
          var needRebuild = builtSig === '' || card.getAttribute('data-variant') !== ui.variant ||
            card.classList.contains('is-folded') !== ui.folded
          if (needRebuild) {
            var parent = card.parentNode
            buildCard()
            if (parent) parent.replaceChild(card, parent.firstChild)
          }
          builtSig = sig
        }

        card.setAttribute('data-state', view)
        card.classList.toggle('is-folded', ui.folded)
        card.classList.toggle('dsp-claude', ui.theme === 'claude')
        if (ui.theme === 'auto') {
          if (Date.now() - lumAt > 3000) {
            lumAt = Date.now()
            card.setAttribute('data-lum', detectLum())
          }
        } else {
          card.setAttribute('data-lum', ui.theme === 'light' ? 'light' : 'dark')
        }

        var tag = card.querySelector('.dsp-tag')
        if (tag) tag.textContent = TAG[view]
        var chev = card.querySelector('.dsp-chev')
        if (chev) chev.classList.toggle('is-folded', ui.folded)

        var btn = card.querySelector('.dsp-btn')
        if (btn) {
          var isOff = view === 'off'
          var isFire = view === 'fire'
          btn.textContent = isOff ? '武装' : isFire ? '取消关机' : '解除'
          btn.className = isOff ? 'dsp-btn dsp-btn-primary' : 'dsp-btn dsp-btn-danger'
        }
        var note = card.querySelector('.dsp-note')
        if (note) note.textContent = view === 'fire' ? '点取消可撤销本次' : view === 'hold' ? '等任务结束' : view === 'off' ? '' : '守候中'

        var big = card.querySelector('.dsp-big')
        if (big) big.textContent = bigText(snap, view)
        var meta = card.querySelector('.dsp-meta')
        if (meta) meta.textContent = metaText(snap, view)

        var hud = card.querySelector('.dsp-hud')
        if (hud) {
          hud.querySelector('b').textContent = view === 'fire' ? mmss(sec)
            : view === 'hold' ? 'Holding'
              : view === 'fired' ? 'Fired'
                : view === 'off' ? 'Offline' : 'Standby'
          hud.querySelector('span').textContent = 'jobs ' + fmt2(snap.jobsRunning) + ' · agent ' + fmt2(snap.runningCount)
        }

        var dots = card.querySelector('.dsp-dots')
        if (dots) {
          syncDots('run', snap.runningCount)
          syncDots('job', snap.jobsRunning)
          var html = ''
          dotStore.run.forEach(function (p) {
            html += '<i class="dsp-rdot dsp-rdot-run" style="left:calc(50% + ' + p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
          })
          dotStore.job.forEach(function (p) {
            html += '<i class="dsp-rdot dsp-rdot-job" style="left:calc(50% + ' + p.x.toFixed(1) + 'px);top:calc(50% + ' + p.y.toFixed(1) + 'px)"></i>'
          })
          if (dots.innerHTML !== html) dots.innerHTML = html
        }

        var l2 = card.querySelector('.dsp-l2')
        if (l2) l2.textContent = 'jobs ' + fmt2(snap.jobsRunning) + ' · agent ' + fmt2(snap.runningCount)
        var l3 = card.querySelector('.dsp-l3')
        if (l3) l3.textContent = view === 'fire' ? ('T-minus ' + mmss(sec))
          : view === 'hold' ? 'holding'
            : view === 'off' ? 'offline'
              : view === 'fired' ? 'done' : 'waiting'
        var led = [view !== 'off', true, snap.runningCount === 0, snap.jobsRunning === 0, snap.erroredCount === 0, view === 'fire']
        var segs = card.querySelectorAll('.dsp-led-seg')
        for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', !!led[i])
        var code = card.querySelector('.dsp-code')
        if (code) code.textContent = '条件 ' + led.filter(Boolean).length + '/6 已满足'
      }

      // ---------------- settings section ----------------

      function settingsRow(key, title, desc, control, extraClass) {
        return h('div', { key: key, className: 'dsp-srow' + (extraClass ? ' ' + extraClass : '') },
          h('div', { className: 'dsp-srow-text' },
            h('span', { className: 'dsp-stitle' }, title),
            desc ? h('span', { className: 'dsp-sdesc' }, desc) : null),
          control)
      }

      function settingsGroup(key, title) {
        return h('div', { key: key, className: 'dsp-sgroup' }, title)
      }

      function seg(items, current, onPick) {
        return h('div', { className: 'dsp-seg' }, items.map(function (pair) {
          return h('button', {
            key: pair[0],
            type: 'button',
            className: 'dsp-segbtn' + (current === pair[0] ? ' on' : ''),
            onClick: function () { onPick(pair[0]) },
          }, pair[1])
        }))
      }

      function SettingsSection() {
        var uiState = React.useSyncExternalStore(subscribeUi, getUi)
        var snap = React.useSyncExternalStore(subscribe, getSnapshot)
        var skip = snap.lastSkip
        var groups = []

        // 1) 外观：只影响长相，和关机逻辑无关
        var look = [settingsGroup('look-g', '外观')]
        look.push(settingsRow('look', '卡片外观', '三种外观共用同一套判定逻辑。',
          seg(VARIANTS.map(function (v) { return [v, v] }), uiState.variant, setVariant)))
        look.push(settingsRow('theme', '配色', '跟随系统时按当前主题自动取深色或浅色。',
          seg([['auto', '跟随'], ['dark', '深色'], ['light', '浅色'], ['claude', 'Claude']], uiState.theme, setTheme)))
        look.push(settingsRow('fold', '默认折叠', '折叠后只保留标题和状态。',
          h('button', {
            type: 'button',
            className: 'dsp-switch' + (uiState.folded ? ' on' : ''),
            'aria-pressed': uiState.folded,
            onClick: function () { setFolded(!uiState.folded) },
          }, h('i', null))))
        if (uiState.variant === 'C') {
          look.push(settingsRow('led', '终端里的 6 个小块', '已开启、只算成功、会话空闲、后台任务清零、没有报错、正在倒计时——亮几个就满足几条。', null, 'dsp-srow-ro'))
        }
        groups.push(h('div', { key: 'g-look', className: 'dsp-sgroup-box' }, look))

        // 2) 判定：先底线，再附加条件，最后例外
        var rules = [settingsGroup('rule-g', '什么时候才关机')]
        rules.push(settingsRow('c3', '会话都停下来', '底线条件，始终开启。',
          h('span', { className: 'dsp-sval' }, '总是开启'), 'dsp-srow-ro'))
        rules.push(settingsRow('c2', '后台任务跑完', '有后台任务在跑时，先不下发关机指令。',
          h('button', {
            type: 'button',
            className: 'dsp-switch' + (snap.blockOnJobs ? ' on' : ''),
            'aria-pressed': !!snap.blockOnJobs,
            onClick: function () { void post('/config', { blockOnJobs: !snap.blockOnJobs }) },
          }, h('i', null))))
        rules.push(settingsRow('c1', '有会话报错就跳过这一轮', '只认成功的任务，出过错的批次不关机。',
          h('button', {
            type: 'button',
            className: 'dsp-switch' + (snap.onlyOnSuccess ? ' on' : ''),
            'aria-pressed': !!snap.onlyOnSuccess,
            onClick: function () { void post('/config', { onlyOnSuccess: !snap.onlyOnSuccess }) },
          }, h('i', null))))
        groups.push(h('div', { key: 'g-rule', className: 'dsp-sgroup-box' }, rules))

        // 3) 状态：只读，解释上一次为什么没关机
        var status = [settingsGroup('st-g', '状态')]
        status.push(settingsRow('skip', '上次为什么没关机', null,
          h('span', { className: 'dsp-sval' + (skip && skip.reason ? '' : ' dsp-sval-dim') },
            skip && skip.reason ? skip.reason : '还没发生过')))
        groups.push(h('div', { key: 'g-st', className: 'dsp-sgroup-box' }, status))

        return h('div', { className: 'dsp-settings' }, groups)
      }
      // ---------------- css ----------------

      var CSS = [
        // host: matches the panel row hit area (button x=12, width=256 in a 280px sidebar)
        '.dsp-host{flex:0 0 auto;padding:0 12px 8px 0;min-width:0}',
        // own palette: the card does not follow the host theme's alias tokens
        '.dsp-card{--dsp-bg:#1c1e22;--dsp-fg:#f3f4f6;--dsp-muted:#a7abb4;--dsp-line:rgba(255,255,255,.14);',
        '--dsp-accent:#f0a83a;--dsp-danger:#ef5350;--dsp-track:rgba(255,255,255,.16);',
        '--dsp-tape-a:#f2b13c;--dsp-tape-b:#e8453c}',
        '.dsp-card.dsp-claude{--dsp-bg:#1f1d1a;--dsp-fg:#f5f1ea;--dsp-muted:#b3a99c;--dsp-line:rgba(255,255,255,.12);--dsp-accent:#d97757;--dsp-danger:#e5674f;--dsp-tape-a:#e08a5f;--dsp-tape-b:#b8483a}',
        '.dsp-card[data-lum="light"]{--dsp-bg:#ffffff;--dsp-fg:#1b2030;--dsp-muted:#5b6472;--dsp-line:rgba(0,0,0,.15);',
        '--dsp-accent:#e08f13;--dsp-danger:#d92d20;--dsp-track:rgba(0,0,0,.13);--dsp-tape-a:#f0b03a;--dsp-tape-b:#e0483c}',
        '.dsp-card{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;margin:0;padding:10px 8px 0;border-radius:12px;',
        'border:1px solid var(--dsp-line);background:var(--dsp-bg);color:var(--dsp-fg);',
        'font-family:var(--dsw-font-family, system-ui);overflow:hidden;transition:height .18s ease}',
        '.dsp-card[data-state="off"]{background:color-mix(in srgb, var(--dsp-fg) 2.5%, var(--dsp-bg))}',
        '.dsp-card[data-state="fire"]{border-color:var(--dsp-danger)}',
        '.dsp-card.is-folded{padding-top:6px;padding-bottom:6px}',
        '.dsp-chead{display:flex;align-items:center;gap:7px;height:22px;cursor:pointer;user-select:none}',
        '.dsp-live{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsp-muted)}',
        '.dsp-card[data-state="armed"] .dsp-live,.dsp-card[data-state="hold"] .dsp-live{background:var(--dsp-accent);box-shadow:0 0 8px var(--dsp-accent)}',
        '.dsp-card[data-state="fire"] .dsp-live,.dsp-card[data-state="fired"] .dsp-live{background:var(--dsp-danger);animation:dsp-pulse-red .9s infinite}',
        '.dsp-ctitle{flex:1 1 auto;min-width:0;font-size:12.5px;line-height:17px;color:var(--dsp-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsp-tag{flex:0 0 auto;font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9px;letter-spacing:.08em;',
        'padding:1px 5px;border-radius:5px;border:1px solid color-mix(in srgb, var(--dsp-muted) 40%, transparent);color:var(--dsp-muted)}',
        '.dsp-card[data-state="armed"] .dsp-tag,.dsp-card[data-state="hold"] .dsp-tag{color:var(--dsp-accent);border-color:color-mix(in srgb, var(--dsp-accent) 50%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-tag,.dsp-card[data-state="fired"] .dsp-tag{color:var(--dsp-danger);border-color:color-mix(in srgb, var(--dsp-danger) 50%, transparent)}',
        '.dsp-chev{flex:0 0 auto;color:var(--dsp-muted);transition:transform .18s}',
        '.dsp-chev.is-folded{transform:rotate(-90deg)}',
        '.dsp-cbody{position:relative;flex:1;min-height:0}',
        '.dsp-v-a{padding:6px 0 0}',
        '.dsp-big{font-family:ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;font-size:26px;line-height:1.15;font-weight:650;letter-spacing:-.5px}',
        '.dsp-card[data-state="fire"] .dsp-big{color:var(--dsp-danger)}',
        '.dsp-meta{margin-top:5px;font-size:11.5px;line-height:16px;color:var(--dsp-muted);min-height:15px}',
        '.dsp-card[data-state="hold"] .dsp-meta{color:var(--dsp-accent)}',
        '.dsp-cbtns{display:flex;align-items:center;gap:8px;padding:7px 0 10px}',
        '.dsp-btn{flex:1 1 auto;height:30px;border-radius:8px;border:1px solid var(--dsp-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}',
        '.dsp-btn:hover{background:color-mix(in srgb, var(--dsp-fg) 7%, transparent)}',
        '.dsp-btn-primary{border-color:transparent;background:var(--dsp-accent);color:#1a1200;font-weight:600}',
        '.dsp-btn-danger{border-color:color-mix(in srgb, var(--dsp-danger) 45%, transparent);color:var(--dsp-danger);background:color-mix(in srgb, var(--dsp-danger) 6%, transparent)}',
        '.dsp-note{flex:0 0 auto;font-size:10px;color:var(--dsp-muted)}',
        // caution tape: one wide strip with an intrinsic repeating gradient, translated 鈥?no tiling seams
        '.dsp-hazard{position:relative;height:10px;margin:0 -8px;overflow:hidden}',
        '.dsp-hazard::before{content:"";position:absolute;top:0;bottom:0;left:-48px;right:-48px;',
        'background:repeating-linear-gradient(45deg,var(--dsp-tape-a) 0 10px,var(--dsp-tape-b) 10px 20px);',
        'animation:dsp-slide 1.15s linear infinite}',
        '.dsp-card[data-state="hold"] .dsp-hazard::before{animation-duration:2.6s;opacity:.9}',
        '.dsp-card[data-state="fire"] .dsp-hazard::before{animation-duration:.42s}',
        '.dsp-card[data-state="off"] .dsp-hazard{opacity:.55}',
        '.dsp-card[data-state="off"] .dsp-hazard::before{animation:none}',
        '.dsp-card[data-state="fired"] .dsp-hazard{opacity:.45}',
        '.dsp-card[data-state="fired"] .dsp-hazard::before{animation:none}',
        // radar
        // B: radar scope fills the body, exactly as in preview/sidebar-live.html
        '.dsp-card[data-variant="B"]{height:178px}',
        '.dsp-v-b{display:block;height:100%;padding:6px 0 0}',
        '.dsp-disc{position:relative;height:100%;min-height:66px;border-radius:10px;border:1px solid var(--dsp-line);overflow:hidden;',
        'background:radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--dsp-accent) 9%, transparent), transparent 66%), color-mix(in srgb, var(--dsp-bg) 94%, var(--dsp-fg))}',
        '.dsp-sweep{position:absolute;left:50%;top:50%;width:320px;height:320px;margin:-160px 0 0 -160px;border-radius:50%;',
        'background:conic-gradient(from 0deg,transparent 0deg,transparent 10deg,',
        'color-mix(in srgb, var(--dsp-accent) 8%, transparent) 22deg,',
        'color-mix(in srgb, var(--dsp-accent) 20%, transparent) 38deg,',
        'color-mix(in srgb, var(--dsp-accent) 34%, transparent) 54deg,',
        'color-mix(in srgb, var(--dsp-accent) 12%, transparent) 66deg,',
        'color-mix(in srgb, var(--dsp-accent) 4%, transparent) 72deg,transparent 78deg,transparent 360deg);',
        'animation:dsp-spin 3.2s linear infinite;',
        '-webkit-mask-image:radial-gradient(circle, #000 0 44%, transparent 74%);mask-image:radial-gradient(circle, #000 0 44%, transparent 74%)}',        '.dsp-card[data-state="hold"] .dsp-sweep{animation-duration:5.6s;opacity:.62}',
        '.dsp-card[data-state="fire"] .dsp-sweep{animation-duration:1s}',
        '.dsp-rings{position:absolute;inset:0}',
        '.dsp-radar-svg{position:absolute;left:50%;top:50%;width:238px;height:202px;margin:-101px 0 0 -119px;pointer-events:none}',
        '.dsp-dots{position:absolute;inset:0}',
        '.dsp-ring{position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);border:1px solid color-mix(in srgb, var(--dsp-accent) 30%, transparent);z-index:1}',
        '.dsp-ping{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--dsp-accent);z-index:2;box-shadow:0 0 12px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}',
        '.dsp-card[data-state="fire"] .dsp-ping{background:var(--dsp-danger);box-shadow:0 0 12px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}',
        '.dsp-rdot{position:absolute;width:5px;height:5px;border-radius:50%;transform:translate(-50%,-50%);z-index:2}',
        '.dsp-rdot-run{background:var(--dsp-muted);box-shadow:0 0 6px color-mix(in srgb, var(--dsp-muted) 80%, transparent)}',
        '.dsp-rdot-job{background:var(--dsp-accent);box-shadow:0 0 8px color-mix(in srgb, var(--dsp-accent) 95%, transparent)}',
        '.dsp-card[data-state="hold"] .dsp-rdot{animation:dsp-dotpulse 2.4s ease-in-out infinite}',
        '.dsp-card[data-state="fire"] .dsp-rdot{opacity:.3}',
        '.dsp-card[data-state="fired"] .dsp-rdot{opacity:.18}',
        '.dsp-disc::after{content:"";position:absolute;left:0;right:0;bottom:0;height:42px;z-index:1;pointer-events:none;',
        'background:linear-gradient(0deg, color-mix(in srgb, var(--dsp-bg) 92%, transparent) 12%, transparent)}',
        '.dsp-hud{position:absolute;left:9px;right:9px;bottom:7px;z-index:3;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;row-gap:1px;',
        'font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;',
        'color:var(--dsp-muted);text-shadow:0 1px 8px rgba(0,0,0,.5);white-space:nowrap;line-height:1.45}',
        '.dsp-hud::before{content:"";width:4px;height:4px;border-radius:50%;background:var(--dsp-accent);flex:none;align-self:center;',
        'box-shadow:0 0 7px color-mix(in srgb, var(--dsp-accent) 90%, transparent)}',
        '.dsp-hud b{font-size:11px;letter-spacing:.1em;color:var(--dsp-fg);font-weight:600}',
        '.dsp-card[data-state="fire"] .dsp-hud b{font-size:12px;color:color-mix(in srgb, var(--dsp-danger) 55%, #fff)}',
        '.dsp-card[data-state="fire"] .dsp-hud::before{background:var(--dsp-danger);box-shadow:0 0 7px color-mix(in srgb, var(--dsp-danger) 90%, transparent)}',
        '.dsp-card[data-state="off"] .dsp-hud::before,.dsp-card[data-state="fired"] .dsp-hud::before{background:var(--dsp-muted);box-shadow:none}',
        // terminal
        '.dsp-v-c{padding:6px 0 0}',
        '.dsp-screen{border-radius:6px;padding:6px 7px;background:#0b0d10;border:1px solid rgba(255,255,255,.08);font-family:ui-monospace, "Cascadia Mono", Consolas, monospace;font-size:9.5px;line-height:1.5;color:#9ef0a8;min-height:58px}',
        '.dsp-term-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9f7d2}',
        '.dsp-pr{color:#5d8f6b;margin-right:4px}',
        '.dsp-caret{display:inline-block;width:5px;height:9px;margin-left:2px;background:#9ef0a8;animation:dsp-blink 1s steps(1) infinite;vertical-align:-1px}',
        '.dsp-card[data-state="fire"] .dsp-screen{background:#2a0d0d;border-color:rgba(255,77,79,.4);color:#ffb3b0}',
        '.dsp-card[data-state="fire"] .dsp-term-line{color:#ffd0cc}',
        '.dsp-card[data-state="fire"] .dsp-caret{background:#ff4d4f}',
        '.dsp-led{display:flex;gap:4px;margin-top:6px}',
        '.dsp-led-seg{flex:1 1 0;height:3px;border-radius:2px;background:var(--dsp-track)}',
        '.dsp-led-seg.on{background:var(--dsp-accent)}',
        '.dsp-card[data-state="fire"] .dsp-led-seg.on{background:var(--dsp-danger)}',
        '.dsp-code{margin-top:5px;font-size:9px;color:var(--dsp-muted)}',
        // settings (host theme tokens: it lives in the app settings page)
        '.dsp-settings{display:flex;flex-direction:column;padding:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary, #f4f4f5)}',
        '.dsp-srow{display:flex;align-items:center;justify-content:space-between;gap:12px 8px;padding:14px 0;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-srow:first-child{border-top:none}',
        '.dsp-srow-text{flex:1 1 140px;min-width:0;display:flex;flex-direction:column;gap:3px;padding-right:28px}',
        '.dsp-stitle{font-size:14px;line-height:22px}',
        '.dsp-sdesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sgroup-box{display:flex;flex-direction:column;padding-top:16px;margin-top:16px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))}',
        '.dsp-sgroup-box:first-child{padding-top:0;margin-top:0;border-top:none}',
        '.dsp-sgroup{font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary, #b0aea5);padding:0 0 2px}',
        '.dsp-sgroup + .dsp-srow{border-top:none}',
        '.dsp-srow{padding:12px 0}',
        '.dsp-srow-stack{align-items:flex-start;flex-direction:column;gap:6px}',
        '.dsp-srow-stack .dsp-sval{font-size:12px;line-height:18px;white-space:normal}',
        '.dsp-srow-ro .dsp-sval{max-width:58%;text-align:right;white-space:normal}',
        '.dsp-sval-dim{opacity:.55}',
        '.dsp-shead{margin:16px 0 -2px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));font-size:12px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-secondary, #b9b9b4)}',
        '.dsp-seg{display:flex;gap:4px;flex:none;flex-wrap:wrap;justify-content:flex-end}',
        '.dsp-segbtn{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));background:transparent;color:var(--dsw-alias-label-secondary, #b9b9b4);font:inherit;font-size:13px;cursor:pointer}',
        '.dsp-segbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))}',
        '.dsp-segbtn.on{background:var(--dsw-alias-button-primary-fill, #f5a623);border-color:transparent;color:var(--dsw-alias-label-inverse, #201500);font-weight:600}',
        '.dsp-switch{flex:none;width:36px;height:20px;border-radius:10px;border:0;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.3));position:relative;cursor:pointer;padding:0}',
        '.dsp-switch i{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-overlay, #fff);transition:.16s}',
        '.dsp-switch.on{background:var(--dsw-alias-brand-primary, #d97757)}',
        '.dsp-switch.on i{left:18px}',
        '.dsp-shint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        '.dsp-sval{font-size:12px;color:var(--dsw-alias-label-tertiary, #8f8d84)}',
        // keyframes
        '@keyframes dsp-slide{to{transform:translateX(-28.28px)}}',
        '@keyframes dsp-spin{to{transform:rotate(360deg)}}',
        '@keyframes dsp-blink{50%{opacity:0}}',
        '@keyframes dsp-dotpulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '@keyframes dsp-pulse-red{0%{box-shadow:0 0 0 0 rgba(239,83,80,.7)}70%{box-shadow:0 0 0 6px rgba(239,83,80,0)}100%{box-shadow:0 0 0 0 rgba(239,83,80,0)}}',
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

        try {
          ctx.effect(function () {
            var off = subscribe(paint)
            var offUi = subscribeUi(function () {
              if (card) {
                card.setAttribute('data-variant', ui.variant)
                // variant/fold change the DOM structure; rebuild on next paint
                builtSig = ''
                var parent = card.parentNode
                buildCard()
                if (parent) parent.replaceChild(card, parent.firstChild)
              }
              paint()
            })
            paint()
            var timer = setInterval(paint, POLL_MS)
            return function () {
              off()
              offUi()
              clearInterval(timer)
              stopPolling()
              if (host) host.remove()
              host = null
              card = null
              builtSig = ''
            }
          }, 'shutdown-panel: card')
        } catch (e) { /* ignore */ }

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
