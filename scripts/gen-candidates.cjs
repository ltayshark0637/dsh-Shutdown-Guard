#!/usr/bin/env node
/**
 * gen-candidates.cjs — 六个图标概念候选 + 一张深浅底对比图（零依赖，纯 Node）。
 *
 *   node scripts/gen-candidates.cjs
 *
 * 产物（写进 assets/）：
 *   assets/candidate-<n>-128.png   128×128，插件列表/设置页 2× DPR 场景
 *   assets/candidate-<n>-36.png     36×36，插件列表的真实展示尺寸（专门绘制，不是缩图）
 *   assets/candidates-sheet.png    3 列 × 2 行 × 深浅两组对比图，每格 128 + 36 实尺寸 + 编号
 *
 * 画法复用 scripts/gen-icon.cjs 的 SDF + 内建 PNG 编码器：
 * 所有图形按 100×100 设计坐标给出，再按目标尺寸重绘并单独调线宽，
 * 因此 36px 版本是「重新画」而不是「缩图」。无随机数、无外部字体，两次运行字节一致。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { C, Canvas, sdf, cover, maskCover, polyMask, encodePNG, OUT_DIR } = require('./gen-icon.cjs');

// ---------------------------------------------------------------- 构件
/** 关机符号：开口圆环 + 顶部竖条；ring 两端补圆头，避免角度硬切出斜边 */
function powerShape(cx, cy, r, sw, gap) {
  const end = (deg) => {
    const a = (deg * Math.PI) / 180;
    return sdf.disc(cx + r * Math.cos(a), cy + r * Math.sin(a), sw / 2);
  };
  return {
    ring: sdf.ring(cx, cy, r, sw, gap),
    capA: end(gap[0]),
    capB: end(gap[1]),
    bar: sdf.capsule(cx, cy - r - sw * 0.32, cx, cy - r * 0.24, sw),
  };
}

/** 把四个 SDF 部件按 keyline → 实色 的顺序画上去 */
function paintParts(cv, parts, color, keyline, keyAlpha) {
  for (const fn of parts) cv.paint(cover(fn), C.dark, keyAlpha);
  for (const fn of parts) cv.paint(cover(fn), color, 1);
}

/** 带 keyline 的单个 SDF 形状 */
function paintShape(cv, fn, color, offset, keyAlpha) {
  if (offset > 0) cv.paint(cover((u, v) => fn(u, v) - offset), C.dark, keyAlpha);
  cv.paint(cover(fn), color, 1);
}

