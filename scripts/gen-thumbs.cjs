// Turn the rendered `thumb-*.png` pages (A/B/C × zh/en/ru × light/dark) into the
// PNGs the settings panel embeds, and dump their base64 for inlining into
// lib/client.js.
//
//   node scripts/gen-gallery.cjs --thumbs
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1 -Filter 'thumb-*.html'
//   node scripts/gen-thumbs.cjs
//
// Input:  docs/screenshots/thumb-{a,b,c}-{zh,en,ru}-{light,dark}.png  (2x, trimmed to the card)
// Output: assets/variant-{a,b,c}-{zh,en,ru}-{light,dark}.png          (400 wide, transparent)
//         _ops/variant-thumbs.txt                                     (3 comment lines + 18 "<key> <base64>")
//
// The `thumb-*.png` / `thumb-*.html` inputs are intermediate: delete them after
// the run, do not commit them. `docs/screenshots/` is the README picture folder,
// and a stray 2x render there reads like a picture that is meant to ship.
//
// Why 400 wide and an indexed palette: the settings panel draws the picture at
// `width:100%` inside a ~210 CSS px slot, so a 2x screen wants ~420 device
// pixels. 200 wide was upscaled 2.1x and looked soft, and the 4 KB budget forced
// B's radar sweep down to ~20 colours, which banded once enlarged. Now: 400x256,
// up to 256 palette entries, Floyd–Steinberg dithering (mandatory for the radar
// gradient), budget 22 KB per picture.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.join(__dirname, '..')
const SHOTS = path.join(root, 'docs', 'screenshots')
const OUT = path.join(root, 'assets')
const TARGET_W = 400
const MAX_BYTES = 22 * 1024
// Hard ceiling before the run fails instead of quietly shipping a soft picture.
const HARD_MAX_BYTES = 30 * 1024

function decodePNG(buf) {
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let plte = null
  let trns = null
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
    } else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2 && colorType !== 3)) {
    throw new Error('unsupported PNG: depth ' + bitDepth + ' color ' + colorType + ' interlace ' + interlace)
  }
  if (colorType === 3 && !plte) throw new Error('indexed PNG without PLTE')
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
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
      const d = (y * width + x) * 4
      if (colorType === 3) {
        const i = cur[x]
        out[d] = plte[i * 3]
        out[d + 1] = plte[i * 3 + 1]
        out[d + 2] = plte[i * 3 + 2]
        out[d + 3] = trns && i < trns.length ? trns[i] : 255
        continue
      }
      const s = x * bpp
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

// Median cut over RGBA. Alpha is part of the distance so the antialiased card
// edges land on their own palette entries instead of turning into dark fringes.
function buildPalette(img, maxColors) {
  const n = img.width * img.height
  const counts = new Map()
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = img.rgba[o + 3]
    // Everything below the visible threshold collapses into one clear entry.
    const key = a < 8 ? -1 : ((img.rgba[o] << 24) | (img.rgba[o + 1] << 16) | (img.rgba[o + 2] << 8) | a) >>> 0
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const entries = [...counts.entries()].map(([k, count]) => (
    k === -1
      ? { r: 0, g: 0, b: 0, a: 0, count, clear: true }
      : { r: (k >>> 24) & 255, g: (k >>> 16) & 255, b: (k >>> 8) & 255, a: k & 255, count }
  ))
  const boxes = [entries.filter((e) => !e.clear)]
  const clearCount = counts.get(-1) || 0
  while (boxes.length < maxColors) {
    let pick = -1
    let best = -1
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      const spans = ['r', 'g', 'b', 'a'].map((k) => {
        const vals = box.map((c) => c[k])
        return Math.max(...vals) - Math.min(...vals)
      })
      const span = Math.max(spans[0], spans[1], spans[2], spans[3] * 1.6)
      const weight = span * Math.sqrt(box.reduce((s, c) => s + c.count, 0))
      if (weight > best) { best = weight; pick = i }
    }
    if (pick < 0) break
    const box = boxes[pick]
    const spans = ['r', 'g', 'b', 'a'].map((k) => {
      const vals = box.map((c) => c[k])
      return Math.max(...vals) - Math.min(...vals)
    })
    const axisIdx = spans.indexOf(Math.max(spans[0], spans[1], spans[2], spans[3]))
    const axis = ['r', 'g', 'b', 'a'][axisIdx]
    box.sort((x, y) => x[axis] - y[axis])
    const half = box.reduce((s, c) => s + c.count, 0) / 2
    let acc = 0
    let cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].count
      if (acc >= half) { cut = i + 1; break }
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }
  const palette = boxes.filter((b) => b.length).map((b) => {
    const total = b.reduce((s, c) => s + c.count, 0)
    return {
      r: Math.round(b.reduce((s, c) => s + c.r * c.count, 0) / total),
      g: Math.round(b.reduce((s, c) => s + c.g * c.count, 0) / total),
      b: Math.round(b.reduce((s, c) => s + c.b * c.count, 0) / total),
      a: Math.round(b.reduce((s, c) => s + c.a * c.count, 0) / total),
    }
  })
  if (clearCount) palette.push({ r: 0, g: 0, b: 0, a: 0 })
  return palette
}

function nearest(palette, r, g, b, a) {
  let bestD = Infinity
  let best = 0
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]
    const dr = p.r - r, dg = p.g - g, db = p.b - b, da = (p.a - a) * 1.6
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + da * da
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

