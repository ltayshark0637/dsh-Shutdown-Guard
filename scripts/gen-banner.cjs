// Builds the GitHub social preview / README banner.
//
//   node scripts/gen-banner.cjs            # writes docs/screenshots/banner.html
//
// The banner reuses the card markup from gen-gallery.cjs, so it always shows
// the real component rather than a redrawn illustration. All three skins are
// on stage at once, each in a different state.
//
// Every block is laid out with absolute left/top so the page can be opened in
// any visual HTML editor and dragged around without the flex layout collapsing.
// The coordinates below were measured from the flex version and reproduce it
// pixel for pixel: change them freely, that is the point of the file.
const fs = require('node:fs')
const path = require('node:path')
const { CSS, card, BASE_CSS } = require('./gen-gallery.cjs')

const root = path.join(__dirname, '..')
const OUT = path.join(root, 'docs', 'screenshots')

// 1280x640 is what GitHub asks for in Settings → Social preview.
const BANNER_CSS = `
body{margin:0;background:#14120f;color:#faf9f5;font-family:'Inter',system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
/* Canvas. Everything inside is absolutely positioned against this box. */
.bn{position:relative;width:1280px;height:640px;overflow:hidden;isolation:isolate}

/* ---- background layers (full bleed) ---- */
/* One continuous wash: a single linear field plus two soft lobes. Separate
   radial blobs left a visible step where they met. */
.wash{position:absolute;left:0;top:0;width:1280px;height:640px;z-index:0;pointer-events:none;
  background:linear-gradient(104deg,#14120f 0%,#17140f 34%,#191410 58%,#1b120e 78%,#1c110d 100%)}
.lobe{position:absolute;left:0;top:0;width:1280px;height:640px;z-index:0;pointer-events:none;
  background:
    radial-gradient(1400px 900px at 4% 2%, rgba(240,168,58,.10), transparent 70%),
    radial-gradient(1400px 900px at 100% 100%, rgba(232,69,60,.10), transparent 70%)}
/* A faint grain breaks the 8-bit stepping that soft gradients show on large
   flat areas (the "layered" look). */
.grain{position:absolute;left:0;top:0;width:1280px;height:640px;z-index:1;pointer-events:none;opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
.grid{position:absolute;left:0;top:0;width:1280px;height:640px;z-index:0;opacity:.4;pointer-events:none;
  background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);
  background-size:44px 44px;mask-image:radial-gradient(ellipse 78% 82% at 34% 48%,#000 34%,transparent 82%)}

/* ---- copy block: one box per line of text ---- */
.eyebrow{position:absolute;left:60px;top:194px;width:225px;height:15px;
  display:flex;align-items:center;gap:8px;font-size:11.5px;letter-spacing:.17em;
  text-transform:uppercase;color:#9c9a90;font-weight:600;white-space:nowrap}
.eyebrow i{width:6px;height:6px;border-radius:50%;background:#f0a83a;box-shadow:0 0 0 4px rgba(240,168,58,.16);flex:0 0 auto}

h1{position:absolute;left:60px;top:225px;width:498px;height:46px;margin:0;
  font-size:46px;line-height:1;letter-spacing:-.032em;font-weight:750;color:#fff;white-space:nowrap}
h1 em{font-style:normal;color:#f0a83a}

.zh{position:absolute;left:60px;top:284px;width:498px;height:24px;margin:0;
  font-size:18.5px;line-height:1.3;font-weight:600;color:#faf9f5;white-space:nowrap}
.zh span{color:#7d7b72;font-weight:400;margin:0 9px}

.tag{position:absolute;left:60px;top:326px;width:474px;height:74px;margin:0;
  font-size:13.5px;line-height:1.82;color:#c2c0b6}
.tag b{color:#faf9f5;font-weight:600}

.chips{position:absolute;left:60px;top:422px;width:474px;height:29px;
  display:flex;gap:7px;flex-wrap:nowrap;align-items:flex-start}
.chip{font-size:11.5px;padding:6px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
  color:#d4d2c8;background:rgba(255,255,255,.045);white-space:nowrap;flex:0 0 auto}

/* ---- card stage: three cards, each its own draggable box ---- */
/* .zoom keeps the card at its design size (264x178) and scales it up; that is
   why a card's slot can be larger than its content. */
.slot{position:absolute;z-index:2}
.zoom{width:264px;height:178px;transform-origin:top left}

.slot-a{left:588px;top:256px;width:360px;height:243px}
.slot-a .zoom{transform:scale(1.364)}
.slot-b{left:966px;top:104px;width:289px;height:195px}
.slot-b .zoom{transform:scale(1.095)}
.slot-c{left:966px;top:330px;width:289px;height:195px}
.slot-c .zoom{transform:scale(1.095)}

.halo{position:absolute;left:548px;top:216px;width:440px;height:323px;z-index:0;pointer-events:none;
  background:radial-gradient(ellipse at 50% 50%,rgba(239,83,80,.15),rgba(240,168,58,.07) 46%,transparent 70%)}

.cap{position:absolute;z-index:3;font-size:10.5px;letter-spacing:.14em;color:#7d7b72;white-space:nowrap}
.cap-a{left:590px;top:512px}
.cap-b{left:968px;top:308px}
.cap-c{left:968px;top:534px}

/* ---- bottom hazard rule ---- */
.rule{position:absolute;left:0;top:635px;width:1280px;height:5px;z-index:4;overflow:hidden;background:#141413}
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
  <div class="wash"></div><div class="lobe"></div><div class="grid"></div>

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

  <div class="halo"></div>
  <div class="slot slot-a"><div class="zoom">${a}</div></div>
  <div class="cap cap-a">A · 警戒带</div>
  <div class="slot slot-b"><div class="zoom">${b}</div></div>
  <div class="cap cap-b">B · 雷达</div>
  <div class="slot slot-c"><div class="zoom">${c}</div></div>
  <div class="cap cap-c">C · 终端</div>

  <div class="rule"></div>
  <div class="grain"></div>
</div></body></html>`
}

fs.mkdirSync(OUT, { recursive: true })
const file = path.join(OUT, 'banner.html')
fs.writeFileSync(file, banner())
console.log('wrote', path.relative(root, file))
