#!/usr/bin/env node
/**
 * gen-icon-shield.cjs — 盾牌图标两变体（零依赖，纯 Node）。
 *
 *   node scripts/gen-icon-shield.cjs
 *
 * 产物（写进 assets/）：
 *   assets/icon-shield-1-{36,128,180}.png   「纯盾」：实心琥珀盾 + 负形关机符号
 *   assets/icon-shield-2-{36,128,180}.png   「双色盾」：琥珀盾 + 30% 深色内嵌层 + 实心琥珀关机符号
 *   assets/icon-shield-sheet.png            深底 / 白底两组，128 与 36 实尺寸并排
 *
 * 设计口径（来自 icon-design 技能的 S1/S7 + 实测约束）：
 *   - 图形占画布 68%（盾高 68/100，宽 55/100），留白呼吸；
 *   - 层次用「同形 β 层」而不是两色等面积对撞：V1 用负形打穿，V2 用 30% 深色内嵌；
 *   - 36px 单独重绘（非缩放），关机符号线宽 8.5 设计单位 × 0.36 = 3.06px ≥ 3px；
 *   - 外轮廓内衬 keyline（36 档 1.4px / 128 档 2.2px / 180 档 2.8px），白底与 #0b0d10 都立得住。
 * 全部图形由参数化几何绘制 + 4× 超采样降采样，无随机数、无时间戳，两次运行字节一致。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { C, Canvas, sdf, cover, encodePNG, powerGlyph, OUT_DIR } = require('./gen-icon.cjs');

const AMBER = C.amber;
const DARK = C.dark;

// ---------------------------------------------------------------- 盾形
// 设计坐标系 100×100：盾顶 y=15、盾尖 y=85（高 68），半宽 27.5，肩线 y=40，顶角圆角 6.5。
const SHAPE = { cx: 50, top: 15, tip: 85, halfW: 27.5, shoulder: 40, cornerR: 6.5 };
const ARC_STEPS = 10;
const BEZ_STEPS = 16;

/** 右半轮廓（顶心 → 右上圆角 → 直边 → 贝塞尔收尖），再镜像出左半，得到顺时针凸多边形 */
function buildShieldPts() {
  const { cx, top, tip, halfW, shoulder, cornerR } = SHAPE;
  const right = [];
  const xt = cx + halfW - cornerR;
  right.push([cx, top]);
  right.push([xt, top]);
  for (let i = 1; i <= ARC_STEPS; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / ARC_STEPS);
    right.push([xt + cornerR * Math.cos(a), top + cornerR + cornerR * Math.sin(a)]);
  }
  right.push([cx + halfW, shoulder]);
  const P0 = [cx + halfW, shoulder];
  const P1 = [cx + halfW - 0.5, shoulder + 20];
  const P2 = [cx + 12, tip - 11];
  const P3 = [cx, tip];
  for (let i = 1; i <= BEZ_STEPS; i++) {
    const t = i / BEZ_STEPS;
    const m = 1 - t;
    right.push([
      m * m * m * P0[0] + 3 * m * m * t * P1[0] + 3 * m * t * t * P2[0] + t * t * t * P3[0],
      m * m * m * P0[1] + 3 * m * m * t * P1[1] + 3 * m * t * t * P2[1] + t * t * t * P3[1],
    ]);
  }
  const left = right
    .slice(0, -1)                 // 去掉盾尖，避免重复点
    .map(([x, y]) => [2 * cx - x, y])
    .reverse()
    .slice(0, -1);                // 去掉镜像回来的盾顶中点
  return right.concat(left);
}

/** 凸多边形 SDF（y 向下的顺时针绕序，外法线 = (ey, -ex)） */
function convexSDF(pts) {
  const E = new Float64Array(pts.length * 4);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    E[i * 4] = a[0];
    E[i * 4 + 1] = a[1];
    E[i * 4 + 2] = ey / len;
    E[i * 4 + 3] = -ex / len;
  }
  return (u, v) => {
    let d = -Infinity;
    for (let i = 0; i < E.length; i += 4) {
      const t = (u - E[i]) * E[i + 2] + (v - E[i + 1]) * E[i + 3];
      if (t > d) d = t;
    }
    return d;
  };
}

// ---------------------------------------------------------------- 渲染
/** 每个尺寸单独给 keyline 宽度（像素），保证 36 档也有一道能看见的轮廓 */
const RIM_PX = { 36: 1.2, 128: 2.0, 180: 2.4 };

function rimFor(size, sc) {
  return RIM_PX[size] || Math.max(1.2, 2.0 * sc);
}

/** 关机符号：细竖条 + 开口圆环（圆环端头平切，竖条两端留出间隙，避免糊成「钥匙孔」） */
const GLYPH = { cx: 50, cy: 44, r: 12.5, sw: 8.6, barW: 5.4, barOut: 6.6 };

/**
 * 36px 档单独加粗：小尺寸下竖条不放大就会掉到 2px 以下而看不见，
 * 圆环开口放宽到 90° 才留得住竖条与环之间的缝。
 */
