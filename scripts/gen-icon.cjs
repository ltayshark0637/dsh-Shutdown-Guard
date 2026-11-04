#!/usr/bin/env node
/**
 * gen-icon.cjs — 生成 v1.5.2 的两套图标素材（零依赖，纯 Node）。
 *
 *   node scripts/gen-icon.cjs
 *
 * 产物（全部写进仓库 assets/）：
 *   assets/icon-180.png               180×180，awesome-dsh-plugin 条目 icon 字段用（PNG 位图）
 *   assets/icon-settings-<n>-64.png   64×64  设置行图标候选 n=1..3（透明背景）
 *   assets/icon-settings-<n>-128.png  128×128 同上
 *
 * 设计口径：贴仓库 CSS 的工业仪表风 —— 深色终端底 #0b0d10、警示带（45° 斜纹）、
 * 主色琥珀 #f5a623（--dsw-alias-button-primary-fill）、品牌橘 #d97757（--dsw-brand-primary）、
 * 终端光标绿 #9ef0a8、阻塞灰蓝 #7e8aa3。
 * 全部图形由参数化几何绘制 + 4× 超采样降采样，不含随机数，因此两次运行字节一致。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');
const SS = 4; // 超采样倍数

// ---------------------------------------------------------------- 基础色板
const C = {
  dark: [11, 13, 16],      // #0b0d10 终端底
  amber: [245, 166, 35],   // #f5a623 主按钮/警戒
  brand: [217, 119, 87],   // #d97757 品牌橘
  green: [158, 240, 168],  // #9ef0a8 光标绿
  slate: [126, 138, 163],  // #7e8aa3 阻塞灰蓝
  white: [255, 255, 255],
};

// ---------------------------------------------------------------- PNG 编码
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filter
  ihdr[12] = 0; // no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None（保证字节确定）
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ 画布（超采样）
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

class Canvas {
  constructor(size) {
    this.size = size;
    this.w = size * SS;
    this.d = new Float32Array(this.w * this.w * 4); // 预乘 alpha
  }
  /** cov(u,v) -> 0..1 覆盖率，u/v 为目标尺寸坐标系 */
  paint(cov, color, alpha = 1) {
    const [r, g, b] = color;
    const w = this.w;
    const d = this.d;
    for (let y = 0; y < w; y++) {
      const v = (y + 0.5) / SS;
      for (let x = 0; x < w; x++) {
        const c = cov((x + 0.5) / SS, v);
        if (c <= 0) continue;
        const sa = clamp01(c) * alpha;
        const i = (y * w + x) * 4;
        const inv = 1 - sa;
        d[i] = r * sa + d[i] * inv;
        d[i + 1] = g * sa + d[i + 1] * inv;
        d[i + 2] = b * sa + d[i + 2] * inv;
        d[i + 3] = sa + d[i + 3] * inv;
      }
    }
  }
  /** 4×4 盒式降采样 → 直通 alpha 的 RGBA */
  resolve() {
    const { size, w, d } = this;
    const out = Buffer.alloc(size * size * 4);
    const n = SS * SS;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let R = 0, G = 0, B = 0, A = 0;
        for (let j = 0; j < SS; j++) {
          for (let i = 0; i < SS; i++) {
            const p = ((y * SS + j) * w + (x * SS + i)) * 4;
            R += d[p]; G += d[p + 1]; B += d[p + 2]; A += d[p + 3];
          }
        }
        const a = A / n;
        const o = (y * size + x) * 4;
        if (a > 0) {
          out[o] = Math.min(255, Math.round(R / n / a));
          out[o + 1] = Math.min(255, Math.round(G / n / a));
          out[o + 2] = Math.min(255, Math.round(B / n / a));
        }
        out[o + 3] = Math.min(255, Math.round(a * 255));
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- 几何（SDF）
const sdf = {
  /** 圆角矩形 */
  roundRect(x, y, w, h, r) {
    const cx = x + w / 2, cy = y + h / 2, hx = w / 2 - r, hy = h / 2 - r;
    return (u, v) => {
      const qx = Math.abs(u - cx) - hx;
      const qy = Math.abs(v - cy) - hy;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
    };
  },
  /** 圆环（可留顶部缺口 gap=[起始角, 结束角]，角度为屏幕坐标，上=270） */
  ring(cx, cy, r, sw, gap) {
    return (u, v) => {
      const dx = u - cx, dy = v - cy;
      const dist = Math.hypot(dx, dy);
      if (gap) {
        let a = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (a < 0) a += 360;
        if (a > gap[0] && a < gap[1]) return 1e9;
      }
      return Math.abs(dist - r) - sw / 2;
    };
  },
  /** 线段（胶囊） */
  capsule(x1, y1, x2, y2, sw) {
    return (u, v) => {
      const vx = x2 - x1, vy = y2 - y1;
      const wx = u - x1, wy = v - y1;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
      return Math.hypot(wx - vx * t, wy - vy * t) - sw / 2;
    };
  },
  /** 折线描边（圆头圆角） */
  stroke(points, sw) {
    const segs = [];
    for (let i = 0; i + 1 < points.length; i++) segs.push([...points[i], ...points[i + 1]]);
    return (u, v) => {
      let best = 1e9;
      for (const [x1, y1, x2, y2] of segs) {
        const vx = x2 - x1, vy = y2 - y1;
        const wx = u - x1, wy = v - y1;
        const len2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
        best = Math.min(best, Math.hypot(wx - vx * t, wy - vy * t) - sw / 2);
      }
      return best;
    };
  },
  /** 圆盘 */
  disc(cx, cy, r) {
    return (u, v) => Math.hypot(u - cx, v - cy) - r;
  },
};

/** SDF（单位=目标像素）→ 覆盖率函数；extra 可选：附加布尔掩膜 */
function cover(fn, extra) {
  return (u, v) => {
    if (extra && !extra(u, v)) return 0;
    return clamp01(0.5 - fn(u, v) * SS);
  };
}

/** 布尔掩膜 → 覆盖率（0/1） */
function maskCover(mask) {
  return (u, v) => (mask(u, v) ? 1 : 0);
}

function polyMask(points) {
  return (u, v) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

// ---------------------------------------------------------------- 图案构件
/** 关机符号：开口圆环 + 顶部竖条（环两端加圆头，避免斜切尖角） */
function powerGlyph(cx, cy, r, sw) {
  const gap = [235, 305];
  const end = (deg) => {
    const a = (deg * Math.PI) / 180;
    return sdf.disc(cx + r * Math.cos(a), cy + r * Math.sin(a), sw / 2);
  };
  return {
    ring: sdf.ring(cx, cy, r, sw, gap),
    capA: end(gap[0]),
    capB: end(gap[1]),
    bar: sdf.capsule(cx, cy - r - sw * 0.35, cx, cy - r * 0.28, sw),
  };
}

/** 45° 警示斜纹掩膜（x+y 周期） */
function hazardMask(x0, y0, x1, y1, period, ratio) {
  return (u, v) => u >= x0 && u <= x1 && v >= y0 && v <= y1 && ((u + v) % period) / period < ratio;
}

// ---------------------------------------------------------------- 素材 A
function renderAppIcon180() {
  const S = 180, R = 38;
  const cv = new Canvas(S);
  const tile = sdf.roundRect(0, 0, S, S, R);
  const inside = (u, v) => tile(u, v) <= 0;

  // 深色底
  cv.paint(cover(tile), C.dark, 1);
  // 底部警示斜纹（裁进圆角矩形）
  cv.paint(maskCover(hazardMask(0, 132, S, S, 26, 0.5)), C.amber, 1);
  // 斜纹与上半区分隔线
  cv.paint(cover(sdf.capsule(16, 132, S - 16, 132, 2)) , C.amber, 0.55);
  // 外描边：区分深浅背景
  cv.paint(cover((u, v) => Math.abs(tile(u, v)) - 1.5), C.amber, 0.5);
  // 关机符号
  const g = powerGlyph(90, 82, 40, 13);
  cv.paint(cover(g.ring), C.amber, 1);
  cv.paint(cover(g.capA), C.amber, 1);
  cv.paint(cover(g.capB), C.amber, 1);
  cv.paint(cover(g.bar), C.amber, 1);
  return cv;
}

// ---------------------------------------------------------------- 素材 B
// 1) 关机符号（琥珀）  2) 盾牌 + 关机符号（琥珀盾、绿芯）  3) 雷达扫掠（灰蓝环、琥珀扇形、绿点）
const SETTINGS_VARIANTS = ['1', '2', '3'];

// ---------------------------------------------------------------- 输出
function writePng(name, canvas) {
  const size = canvas.size;
  const buf = encodePNG(size, size, canvas.resolve());
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, buf);
  return { file, size, bytes: buf.length };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [];
  jobs.push(writePng('icon-180.png', renderAppIcon180()));
  for (const n of SETTINGS_VARIANTS) {
    for (const target of [64, 128]) {
      const cv = new Canvas(target);
      drawVariant(cv, n, target / 100);
      jobs.push(writePng(`icon-settings-${n}-${target}.png`, cv));
    }
  }
  for (const j of jobs) {
    const rel = path.relative(path.join(__dirname, '..'), j.file).replace(/\\/g, '/');
    console.log(`${rel}  ${j.size}x${j.size}  ${j.bytes} bytes`);
  }
}

/** 按目标尺寸重绘候选（scale = size/100），保证不同尺寸笔触比例一致 */
function drawVariant(cv, n, scale) {
  const T = (p) => p * scale;
  // 深色描边（keyline）：透明背景下浅色主题也看得见轮廓，深色主题里几乎不可见
  const K = Math.max(1.5, T(3.5));
  const KEY = 0.55;
  if (n === '1') {
    const halo = powerGlyph(T(50), T(53), T(27), Math.max(1, T(9)) + K);
    cv.paint(cover(halo.ring), C.dark, KEY);
    cv.paint(cover(halo.capA), C.dark, KEY);
    cv.paint(cover(halo.capB), C.dark, KEY);
    cv.paint(cover(halo.bar), C.dark, KEY);
    const g = powerGlyph(T(50), T(53), T(27), Math.max(1, T(9)));
    cv.paint(cover(g.ring), C.amber, 1);
    cv.paint(cover(g.capA), C.amber, 1);
    cv.paint(cover(g.capB), C.amber, 1);
    cv.paint(cover(g.bar), C.amber, 1);
    return;
  }
  if (n === '2') {
    const pts = [[50, 8], [84, 20], [84, 44], [74, 70], [50, 92], [26, 70], [16, 44], [16, 20], [50, 8]]
      .map(([x, y]) => [T(x), T(y)]);
    cv.paint(cover(sdf.stroke(pts, Math.max(1, T(7)) + K)), C.dark, KEY);
    cv.paint(cover(sdf.stroke(pts, Math.max(1, T(7)))), C.amber, 1);
    const halo = powerGlyph(T(50), T(49), T(14.5), Math.max(1, T(6.5)) + K);
    cv.paint(cover(halo.ring), C.dark, KEY);
    cv.paint(cover(halo.capA), C.dark, KEY);
    cv.paint(cover(halo.capB), C.dark, KEY);
    cv.paint(cover(halo.bar), C.dark, KEY);
    const g = powerGlyph(T(50), T(49), T(14.5), Math.max(1, T(6.5)));
    cv.paint(cover(g.ring), C.green, 1);
    cv.paint(cover(g.capA), C.green, 1);
    cv.paint(cover(g.capB), C.green, 1);
    cv.paint(cover(g.bar), C.green, 1);
    return;
  }
  // 3) 守夜：月牙（外圆减内圆）+ 三颗回波点 —— 32px 下仍能认出「夜里守着」
  const cA = cover(sdf.disc(T(53), T(52), T(35)));
  const cB = cover(sdf.disc(T(74), T(40), T(32)));
  const hA = cover(sdf.disc(T(53), T(52), T(35) + K / 2));
  const hB = cover(sdf.disc(T(74), T(40), T(32) - K / 2));
  cv.paint((u, v) => Math.max(0, hA(u, v) - hB(u, v)), C.dark, KEY);
  cv.paint((u, v) => Math.max(0, cA(u, v) - cB(u, v)), C.amber, 1);
  cv.paint(cover(sdf.disc(T(78), T(24), T(4.5) + K / 2)), C.dark, KEY);
  cv.paint(cover(sdf.disc(T(78), T(24), T(4.5))), C.green, 0.95);
  cv.paint(cover(sdf.disc(T(85), T(41), T(3) + K / 2)), C.dark, KEY);
  cv.paint(cover(sdf.disc(T(85), T(41), T(3))), C.green, 0.8);
  cv.paint(cover(sdf.disc(T(68), T(13), T(2.5) + K / 2)), C.dark, KEY);
  cv.paint(cover(sdf.disc(T(68), T(13), T(2.5))), C.green, 0.65);
}

main();

// 生成器本体只在直接运行时执行；gen-candidates.cjs 复用下面这些画法。
if (require.main === module) main();

module.exports = { C, SS, Canvas, sdf, cover, maskCover, polyMask, encodePNG, powerGlyph, hazardMask, drawVariant, writePng, OUT_DIR };