// ---------------------------------------------------------------- 六个概念
const CONCEPTS = {
  // 1) 电源环（改良）：环更粗、开口更小，36px 下环与竖条几乎连成一体
  1(cv, T, thin, K, KEY) {
    const sw = T(thin ? 16.5 : 13.5);
    const r = T(27);
    const g = powerShape(T(50), T(54), r, sw, [252, 288]);
    paintParts(cv, [g.ring, g.capA, g.capB, g.bar], C.amber, null, KEY);
  },

  // 2) 盾牌 + 电源：守卫语义，盾用琥珀、芯用光标绿
  2(cv, T, thin, K, KEY) {
    const pts = [[50, 8], [84, 20], [84, 44], [74, 70], [50, 92], [26, 70], [16, 44], [16, 20], [50, 8]]
      .map(([x, y]) => [T(x), T(y)]);
    const shield = sdf.stroke(pts, T(thin ? 9.5 : 7.5));
    paintShape(cv, shield, C.amber, K, KEY);
    const g = powerShape(T(50), T(49), T(thin ? 15 : 14), T(thin ? 8.5 : 6.5), [240, 300]);
    paintParts(cv, [g.ring, g.capA, g.capB, g.bar], C.green, null, KEY);
  },

  // 3) 月牙 + 三点：守夜语义（36px 只留两颗点，避免糊成一片）
  3(cv, T, thin, K, KEY) {
    const outer = sdf.disc(T(53), T(52), T(35));
    const inner = sdf.disc(T(74), T(40), T(32));
    const hOuter = sdf.disc(T(53), T(52), T(35) + K / 2);
    const hInner = sdf.disc(T(74), T(40), T(32) - K / 2);
    cv.paint((u, v) => Math.max(0, cover(hOuter)(u, v) - cover(hInner)(u, v)), C.dark, KEY);
    cv.paint((u, v) => Math.max(0, cover(outer)(u, v) - cover(inner)(u, v)), C.amber, 1);
    const dots = thin
      ? [[80, 24, 6], [87, 43, 4]]
      : [[78, 24, 4.5], [85, 41, 3], [68, 13, 2.5]];
    const alphas = thin ? [0.95, 0.8] : [0.95, 0.8, 0.65];
    dots.forEach(([x, y, r], i) => {
      const fn = sdf.disc(T(x), T(y), T(r));
      cv.paint(cover((u, v) => fn(u, v) - K / 2), C.dark, KEY);
      cv.paint(cover(fn), C.green, alphas[i]);
    });
  },

  // 4) 沙漏 + 断开的环：倒计时语义；36px 用实心沙漏轮廓代替细线
  4(cv, T, thin, K, KEY) {
    const ring = sdf.ring(T(50), T(50), T(42), T(thin ? 6 : 4.5), [55, 125]);
    paintShape(cv, ring, C.green, K / 2, KEY);
    // 实心两个三角（128 也用实心：细线版在 36px 会糊成蝴蝶结）
    const topTri = polyMask([[28, 21], [72, 21], [50, 50]].map(([x, y]) => [T(x), T(y)]));
    const botTri = polyMask([[28, 79], [72, 79], [50, 50]].map(([x, y]) => [T(x), T(y)]));
    for (const tri of [topTri, botTri]) {
      cv.paint(cover((u, v) => (tri(u, v) ? -1 : 1), null), C.dark, KEY);
      cv.paint(maskCover(tri), C.amber, 1);
    }
    const capTop = sdf.capsule(T(24), T(19), T(76), T(19), T(thin ? 9 : 8));
    const capBot = sdf.capsule(T(24), T(81), T(76), T(81), T(thin ? 9 : 8));
    paintShape(cv, capTop, C.amber, K, KEY);
    paintShape(cv, capBot, C.amber, K, KEY);
  },

  // 5) 同心哨戒圆 + 中心电源点：灰蓝环圈像雷达刻度，中心琥珀点是能量核心
  5(cv, T, thin, K, KEY) {
    const rings = thin ? [33, 21] : [34, 24, 14];
    const widths = thin ? [6.5, 5] : [5, 4, 3.5];
    rings.forEach((r, i) => {
      const fn = sdf.ring(T(50), T(50), T(r), T(widths[i]), null);
      paintShape(cv, fn, C.slate, K / 2, KEY);
    });
    const g = powerShape(T(50), T(50), T(thin ? 11 : 9.5), T(thin ? 6 : 4.5), [250, 290]);
    paintParts(cv, [g.ring, g.capA, g.capB, g.bar], C.amber, null, KEY);
  },

  // 6) 极简几何：圆角方框上方开口 + 一条竖线插入，抽象成「电源插座」
  6(cv, T, thin, K, KEY) {
    const frame = sdf.roundRect(T(20), T(20), T(60), T(60), T(14));
    const ringWidth = T(thin ? 8 : 7);
    const frameRing = (u, v) => Math.abs(frame(u, v)) - ringWidth / 2;
    const notch = (u, v) => !(u > T(41) && u < T(59) && v < T(32));
    cv.paint(cover((u, v) => frameRing(u, v) - K, notch), C.dark, KEY);
    cv.paint(cover(frameRing, notch), C.amber, 1);
    const bar = sdf.capsule(T(50), T(48), T(50), T(17), T(thin ? 10 : 9));
    paintShape(cv, bar, C.amber, K, KEY);
  },
};

/** 按目标尺寸重绘（100 坐标 → 目标坐标） */
function renderConcept(n, size) {
  const cv = new Canvas(size);
  const T = (p) => (p * size) / 100;
  const thin = size <= 40;
  const K = Math.max(1.5, T(3.5));
  CONCEPTS[n](cv, T, thin, K, 0.55);
  return cv;
}

// ---------------------------------------------------------------- 对比图
// 5×7 数字字形，用来在对比图上标号（不依赖任何字体文件）
const DIGITS = {
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
};

