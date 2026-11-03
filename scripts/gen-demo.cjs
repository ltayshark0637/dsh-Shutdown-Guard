// Builds docs/demo.html — one page with two panes behind a tab bar.
//
//   pane 1  了解      the README, as a page you can actually read
//   pane 2  试一试    the interactive playground
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

// Screenshots live beside this page under docs/screenshots/, so a plain
// relative path works both from disk and from GitHub Pages.
const img = (file, cap) =>
  `<div class="shot"><img src="screenshots/${file}" alt="${cap}" loading="lazy"><span>${cap}</span></div>`

// ---------------------------------------------------------------- pane 1
const aboutPane = `<div class="about">

  <div class="sect">
    <h2><span>01</span>为什么需要它</h2>
    <p>跑长任务的人常有这个场景：晚上让 agent 把一批活干完，想让它干完就关机，人不在跟前。</p>
    <p>但「任务结束」不等于「可以关机」——后台任务还在跑、会话报错了、agent 在等你回答问题、你在半路手动终止了……这些情况下关机全是事故。这个插件把这些情况逐个挡下来，只有真的可以关的时候才关。</p>
  </div>

  <div class="sect">
    <h2><span>02</span>判定：什么时候才关</h2>
    <p>处于阻断态时直接不下发；其余五道闸门同时满足才下发 <code>shutdown /s</code>：</p>
    <ol class="gates">
      <li><b>已武装</b> —— 你手动点的</li>
      <li><b>没有倒计时在跑</b> —— 避免重复下发</li>
      <li><b>所有 root 会话都空闲</b> —— 没有任何 agent 还在干活</li>
      <li><b>没有运行中 / 停止中的后台任务</b> —— <code>blockOnJobs</code>，默认开</li>
      <li><b>本批次没有会话报错</b> —— <code>onlyOnSuccess</code>，默认开</li>
    </ol>
  </div>

  <div class="sect full">
    <h2><span>03</span>三种外观</h2>
    <div class="strip three">
      ${img('02-armed.png', '<b>A · 警戒带</b>大字状态 + 底部滚动的红黄斜纹')}
      ${img('06-variant-b-radar.png', '<b>B · 雷达</b>同心圆 + 扫描光束，任务以圆点呈现')}
      ${img('07-variant-c-terminal.png', '<b>C · 终端</b>命令行摘要 + 六段判定指示灯')}
    </div>
    <p>雷达里的圆点按数量增删、不重排：数量变化时，你正在看的那几个点不会跳位置。设置里切换，立即生效，无需重启。</p>
    <p>想自己动手试试？打开 <a href="#try">试一试</a> —— 换外观、掷状态、看日志，都是本地随机的，不联网。</p>
  </div>

  <div class="sect full">
    <h2 class="with-pills">
      <span><span>04</span>六种运行状态</span>
      <span class="pills" id="show-variant-pills" role="group" aria-label="用哪种外观预览">
        <button data-v="A" class="on">A</button>
        <button data-v="B">B</button>
        <button data-v="C">C</button>
      </span>
    </h2>
    <div class="strip three" id="show-states"></div>
    <p>倒计时期间随时可取消，<b>取消后仍保持武装</b>——下一批任务干完照样会关。</p>
  </div>

  <div class="sect">
    <h2><span>05</span>阻断态</h2>
    <p>遇到没法当普通失败处理的错误，插件<b>不解除武装</b>，卡片转色、把原因写出来：</p>
    <ul class="levels">
      <li class="halted"><em>halted · 灰蓝</em>额度不足、凭证失效、上下文超限、能力不支持、磁盘写满。只有人能处理，点「解除并重试」。</li>
      <li class="waiting"><em>waiting · 灰绿</em>限流、5xx、网络中断、空响应、超时、图片卸载。按策略自动重试，到点注入「继续原计划」指令。</li>
    </ul>
  </div>

  <div class="sect">
    <h2><span>06</span>AFK 自动接管</h2>
    <p>人不在跟前时，插件替你顶三件事：</p>
    <ul class="levels">
      <li><em>自动回答提问</em>agent 问你问题时，回复「用户处于 AFK，先完成已交代的任务，汇总报告并落盘」。返回 <code>selected: []</code> + 自定义文本，<b>不会替你选中任何选项</b>；关掉后提问照常抛给你。</li>
      <li><em>错误恢复</em>会话报错时先要求 agent 排查并继续原计划；同一会话再失败改为「停止重试、写报告收尾」。</li>
      <li><em>中断保护</em>你在半路手动终止任务，不会触发关机。</li>
    </ul>
  </div>

  <div class="sect full">
    <h2><span>07</span>装在哪里</h2>
    <div class="strip two">
      ${img('10-sidebar-hold.png', '武装时：技能中心下方、会话列表上方')}
      ${img('11-sidebar-fire.png', '倒计时：同一位置，整条转红')}
    </div>
    <p>卡片目前固定在侧边栏的这个位置。后续计划把它做成可以独立出现的形态，届时这里会补充说明。</p>
  </div>

  <div class="install full">
    <span>设置 → 插件 → 添加，填<b>插件目录的绝对路径</b> → 安装 → 重启 DSH。客户端的 bundle 只在启动时编入模块图，改完代码必须重启，刷新页面无效。</span>
    <span class="go"><a href="https://github.com/ltayshark0637/dsh-Shutdown-Guard">完整说明在 GitHub →</a></span>
  </div>

</div>`

