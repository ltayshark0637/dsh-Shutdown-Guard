// Builds the GitHub social preview / README banner.
//
//   node scripts/gen-banner.cjs            # writes docs/screenshots/banner.html
//
// The banner reuses the card markup from gen-gallery.cjs, so it always shows
// the real component rather than a redrawn illustration. All three skins are
// on stage at once, each in a different state.
const fs = require('node:fs')
const path = require('node:path')
const { CSS, card, BASE_CSS } = require('./gen-gallery.cjs')

const root = path.join(__dirname, '..')
const OUT = path.join(root, 'docs', 'screenshots')

// 1280x640 is what GitHub asks for in Settings → Social preview.
const BANNER_CSS = `
body{margin:0;background:#0f0f0e;color:#faf9f5;font-family:'Inter',system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
.bn{width:1280px;height:640px;position:relative;overflow:hidden;display:flex;align-items:center;isolation:isolate}
.glow{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
.glow-a{width:640px;height:640px;left:-190px;top:-240px;background:radial-gradient(circle,rgba(240,168,58,.20),transparent 68%)}
.glow-b{width:720px;height:720px;right:-260px;bottom:-320px;background:radial-gradient(circle,rgba(232,69,60,.18),transparent 66%)}
.grid{position:absolute;inset:0;z-index:0;opacity:.45;
  background-image:linear-gradient(rgba(255,255,255,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.032) 1px,transparent 1px);
  background-size:44px 44px;mask-image:radial-gradient(ellipse at 26% 44%,#000 28%,transparent 76%)}

.copy{position:relative;z-index:2;padding-left:70px;width:592px;flex:0 0 auto;margin-top:-16px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;letter-spacing:.17em;text-transform:uppercase;color:#9c9a90;margin-bottom:16px;font-weight:600}
.eyebrow i{width:6px;height:6px;border-radius:50%;background:#f0a83a;box-shadow:0 0 0 4px rgba(240,168,58,.16)}
h1{margin:0;font-size:53px;line-height:1;letter-spacing:-.034em;font-weight:750;color:#fff}
h1 em{font-style:normal;color:#f0a83a}
.zh{margin:15px 0 0;font-size:21px;font-weight:600;color:#faf9f5}
.zh span{color:#7d7b72;font-weight:400;margin:0 9px}
.tag{margin:20px 0 0;font-size:14.5px;line-height:1.86;color:#c2c0b6;width:546px}
.tag span{white-space:nowrap}
.tag b{color:#faf9f5;font-weight:600}
.chips{display:flex;gap:8px;margin-top:26px;flex-wrap:wrap;width:546px}
.chip{font-size:11.5px;padding:6px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.14);color:#d4d2c8;background:rgba(255,255,255,.045)}
.pkg{position:absolute;left:70px;bottom:26px;z-index:2;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;
  font-size:11.5px;letter-spacing:.03em;color:#6f6d66}
.pkg b{color:#9c9a90;font-weight:500}

.deck{position:relative;z-index:2;width:584px;height:470px;flex:0 0 auto;margin-left:auto;margin-right:30px}
.slot{position:absolute}
.zoom{width:264px;height:178px;transform-origin:top left}
.slot-a{left:0;top:186px;width:305px;height:206px}
.slot-a .zoom{transform:scale(1.155)}
.slot-b{left:330px;top:52px;width:251px;height:169px}
.slot-b .zoom{transform:scale(.951)}
.slot-c{left:330px;top:264px;width:251px;height:169px}
.slot-c .zoom{transform:scale(.951)}
.halo{position:absolute;inset:-40px;z-index:-1;border-radius:40px;
  background:radial-gradient(ellipse at 40% 54%,rgba(239,83,80,.15),rgba(240,168,58,.07) 46%,transparent 70%)}
.cap{position:absolute;font-size:10.5px;letter-spacing:.14em;color:#7d7b72;white-space:nowrap}
.cap-a{left:2px;top:397px}
.cap-b{left:332px;top:228px}
.cap-c{left:332px;top:440px}

.rule{position:absolute;left:0;bottom:0;height:5px;width:100%;z-index:3;overflow:hidden;background:#141413}
.rule::before{content:'';position:absolute;top:0;bottom:0;left:-60px;right:-60px;
  background:repeating-linear-gradient(45deg,#f2b13c 0 10px,#e8453c 10px 20px);
  animation:bn-slide 1.15s linear infinite}
@keyframes bn-slide{to{transform:translateX(28.28px)}}
`

function banner() {
  // One skin each, one state each: A is firing off a countdown, B is holding
  // for background jobs, C is standing by. No two panels say the same thing.
  const a = card({ view: 'fire', variant: 'A' })
  const b = card({ view: 'hold', variant: 'B' })
  const c = card({ view: 'armed', variant: 'C' })
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${BASE_CSS}</style><style>${BANNER_CSS}</style><style>${CSS}</style></head><body><div class="bn">
  <div class="glow glow-a"></div><div class="glow glow-b"></div><div class="grid"></div>

  <div class="copy">
    <div class="eyebrow"><i></i>DeepSeek Harness Plugin</div>
    <h1>Shutdown <em>Guard</em></h1>
    <div class="zh">任务完成后自动关机<span>·</span>侧边栏守夜卡片</div>
    <p class="tag">为 DeepSeek Harness 的侧边栏添加「所有任务完成后自动关机」卡片，<br>拥有更好且多样的<b>视觉效果</b>、<b>判定逻辑</b>与<b>个性化定制</b>。<br>位于「技能中心」下方、会话列表上方，随任务状态实时变化。</p>
    <div class="chips">
      <span class="chip">五道判定闸</span>
      <span class="chip">三种外观</span>
      <span class="chip">个性化定制</span>
      <span class="chip">AFK 自动接管</span>
      <span class="chip">阻断态分级</span>
    </div>
  </div>

  <div class="deck">
    <div class="halo"></div>
    <div class="slot slot-a"><div class="zoom">${a}</div></div>
    <div class="cap cap-a">A · 警戒带</div>
    <div class="slot slot-b"><div class="zoom">${b}</div></div>
    <div class="cap cap-b">B · 雷达</div>
    <div class="slot slot-c"><div class="zoom">${c}</div></div>
    <div class="cap cap-c">C · 终端</div>
  </div>

  <div class="pkg"><b>dsh-shutdown-guard</b> · v1.5.0 · MIT</div>
  <div class="rule"></div>
</div></body></html>`
}

fs.mkdirSync(OUT, { recursive: true })
const file = path.join(OUT, 'banner.html')
fs.writeFileSync(file, banner())
console.log('wrote', path.relative(root, file))