function glyphParts(T, size) {
  const { cx, cy, r, sw, barW, barOut } = GLYPH;
  const small = size <= 40;
  const gap = small ? [224, 316] : [233, 307];
  const bw = small ? barW * 1.3 : barW;      // 36 档 7.0 → 2.5px
  const bo = small ? barOut * 0.92 : barOut;
  const ring = sdf.ring(T(cx), T(cy), T(r), T(sw), gap);
  const bar = sdf.capsule(
    T(cx), T(cy - r - bo),
    T(cx), T(cy - (r - sw / 2)),
    T(bw)
  );
  return { ring, bar };
}

function renderShield(variant, size) {
  const cv = new Canvas(size);
  const sc = size / 100;
  const T = (p) => p * sc;

  const outer = convexSDF(buildShieldPts().map(([x, y]) => [T(x), T(y)]));
  const inner = (u, v) => outer(u, v) + T(7);            // 同形内嵌一层（等距偏置，不是等比缩放）
  const rp = rimFor(size, sc);
  const rim = (u, v) => Math.abs(outer(u, v) + rp / 2) - rp / 2; // 贴着轮廓内侧的一道 keyline

  const g = glyphParts(T, size);
  const glyph = (u, v) => Math.min(g.ring(u, v), g.bar(u, v));

  const cOuter = cover(outer);
  const cInner = cover(inner);
  const cRim = cover(rim);
  const cGlyph = cover(glyph);

  if (variant === 1) {
    // 纯盾：关机符号是打穿的负形，白底上呈白、深底上呈 #0b0d10
    const body = (u, v) => cOuter(u, v) * (1 - cGlyph(u, v));
    cv.paint(body, AMBER, 1);
    cv.paint(cRim, DARK, 0.9);
  } else {
    // 双色盾：同形深色内嵌（30% 透明 → alpha 0.70）做出厚度；盾心实心琥珀关机符号
    cv.paint(cOuter, AMBER, 1);
    cv.paint(cRim, DARK, 0.9);
    cv.paint(cInner, DARK, 0.7);
    cv.paint(cGlyph, AMBER, 1);
  }
  return cv;
}

// ---------------------------------------------------------------- 对比图
const DIGITS = {
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
};

class Sheet {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4);
  }
  fillRect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const o = (j * this.w + i) * 4;
        this.px[o] = color[0]; this.px[o + 1] = color[1]; this.px[o + 2] = color[2]; this.px[o + 3] = 255;
      }
    }
  }
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
  const PAD = 24;
  const BIG = 128;
  const SMALL = 36;
  const LABEL_H = 26;
  const GAP_INSIDE = 18;
  const COL_GAP = 40;
  const groupW = PAD * 2 + 2 * (BIG + GAP_INSIDE + SMALL) + COL_GAP;
  const groupH = PAD * 2 + LABEL_H + BIG;
  const W = groupW;
  const H = groupH * 2 + 8;

  const sheet = new Sheet(W, H);
  sheet.fillRect(0, 0, W, groupH, DARK);
  sheet.fillRect(0, groupH + 8, W, groupH, [255, 255, 255]);

  for (let group = 0; group < 2; group++) {
    const baseY = group === 0 ? 0 : groupH + 8;
    const label = group === 0 ? [139, 136, 126] : [91, 100, 114];
    for (let idx = 0; idx < 2; idx++) {
      const x = PAD + idx * (BIG + GAP_INSIDE + SMALL + COL_GAP);
      const y = baseY + PAD;
      sheet.digit(idx + 1, x, y, 2, label);
      const big = renderShield(idx + 1, BIG);
      sheet.blit(big.resolve(), BIG, BIG, x, y + LABEL_H);
      const small = renderShield(idx + 1, SMALL);
      sheet.blit(small.resolve(), SMALL, SMALL, x + BIG + GAP_INSIDE, y + LABEL_H + BIG - SMALL);
    }
  }
  return sheet;
}

// ---------------------------------------------------------------- 输出
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [];
  for (const variant of [1, 2]) {
    for (const size of [36, 128, 180]) {
      const cv = renderShield(variant, size);
      const buf = encodePNG(size, size, cv.resolve());
      const file = path.join(OUT_DIR, `icon-shield-${variant}-${size}.png`);
      fs.writeFileSync(file, buf);
      jobs.push({ file, size: `${size}x${size}`, bytes: buf.length });
    }
  }
  const sheet = renderSheet();
  const sheetBuf = encodePNG(sheet.w, sheet.h, sheet.px);
  const sheetFile = path.join(OUT_DIR, 'icon-shield-sheet.png');
  fs.writeFileSync(sheetFile, sheetBuf);
  jobs.push({ file: sheetFile, size: `${sheet.w}x${sheet.h}`, bytes: sheetBuf.length });

  for (const j of jobs) {
    const rel = path.relative(path.join(__dirname, '..'), j.file).replace(/\\/g, '/');
    console.log(`${rel}  ${j.size}  ${j.bytes} bytes`);
  }
}

main();