// ---------------------------------------------------------------- pane 2
const tryPane = `<div class="main">
  <div class="stage-col">
    <div class="stage-frame">${sbShell}</div>
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
      <div class="blabel">场景</div>
      <button class="roll" id="roll">随机一个场景</button>
      <div class="armhint" id="arm-hint" hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
        去左边点卡片上的「武装」开始检测
      </div>
      <div class="now" id="now" role="status" aria-live="polite">当前 <b>未开启</b></div>
      <button class="stop" id="stop">解除</button>
    </div>

    <div class="block">
      <div class="blabel">模拟日志</div>
      <ul class="log" id="log"><li class="empty">还没有记录</li></ul>
      <ol class="tips">
        <li><b>左边是它真正待的地方</b>：技能中心下方、会话列表上方。目前卡片固定在这个位置；后续会支持让它独立出现，届时这里的交互会跟着变。<b>这页的卡片可以点</b>，武装、取消、解除都在左边操作。</li>
        <li>流程：<b>随机场景</b> → 点卡片上的<b>武装</b> → 开始检测 → 后台任务与会话逐个减少 → 全部结束后进入倒计时 → 下发。</li>
        <li>检测途中会有小概率撞上阻断态：<code>halted</code> 要你点「解除并重试」，<code>waiting</code> 过几秒自己恢复。</li>
        <li>倒计时期间你可以随时「取消关机」，模式仍保持武装；也可能撞上阻断。</li>
        <li>真实插件的日志在 <code>设置 → 状态</code>，完整流水写在 <code>data/events.log</code>。这里倒计时用 12 秒，插件默认 60 秒。</li>
      </ol>
    </div>
  </div>
</div>`

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shutdown Guard · 任务完成后自动关机</title>
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
  <p class="lede">为 DeepSeek Harness 的侧边栏添加「所有任务完成后自动关机」卡片，拥有更好且多样的<b>视觉效果</b>、<b>判定逻辑</b>与<b>个性化定制</b>。</p>
  <div class="chips">
    <span class="chip">五道判定闸</span>
    <span class="chip">三种外观</span>
    <span class="chip">个性化定制</span>
    <span class="chip">AFK 自动接管</span>
    <span class="chip">阻断态分级</span>
  </div>

  <div class="tabs" role="tablist">
    <button class="tab on" id="tab-about" role="tab" aria-selected="true" aria-controls="pane-about" data-pane="about">
      <span class="n">01</span>了解
    </button>
    <button class="tab" id="tab-try" role="tab" aria-selected="false" aria-controls="pane-try" data-pane="try">
      <span class="n">02</span>试一试
    </button>
  </div>

  <div class="pane" id="pane-about" role="tabpanel" aria-labelledby="tab-about">
    ${aboutPane}
  </div>

  <div class="pane" id="pane-try" role="tabpanel" aria-labelledby="tab-try" hidden>
    ${tryPane}
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
