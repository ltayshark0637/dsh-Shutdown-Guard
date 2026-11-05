#!/usr/bin/env node
/**
 * gen-icon-mono.cjs — 设置页导航行用的单色 mask 图标（零依赖，纯 Node）。
 *
 *   node scripts/gen-icon-mono.cjs
 *
 * 宿主只认 id 映射，不读插件自定义图标，所以客户端会在运行时把这一行的 <svg>
 * 换成 CSS mask-image：图形从 PNG 的 alpha 通道取，颜色由 currentColor 给。
 * 因此这里只出一色 —— 白 #ffffff 填充、镂空处真的 alpha=0，任何彩色信息都会被丢掉。
 *
 * 产物（写进 assets/）：
 *   assets/icon-mono-transparent-64.png    64×64   透明背景，纯 alpha（mask 源）
 *   assets/icon-mono-transparent-128.png   128×128 同上
 *   assets/icon-mono-opaque-64.png         64×64   #0b0d10 满幅底 + 白色图形（不吃 mask 的兜底）
 *   assets/icon-mono-opaque-128.png        128×128 同上
 *   assets/icon-mono-sheet.png             白底/深底 × 64/128 的肉眼验收图
 *
 * 造型直接复用 gen-icon-shield.cjs 的变体 1：实心盾 + 打穿的关机符号负形，盾高占画布 68%。
 * 无随机数、无时间戳，两次运行 sha256 一致。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Canvas, cover, encodePNG, OUT_DIR } = require('./gen-icon.cjs');
const { buildShieldPts, convexSDF, glyphParts } = require('./gen-icon-shield.cjs');

const WHITE = [255, 255, 255];
const DARK = [11, 13, 16];

/**
 * 画一枚单色盾。
 * @param {number} size   目标边长
 * @param {boolean} opaque true = 满幅深底 + 白图形；false = 透明底 + 白图形
 * @param {number[]} ink  图形颜色（对比图里会换成深色，用来模拟白底上的 currentColor）
 */
function renderMono(size, opaque, ink = WHITE) {
  const cv = new Canvas(size);
  const sc = size / 100;
  const T = (p) => p * sc;

  const outer = convexSDF(buildShieldPts().map(([x, y]) => [T(x), T(y)]));
  const g = glyphParts(T, size);
  const glyph = (u, v) => Math.min(g.ring(u, v), g.bar(u, v));

  const cOuter = cover(outer);
  const cGlyph = cover(glyph);

  if (opaque) cv.paint(() => 1, DARK, 1);         // 满幅铺底
  const body = (u, v) => cOuter(u, v) * (1 - cGlyph(u, v)); // 负形打穿：镂空处 alpha 归零
  cv.paint(body, ink, 1);
  return cv;
}

// ---------------------------------------------------------------- 对比图
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
}

function renderSheet() {
  const PAD = 24;
  const BIG = 128;
  const SMALL = 64;
  const GAP = 22;
  const W = PAD * 2 + BIG + GAP + SMALL;
  const rowH = PAD * 2 + BIG;

  const sheet = new Sheet(W, rowH * 2 + 8);
  // 上：白底 + 深色 currentColor（模拟浅色主题下 mask 的效果）
  sheet.fillRect(0, 0, W, rowH, WHITE);
  // 下：深底 + 浅色 currentColor（模拟深色主题，等价于不透明兜底图）
  sheet.fillRect(0, rowH + 8, W, rowH, DARK);

  const rows = [
    { y: 0, bg: WHITE, ink: DARK },
    { y: rowH + 8, bg: DARK, ink: WHITE },
  ];
  for (const row of rows) {
    const big = renderMono(BIG, false, row.ink);
    sheet.blit(big.resolve(), BIG, BIG, PAD, row.y + PAD);
    const small = renderMono(SMALL, false, row.ink);
    sheet.blit(small.resolve(), SMALL, SMALL, PAD + BIG + GAP, row.y + PAD + BIG - SMALL);
  }
  return sheet;
}

// ---------------------------------------------------------------- 输出
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jobs = [];
  for (const size of [64, 128]) {
    for (const opaque of [false, true]) {
      const kind = opaque ? 'opaque' : 'transparent';
      const buf = encodePNG(size, size, renderMono(size, opaque).resolve());
      const file = path.join(OUT_DIR, `icon-mono-${kind}-${size}.png`);
      fs.writeFileSync(file, buf);
      jobs.push({ file, size: `${size}x${size}`, bytes: buf.length });
    }
  }
  const sheet = renderSheet();
  const sheetBuf = encodePNG(sheet.w, sheet.h, sheet.px);
  const sheetFile = path.join(OUT_DIR, 'icon-mono-sheet.png');
  fs.writeFileSync(sheetFile, sheetBuf);
  jobs.push({ file: sheetFile, size: `${sheet.w}x${sheet.h}`, bytes: sheetBuf.length });

  for (const j of jobs) {
    const rel = path.relative(path.join(__dirname, '..'), j.file).replace(/\\/g, '/');
    console.log(`${rel}  ${j.size}  ${j.bytes} bytes`);
  }
}

if (require.main === module) main();

module.exports = { renderMono, renderSheet };
