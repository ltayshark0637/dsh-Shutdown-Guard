// Builds the animated GIFs used in the README.
//
//   node scripts/gen-gif.cjs
//
// No ffmpeg / ImageMagick / sharp exists on this machine, so the pipeline is:
//   1. take an already-generated single-frame page from docs/screenshots/*.html
//      and freeze its CSS animations at a given time with `animation-delay:-t`
//      plus `animation-play-state:paused` — that is the only way to get a
//      deterministic frame out of headless Edge;
//   2. screenshot each frame, at 1x so the GIF stays small;
//   3. stitch the PNGs into a GIF89a with the encoder below.
//
// The encoder uses a 6x6x6 colour cube plus a 40-step grey ramp and no
// dithering. The cards are flat-coloured, so that is plenty and keeps the
// filesize down into the tens of KB.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SHOTS = path.join(ROOT, 'docs', 'screenshots')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

// ---------------------------------------------------------------- PNG decode
/** Inflate an 8-bit RGB/RGBA PNG. Node's zlib does the work; we undo filters. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, color type ${colorType}`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const inflated = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]
    const line = Buffer.from(inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
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
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = bpp === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, rgba: out }
}

// ---------------------------------------------------------------- palette
const LEVELS = [0, 51, 102, 153, 204, 255]
const PALETTE = []
for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) PALETTE.push([r, g, b])
for (let i = 0; i < 39; i++) {
  const v = Math.round((i / 38) * 255)
  PALETTE.push([v, v, v])
}
while (PALETTE.length < 256) PALETTE.push([0, 0, 0])
// Index 255 is reserved for transparency, so the grey ramp stops at 254.

/** Nearest palette entry, with near-grey pixels preferring the grey ramp. */
function quantize(r, g, b) {
  const cube = Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51)
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    const gi = 216 + Math.min(38, Math.max(0, Math.round((r / 255) * 38)))
    const gv = PALETTE[gi][0]
    const cv = PALETTE[cube][0]
    if (Math.abs(gv - r) < Math.abs(cv - r)) return gi
  }
  return cube
}

// ---------------------------------------------------------------- GIF encode
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize
  const eoi = clearCode + 1
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  const dict = new Map()
  const out = []
  let acc = 0
  let bits = 0
  const emit = (code) => {
    acc |= code << bits
    bits += codeSize
    while (bits >= 8) {
      out.push(acc & 0xff)
      acc >>= 8
      bits -= 8
    }
  }
  const reset = () => {
    dict.clear()
    codeSize = minCodeSize + 1
    next = eoi + 1
  }
  emit(clearCode)
  reset()
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = (prefix << 8) | k
    const found = dict.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    dict.set(key, next)
    next += 1
    if (next > 1 << codeSize && codeSize < 12) codeSize += 1
    if (next >= 4094) {
      emit(clearCode)
      reset()
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (bits > 0) out.push(acc & 0xff)
  return Buffer.from(out)
}

const TRANSPARENT_INDEX = 255

function encodeGif(frames, width, height, delayCs) {
  const chunks = [Buffer.from('GIF89a', 'ascii')]
  const lsd = Buffer.alloc(7)
  lsd.writeUInt16LE(width, 0)
  lsd.writeUInt16LE(height, 2)
  lsd[4] = 0xf7 // global colour table, 256 entries, 8 bits per channel
  chunks.push(lsd)
  const table = Buffer.alloc(256 * 3)
  PALETTE.forEach((c, i) => {
    table[i * 3] = c[0]
    table[i * 3 + 1] = c[1]
    table[i * 3 + 2] = c[2]
  })
  chunks.push(table)
  // NETSCAPE2.0 — loop forever
  chunks.push(
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  )
  for (const frame of frames) {
    // Disposal 1 + transparent flag: the card overlays whatever background
    // GitHub puts behind it instead of stamping a black rectangle.
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x05, 0, 0, TRANSPARENT_INDEX, 0])
    gce[4] = delayCs & 0xff
    gce[5] = (delayCs >> 8) & 0xff
    chunks.push(gce)
    const desc = Buffer.alloc(10)
    desc[0] = 0x2c
    desc.writeUInt16LE(width, 5)
    desc.writeUInt16LE(height, 7)
    chunks.push(desc)
    chunks.push(Buffer.from([8]))
    const data = lzwEncode(frame, 8)
    for (let i = 0; i < data.length; i += 255) {
      const slice = data.subarray(i, i + 255)
      chunks.push(Buffer.from([slice.length]), slice)
    }
    chunks.push(Buffer.from([0]))
  }
  chunks.push(Buffer.from([0x3b]))
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------- frames
/** Freeze every animation at `seconds` so Edge renders a deterministic frame. */
function freeze(html, seconds) {
  const style = `<style>*{animation-play-state:paused!important;animation-delay:-${seconds}s!important}</style>`
  return html.replace('</head>', `${style}</head>`)
}

