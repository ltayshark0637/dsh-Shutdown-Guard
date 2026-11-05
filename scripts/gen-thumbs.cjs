// Turn the rendered `thumb-*.png` pages (A/B/C × zh/en/ru × light/dark) into the
// small PNGs the settings panel embeds, and dump their base64 for inlining into
// lib/client.js.
//
//   node scripts/gen-gallery.cjs --thumbs
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1 -Filter 'thumb-*.html'
//   node scripts/gen-thumbs.cjs
//
// Input:  docs/screenshots/thumb-{a,b,c}-{zh,en,ru}-{light,dark}.png  (2x, trimmed to the card)
// Output: assets/variant-{a,b,c}-{zh,en,ru}-{light,dark}.png          (200 wide, transparent)
//         _ops/variant-thumbs.txt                                     (3 comment lines + 18 "<key> <base64>")
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { encodePNG } = require('./gen-icon.cjs')

const root = path.join(__dirname, '..')
const SHOTS = path.join(root, 'docs', 'screenshots')
const OUT = path.join(root, 'assets')
const MAX_BYTES = 4 * 1024

function decodePNG(buf) {
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error('unsupported PNG: depth ' + bitDepth + ' color ' + colorType + ' interlace ' + interlace)
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(width * height * 4)
  const cur = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = cur[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp
      const d = (y * width + x) * 4
      out[d] = cur[s]
      out[d + 1] = cur[s + 1]
      out[d + 2] = cur[s + 2]
      out[d + 3] = bpp === 4 ? cur[s + 3] : 255
    }
    cur.copy(prev)
  }
  return { width, height, rgba: out }
}

// Area-average downscale in premultiplied space, so the transparent margin does
// not bleed a dark fringe into the card's rounded corners.
function resize(img, targetW) {
  const scale = img.width / targetW
  const targetH = Math.max(1, Math.round(img.height / scale))
  const out = Buffer.alloc(targetW * targetH * 4)
  for (let y = 0; y < targetH; y++) {
    const y0 = y * scale
    const y1 = Math.min(img.height, (y + 1) * scale)
    for (let x = 0; x < targetW; x++) {
      const x0 = x * scale
      const x1 = Math.min(img.width, (x + 1) * scale)
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const i = (sy * img.width + sx) * 4
          const al = img.rgba[i + 3] / 255
          r += img.rgba[i] * al
          g += img.rgba[i + 1] * al
          b += img.rgba[i + 2] * al
          a += al
          n += 1
        }
      }
      const d = (y * targetW + x) * 4
      if (a > 0) {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
      }
      out[d + 3] = Math.round((a / n) * 255)
    }
  }
  return { width: targetW, height: targetH, rgba: out }
}

// 200 宽的卡面要压到 4KB 以内。逐通道取整会把接近暗色的通道各自取整，导致雷达
// 那种淡光晕出现色相噪点（灰绿/灰红斑块），所以这里改成「按颜色出现频次做中位切分，
// 再把每个像素映射到最近的调色板色」：色相保持一致，颜色数变少，压缩率也跟着上来。
// alpha 仍保留 8 bit，圆角不会锯齿。
function quantize(img, maxColors) {
  const n = img.width * img.height
  const counts = new Map()
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (img.rgba[o + 3] < 8) continue
    const key = (img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let boxes = [[...counts.entries()].map(([key, count]) => ({
    r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count,
  }))]
  while (boxes.length < maxColors) {
    // 选体积（按通道跨度 × 像素数）最大的一箱来切。
    let pick = -1
    let best = -1
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      const r = box.map((c) => c.r), g = box.map((c) => c.g), b = box.map((c) => c.b)
      const span = Math.max(Math.max(...r) - Math.min(...r), Math.max(...g) - Math.min(...g), Math.max(...b) - Math.min(...b))
      const weight = span * Math.sqrt(box.reduce((s, c) => s + c.count, 0))
      if (weight > best) { best = weight; pick = i }
    }
    if (pick < 0) break
    const box = boxes[pick]
    const axis = (() => {
      const spans = ['r', 'g', 'b'].map((k) => {
        const vals = box.map((c) => c[k])
        return Math.max(...vals) - Math.min(...vals)
      })
      return ['r', 'g', 'b'][spans.indexOf(Math.max(...spans))]
    })()
    box.sort((a, b2) => a[axis] - b2[axis])
    const half = box.reduce((s, c) => s + c.count, 0) / 2
    let acc = 0
    let cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].count
      if (acc >= half) { cut = i + 1; break }
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }
  const palette = boxes.filter((b2) => b2.length).map((b2) => {
    const total = b2.reduce((s, c) => s + c.count, 0)
    return {
      r: Math.round(b2.reduce((s, c) => s + c.r * c.count, 0) / total),
      g: Math.round(b2.reduce((s, c) => s + c.g * c.count, 0) / total),
      b: Math.round(b2.reduce((s, c) => s + c.b * c.count, 0) / total),
    }
  })
  const out = Buffer.from(img.rgba)
  const cache = new Map()
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (img.rgba[o + 3] < 8) continue
    const key = (img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]
    let hit = cache.get(key)
    if (!hit) {
      let bestD = Infinity
      for (const p of palette) {
        const dr = p.r - img.rgba[o], dg = p.g - img.rgba[o + 1], db = p.b - img.rgba[o + 2]
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
        if (d < bestD) { bestD = d; hit = p }
      }
      cache.set(key, hit)
    }
    out[o] = hit.r
    out[o + 1] = hit.g
    out[o + 2] = hit.b
  }
  return { width: img.width, height: img.height, rgba: out }
}

