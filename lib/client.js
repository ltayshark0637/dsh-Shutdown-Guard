/* dsh-shutdown-panel — client half (prebuilt bundle, no build step).
 *
 * Contributes one row to `sidebar.footer.action` and one panel to
 * `shell.overlay`. The row opens the panel; the panel drives the host half
 * through /api/dsh-shutdown-panel/{state,arm,disarm,cancel}.
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
      var open = false
      var listeners = new Set()
      var pollTimer = null
      var inflight = false

      function emit() {
        listeners.forEach(function (fn) {
          try { fn() } catch (e) { /* ignore */ }
        })
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
            if (body && typeof body === 'object') {
              setSnapshot({
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
              })
            }
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
            if (body && typeof body === 'object') {
              setSnapshot({
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
              })
            }
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

      // panel open state, also a tiny external store
      var openListeners = new Set()
      function subscribeOpen(fn) {
        openListeners.add(fn)
        return function () { openListeners.delete(fn) }
      }
      function getOpen() { return open }
      function setOpen(next) {
        var value = !!next
        if (value === open) return
        open = value
        openListeners.forEach(function (fn) { try { fn() } catch (e) { /* ignore */ } })
      }

      // ---------------- derived helpers ----------------

      function remainingSec(snap) {
        if (snap.state !== 'countdown' || !snap.deadline) return 0
        return Math.max(0, Math.ceil((snap.deadline - Date.now()) / 1000))
      }

      function statusText(snap) {
        if (snap.state === 'countdown') return '倒计时 ' + remainingSec(snap) + 's'
        if (snap.state === 'fired') return '已触发'
        if (snap.armed && snap.jobsRunning > 0) return '等后台任务'
        if (snap.armed) return '已武装'
        if (snap.lastSkip && Date.now() - snap.lastSkip.at < 60000) return '已跳过'
        return '未开启'
      }

      function statusTone(snap) {
        if (snap.state === 'countdown' || snap.state === 'fired') return 'danger'
        if (snap.armed) return 'accent'
        return 'muted'
      }

      // ---------------- components ----------------

      function PowerIcon(props) {
        var size = props.size || 16
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: props.color || 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: '0 0 auto' },
        },
        h('path', { key: 'p1', d: 'M12 3v8' }),
        h('path', { key: 'p2', d: 'M7.5 5.2a8 8 0 1 0 9 0' }))
      }

      function FooterRow(props) {
        var snap = React.useSyncExternalStore(subscribe, getSnapshot)
        var wide = !!props.wide
        var label = '任务完成后关机'
        var status = statusText(snap)
        var tone = statusTone(snap)
        var color = tone === 'danger' ? 'var(--dsw-alias-state-error-primary, #ff6b6b)'
          : tone === 'accent' ? 'var(--dsw-alias-button-primary-fill, #6aa6ff)'
            : 'currentColor'

        if (!wide) {
          return h('button', {
            type: 'button',
            className: 'dsp-footer dsp-footer-icon',
            'aria-label': label + '：' + status,
            title: label + '：' + status,
            'aria-haspopup': 'dialog',
            'aria-expanded': getOpen(),
            onClick: function () { setOpen(!open) },
          },
          h(PowerIcon, { key: 'icon', size: 18, color: color }),
          h('span', {
            key: 'dot',
            className: 'dsp-dot dsp-dot-' + tone,
            'aria-hidden': 'true',
          }))
        }

        return h('button', {
          type: 'button',
          className: 'dsp-footer',
          'aria-label': label + '：' + status,
          title: label + '：' + status,
          'aria-haspopup': 'dialog',
          'aria-expanded': getOpen(),
          onClick: function () { setOpen(!open) },
        },
        h(PowerIcon, { key: 'icon', size: 16, color: color }),
        h('span', { key: 'label', className: 'dsp-footer-label' }, label),
        h('span', { key: 'status', className: 'dsp-footer-status dsp-tone-' + tone }, status))
      }

      function Overlay() {
        var isOpen = React.useSyncExternalStore(subscribeOpen, getOpen)
        if (!isOpen) return null
        return h(Panel)
      }

      function Panel() {
        var snap = React.useSyncExternalStore(subscribe, getSnapshot)

        React.useEffect(function () {
          function onKey(event) {
            if (event.key === 'Escape') setOpen(false)
          }
          window.addEventListener('keydown', onKey)
          return function () { window.removeEventListener('keydown', onKey) }
        }, [])

        var state = snap.state
        var countdown = remainingSec(snap)
        var idle = Math.max(0, snap.rootsCount - snap.runningCount)
        var summary = state === 'countdown'
          ? '系统将在 ' + countdown + ' 秒后关机'
          : state === 'fired'
            ? '关机指令已生效，无法取消'
            : snap.armed
              ? snap.jobsRunning > 0
                ? '已武装：等待 ' + snap.jobsRunning + ' 个后台任务结束后关机'
                : '已武装：所有任务结束后自动关机'
              : '未开启：点击「武装」开始监听'

        return h('div', {
          className: 'dsp-backdrop',
          onMouseDown: function (event) { if (event.target === event.currentTarget) setOpen(false) },
        },
        h('div', {
          className: 'dsp-panel',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': '任务完成后关机',
          onMouseDown: function (event) { event.stopPropagation() },
        },
        h('div', { key: 'head', className: 'dsp-head' },
          h('span', { key: 't', className: 'dsp-title' }, '任务完成后关机'),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'dsp-close',
            'aria-label': '关闭',
            onClick: function () { setOpen(false) },
          }, '\u00d7')),
        h('div', { key: 'summary', className: 'dsp-summary dsp-tone-' + statusTone(snap) }, summary),
        h('div', { key: 'meta', className: 'dsp-meta' },
          h('span', null, '空闲会话 ' + idle + ' / ' + snap.rootsCount),
          h('span', null, '报错 ' + snap.erroredCount),
          h('span', null, '后台任务 ' + snap.jobsRunning),
          h('span', null, '倒计时 ' + snap.countdownSec + 's')),
        snap.lastSkip
          ? h('div', { key: 'skip', className: 'dsp-skip' }, snap.lastSkip.reason || '本批次有会话出错，已跳过')
          : null,
        h('div', { key: 'actions', className: 'dsp-actions' },
          h('button', {
            key: 'arm',
            type: 'button',
            className: 'dsp-btn dsp-btn-primary',
            disabled: snap.armed || !snap.ready,
            onClick: function () { void post('/arm') },
          }, snap.armed ? '已武装' : '武装'),
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dsp-btn',
            disabled: state !== 'countdown' && state !== 'fired',
            onClick: function () { void post('/cancel') },
          }, '取消倒计时'),
          h('button', {
            key: 'disarm',
            type: 'button',
            className: 'dsp-btn',
            disabled: !snap.armed && state === 'idle',
            onClick: function () { void post('/disarm') },
          }, '解除'))))
      }

      // ---------------- styles ----------------

      var CSS = [
        '.dsp-footer{display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;',
        'width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;gap:8px;',
        'border:none;background:transparent;color:inherit;font:inherit;line-height:22px;cursor:pointer;border-radius:8px}',
        '.dsp-footer:hover{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06))}',
        '.dsp-footer-icon{width:36px;height:36px;margin:3px 0;padding:0;justify-content:center;position:relative}',
        '.dsp-footer-label{flex:1 1 auto;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
        '.dsp-footer-status{flex:0 0 auto;font-size:11px;line-height:16px;opacity:.85;white-space:nowrap}',
        '.dsp-dot{position:absolute;right:5px;bottom:5px;width:6px;height:6px;border-radius:50%;background:transparent}',
        '.dsp-dot-accent{background:var(--dsw-alias-button-primary-fill, #6aa6ff)}',
        '.dsp-dot-danger{background:var(--dsw-alias-state-error-primary, #ff6b6b)}',
        '.dsp-dot-muted{background:var(--dsw-alias-label-secondary, rgba(128,128,128,.6))}',
        '.dsp-tone-accent{color:var(--dsw-alias-button-primary-fill, #6aa6ff)}',
        '.dsp-tone-danger{color:var(--dsw-alias-state-error-primary, #ff6b6b)}',
        '.dsp-tone-muted{color:var(--dsw-alias-label-secondary, rgba(128,128,128,.9))}',
        '.dsp-backdrop{position:fixed;inset:0;z-index:1210;display:flex;align-items:center;justify-content:flex-start;',
        'padding:0 16px 16px 16px;background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,.18))}',
        '.dsp-panel{box-sizing:border-box;width:320px;max-width:calc(100vw - 32px);margin-bottom:64px;',
        'display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:var(--dsw-radius-panel, 12px);',
        'border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.25));',
        'background:var(--dsw-alias-bg-layer-2, #1f2023);color:var(--dsw-alias-label-primary, #f4f4f5);',
        'box-shadow:var(--dsw-elevation-prominent, 0 18px 48px rgba(0,0,0,.4));font-family:var(--dsw-font-family, system-ui);font-size:13px}',
        '.dsp-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
        '.dsp-title{font-size:13px;font-weight:600;line-height:20px}',
        '.dsp-close{width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:inherit;',
        'font-size:16px;line-height:24px;cursor:pointer;opacity:.7}',
        '.dsp-close:hover{opacity:1;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.08))}',
        '.dsp-summary{font-size:12px;line-height:18px}',
        '.dsp-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;line-height:16px;',
        'color:var(--dsw-alias-label-secondary, rgba(128,128,128,.9))}',
        '.dsp-skip{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary, #ff6b6b)}',
        '.dsp-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:2px}',
        '.dsp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3));',
        'background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;height:30px;',
        'padding:0 12px;border-radius:8px;cursor:pointer}',
        '.dsp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.08))}',
        '.dsp-btn:disabled{opacity:.45;cursor:default}',
        '.dsp-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill, #6aa6ff);',
        'color:var(--dsw-alias-label-inverse, #0b0b0c)}',
        '.dsp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill, #6aa6ff);opacity:.9}',
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

        ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'shutdown-panel',
            order: 70,
            label: '任务完成后关机',
          }, function (props) { return h(FooterRow, props) })
        })

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'shutdown-panel-popover',
            order: 120,
            label: '任务完成后关机',
          }, function () { return h(Overlay) })
        })
      }

      return {
        name: 'dsh-shutdown-panel',
        apply: apply,
        inject: ['slots'],
      }
    },
  })
})()