function shoot(html, out, width, height) {
  const tmp = path.join(os.tmpdir(), `gifframe-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  const profile = path.join(os.tmpdir(), `gifprofile-${process.pid}-${Date.now()}`)
  const uri = 'file:///' + tmp.replace(/\\/g, '/')
  try {
    execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--default-background-color=00000000',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      uri,
    ], { stdio: 'ignore' })
  } catch {
    // headless Edge exits non-zero even on success
  }
  fs.rmSync(tmp, { force: true })
  fs.rmSync(profile, { recursive: true, force: true })
  if (!fs.existsSync(out)) throw new Error(`screenshot missing: ${out}`)
}

/** Build one GIF from a page that already exists in docs/screenshots. */
function buildGif({ source, name, frames, spanSeconds, width, height, delayCs }) {
  const base = fs.readFileSync(path.join(SHOTS, source), 'utf8')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gifframes-'))
  const indices = []
  let gw = 0
  let gh = 0
  for (let i = 0; i < frames; i++) {
    const t = (spanSeconds * i) / frames
    const png = path.join(dir, `f${String(i).padStart(3, '0')}.png`)
    shoot(freeze(base, t.toFixed(3)), png, width, height)
    const img = decodePng(fs.readFileSync(png))
    gw = img.width
    gh = img.height
    const idx = Buffer.alloc(gw * gh)
    for (let p = 0; p < gw * gh; p++) {
      // Index 255 is reserved for full transparency; anything nearly clear
      // maps to it so the card keeps its rounded corners on any background.
      idx[p] = img.rgba[p * 4 + 3] < 16
        ? TRANSPARENT_INDEX
        : quantize(img.rgba[p * 4], img.rgba[p * 4 + 1], img.rgba[p * 4 + 2])
    }
    indices.push(idx)
  }
  // Keep the first frame as the still image too, so the README degrades well.
  const still = path.join(SHOTS, name.replace(/\.gif$/, '.png'))
  fs.copyFileSync(path.join(dir, 'f000.png'), still)
  fs.rmSync(dir, { recursive: true, force: true })
  const gif = encodeGif(indices, gw, gh, delayCs)
  const out = path.join(SHOTS, name)
  fs.writeFileSync(out, gif)
  console.log(`${name}  ${gw}x${gh}  ${frames} frames  ${Math.round(gif.length / 1024)} KB`)
  return out
}

function main() {
  if (!fs.existsSync(EDGE)) throw new Error(`Edge not found: ${EDGE}`)
  // Hazard tape scrolling — one full 1.15s cycle.
  buildGif({ source: '02-armed.html', name: 'anim-hazard.gif', frames: 12, spanSeconds: 1.15, width: 330, height: 260, delayCs: 10 })
  // Radar sweep — one full 3.2s rotation.
  buildGif({ source: '06-variant-b-radar.html', name: 'anim-radar.gif', frames: 16, spanSeconds: 3.2, width: 330, height: 260, delayCs: 20 })
  // Waiting dot breathing — one 1.6s cycle.
  buildGif({ source: '09-blocked-waiting.html', name: 'anim-blocked.gif', frames: 10, spanSeconds: 1.6, width: 380, height: 260, delayCs: 16 })
}

module.exports = { decodePng, encodeGif, quantize, freeze }

if (require.main === module) main()