// a→c、zh→ru、light→dark：与 _ops/variant-thumbs.txt 的行序一致。
const VARIANTS = ['a', 'b', 'c']
const LANGS = ['zh', 'en', 'ru']
const THEMES = ['light', 'dark']

function thumbKey(variant, lang, theme) {
  return variant + '-' + lang + '-' + theme
}

// 每张图单独挑「能压进 4KB 的最大调色板」：调色板越大越接近原图，A/C 卡面平，
// 48 色就够；B 的雷达渐变会逼到更小的调色板才能真正压下去。
function buildOne(entry, width, paletteSizes) {
  for (const colors of paletteSizes) {
    const small = quantize(resize(entry.img, width), colors)
    const png = encodePNG(small.width, small.height, small.rgba)
    if (png.length <= MAX_BYTES) return { key: entry.key, small, png, colors }
  }
  return null
}

function main() {
  const set = []
  for (const variant of VARIANTS) {
    for (const lang of LANGS) {
      for (const theme of THEMES) {
        const name = 'thumb-' + thumbKey(variant, lang, theme)
        const src = path.join(SHOTS, name + '.png')
        if (!fs.existsSync(src)) {
          throw new Error('missing ' + src + ' (run gen-gallery --thumbs + screenshot.ps1 first)')
        }
        set.push({ key: thumbKey(variant, lang, theme), img: decodePNG(fs.readFileSync(src)) })
      }
    }
  }

  const SIZES = [160, 128, 96, 80, 64, 48, 32, 24, 20, 16, 12]
  let results = set.map((entry) => buildOne(entry, 200, SIZES))
  // 200 宽压不下去才降到需求允许的 180。
  if (results.includes(null)) {
    results = set.map((entry) => buildOne(entry, 180, SIZES))
  }
  const failed = results.filter((r) => !r)
  if (failed.length) throw new Error('thumbnails still exceed ' + MAX_BYTES + ' B; lower the width')

  fs.mkdirSync(OUT, { recursive: true })
  const lines = [
    '# 设置页外观缩略图（A/B/C × zh/en/ru × 浅/深，armed 态，200px 宽，透明背景）',
    '# 生成：node scripts/gen-gallery.cjs --thumbs && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1 -Filter \'thumb-*.html\' && node scripts/gen-thumbs.cjs',
    '# 格式：<variant>-<lang>-<theme> <base64 PNG，无 data: 前缀>',
  ]
  for (const r of results) {
    const file = path.join(OUT, 'variant-' + r.key + '.png')
    fs.writeFileSync(file, r.png)
    lines.push(r.key + ' ' + r.png.toString('base64'))
    console.log('assets/variant-' + r.key + '.png  ' + r.small.width + 'x' + r.small.height + '  ' + r.png.length + ' B')
  }
  const txt = path.join(root, '_ops', 'variant-thumbs.txt')
  fs.writeFileSync(txt, lines.join('\n') + '\n', 'utf8')
  console.log('_ops/variant-thumbs.txt  ' + (lines.length - 3) + ' thumbs, ' + fs.statSync(txt).size + ' B')
}

if (require.main === module) main()
module.exports = { decodePNG, resize, quantize }