class Sheet {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4); // 直通 alpha，最终全不透明
  }
  fillRect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const o = (j * this.w + i) * 4;
        this.px[o] = color[0]; this.px[o + 1] = color[1]; this.px[o + 2] = color[2]; this.px[o + 3] = 255;
      }
    }
  }
  /** 把图标的预乘 alpha 结果按 source-over 叠到给定坐标 */
  blit(src, sw, sh, x, y) {
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const s = (j * sw + i) * 4;
        const a = src[s + 3] / 255;
        if (a <= 0) continue;
        const d = ((y + j) * this.w + (x + i)) * 4;
        for (let c = 0; c < 3; c++) this.px[d + c] = Math.round(src[s + c] * a + this.px[d + c] * (1 - a));
        this.px[d + 3] = 255;
      }
    }
  }
  digit(n, x, y, scale, color) {
    const glyph = DIGITS[n];
    for (let ry = 0; ry < glyph.length; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (glyph[ry][rx] !== '1') continue;
        this.fillRect(x + rx * scale, y + ry * scale, scale, scale, color);
      }
    }
  }
}

function renderSheet() {
  const PAD = 26;
  const CELL_W = 128;
  const COL_GAP = 34;
  const ROW_GAP = 30;
  const LABEL_H = 26;
  const SMALL_GAP = 16;
  const SMALL = 36;
  const cellH = LABEL_H + CELL_W + SMALL_GAP + SMALL;
  const cols = 3;
  const rows = 2;
  const groupW = PAD * 2 + cols * CELL_W + (cols - 1) * COL_GAP;
  const groupH = PAD * 2 + rows * cellH + (rows - 1) * ROW_GAP + 10;
  const W = groupW;
  const H = groupH * 2 + 8;

  const sheet = new Sheet(W, H);
  const dark = C.dark, light = [255, 255, 255];
  const labelDark = [139, 136, 126];
  const labelLight = [91, 100, 114];
  sheet.fillRect(0, 0, W, groupH, dark);
  sheet.fillRect(0, groupH + 8, W, groupH, light);

  for (let group = 0; group < 2; group++) {
    const baseY = group === 0 ? 0 : groupH + 8;
    const label = group === 0 ? labelDark : labelLight;
    for (let idx = 0; idx < 6; idx++) {
      const n = String(idx + 1);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = PAD + col * (CELL_W + COL_GAP);
      const y = baseY + PAD + row * (cellH + ROW_GAP);
      sheet.digit(idx + 1, x, y, 2, label);
      const big = renderConcept(n, CELL_W);
      sheet.blit(big.resolve(), CELL_W, CELL_W, x, y + LABEL_H);
      const small = renderConcept(n, SMALL);
      sheet.blit(
        small.resolve(), SMALL, SMALL,
        x + Math.round((CELL_W - SMALL) / 2),
        y + LABEL_H + CELL_W + SMALL_GAP
      );
    }
  }
  return sheet;
}

// ---------------------------------------------------------------- 输出
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [];
  for (const n of ['1', '2', '3', '4', '5', '6']) {
    for (const size of [128, 36]) {
      const cv = renderConcept(n, size);
      const buf = encodePNG(size, size, cv.resolve());
      const file = path.join(OUT_DIR, `candidate-${n}-${size}.png`);
      fs.writeFileSync(file, buf);
      jobs.push({ file, size, bytes: buf.length });
    }
  }
  const sheet = renderSheet();
  const sheetBuf = encodePNG(sheet.w, sheet.h, sheet.px);
  const sheetFile = path.join(OUT_DIR, 'candidates-sheet.png');
  fs.writeFileSync(sheetFile, sheetBuf);
  jobs.push({ file: sheetFile, size: `${sheet.w}x${sheet.h}`, bytes: sheetBuf.length });

  for (const j of jobs) {
    const rel = path.relative(path.join(__dirname, '..'), j.file).replace(/\\/g, '/');
    console.log(`${rel}  ${j.size}  ${j.bytes} bytes`);
  }
}

if (require.main === module) main();

module.exports = { renderConcept, renderSheet, CONCEPTS };
