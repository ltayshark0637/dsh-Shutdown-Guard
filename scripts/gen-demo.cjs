// Builds docs/demo.html — the interactive demo linked from the README.
//
// Same rule as the gallery: the card CSS comes from lib/client.js, so the demo
// cannot drift from the product. The sidebar chrome comes from gen-gallery.cjs
// for the same reason.
//
// Run from the plugin root:  node scripts/gen-demo.cjs
const fs = require('node:fs')
const path = require('node:path')
const { CSS, esc, sidebar, frame, SIDEBAR_CSS } = require('./gen-gallery.cjs')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(__dirname, 'demo', p), 'utf8')

const appCss = read('app.css')
const appJs = read('app.js')

const ICON = {
  chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  board: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  plug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v6M8 9h8v4a4 4 0 0 1-8 0V9zM12 17v4"/></svg>',
  skill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3z"/></svg>',
}

// The sidebar shell: the card slot is filled by app.js after boot.
const sbShell = `<div class="sb">
  <div class="sb-top"><span>deepseek</span><span class="sb-badge">HARNESS</span></div>
  <div class="sb-row">${ICON.chat}<span>新会话</span></div>
  <div class="sb-row">${ICON.board}<span>工作台</span></div>
  <div class="sb-row">${ICON.plug}<span>插件</span></div>
  <div class="sb-row">${ICON.skill}<span>技能中心</span></div>
  <div class="sb-gap"></div>
  <div id="card-slot"></div>
  <div class="sb-gap"></div>
  <div class="sb-sess"><i></i><span class="nm">重构关机插件</span><span class="tm">1 分钟</span></div>
  <div class="sb-sess"><i></i><span class="nm">周报数据整理</span><span class="tm">14 小时</span></div>
  <div class="sb-sess"><i></i><span class="nm">iOS 构建脚本</span><span class="tm">昨天</span></div>
</div>`

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-shutdown-guard · 交互演示</title>
<style>
${appCss}
</style>
<style>
${SIDEBAR_CSS}
/* the demo needs the sidebar a little wider than a screenshot frame */
.sb { width: 264px }
</style>
<style>
${CSS}
</style>
</head><body>
<div class="app">

  <div>
    <div class="stage">${sbShell}</div>
    <p class="stage-note">
      <b>左侧是真实位置</b>：卡片在「技能中心」下方、会话列表上方。<br>
      这里的按钮只是样子，真正的交互在右边。
    </p>
  </div>

  <div class="panel">
    <h1 class="title">任务完成后关机</h1>
    <p class="subtitle">点「随机一个状态」看看它在不同情况下长什么样。数据是这一次随机出来的，刷新就变。</p>

    <div class="group">
      <div class="glabel">外观</div>
      <div class="seg" id="variants">
        <button data-v="A" class="on">A · 警戒带</button>
        <button data-v="B">B · 雷达</button>
        <button data-v="C">C · 终端</button>
      </div>
    </div>

    <div class="group">
      <div class="glabel">状态</div>
      <button class="random" id="roll">随机一个状态</button>
      <div class="now" id="now">正在模拟 <b>等待后台任务</b></div>
    </div>

    <div class="group">
      <div class="glabel">运行日志</div>
      <ul class="log" id="log"><li class="empty">还没有记录</li></ul>
    </div>
  </div>

</div>
<script>
${appJs}
</script>
</body></html>
`

const out = path.join(root, 'docs', 'demo.html')
fs.writeFileSync(out, html)
console.log('wrote', path.relative(root, out), `(${(html.length / 1024).toFixed(1)} KB)`)