// Floyd–Steinberg on RGB, only inside fully opaque areas: the card face is what
// needs to avoid banding, and dithering the antialiased rim would speckle it.
function toIndexed(img, maxColors, dither) {
  const palette = buildPalette(img, maxColors)
  const n = img.width * img.height
  const idx = Buffer.alloc(n)
  const work = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    work[i * 3] = img.rgba[i * 4]
    work[i * 3 + 1] = img.rgba[i * 4 + 1]
    work[i * 3 + 2] = img.rgba[i * 4 + 2]
  }
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x
      const o = i * 4
      const a = img.rgba[o + 3]
      const r = clamp(work[i * 3])
      const g = clamp(work[i * 3 + 1])
      const b = clamp(work[i * 3 + 2])
      const best = nearest(palette, r, g, b, a)
      idx[i] = best
      if (!dither || a < 250) continue
      const p = palette[best]
      const er = r - p.r
      const eg = g - p.g
      const eb = b - p.b
      const push = (nx, ny, f) => {
        if (nx < 0 || nx >= img.width || ny >= img.height) return
        const j = (ny * img.width + nx) * 4
        if (img.rgba[j + 3] < 250) return
        const k = ny * img.width + nx
        work[k * 3] += er * f
        work[k * 3 + 1] += eg * f
        work[k * 3 + 2] += eb * f
      }
      push(x + 1, y, 7 / 16)
      push(x - 1, y + 1, 3 / 16)
      push(x, y + 1, 5 / 16)
      push(x + 1, y + 1, 1 / 16)
    }
  }
  return { width: img.width, height: img.height, palette, idx }
}

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// Indexed PNG (color type 3) with a tRNS alpha table: that is what makes an
// 8-bit 256-colour picture small enough to inline 18 times.
function encodeIndexed(width, height, palette, idx) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 3
  const plte = Buffer.alloc(palette.length * 3)
  palette.forEach((p, i) => {
    plte[i * 3] = p.r
    plte[i * 3 + 1] = p.g
    plte[i * 3 + 2] = p.b
  })
  const trns = Buffer.from(palette.map((p) => p.a))
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    idx.copy(raw, y * (width + 1) + 1, y * width, y * width + width)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// a→c、zh→ru、light→dark：与 _ops/variant-thumbs.txt 的行序一致。
const VARIANTS = ['a', 'b', 'c']
const LANGS = ['zh', 'en', 'ru']
const THEMES = ['light', 'dark']

function thumbKey(variant, lang, theme) {
  return variant + '-' + lang + '-' + theme
}

// 先试 256 色；压不进 22KB 才逐级降（160 / 128 / 96）。降到不能再降仍在 30KB 内
// 就收下并在回报里点名，超过 30KB 直接失败，不允许静默发糊图。
const PALETTE_STEPS = [256, 192, 160, 128, 96, 64]

function buildOne(entry) {
  const img = resize(entry.img, TARGET_W)
  let last = null
  for (const colors of PALETTE_STEPS) {
    const indexed = toIndexed(img, colors, true)
    const png = encodeIndexed(indexed.width, indexed.height, indexed.palette, indexed.idx)
    last = { key: entry.key, img, indexed, png, colors }
    if (png.length <= MAX_BYTES) return last
  }
  if (last.png.length <= HARD_MAX_BYTES) return last
  throw new Error(entry.key + ': ' + last.png.length + ' B exceeds the hard ceiling')
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

  const results = set.map(buildOne)

  fs.mkdirSync(OUT, { recursive: true })
  const lines = [
    '# 设置页外观缩略图（A/B/C × zh/en/ru × 浅/深，armed 态，400px 宽，透明背景）',
    '# 生成：node scripts/gen-gallery.cjs --thumbs && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1 -Filter \'thumb-*.html\' && node scripts/gen-thumbs.cjs',
    '# 格式：<variant>-<lang>-<theme> <base64 PNG，无 data: 前缀>',
  ]
  let totalB64 = 0
  let minB = Infinity
  let maxB = 0
  const over = []
  for (const r of results) {
    const file = path.join(OUT, 'variant-' + r.key + '.png')
    fs.writeFileSync(file, r.png)
    lines.push(r.key + ' ' + r.png.toString('base64'))
    totalB64 += r.png.toString('base64').length
    minB = Math.min(minB, r.png.length)
    maxB = Math.max(maxB, r.png.length)
    if (r.png.length > MAX_BYTES) over.push(r.key + ' ' + r.png.length + ' B / ' + r.colors + ' colors')
    console.log('assets/variant-' + r.key + '.png  ' + r.indexed.width + 'x' + r.indexed.height +
      '  ' + r.png.length + ' B  ' + r.colors + ' colors')
  }
  const txt = path.join(root, '_ops', 'variant-thumbs.txt')
  fs.writeFileSync(txt, lines.join('\n') + '\n', 'utf8')
  console.log('bytes ' + minB + '-' + maxB)
  console.log('base64 total ' + totalB64 + ' B (' + (totalB64 / 1024).toFixed(1) + ' KiB)')
  console.log('over budget ' + (over.length ? over.join('; ') : 'none'))
  console.log('_ops/variant-thumbs.txt  ' + (lines.length - 3) + ' thumbs, ' + fs.statSync(txt).size + ' B')
}

if (require.main === module) main()
module.exports = { decodePNG, resize, buildPalette, toIndexed, encodeIndexed }
