// Builds docs/demo.html — the interactive playground linked from the README.
//
// Visual language matches docs/screenshots/banner.html (same wash, grid, grain,
// amber eyebrow, hazard rule) so the demo reads as the product's own page
// rather than a separate microsite.
//
// Same rule as the gallery: the card CSS comes from lib/client.js and the
// sidebar chrome from gen-gallery.cjs, so nothing here can drift from the
// product.
//
// Run from the plugin root:  node scripts/gen-demo.cjs
const fs = require('node:fs')
const path = require('node:path')
const { CSS, SIDEBAR_CSS } = require('./gen-gallery.cjs')

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

// The sidebar shell; #card-slot is filled by app.js after boot.
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
  <div class="sb-sess"><i></i><span class="nm">合同条款比对</span><span class="tm">2 天</span></div>
</div>`

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shutdown Guard · 交互演示</title>
<meta name="description" content="任务完成后自动关机 —— 侧边栏守夜卡片。三种外观、六种状态，可在这里直接试。">
<style>
${appCss}
</style>
<style>
${SIDEBAR_CSS}
/* the demo sidebar fills its frame instead of sitting at screenshot width */
.sb { width: 100% }
</style>
<style>
${CSS}
</style>
</head><body>

<div class="bg bg-wash"></div>
<div class="bg bg-lobe"></div>
<div class="bg bg-grid"></div>
<div class="bg bg-grain"></div>

<div class="page">
  <div class="eyebrow"><i></i>DeepSeek Harness Plugin</div>
  <h1>Shutdown <em>Guard</em></h1>
  <div class="zh">任务完成后自动关机<span>·</span>侧边栏守夜卡片</div>
  <p class="lede">为 DeepSeek Harness 的侧边栏添加「所有任务完成后自动关机」卡片，拥有更好且多样的<b>视觉效果</b>、<b>判定逻辑</b>与<b>个性化定制</b>。下面的卡片是真的：换外观、掷一次状态，看它怎么变。</p>
  <div class="chips">
    <span class="chip">五道判定闸</span>
    <span class="chip">三种外观</span>
    <span class="chip">个性化定制</span>
    <span class="chip">AFK 自动接管</span>
    <span class="chip">阻断态分级</span>
  </div>

  <div class="main">
    <div class="stage-col">
      <div class="stage-frame">${sbShell}</div>
      <p class="stage-note"><b>左边是它真正待的地方</b>：技能中心下方、会话列表上方。卡片上的按钮在这里只是样子，真正的交互在右边。</p>
    </div>

    <div class="panel">
      <div class="block">
        <div class="blabel">外观</div>
        <div class="seg" id="variants" role="group" aria-label="外观">
          <button data-v="A" class="on">A · 警戒带</button>
          <button data-v="B">B · 雷达</button>
          <button data-v="C">C · 终端</button>
        </div>
      </div>

      <div class="block">
        <div class="blabel">状态</div>
        <button class="roll" id="roll">随机一个状态</button>
        <div class="now" id="now" role="status" aria-live="polite">正在模拟 <b>等待后台任务</b></div>
      </div>

      <div class="block">
        <div class="blabel">运行日志</div>
        <ul class="log" id="log"><li class="empty">还没有记录</li></ul>
        <p class="hint">每次点击掷一次：三成概率落进阻断态，其余在未开启 / 待命 / 等待后台任务 / 倒计时 / 已下发之间分布，后台任务与会话数各自 0–9 随机。真实插件的这条日志在 <code>settings → 状态</code> 里。</p>
      </div>
    </div>
  </div>
</div>

<div class="rule"></div>
<div class="colophon">
  <span><b>dsh-shutdown-guard</b></span>
  <span>MIT</span>
  <span>演示页 · 数据全部本地随机，不联网</span>
  <a href="https://github.com/ltayshark0637/dsh-Shutdown-Guard">GitHub</a>
</div>

<script>
${appJs}
</script>
</body></html>
`

const out = path.join(root, 'docs', 'demo.html')
fs.writeFileSync(out, html)
console.log('wrote', path.relative(root, out), `(${(html.length / 1024).toFixed(1)} KB)`)
