// Builds the GitHub social preview / README banner.
//
//   node scripts/gen-banner.cjs            # writes docs/screenshots/banner.html
//   powershell -File scripts/banner.ps1    # renders banner.png + banner@2x
//
// The banner reuses the card markup from gen-gallery.cjs, so it always shows
// the real component rather than a redrawn illustration.
const fs = require('node:fs')
const path = require('node:path')
const { CSS, card, BASE_CSS } = require('./gen-gallery.cjs')

const root = path.join(__dirname, '..')
const OUT = path.join(root, 'docs', 'screenshots')

// A 1280x640 canvas is what GitHub asks for in Settings → Social preview.
// Everything sits on a warm near-black so the card's own palette blends in.
const BANNER_CSS = `
body{margin:0;background:#0f0f0e;color:#faf9f5;font-family:'Inter',system-ui,'Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
.bn{width:1280px;height:640px;position:relative;overflow:hidden;display:flex;align-items:center;isolation:isolate}
.glow{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
.glow-a{width:620px;height:620px;left:-160px;top:-220px;background:radial-gradient(circle,rgba(240,168,58,.22),transparent 68%)}
.glow-b{width:700px;height:700px;right:-220px;bottom:-300px;background:radial-gradient(circle,rgba(232,69,60,.20),transparent 66%)}
.grid{position:absolute;inset:0;z-index:0;opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.032) 1px,transparent 1px);
  background-size:44px 44px;mask-image:radial-gradient(ellipse at 30% 40%,#000 30%,transparent 78%)}
.copy{position:relative;z-index:2;padding:0 0 0 76px;width:700px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#8b887e;margin-bottom:20px}
.eyebrow i{width:6px;height:6px;border-radius:50%;background:#f0a83a;box-shadow:0 0 0 4px rgba(240,168,58,.16)}
h1{margin:0;font-size:62px;line-height:1.04;letter-spacing:-.03em;font-weight:700}
h1 em{font-style:normal;color:#f0a83a}
.tag{margin:20px 0 0;font-size:16.5px;line-height:1.62;color:#b0aea5;max-width:520px}
.chips{display:flex;gap:9px;margin-top:28px;flex-wrap:wrap}
.chip{font-size:12px;padding:6px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.12);color:#c9c7be;background:rgba(255,255,255,.035)}
.cardwrap{position:relative;z-index:2;margin-left:auto;margin-right:54px}
.cardhalo{position:absolute;inset:-70px -60px -60px -60px;z-index:-1;border-radius:40px;
  background:radial-gradient(ellipse at 50% 45%,rgba(239,83,80,.20),rgba(240,168,58,.08) 48%,transparent 72%)}
.rule{position:absolute;left:0;bottom:0;height:5px;width:100%;z-index:3;overflow:hidden;background:#141413}
.rule::before{content:'';position:absolute;top:0;bottom:0;left:-60px;right:-60px;
  background:repeating-linear-gradient(45deg,#f2b13c 0 10px,#e8453c 10px 20px);
  animation:bn-slide 1.15s linear infinite}
@keyframes bn-slide{to{transform:translateX(28.28px)}}
.lockup{position:absolute;right:34px;bottom:26px;z-index:2;font-size:12px;color:#6f6d66;letter-spacing:.04em}
`

function banner() {
  // Fire state reads best at a glance: the countdown is the promise of the
  // product, and the red border separates it from the dark canvas.
  const c = card({ view: 'fire', variant: 'A' })
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${BASE_CSS}</style><style>${BANNER_CSS}</style><style>${CSS}</style>
<style>.cardwrap{width:432px;height:300px;display:grid;place-items:center}
/* Scale the real card instead of restyling it: the internal rhythm stays exact. */
.cardwrap .dsp-card{width:264px;height:178px;transform:scale(1.63);transform-origin:center}
.cardwrap .dsp-hazard{height:10px}</style>
</head><body><div class="bn">
  <div class="glow glow-a"></div><div class="glow glow-b"></div><div class="grid"></div>
  <div class="copy">
    <div class="eyebrow"><i></i>DSH plugin</div>
    <h1>任务跑完<br><em>电脑自己关</em></h1>
    <p class="tag">侧边栏里的一张卡片。五道判定闸拦住后台任务、报错、人工中断，只在真的可以关的时候关机。</p>
    <div class="chips">
      <span class="chip">侧边栏卡片</span>
      <span class="chip">三种外观</span>
      <span class="chip">AFK 自动接管</span>
      <span class="chip">阻断态分级</span>
    </div>
  </div>
  <div class="cardwrap"><div class="cardhalo"></div>${c}</div>
  <div class="rule"></div>
  <div class="lockup">dsh-shutdown-guard</div>
</div></body></html>`
}

fs.mkdirSync(OUT, { recursive: true })
const file = path.join(OUT, 'banner.html')
fs.writeFileSync(file, banner())
console.log('wrote', path.relative(root, file))
