/**
 * render2d/citypainter.ts — 城市静态画师（世界→纸面）
 *
 * 将 CityModel 渲染为手绘涂鸦纸面地图。
 * 所有随机值均通过 rng0(seed) 生成（禁用 Math.random）。
 * street 类型道路不绘制。
 */

import type { CityModel, Building, District, Road } from '@shared/types';
import type { WorldParams } from '../world/params';
import type { WorldCanvas } from './worldcanvas';
import type { HitItem } from './hit';
import {
  PAPER,
  wobblyPath,
  wobblyRect,
  wobblyCircle,
  hatchRect,
  scribbleBlob,
  dashedPath,
} from './sketch';
import { rng0, hashStr } from '../util/seed';
import { getBiome } from './biomes';
import { buildTransport, TransportNet } from './transport';
import { polyDist } from '../util/poly';

/* ------------------------------------------------------------------ */
/* Helper: 线性插值 hex 颜色（分 R/G/B 通道）                           */
/* ------------------------------------------------------------------ */

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + bl.toString(16).padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* Helper: 建筑占地半径                                                  */
/* ------------------------------------------------------------------ */

function footprintR(b: Building): number {
  return b.size === 1 ? 1.1 : b.size === 2 ? 1.4 : 1.7;
}

/* ------------------------------------------------------------------ */
/* Helper: 平行折线偏移（法向量法）                                       */
/* ------------------------------------------------------------------ */

function offsetPolyline(
  pts: ReadonlyArray<readonly [number, number]>,
  offset: number,
): [number, number][] {
  const result: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    // 法向量（垂直于切线，指向左侧）
    const nx = -dz / len;
    const nz = dx / len;
    result.push([pts[i][0] + nx * offset, pts[i][1] + nz * offset]);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 层 1 — 纸底                                                          */
/* ------------------------------------------------------------------ */

function paintBackground(
  ctx: CanvasRenderingContext2D,
  minX: number, minZ: number, maxX: number, maxZ: number,
  rng: () => number,
  paperColor: string = PAPER.paper,
  patchColor: string = PAPER.grass,
): void {
  // 填充纸底色
  (ctx as unknown as Record<string, unknown>).fillStyle = paperColor;
  ctx.fillRect(minX, minZ, maxX - minX, maxZ - minZ);

  // 4-8 个地面斑块色块（随机圆角区域）
  (ctx as unknown as Record<string, unknown>).fillStyle = patchColor;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.3;
  const patchCount = 4 + Math.floor(rng() * 5);
  for (let pi = 0; pi < patchCount; pi++) {
    const px = minX + rng() * (maxX - minX);
    const pz = minZ + rng() * (maxZ - minZ);
    const pr = 10 + rng() * 20;
    scribbleBlob(ctx, rng, px, pz, pr);
    ctx.fill();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 2000 个稀疏噪点（边缘羽化：距边 < FEATHER_DIST 时按比例丢弃）
  const FEATHER_DIST = 30;
  (ctx as unknown as Record<string, unknown>).fillStyle = 'rgba(90,90,86,0.05)';
  for (let i = 0; i < 2000; i++) {
    const nx = minX + rng() * (maxX - minX);
    const nz = minZ + rng() * (maxZ - minZ);
    const distToEdge = Math.min(nx - minX, maxX - nx, nz - minZ, maxZ - nz);
    const draw = rng() < (distToEdge < FEATHER_DIST ? distToEdge / FEATHER_DIST : 1);
    if (draw) ctx.fillRect(nx, nz, 1, 1);
  }

  // 140 条短纤维线（边缘羽化：距边 < FEATHER_DIST 时按比例丢弃）
  (ctx as unknown as Record<string, unknown>).strokeStyle = 'rgba(90,90,86,0.07)';
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
  for (let i = 0; i < 140; i++) {
    const fx = minX + rng() * (maxX - minX);
    const fz = minZ + rng() * (maxZ - minZ);
    const angle = rng() * Math.PI * 2;
    const len = 4 + rng() * 6; // 4-10 世界单位
    const fDistToEdge = Math.min(fx - minX, maxX - fx, fz - minZ, maxZ - fz);
    const drawF = rng() < (fDistToEdge < FEATHER_DIST ? fDistToEdge / FEATHER_DIST : 1);
    if (drawF) {
      ctx.beginPath();
      ctx.moveTo(fx, fz);
      ctx.lineTo(fx + Math.cos(angle) * len, fz + Math.sin(angle) * len);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 2 — 山脉                                                          */
/* ------------------------------------------------------------------ */

function paintMountains(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
  proximityOffset: number = 0,
  extraDensity: number = 0,
  snowline: number = 0.85,
  bandCount: number = 1,
): void {
  const { cosM, sinM, worldR } = params;

  // 山脉垂直方向（旋转90度）
  const perpX = -sinM;
  const perpZ = cosM;

  // 在山脉带两侧各取 5-8 个山峰采样点
  const peakCount = 5 + Math.floor(rng() * 4) + extraDensity; // 5-8 + extraDensity

  for (let band = 0; band < bandCount; band++) {
    // 第二条山带方位角偏转 150°
    const bandAngle = band === 0 ? 0 : Math.PI * (5 / 6);
    const cosBand = Math.cos(bandAngle), sinBand = Math.sin(bandAngle);

    for (let i = 0; i < peakCount; i++) {
      // 沿山脉方向的位置
      const along = (rng() - 0.5) * worldR * 1.8;
      // 垂直于山脉方向的偏移（山脉带宽）
      const across = (worldR * 0.6 + proximityOffset) + rng() * worldR * 0.5;

      const bandCosM = band === 0 ? cosM : cosM * cosBand - sinM * sinBand;
      const bandSinM = band === 0 ? sinM : sinM * cosBand + cosM * sinBand;
      const bandPerpX = band === 0 ? perpX : -bandSinM;
      const bandPerpZ = band === 0 ? perpZ : bandCosM;
      const cx = bandCosM * along + bandPerpX * across;
      const cz = bandSinM * along + bandPerpZ * across;

      const peakH = 8 + rng() * 12; // 山峰高度
      const baseW = 10 + rng() * 8; // 山基宽度

      // 生成锯齿折线峰线（4-6 个锯齿折点）
      const zigCount = 4 + Math.floor(rng() * 3); // 4-6
      const zigPts: [number, number][] = [];

      // 山脚左
      zigPts.push([cx - baseW, cz]);
      // 中间锯齿
      for (let z = 0; z < zigCount; z++) {
        const t = (z + 1) / (zigCount + 1);
        const px = cx - baseW + t * baseW * 2 + (rng() - 0.5) * 3;
        const pz = cz - peakH * Math.sin(Math.PI * t) - rng() * 2;
        zigPts.push([px, pz]);
      }
      // 山脚右
      zigPts.push([cx + baseW, cz]);

      // 绘制山峰轮廓
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
      wobblyPath(ctx, rng, zigPts, 0.8);
      ctx.stroke();

      // 顶部雪帽（两笔短线）
      const snowY = cz - peakH * snowline;
      const snowW = baseW * 0.25;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.snow;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(cx - snowW, snowY + 1.5);
      ctx.lineTo(cx, snowY - 1.5);
      ctx.lineTo(cx + snowW, snowY + 1.5);
      ctx.stroke();

      // 山脚排线
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
      hatchRect(ctx, rng, cx - baseW * 0.6, cz - peakH * 0.3, baseW * 1.2, peakH * 0.3, 6, PAPER.inkFaded);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 3a — 河流                                                         */
/* ------------------------------------------------------------------ */

function paintRiver(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const { RIVER_W, riverWorld, T } = params;
  const step = 1;
  const vMin = -T * 1.2;
  const vMax = T * 1.2;

  // 采样河心线
  const pts: [number, number][] = [];
  for (let v = vMin; v <= vMax; v += step) {
    pts.push(riverWorld(v));
  }

  if (pts.length < 2) return;

  const bankOffset = RIVER_W / 2 + 0.8;
  const leftBank = offsetPolyline(pts, bankOffset);
  const rightBank = offsetPolyline(pts, -bankOffset);

  // 中间水面填充（多边形近似）
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(leftBank[0][0], leftBank[0][1]);
  for (const p of leftBank) ctx.lineTo(p[0], p[1]);
  for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 左岸线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
  wobblyPath(ctx, rng, leftBank, 0.8);
  ctx.stroke();

  // 右岸线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
  wobblyPath(ctx, rng, rightBank, 0.8);
  ctx.stroke();

  // 5-8 笔短水波
  const waveCount = 5 + Math.floor(rng() * 4);
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
  for (let i = 0; i < waveCount; i++) {
    const ti = rng();
    const idx = Math.floor(ti * (pts.length - 1));
    const wx = pts[idx][0];
    const wz = pts[idx][1];
    ctx.beginPath();
    ctx.moveTo(wx - 15, wz);
    ctx.quadraticCurveTo(wx, wz + 2 * (rng() - 0.5) * 3, wx + 15, wz);
    ctx.stroke();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* 层 3b — 运河                                                         */
/* ------------------------------------------------------------------ */

function paintCanal(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const { canalPts, RIVER_W } = params;
  if (canalPts.length < 2) return;

  const canalW = RIVER_W * 0.6;
  const halfW = canalW / 2;

  const leftBank = offsetPolyline(canalPts, halfW);
  const rightBank = offsetPolyline(canalPts, -halfW);

  // 水面填充
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(leftBank[0][0], leftBank[0][1]);
  for (const p of leftBank) ctx.lineTo(p[0], p[1]);
  for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 两岸线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
  wobblyPath(ctx, rng, leftBank, 0.5);
  ctx.stroke();
  wobblyPath(ctx, rng, rightBank, 0.5);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 层 3c — 湖泊                                                         */
/* ------------------------------------------------------------------ */

function paintLakes(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  wsPrefix: string,
): void {
  params.lakes.forEach((lake, i) => {
    const rng = rng0(wsPrefix + ':lake' + i);
    // 湖岸线 + 填充
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    wobblyCircle(ctx, rng, lake.x, lake.z, lake.r, 0.15);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
    wobblyCircle(ctx, rng, lake.x, lake.z, lake.r, 0.1);
    ctx.stroke();

    // 3-5 笔内部波纹
    const waveCount = 3 + Math.floor(rng() * 3);
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    for (let w = 0; w < waveCount; w++) {
      const wAngle = rng() * Math.PI * 2;
      const wDist = rng() * lake.r * 0.6;
      const wx = lake.x + Math.cos(wAngle) * wDist;
      const wz = lake.z + Math.sin(wAngle) * wDist;
      ctx.beginPath();
      ctx.moveTo(wx - lake.r * 0.3, wz);
      ctx.quadraticCurveTo(wx, wz + (rng() - 0.5) * lake.r * 0.4, wx + lake.r * 0.3, wz);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  });
}

/* ------------------------------------------------------------------ */
/* 层 3sea — 海洋（harbor 专属）                                        */
/* ------------------------------------------------------------------ */

function paintSea(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const sea = params.seaData;
  if (!sea) return;
  const { coastPts, islands, lighthousePos, piers, sideAngle } = sea;
  if (coastPts.length < 2) return;

  // 海面填充多边形：沿海岸线采样 + 外扩 800 单位闭合
  const cosSide = Math.cos(sideAngle), sinSide = Math.sin(sideAngle);
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(coastPts[0][0], coastPts[0][1]);
  for (const [cx2, cz2] of coastPts) ctx.lineTo(cx2, cz2);
  // 外扩到海里方向 800 单位
  const farPts = [...coastPts].reverse().map(([px, pz]): [number, number] => [
    px + cosSide * 800,
    pz + sinSide * 800,
  ]);
  for (const [fx, fz] of farPts) ctx.lineTo(fx, fz);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 海岸线（抖动）
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.20;
  wobblyPath(ctx, rng, coastPts, 1.2);
  ctx.stroke();

  // 沙滩带（岸内侧 3 世界单位 sand 色条）
  const sandColor = '#e8d8a0';
  (ctx as unknown as Record<string, unknown>).strokeStyle = sandColor;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.25;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.35;
  wobblyPath(ctx, rng, coastPts, 0.5);
  ctx.stroke();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 3 层波浪短线群（离岸越远越稀）
  for (let layer = 0; layer < 3; layer++) {
    const waveCount = 8 - layer * 2;
    const waveOff = 15 + layer * 25;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.15 + layer * 0.05;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    for (let w = 0; w < waveCount; w++) {
      const idx = Math.floor(rng() * (coastPts.length - 1));
      const [wx, wz] = coastPts[idx];
      const wfx = wx + cosSide * (waveOff + rng() * 10);
      const wfz = wz + sinSide * (waveOff + rng() * 10);
      ctx.beginPath();
      ctx.moveTo(wfx - 8, wfz);
      ctx.quadraticCurveTo(wfx, wfz + (rng() - 0.5) * 4, wfx + 8, wfz);
      ctx.stroke();
    }
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 浪花点
  (ctx as unknown as Record<string, unknown>).fillStyle = '#ffffff';
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(rng() * coastPts.length);
    const [fx, fz] = coastPts[idx];
    wobblyCircle(ctx, rng, fx + cosSide * (5 + rng() * 10), fz + sinSide * (5 + rng() * 10), 0.3 + rng() * 0.4, 0.1);
    ctx.fill();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 小岛
  for (const isl of islands) {
    (ctx as unknown as Record<string, unknown>).fillStyle = '#e8d4a0';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyCircle(ctx, rng, isl.x, isl.z, isl.r, 0.1);
    ctx.fill();
    wobblyCircle(ctx, rng, isl.x, isl.z, isl.r, 0.08);
    ctx.stroke();
    // 环岛浪线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.3;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    wobblyCircle(ctx, rng, isl.x, isl.z, isl.r + 2, 0.12);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    // 岛上 1-2 棵树
    const treeCount = 1 + Math.floor(rng() * 2);
    for (let ti = 0; ti < treeCount; ti++) {
      const tx2 = isl.x + (rng() - 0.5) * isl.r;
      const tz2 = isl.z + (rng() - 0.5) * isl.r;
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
      scribbleBlob(ctx, rng, tx2, tz2, 1.2 + rng() * 0.6);
      ctx.fill();
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }

  // 灯塔（红白环纹小塔 + 顶部光芒短线）
  {
    const { x: ltx, z: ltz } = lighthousePos;
    const towerH = 4, towerW = 0.8;
    // 塔身（白色）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#f8f8f8';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    ctx.beginPath();
    ctx.rect(ltx - towerW / 2, ltz - towerH, towerW, towerH);
    ctx.fill();
    ctx.stroke();
    // 红色环纹（2 条）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#d94040';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
    ctx.fillRect(ltx - towerW / 2, ltz - towerH * 0.4, towerW, towerH * 0.18);
    ctx.fillRect(ltx - towerW / 2, ltz - towerH * 0.75, towerW, towerH * 0.15);
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    // 顶部灯光短线（6 根放射线）
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#f5d060';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    for (let ri = 0; ri < 6; ri++) {
      const ang = (ri / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ltx, ltz - towerH);
      ctx.lineTo(ltx + Math.cos(ang) * 2.5, ltz - towerH + Math.sin(ang) * 2.5);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  // 码头栈桥（双线 + 横板短线，末端 2-3 艘帆船涂鸦）
  for (const pier of piers) {
    const cosPier = Math.cos(pier.angle), sinPier = Math.sin(pier.angle);
    const pierLen = 12 + rng() * 6;
    // 栈桥两侧线
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#9a7a5e';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    const offset = 0.6;
    ctx.beginPath();
    ctx.moveTo(pier.x - sinPier * offset, pier.z + cosPier * offset);
    ctx.lineTo(pier.x - sinPier * offset + cosPier * pierLen, pier.z + cosPier * offset + sinPier * pierLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pier.x + sinPier * offset, pier.z - cosPier * offset);
    ctx.lineTo(pier.x + sinPier * offset + cosPier * pierLen, pier.z - cosPier * offset + sinPier * pierLen);
    ctx.stroke();
    // 横板短线
    const boardCount = Math.floor(pierLen / 1.5);
    for (let bi = 0; bi < boardCount; bi++) {
      const bd = (bi + 0.5) * 1.5;
      const bx = pier.x + cosPier * bd;
      const bz = pier.z + sinPier * bd;
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#b89a7e';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      ctx.beginPath();
      ctx.moveTo(bx - sinPier * 0.8, bz + cosPier * 0.8);
      ctx.lineTo(bx + sinPier * 0.8, bz - cosPier * 0.8);
      ctx.stroke();
    }
    // 末端系泊帆船（2-3 艘，简化为小椭圆+三角帆）
    const moored = 2 + Math.floor(rng() * 2);
    for (let mi = 0; mi < moored; mi++) {
      const mx = pier.x + cosPier * (pierLen + 1 + mi * 2.5);
      const mz = pier.z + sinPier * (pierLen + 1 + mi * 2.5);
      (ctx as unknown as Record<string, unknown>).fillStyle = '#9a7a5e';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
      wobblyCircle(ctx, rng, mx, mz, 0.7, 0.08);
      ctx.fill();
      ctx.stroke();
      // 帆（三角）
      (ctx as unknown as Record<string, unknown>).fillStyle = '#f0ead8';
      ctx.beginPath();
      ctx.moveTo(mx, mz - 0.8);
      ctx.lineTo(mx + 0.6, mz + 0.2);
      ctx.lineTo(mx, mz + 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 海鸥（extras.includes('seagull') 控制）
  const seaBiome = getBiome(params.theme ?? 'harbor');
  if (seaBiome.extras.includes('seagull')) {
    const gullCount = 3 + Math.floor(rng() * 3);
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    for (let gi = 0; gi < gullCount; gi++) {
      const idx = Math.floor(rng() * coastPts.length);
      const [gx, gz] = coastPts[idx];
      const gfx = gx + cosSide * (20 + rng() * 40);
      const gfz = gz + sinSide * (20 + rng() * 40);
      const span = 1.2 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(gfx - span, gfz);
      ctx.quadraticCurveTo(gfx, gfz - span * 0.4, gfx + span, gfz);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 3frozen — 冻河（snow 专属）                                       */
/* ------------------------------------------------------------------ */

function paintFrozenRiver(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const { RIVER_W, riverWorld, T } = params;
  const step = 1;
  const vMin = -T * 1.2;
  const vMax = T * 1.2;

  const pts: [number, number][] = [];
  for (let v = vMin; v <= vMax; v += step) pts.push(riverWorld(v));
  if (pts.length < 2) return;

  const bankOffset = RIVER_W / 2 + 0.8;
  const leftBank = offsetPolyline(pts, bankOffset);
  const rightBank = offsetPolyline(pts, -bankOffset);

  // 冰面填充（冰白）
  (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(leftBank[0][0], leftBank[0][1]);
  for (const p of leftBank) ctx.lineTo(p[0], p[1]);
  for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 冰边（冰蓝）
  const iceEdge = '#8ab4d0';
  (ctx as unknown as Record<string, unknown>).strokeStyle = iceEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
  wobblyPath(ctx, rng, leftBank, 0.8);
  ctx.stroke();
  wobblyPath(ctx, rng, rightBank, 0.8);
  ctx.stroke();

  // 河面裂纹折线（2-3 条）
  const crackCount = 2 + Math.floor(rng() * 2);
  (ctx as unknown as Record<string, unknown>).strokeStyle = iceEdge;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
  for (let c2 = 0; c2 < crackCount; c2++) {
    const startIdx = Math.floor(rng() * (pts.length * 0.8));
    const crackLen = 5 + Math.floor(rng() * 8);
    const crackPts: [number, number][] = [];
    for (let ck = 0; ck < crackLen; ck++) {
      const ci = Math.min(pts.length - 1, startIdx + ck);
      const cx2 = pts[ci][0] + (rng() - 0.5) * RIVER_W * 0.8;
      const cz2 = pts[ci][1] + (rng() - 0.5) * RIVER_W * 0.3;
      crackPts.push([cx2, cz2]);
    }
    wobblyPath(ctx, rng, crackPts, 0.3);
    ctx.stroke();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 局部未冻水洞（1-2 个深色圆）
  const holeCount = 1 + Math.floor(rng() * 2);
  for (let h = 0; h < holeCount; h++) {
    const hi = Math.floor(rng() * pts.length);
    const hx = pts[hi][0] + (rng() - 0.5) * RIVER_W * 0.5;
    const hz = pts[hi][1] + (rng() - 0.5) * RIVER_W * 0.3;
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    wobblyCircle(ctx, rng, hx, hz, 1.5 + rng(), 0.15);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 层 3torrent — 激流（mountain 专属）                                  */
/* ------------------------------------------------------------------ */

function paintTorrentRiver(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const { RIVER_W, riverWorld, T } = params;
  const narrowW = RIVER_W * 0.55;
  const step = 1;
  const vMin = -T * 1.2, vMax = T * 1.2;

  const pts: [number, number][] = [];
  for (let v = vMin; v <= vMax; v += step) pts.push(riverWorld(v));
  if (pts.length < 2) return;

  const bankOffset = narrowW / 2 + 0.5;
  const leftBank = offsetPolyline(pts, bankOffset);
  const rightBank = offsetPolyline(pts, -bankOffset);

  // 窄河填充
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(leftBank[0][0], leftBank[0][1]);
  for (const p of leftBank) ctx.lineTo(p[0], p[1]);
  for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 岸线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
  wobblyPath(ctx, rng, leftBank, 0.6);
  ctx.stroke();
  wobblyPath(ctx, rng, rightBank, 0.6);
  ctx.stroke();

  // 河内密集流线短线群（激流感）
  const flowCount = 12 + Math.floor(rng() * 8);
  (ctx as unknown as Record<string, unknown>).strokeStyle = '#c8e4f0';
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
  for (let f = 0; f < flowCount; f++) {
    const fIdx = Math.floor(rng() * (pts.length - 3));
    const fx = pts[fIdx][0] + (rng() - 0.5) * narrowW * 0.6;
    const fz = pts[fIdx][1] + (rng() - 0.5) * narrowW * 0.2;
    const fx2 = pts[fIdx + 2][0] + (rng() - 0.5) * narrowW * 0.4;
    const fz2 = pts[fIdx + 2][1] + (rng() - 0.5) * narrowW * 0.2;
    ctx.beginPath();
    ctx.moveTo(fx, fz);
    ctx.lineTo(fx2, fz2);
    ctx.stroke();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 跨涧石点（5-8 个深色椭圆）
  const stoneCount = 5 + Math.floor(rng() * 4);
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.mountain;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
  for (let si = 0; si < stoneCount; si++) {
    const si2 = Math.floor(rng() * pts.length);
    const sx = pts[si2][0] + (rng() - 0.5) * narrowW;
    const sz = pts[si2][1] + (rng() - 0.5) * narrowW * 0.3;
    wobblyCircle(ctx, rng, sx, sz, 0.5 + rng() * 0.5, 0.2);
    ctx.fill();
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* 层 3d — 桥                                                           */
/* ------------------------------------------------------------------ */

function paintBridges(
  ctx: CanvasRenderingContext2D,
  roads: Road[],
  params: WorldParams,
  rng: () => number,
): void {
  const { riverDist, RIVER_W } = params;

  for (const road of roads) {
    if (road.kind === 'street') continue;
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      if (riverDist(mx, mz) < RIVER_W + 3) {
        // 桥：两道横线
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.3;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const bw = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx + nx * bw, mz + nz * bw);
        ctx.lineTo(mx - nx * bw, mz - nz * bw);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx + nx * bw + dx * 0.3, mz + nz * bw + dz * 0.3);
        ctx.lineTo(mx - nx * bw + dx * 0.3, mz - nz * bw + dz * 0.3);
        ctx.stroke();
        hatchRect(ctx, rng, mx - 3, mz - 1.5, 6, 3, 4, PAPER.inkFaded);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 4 — 街区补丁                                                      */
/* ------------------------------------------------------------------ */

function paintDistricts(
  ctx: CanvasRenderingContext2D,
  districts: District[],
  wsPrefix: string,
  theme: string = 'plains',
): void {
  for (const district of districts) {
    const rng = rng0(wsPrefix + ':dist:' + district.dir);
    const poly = district.polygon;

    // 街区 pastel 填充
    const rawPastel = PAPER.pastels[hashStr(district.dir) % 6];
    const biomeD = getBiome(theme);
    const pastelColor = biomeD.pastelShift ? biomeD.pastelShift(rawPastel, rng) : rawPastel;
    (ctx as unknown as Record<string, unknown>).fillStyle = pastelColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // wobbly 描边
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.24;
    const closedPoly = [...poly, poly[0]] as [number, number][];
    wobblyPath(ctx, rng, closedPoly, 0.8);
    ctx.stroke();

    // 角落 hatch（polygon bbox 左上角 1/3 宽度区域）
    let bboxMinX = Infinity, bboxMinZ = Infinity, bboxMaxX = -Infinity, bboxMaxZ = -Infinity;
    for (const [px, pz] of poly) {
      bboxMinX = Math.min(bboxMinX, px);
      bboxMinZ = Math.min(bboxMinZ, pz);
      bboxMaxX = Math.max(bboxMaxX, px);
      bboxMaxZ = Math.max(bboxMaxZ, pz);
    }
    const w3 = (bboxMaxX - bboxMinX) / 3;
    const h3 = (bboxMaxZ - bboxMinZ) / 3;
    hatchRect(ctx, rng, bboxMinX, bboxMinZ, w3, h3, 8, PAPER.inkFaded);

    // 区名标签（字号按街区宽度等比缩放，世界坐标下 px 即世界单位）
    const labelMinWidth = 8; // 街区太小不画标签
    if (district.width >= labelMinWidth) {
      const fontSize = Math.min(3.5, district.width * 0.16);
      const cx = (bboxMinX + bboxMaxX) / 2;
      const cz = (bboxMinZ + bboxMaxZ) / 2;

      // 描边（paper 色，模拟纸底）
      (ctx as unknown as Record<string, unknown>).font = `${fontSize}px 'Hannotate SC', 'Xingkai SC', 'Kaiti SC', cursive`;
      (ctx as unknown as Record<string, unknown>).textAlign = 'center';
      (ctx as unknown as Record<string, unknown>).textBaseline = 'middle';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.paper;
      (ctx as unknown as Record<string, unknown>).lineWidth = fontSize * 0.06;
      ctx.strokeText(district.dir || 'inbox', cx, cz);

      // 填充（ink 色）
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.ink;
      ctx.fillText(district.dir || 'inbox', cx, cz);

      // 重置 textAlign/textBaseline 以免影响其它绘制
      (ctx as unknown as Record<string, unknown>).textAlign = 'start';
      (ctx as unknown as Record<string, unknown>).textBaseline = 'alphabetic';
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 5 — 道路（只画 main 和 avenue）                                   */
/* ------------------------------------------------------------------ */

function paintRoads(
  ctx: CanvasRenderingContext2D,
  roads: Road[],
  wsPrefix: string,
): void {
  // 预先收集所有 main 路的全部途经点，用于判断路口（两条不同 main 路的点互相靠近）
  const mainRoads = roads.filter(r => r.kind === 'main');

  // 对每条 main 路，找出其点中与其他 main 路的任意点距离 ≤3 的点（路口候选）
  const INTERSECTION_THRESHOLD = 3;
  function isIntersectionPt(
    roadIdx: number,
    px: number,
    pz: number,
  ): boolean {
    for (let j = 0; j < mainRoads.length; j++) {
      if (j === roadIdx) continue;
      for (const [ox, oz] of mainRoads[j].points) {
        const dx = px - ox;
        const dz = pz - oz;
        if (dx * dx + dz * dz <= INTERSECTION_THRESHOLD * INTERSECTION_THRESHOLD) {
          return true;
        }
      }
    }
    return false;
  }

  for (const road of roads) {
    if (road.kind === 'street') continue; // street 一律跳过

    const rng = rng0(wsPrefix + ':road:' + road.points[0].join(','));
    const roadWidth = road.kind === 'main' ? 3 : 2;
    const pts = road.points;

    if (pts.length < 2) continue;

    const halfRoad = roadWidth / 2;
    const leftEdge = offsetPolyline(pts, halfRoad);
    const rightEdge = offsetPolyline(pts, -halfRoad);

    // 路面填充
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
    ctx.beginPath();
    ctx.moveTo(leftEdge[0][0], leftEdge[0][1]);
    for (const p of leftEdge) ctx.lineTo(p[0], p[1]);
    for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i][0], rightEdge[i][1]);
    ctx.closePath();
    ctx.fill();

    // 左侧边线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyPath(ctx, rng, leftEdge, 1.2);
    ctx.stroke();

    // 右侧边线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyPath(ctx, rng, rightEdge, 1.2);
    ctx.stroke();

    // 中央虚线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    dashedPath(ctx, pts, [4, 6]);

    // 路口红绿灯（仅在与其他 main 路相交的路口处画 3 个小圆点）
    if (road.kind === 'main') {
      const roadIdx = mainRoads.indexOf(road);
      for (const [px, pz] of pts) {
        if (!isIntersectionPt(roadIdx, px, pz)) continue;
        // 红/黄/绿 三个小点
        const colors = ['#e05050', '#e0c050', '#50c050'];
        for (let ci = 0; ci < 3; ci++) {
          (ctx as unknown as Record<string, unknown>).fillStyle = colors[ci];
          ctx.beginPath();
          ctx.arc(px + ci * 1.2 - 1.2, pz - 1.5, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 6 — 公园/池塘                                                     */
/* ------------------------------------------------------------------ */

function paintParks(
  ctx: CanvasRenderingContext2D,
  districts: District[],
  wsPrefix: string,
): void {
  for (const district of districts) {
    if (!district.isInbox && district.buildings.length >= 3) continue;

    const rng = rng0(wsPrefix + ':park:' + district.dir);
    const poly = district.polygon;

    // polygon bbox
    let bboxMinX = Infinity, bboxMinZ = Infinity, bboxMaxX = -Infinity, bboxMaxZ = -Infinity;
    for (const [px, pz] of poly) {
      bboxMinX = Math.min(bboxMinX, px);
      bboxMinZ = Math.min(bboxMinZ, pz);
      bboxMaxX = Math.max(bboxMaxX, px);
      bboxMaxZ = Math.max(bboxMaxZ, pz);
    }

    // 2-4 个 scribbleBlob 绿团
    const blobCount = 2 + Math.floor(rng() * 3);
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    for (let b = 0; b < blobCount; b++) {
      const bx = bboxMinX + rng() * (bboxMaxX - bboxMinX);
      const bz = bboxMinZ + rng() * (bboxMaxZ - bboxMinZ);
      const br = 2 + rng() * 2; // 2-4 世界单位
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      scribbleBlob(ctx, rng, bx, bz, br);
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 1 个小水斑
    const wx = bboxMinX + rng() * (bboxMaxX - bboxMinX);
    const wz = bboxMinZ + rng() * (bboxMaxZ - bboxMinZ);
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
    wobblyCircle(ctx, rng, wx, wz, 1.5, 0.1);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 长椅（两笔短横线）
    const benchX = bboxMinX + rng() * (bboxMaxX - bboxMinX);
    const benchZ = bboxMinZ + rng() * (bboxMaxZ - bboxMinZ);
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(benchX - 1.5, benchZ);
    ctx.lineTo(benchX + 1.5, benchZ);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(benchX - 1.5, benchZ + 0.8);
    ctx.lineTo(benchX + 1.5, benchZ + 0.8);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* 层 7 — 建筑                                                          */
/* ------------------------------------------------------------------ */

function paintBuildings(
  ctx: CanvasRenderingContext2D,
  districts: District[],
  wsPrefix: string,
): void {
  for (const district of districts) {
    for (const b of district.buildings) {
      const rng = rng0(wsPrefix + ':bld:' + b.notePath);

      const r = footprintR(b);
      const bw = r * 2;
      const bh = r * 2;
      const bx = b.x - r;
      const bz = b.z - r;

      // 新鲜度墨色
      const ageDays = (Date.now() - b.mtimeMs) / 86400000;
      const t = Math.min(1, ageDays / 365);
      const inkColor = lerpHex(PAPER.ink, PAPER.inkFaded, t);

      if (b.isCivic) {
        // 区府：外圆 + 内圆 + 放射线 + 广场圈
        const outerR = r * 1.5;
        const innerR = r * 1.2;
        const squareR = r * 2.5;

        // 广场圈
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        wobblyCircle(ctx, rng, b.x, b.z, squareR, 0.1);
        ctx.fill();
        wobblyCircle(ctx, rng, b.x, b.z, squareR, 0.08);
        ctx.stroke();

        // 外圆
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.24;
        wobblyCircle(ctx, rng, b.x, b.z, outerR, 0.08);
        ctx.stroke();

        // 内圆
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        wobblyCircle(ctx, rng, b.x, b.z, innerR, 0.08);
        ctx.stroke();

        // 内部小房子（4-5 笔折线）
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
        const houseW = r * 0.6;
        const houseH = r * 0.5;
        ctx.beginPath();
        ctx.moveTo(b.x - houseW, b.z + houseH * 0.5);
        ctx.lineTo(b.x - houseW, b.z - houseH * 0.2);
        ctx.lineTo(b.x, b.z - houseH);
        ctx.lineTo(b.x + houseW, b.z - houseH * 0.2);
        ctx.lineTo(b.x + houseW, b.z + houseH * 0.5);
        ctx.stroke();

        // 放射短线（6 根）
        for (let ri = 0; ri < 6; ri++) {
          const angle = (ri / 6) * Math.PI * 2;
          const rx1 = b.x + Math.cos(angle) * innerR;
          const rz1 = b.z + Math.sin(angle) * innerR;
          const rx2 = b.x + Math.cos(angle) * (innerR + r * 0.6);
          const rz2 = b.z + Math.sin(angle) * (innerR + r * 0.6);
          ctx.beginPath();
          ctx.moveTo(rx1, rz1);
          ctx.lineTo(rx2, rz2);
          ctx.stroke();
        }

      } else if (b.construction) {
        // 施工中：虚线轮廓 + 斜排线 + 吊臂
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.24;
        dashedPath(ctx, [[bx, bz], [bx + bw, bz], [bx + bw, bz + bh], [bx, bz + bh], [bx, bz]], [5, 4]);
        hatchRect(ctx, rng, bx, bz, bw, bh, 4, PAPER.inkFaded);

        // 小吊臂涂鸦（3 笔折线）
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.7, bz + bh); // 底部
        ctx.lineTo(bx + bw * 0.7, bz - bh * 0.3); // 竖杆
        ctx.lineTo(bx + bw * 0.2, bz - bh * 0.3); // 横臂
        ctx.stroke();
        // 垂线
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.2, bz - bh * 0.3);
        ctx.lineTo(bx + bw * 0.2, bz + bh * 0.1);
        ctx.stroke();

      } else if (b.landmark) {
        // 地标：尺寸 ×1.4
        const lr = r * 1.4;
        const lbw = lr * 2;
        const lbh = lr * 2;
        const lbx = b.x - lr;
        const lbz = b.z - lr;

        // 投影阴影
        (ctx as unknown as Record<string, unknown>).fillStyle = 'rgba(0,0,0,0.1)';
        scribbleBlob(ctx, rng, b.x, b.z, lr * 1.2);
        ctx.fill();

        // 屋顶色填充
        const roofColor = PAPER.pastels[(hashStr(b.notePath) + 2) % 6];
        (ctx as unknown as Record<string, unknown>).fillStyle = roofColor;
        wobblyRect(ctx, rng, lbx, lbz, lbw, lbh, 1.2);
        ctx.fill();

        // 描边
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.24;
        wobblyRect(ctx, rng, lbx, lbz, lbw, lbh, 1.2);
        ctx.stroke();

        // 旗帜：短竖杆 + 小三角旗
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        const flagX = b.x;
        const flagZ = b.z - lr;
        ctx.beginPath();
        ctx.moveTo(flagX, flagZ);
        ctx.lineTo(flagX, flagZ - lr * 0.8);
        ctx.stroke();
        (ctx as unknown as Record<string, unknown>).fillStyle = inkColor;
        ctx.beginPath();
        ctx.moveTo(flagX, flagZ - lr * 0.8);
        ctx.lineTo(flagX + lr * 0.5, flagZ - lr * 0.55);
        ctx.lineTo(flagX, flagZ - lr * 0.3);
        ctx.closePath();
        ctx.fill();

      } else {
        // 普通建筑
        const roofColor = PAPER.pastels[(hashStr(b.notePath) + 2) % 6];

        // 屋顶色填充
        (ctx as unknown as Record<string, unknown>).fillStyle = roofColor;
        wobblyRect(ctx, rng, bx, bz, bw, bh, 1.0);
        ctx.fill();

        // 描边
        (ctx as unknown as Record<string, unknown>).strokeStyle = inkColor;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.24;
        wobblyRect(ctx, rng, bx, bz, bw, bh, 1.0);
        ctx.stroke();

        // 屋脊线
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        wobblyPath(ctx, rng, [[bx, b.z], [bx + bw, b.z]], 0.5);
        ctx.stroke();

        // age > 180 天：额外 2 笔小杂草
        if (ageDays > 180) {
          (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
          (ctx as unknown as Record<string, unknown>).lineWidth = 0.09;
          for (let wi = 0; wi < 2; wi++) {
            const gx = bx + rng() * bw;
            const gz = bz + rng() * bh;
            ctx.beginPath();
            ctx.moveTo(gx, gz);
            ctx.lineTo(gx + (rng() - 0.5) * 2, gz - 1.5);
            ctx.lineTo(gx + (rng() - 0.5) * 2, gz - 3);
            ctx.stroke();
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 针叶树（sparse-pine / dense-pine）                                   */
/* ------------------------------------------------------------------ */

function paintPineTree(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  tx: number,
  tz: number,
  h: number,
  withSnow: boolean,
): void {
  // 树干
  const trunkH = h * 0.4;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(tx, tz + trunkH * 0.5);
  ctx.lineTo(tx, tz + trunkH);
  ctx.stroke();

  // 3 层三角形叶冠（从上到下递宽）
  const layerCount = 3;
  for (let li = 0; li < layerCount; li++) {
    const ly = tz - h * 0.7 + li * (h * 0.3);
    const lw = h * 0.2 + li * h * 0.15;
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(tx, ly);
    ctx.lineTo(tx - lw, ly + h * 0.25);
    ctx.lineTo(tx + lw, ly + h * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  // 雪：顶部留白 + 树下雪堆弧
  if (withSnow) {
    (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    // 顶部雪帽
    const snowTipY = tz - h * 0.7;
    const snowW = h * 0.12;
    ctx.beginPath();
    ctx.moveTo(tx, snowTipY);
    ctx.lineTo(tx - snowW, snowTipY + h * 0.15);
    ctx.lineTo(tx + snowW, snowTipY + h * 0.15);
    ctx.closePath();
    ctx.fill();
    // 树下雪堆弧
    const snowBaseW = h * 0.25;
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#c8d8e8';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(tx - snowBaseW, tz + trunkH * 0.3);
    ctx.quadraticCurveTo(tx, tz + trunkH * 0.3 - h * 0.1, tx + snowBaseW, tz + trunkH * 0.3);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 层 8 — 树木                                                          */
/* ------------------------------------------------------------------ */

function paintTrees(
  ctx: CanvasRenderingContext2D,
  districts: District[],
  wsPrefix: string,
  theme: string = 'plains',
): void {
  const biomeT = getBiome(theme);
  const vegKind = biomeT.vegetation.kind;
  const withSnow = theme === 'snow';

  for (const district of districts) {
    const rng = rng0(wsPrefix + ':deco:' + district.dir);
    const poly = district.polygon;

    // polygon bbox
    let bboxMinX = Infinity, bboxMinZ = Infinity, bboxMaxX = -Infinity, bboxMaxZ = -Infinity;
    for (const [px, pz] of poly) {
      bboxMinX = Math.min(bboxMinX, px);
      bboxMinZ = Math.min(bboxMinZ, pz);
      bboxMaxX = Math.max(bboxMaxX, px);
      bboxMaxZ = Math.max(bboxMaxZ, pz);
    }

    const area = district.width * district.depth;
    const treeCount = Math.max(1, Math.floor(area / 120));

    let placed = 0;
    let attempts = 0;
    const maxAttempts = treeCount * 8;

    while (placed < treeCount && attempts < maxAttempts) {
      attempts++;
      const tx = bboxMinX + rng() * (bboxMaxX - bboxMinX);
      const tz = bboxMinZ + rng() * (bboxMaxZ - bboxMinZ);

      // 检查与建筑的距离
      let tooClose = false;
      for (const b of district.buildings) {
        const dx = tx - b.x;
        const dz = tz - b.z;
        if (Math.sqrt(dx * dx + dz * dz) < 2.5) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const tr = 1.5 + rng() * 1.0; // 1.5-2.5

      if (vegKind === 'mixed' || vegKind === 'palm-ish') {
        // 圆团型（原有实现）
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
        scribbleBlob(ctx, rng, tx, tz, tr);
        ctx.fill();
        ctx.stroke();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        // 树干
        const trunkH2 = 2 + rng();
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(tx, tz);
        ctx.lineTo(tx, tz + trunkH2);
        ctx.stroke();
      } else {
        // sparse-pine / dense-pine：三角松
        paintPineTree(ctx, rng, tx, tz, tr * 2.2, withSnow);
      }

      placed++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 9 — 专属元素（extras）                                            */
/* ------------------------------------------------------------------ */

function paintExtras(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  city: CityModel,
  wsPrefix: string,
  minX: number, minZ: number, maxX: number, maxZ: number,
): void {
  const biomeE = getBiome(city.theme);
  const extras = biomeE.extras;
  const rng = rng0(wsPrefix + ':extras');

  // ---- plains: 田块 + 风车 + 干草垛 ----
  if (extras.includes('fields')) {
    const fieldCount = 6 + Math.floor(rng() * 5);
    for (let fi = 0; fi < fieldCount; fi++) {
      const fx = minX + rng() * (maxX - minX);
      const fz = minZ + rng() * (maxZ - minZ);
      // 只在城市 bbox 外围绘制田块
      if (Math.abs(fx) < params.cityHalfW * 0.8 && Math.abs(fz) < params.cityHalfD * 0.8) continue;
      const fw = 15 + rng() * 20;
      const fd = 10 + rng() * 12;
      const fAngle = (rng() - 0.5) * 0.4;
      ctx.save();
      ctx.translate(fx, fz);
      ctx.rotate(fAngle);
      // 田块底色
      (ctx as unknown as Record<string, unknown>).fillStyle = '#d8e8b0';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
      ctx.fillRect(-fw / 2, -fd / 2, fw, fd);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      // 方格 hatch
      hatchRect(ctx, rng, -fw / 2, -fd / 2, fw, fd, 5, '#a8b890');
      // 田埂线（3-4 条水平线）
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#8a9870';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      const ridgeCount = 3 + Math.floor(rng() * 2);
      for (let ri = 1; ri < ridgeCount; ri++) {
        const ry = -fd / 2 + (ri / ridgeCount) * fd;
        ctx.beginPath();
        ctx.moveTo(-fw / 2 + rng() * 2, ry + rng() * 0.5);
        ctx.lineTo(fw / 2 - rng() * 2, ry + rng() * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  if (extras.includes('windmill')) {
    // 1-2 座风车涂鸦
    const wmCount = 1 + Math.floor(rng() * 2);
    for (let wi = 0; wi < wmCount; wi++) {
      const wx = (minX * 0.3 + maxX * 0.5) + rng() * (maxX - minX) * 0.3;
      const wz = (minZ * 0.3 + maxZ * 0.5) + rng() * (maxZ - minZ) * 0.3;
      // 塔身
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      ctx.beginPath();
      ctx.moveTo(wx - 1, wz + 4);
      ctx.lineTo(wx, wz - 2);
      ctx.lineTo(wx + 1, wz + 4);
      ctx.stroke();
      // 4 叶风叶（简化为 X 形两线）
      const bladeLen = 3;
      for (let bi = 0; bi < 2; bi++) {
        const ba = bi * Math.PI / 2 + (rng() - 0.5) * 0.2;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(ba) * bladeLen, wz + Math.sin(ba) * bladeLen);
        ctx.lineTo(wx - Math.cos(ba) * bladeLen, wz - Math.sin(ba) * bladeLen);
        ctx.stroke();
      }
    }
  }

  // 干草垛（wobblyCircle 为底盘 + 锥顶线）
  if (extras.includes('haybale')) {
    const haybaleCount = 2 + Math.floor(rng() * 2);
    for (let hbi = 0; hbi < haybaleCount; hbi++) {
      const hbx = minX + params.cityHalfW * 1.1 + rng() * (maxX - minX - params.cityHalfW * 2.2);
      const hbz = minZ + params.cityHalfD * 1.1 + rng() * (maxZ - minZ - params.cityHalfD * 2.2);
      const hbr = 2 + rng() * 1.5;
      (ctx as unknown as Record<string, unknown>).fillStyle = '#c8b870';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      wobblyCircle(ctx, rng, hbx, hbz, hbr, 0.1);
      ctx.fill();
      ctx.stroke();
      // 圆锥顶
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(hbx - hbr, hbz);
      ctx.lineTo(hbx, hbz - hbr * 1.2);
      ctx.lineTo(hbx + hbr, hbz);
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }

  // ---- snow: 雪橇辙迹 ----
  if (extras.includes('sled-track')) {
    const trackStart = { x: params.cityHalfW * (0.5 + rng() * 0.4), z: params.cityHalfD * (0.5 + rng() * 0.4) };
    const trackLen = 60 + rng() * 40;
    const trackAngle = rng() * Math.PI * 2;
    const trackPts1: [number, number][] = [];
    const trackPts2: [number, number][] = [];
    const trackOffset = 0.6;
    const steps = 20;
    for (let si = 0; si <= steps; si++) {
      const u = si / steps;
      const d = u * trackLen;
      const waver = Math.sin(u * Math.PI * 3) * 4;
      const tx2 = trackStart.x + Math.cos(trackAngle) * d + Math.cos(trackAngle + Math.PI / 2) * waver;
      const tz2 = trackStart.z + Math.sin(trackAngle) * d + Math.sin(trackAngle + Math.PI / 2) * waver;
      trackPts1.push([tx2 - Math.sin(trackAngle) * trackOffset, tz2 + Math.cos(trackAngle) * trackOffset]);
      trackPts2.push([tx2 + Math.sin(trackAngle) * trackOffset, tz2 - Math.cos(trackAngle) * trackOffset]);
    }
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#8ab4d0';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    dashedPath(ctx, trackPts1, [3, 4]);
    dashedPath(ctx, trackPts2, [3, 4]);
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  // ---- mountain: 梯田（山脚 3-4 条等高弧线组）----
  if (extras.includes('terraces')) {
    const { cosM, sinM, worldR } = params;
    const terraceCount = 3 + Math.floor(rng() * 2);
    const terrBaseD = worldR * 0.55;
    for (let ti = 0; ti < terraceCount; ti++) {
      const tDist = terrBaseD + ti * 6;
      const arcLen = worldR * 0.8;
      const arcPts: [number, number][] = [];
      const N = 16;
      for (let ai = 0; ai <= N; ai++) {
        const av = (ai / N - 0.5) * arcLen;
        const ax = cosM * tDist + (-sinM) * av;
        const az = sinM * tDist + cosM * av;
        arcPts.push([ax + (rng() - 0.5) * 1.5, az + (rng() - 0.5) * 1.5]);
      }
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
      wobblyPath(ctx, rng, arcPts, 0.6);
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }

  // ---- mountain: 关隘城墙（城市 bbox 一侧手绘墙线）----
  if (extras.includes('gate-wall')) {
    const { cosM, sinM } = params;
    // 城墙在城市朝山脉一侧（MA 方向）
    const wallSide = params.cityHalfW * 1.05;
    const wallH = params.cityHalfD * 1.8;
    const wallStartX = cosM * wallSide - sinM * (-wallH / 2);
    const wallStartZ = sinM * wallSide + cosM * (-wallH / 2);
    const wallEndX   = cosM * wallSide - sinM * (wallH / 2);
    const wallEndZ   = sinM * wallSide + cosM * (wallH / 2);
    // 将长墙线分段（每段 ≤ 30 世界单位），避免长直斜线伪影
    const wallSegCount = Math.max(2, Math.ceil(wallH / 30));
    const wallPts: [number, number][] = [];
    for (let wi = 0; wi <= wallSegCount; wi++) {
      const t = wi / wallSegCount;
      wallPts.push([
        wallStartX + (wallEndX - wallStartX) * t,
        wallStartZ + (wallEndZ - wallStartZ) * t,
      ]);
    }
    // 外墙线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.25;
    wobblyPath(ctx, rng, wallPts, 0.5);
    ctx.stroke();
    // 内墙线（偏移 1.2 世界单位）
    const innerOff = 1.2;
    const innerPts: [number, number][] = wallPts.map(([px, pz]) => [px - cosM * innerOff, pz - sinM * innerOff]);
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyPath(ctx, rng, innerPts, 0.4);
    ctx.stroke();
    // 垛口齿（沿外墙线每隔 3 世界单位一个垛口）
    const wallLen = Math.hypot(wallEndX - wallStartX, wallEndZ - wallStartZ);
    const merlonCount = Math.floor(wallLen / 3);
    const mDx = (wallEndX - wallStartX) / wallLen;
    const mDz = (wallEndZ - wallStartZ) / wallLen;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    for (let mi = 0; mi < merlonCount; mi++) {
      const md = (mi + 0.5) * (wallLen / merlonCount);
      const mx = wallStartX + mDx * md;
      const mz = wallStartZ + mDz * md;
      // 垛口：短垂线向山方向伸出
      ctx.beginPath();
      ctx.moveTo(mx, mz);
      ctx.lineTo(mx + cosM * 1.2, mz + sinM * 1.2);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 层 5.5 — 跨区交通网                                                  */
/* ------------------------------------------------------------------ */

function paintTransport(
  ctx: CanvasRenderingContext2D,
  transport: TransportNet,
  params: WorldParams,
  wsPrefix: string,
): void {
  const rng = rng0(wsPrefix + ':transport');

  for (const edge of transport.rails) {
    const { pts, total } = edge;
    if (pts.length < 2) continue;

    // 路基（strokeStyle '#b0a898'，lineWidth 0.6）
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#b0a898';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.6;
    wobblyPath(ctx, rng, pts, 0.5);
    ctx.stroke();

    // 双轨（平行线 offset ±0.25）
    const leftPts = offsetPolyline(pts as ReadonlyArray<readonly [number, number]>, 0.25);
    const rightPts = offsetPolyline(pts as ReadonlyArray<readonly [number, number]>, -0.25);
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyPath(ctx, rng, leftPts, 0.3);
    ctx.stroke();
    wobblyPath(ctx, rng, rightPts, 0.3);
    ctx.stroke();

    // 枕木：每 1.2 世界单位一根短横线
    if (total > 0) {
      const sleepersCount = Math.floor(total / 1.2);
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#7a6858';
      // 估算每段中点位置来画枕木
      let cumLen = 0;
      for (let si = 0; si < pts.length - 1; si++) {
        const segLen = edge.lens[si] ?? 0;
        const segCount = Math.floor(segLen / 1.2);
        const [ax, az] = pts[si];
        const [bx, bz] = pts[si + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        for (let ti = 0; ti < segCount; ti++) {
          const t = (ti + 0.5) / segCount;
          const px = ax + dx * t;
          const pz = az + dz * t;
          ctx.beginPath();
          ctx.moveTo(px + nx * 0.5, pz + nz * 0.5);
          ctx.lineTo(px - nx * 0.5, pz - nz * 0.5);
          ctx.stroke();
        }
        cumLen += segLen;
      }
      void sleepersCount; void cumLen;
    }

    // bridge 区间
    for (const [s1, s2] of edge.bridges) {
      const bStart = Math.floor(s1 * (pts.length - 1));
      const bEnd = Math.ceil(s2 * (pts.length - 1));
      const bridgePts = pts.slice(Math.max(0, bStart), Math.min(pts.length, bEnd + 1));
      if (bridgePts.length < 2) continue;

      // 桥板
      (ctx as unknown as Record<string, unknown>).fillStyle = '#8a7055';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      ctx.beginPath();
      const leftBridge = offsetPolyline(bridgePts as ReadonlyArray<readonly [number, number]>, 1);
      const rightBridge = offsetPolyline(bridgePts as ReadonlyArray<readonly [number, number]>, -1);
      ctx.moveTo(leftBridge[0][0], leftBridge[0][1]);
      for (const p of leftBridge) ctx.lineTo(p[0], p[1]);
      for (let i = rightBridge.length - 1; i >= 0; i--) ctx.lineTo(rightBridge[i][0], rightBridge[i][1]);
      ctx.closePath();
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

      // 两侧短柱线（每 2 单位一对）
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#6a5040';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      const bridgeLen = bridgePts.reduce((acc, _, i) => {
        if (i === 0) return 0;
        return acc + Math.hypot(bridgePts[i][0] - bridgePts[i - 1][0], bridgePts[i][1] - bridgePts[i - 1][1]);
      }, 0);
      const pillarCount = Math.floor(bridgeLen / 2);
      for (let pi = 0; pi < pillarCount; pi++) {
        const t = (pi + 0.5) / Math.max(1, pillarCount);
        const idx = Math.min(bridgePts.length - 2, Math.floor(t * (bridgePts.length - 1)));
        const [px, pz] = bridgePts[idx];
        const [nx2, nz2] = (() => {
          const [ax, az] = bridgePts[idx];
          const [bx, bz] = bridgePts[idx + 1];
          const dx = bx - ax;
          const dz = bz - az;
          const l = Math.hypot(dx, dz) || 1;
          return [-dz / l, dx / l];
        })();
        ctx.beginPath();
        ctx.moveTo(px + nx2 * 1, pz + nz2 * 1);
        ctx.lineTo(px + nx2 * 1, pz + nz2 * 1 + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - nx2 * 1, pz - nz2 * 1);
        ctx.lineTo(px - nx2 * 1, pz - nz2 * 1 + 0.5);
        ctx.stroke();
      }
    }

    // tunnel 区间（画洞口）
    for (const [s1, s2] of edge.tunnels) {
      // 隧道口：在 s1/s2 两处
      for (const s of [s1, s2]) {
        const idx = Math.round(s * (pts.length - 1));
        const ptIdx = Math.max(0, Math.min(pts.length - 1, idx));
        const [tx, tz] = pts[ptIdx];

        // 取方向
        const dirIdx = ptIdx === pts.length - 1 ? ptIdx - 1 : ptIdx;
        const [ax, az] = pts[dirIdx];
        const [bx, bz] = pts[Math.min(pts.length - 1, dirIdx + 1)];
        const dxd = bx - ax, dzd = bz - az;
        const dlen = Math.hypot(dxd, dzd) || 1;
        const nx = -dzd / dlen;
        const nz = dxd / dlen;

        // 洞口黑填充（小扇形）
        (ctx as unknown as Record<string, unknown>).fillStyle = '#1a1814';
        ctx.beginPath();
        ctx.moveTo(tx, tz);
        ctx.lineTo(tx + nx * 1.2, tz + nz * 1.2);
        ctx.arc(tx, tz, 1.2, Math.atan2(nz, nx), Math.atan2(-nz, -nx), false);
        ctx.closePath();
        ctx.fill();

        // 拱圈线
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(tx, tz, 1.2, Math.atan2(nz, nx), Math.atan2(-nz, -nx), false);
        ctx.stroke();

        // 拱圈装饰（globalAlpha 0.5）
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        ctx.beginPath();
        ctx.arc(tx, tz, 0.8, Math.atan2(nz, nx), Math.atan2(-nz, -nx), false);
        ctx.stroke();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }

      // 山体表面虚线（隧道段）
      const tStart = Math.floor(s1 * (pts.length - 1));
      const tEnd = Math.ceil(s2 * (pts.length - 1));
      const tunnelPts = pts.slice(Math.max(0, tStart), Math.min(pts.length, tEnd + 1));
      if (tunnelPts.length >= 2) {
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.3;
        dashedPath(ctx, tunnelPts, [2, 3]);
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }
    }
  }

  // 车站
  for (const station of transport.stations) {
    const stRng = rng0(wsPrefix + ':station:' + station.districtDir);
    // 站台：wobblyRect 3×1.5
    (ctx as unknown as Record<string, unknown>).fillStyle = '#f0e8d0';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.2;
    wobblyRect(ctx, stRng, station.x - 1.5, station.z - 0.75, 3, 1.5, 0.5);
    ctx.fill();
    wobblyRect(ctx, stRng, station.x - 1.5, station.z - 0.75, 3, 1.5, 0.5);
    ctx.stroke();

    // 顶棚线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(station.x - 1.2, station.z - 0.45);
    ctx.lineTo(station.x + 1.2, station.z - 0.45);
    ctx.stroke();
  }

  // 机场
  const { airport } = transport;
  if (airport) {
    const apRng = rng0(wsPrefix + ':airport:draw');
    const { x: apx, z: apz, ang, len, width } = airport;

    ctx.save();
    ctx.translate(apx, apz);
    ctx.rotate(ang);

    const hw = width / 2;   // 跑道半宽

    // 1. 跑道带（浅灰，宽 width=7，长 len=36）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#d8d4c8';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyRect(ctx, apRng, -len / 2, -hw, len, width, 0.5);
    ctx.fill();
    wobblyRect(ctx, apRng, -len / 2, -hw, len, width, 0.5);
    ctx.stroke();

    // 2. 白中线虚线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.paper;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.25;
    dashedPath(ctx, [[-len / 2 + 2, 0], [len / 2 - 2, 0]], [4, 3]);

    // 3. 两端横棒（跑道两端的白色阈值线）
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.paper;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.4;
    for (const ex of [-len / 2 + 1, len / 2 - 1]) {
      ctx.beginPath();
      ctx.moveTo(ex, -hw + 0.5);
      ctx.lineTo(ex, hw - 0.5);
      ctx.stroke();
    }

    // 4. 端带 hatch（端头标记）
    hatchRect(ctx, apRng, -len / 2, -hw, 5, width, 3, PAPER.inkFaded);
    hatchRect(ctx, apRng, len / 2 - 5, -hw, 5, width, 3, PAPER.inkFaded);

    // 5. 停机坪（taxiway + apron 矩形，局部坐标）
    const apronW = 14, apronD = 10;
    const { dx: apDx, dz: apDz } = airport.apron;
    (ctx as unknown as Record<string, unknown>).fillStyle = '#ccc8bc';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyRect(ctx, apRng, apDx - apronW / 2, apDz - apronD / 2, apronW, apronD, 0.4);
    ctx.fill();
    wobblyRect(ctx, apRng, apDx - apronW / 2, apDz - apronD / 2, apronW, apronD, 0.4);
    ctx.stroke();

    // 滑行道（跑道到停机坪的连接线，窄带）
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#c8c4b8';
    (ctx as unknown as Record<string, unknown>).lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(apDx, -hw);       // 跑道边缘
    ctx.lineTo(apDx, apDz + apronD / 2);  // 停机坪边
    ctx.stroke();

    // 6. 停机坪 2 架小飞机涂鸦（不同朝向）
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    const planePositions: Array<{px: number; pz: number; angle: number}> = [
      { px: apDx - 3, pz: apDz - 1, angle: 0.3 },
      { px: apDx + 3, pz: apDz + 2, angle: Math.PI - 0.2 },
    ];
    for (const { px: ppx, pz: ppz, angle: pang } of planePositions) {
      ctx.save();
      ctx.translate(ppx, ppz);
      ctx.rotate(pang);
      // 机身（水平线）
      ctx.beginPath();
      ctx.moveTo(-2.5, 0);
      ctx.lineTo(2.5, 0);
      ctx.stroke();
      // 主翼（垂直线，位于机身中偏后）
      ctx.beginPath();
      ctx.moveTo(-0.5, -2);
      ctx.lineTo(-0.5, 2);
      ctx.stroke();
      // 尾翼（短线）
      ctx.beginPath();
      ctx.moveTo(1.8, -0.8);
      ctx.lineTo(1.8, 0.8);
      ctx.stroke();
      ctx.restore();
    }

    // 7. 航站楼（wobblyRect 小楼 + 顶棚线）
    const termW = 8, termD = 4;
    const termX = airport.tower.dx - 2, termZ = airport.tower.dz + 3;
    (ctx as unknown as Record<string, unknown>).fillStyle = '#f0ead8';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.2;
    wobblyRect(ctx, apRng, termX, termZ, termW, termD, 0.4);
    ctx.fill();
    wobblyRect(ctx, apRng, termX, termZ, termW, termD, 0.4);
    ctx.stroke();
    // 顶棚线（沿宽度方向 2 条短线）
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(termX + termW * 0.2, termZ);
    ctx.lineTo(termX + termW * 0.2, termZ - 1.5);
    ctx.moveTo(termX + termW * 0.8, termZ);
    ctx.lineTo(termX + termW * 0.8, termZ - 1.5);
    ctx.stroke();

    // 8. 机库（半圆拱形，用弧线绘制）
    const { dx: hgDx, dz: hgDz } = airport.hangar;
    const hgW = 5, hgH = 4;
    (ctx as unknown as Record<string, unknown>).fillStyle = '#d8d0c0';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(hgDx - hgW / 2, hgDz + hgH / 2);
    ctx.lineTo(hgDx - hgW / 2, hgDz);
    ctx.arc(hgDx, hgDz, hgW / 2, Math.PI, 0, false);
    ctx.lineTo(hgDx + hgW / 2, hgDz + hgH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 9. 塔台（小圆顶塔）
    const { dx: twDx, dz: twDz } = airport.tower;
    // 塔身（wobblyRect）
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.paper;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.2;
    wobblyRect(ctx, apRng, twDx - 1, twDz - 5, 2, 5, 0.3);
    ctx.fill();
    wobblyRect(ctx, apRng, twDx - 1, twDz - 5, 2, 5, 0.3);
    ctx.stroke();
    // 控制室（小方块圆顶）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#c8dce0';
    wobblyRect(ctx, apRng, twDx - 1.5, twDz - 6.5, 3, 1.5, 0.2);
    ctx.fill();
    ctx.stroke();

    // 10. 风向袋（斜杆 + 小三角旗）
    const wsX = len / 2 - 8, wsZ = hw + 3;  // 跑道侧方
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    ctx.beginPath();
    ctx.moveTo(wsX, wsZ);
    ctx.lineTo(wsX - 1, wsZ - 4);   // 斜杆
    ctx.stroke();
    // 三角旗（橙色）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#e06020';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(wsX - 1, wsZ - 4);
    ctx.lineTo(wsX + 1.5, wsZ - 3.5);
    ctx.lineTo(wsX - 1, wsZ - 2.5);
    ctx.closePath();
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    ctx.restore();

    // 11. accessRoad（乡间路，narrow roadFill 带，在 ctx.restore() 之后，世界坐标）
    if (airport.accessRoad.length >= 2) {
      const arPts = airport.accessRoad;
      const arLeft = offsetPolyline(arPts as ReadonlyArray<readonly [number, number]>, 1);
      const arRight = offsetPolyline(arPts as ReadonlyArray<readonly [number, number]>, -1);
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(arLeft[0][0], arLeft[0][1]);
      for (const p of arLeft) ctx.lineTo(p[0], p[1]);
      for (let i = arRight.length - 1; i >= 0; i--) ctx.lineTo(arRight[i][0], arRight[i][1]);
      ctx.closePath();
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      wobblyPath(ctx, rng, arPts as [number, number][], 1.2);
      ctx.stroke();
    }
  }

  // 轮渡
  const { ferry } = transport;
  if (ferry) {
    const frRng = rng0(wsPrefix + ':ferry:draw');
    // 两端渡口小栈板
    for (const dock of ferry.docks) {
      (ctx as unknown as Record<string, unknown>).fillStyle = '#9a7a5e';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      wobblyRect(ctx, frRng, dock.x - 0.75, dock.z - 1.5, 1.5, 3, 0.3);
      ctx.fill();
      wobblyRect(ctx, frRng, dock.x - 0.75, dock.z - 1.5, 1.5, 3, 0.3);
      ctx.stroke();
    }

    // 航线虚线
    if (ferry.route.length >= 2) {
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.water;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.2;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      dashedPath(ctx, ferry.route, [4, 5]);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 渡口 accessPaths：乡间小路（复用 accessRoad 乡间路画法）
    if (ferry.accessPaths) {
      for (const apPts of ferry.accessPaths) {
        if (apPts.length < 2) continue;
        const arLeft = offsetPolyline(apPts as ReadonlyArray<readonly [number, number]>, 1);
        const arRight = offsetPolyline(apPts as ReadonlyArray<readonly [number, number]>, -1);
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(arLeft[0][0], arLeft[0][1]);
        for (const p of arLeft) ctx.lineTo(p[0], p[1]);
        for (let i = arRight.length - 1; i >= 0; i--) ctx.lineTo(arRight[i][0], arRight[i][1]);
        ctx.closePath();
        ctx.fill();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        wobblyPath(ctx, frRng, apPts as [number, number][], 1.2);
        ctx.stroke();
      }
    }
  }

  void params;
  void wsPrefix;
}

/* ------------------------------------------------------------------ */
/* 旷野元素 — 动物园                                                    */
/* ------------------------------------------------------------------ */

function paintZoo(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cz: number,
  theme: string,
): void {
  const isSnow = theme === 'snow';
  const fenceR = 10 + rng() * 4; // 10-14

  // 围栏圈（wobbly 闭合圆，wobble 大 → 不规则）
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
  wobblyCircle(ctx, rng, cx, cz, fenceR, 0.18);
  ctx.stroke();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 围栏短竖线（栏杆，每 2 单位一根，沿圆弧均匀采样）
  const railCount = Math.floor(fenceR * Math.PI); // ~周长/2
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
  for (let ri = 0; ri < railCount; ri++) {
    const ang = (ri / railCount) * Math.PI * 2;
    const rx = cx + Math.cos(ang) * fenceR;
    const rz = cz + Math.sin(ang) * fenceR;
    const outX = cx + Math.cos(ang) * (fenceR + 1.0);
    const outZ = cz + Math.sin(ang) * (fenceR + 1.0);
    ctx.beginPath();
    ctx.moveTo(rx, rz);
    ctx.lineTo(outX, outZ);
    ctx.stroke();
  }

  // 入口小门房（缺口朝南，wobblyRect）
  const gateZ = cz + fenceR - 0.5;
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
  wobblyRect(ctx, rng, cx - 1.0, gateZ, 2.0, 1.5, 0.3);
  ctx.fill();
  wobblyRect(ctx, rng, cx - 1.0, gateZ, 2.0, 1.5, 0.3);
  ctx.stroke();

  // 2-3 个小圈舍
  const enclosureCount = 2 + Math.floor(rng() * 2);
  for (let ei = 0; ei < enclosureCount; ei++) {
    const ang = (ei / enclosureCount) * Math.PI * 2 + rng() * 0.5;
    const er = fenceR * (0.35 + rng() * 0.2);
    const ex = cx + Math.cos(ang) * er;
    const ez = cz + Math.sin(ang) * er;
    const encR = 2 + rng() * 1.5;

    // 圈舍边界
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyCircle(ctx, rng, ex, ez, encR, 0.1);
    ctx.stroke();

    // 动物涂鸦（2-3 笔极简）
    const animalCount = 2 + Math.floor(rng() * 2);
    for (let ai = 0; ai < animalCount; ai++) {
      const ax2 = ex + (rng() - 0.5) * encR * 1.2;
      const az2 = ez + (rng() - 0.5) * encR * 1.2;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;

      if (isSnow) {
        if (ai % 2 === 0) {
          // 驯鹿（reindeer）: oval body + forked antlers
          wobblyCircle(ctx, rng, ax2, az2, 0.8, 0.15);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ax2, az2 - 0.8);
          ctx.lineTo(ax2 - 0.6, az2 - 1.6);
          ctx.moveTo(ax2 - 0.3, az2 - 1.2);
          ctx.lineTo(ax2 - 0.8, az2 - 1.0);
          ctx.moveTo(ax2, az2 - 0.8);
          ctx.lineTo(ax2 + 0.6, az2 - 1.6);
          ctx.moveTo(ax2 + 0.3, az2 - 1.2);
          ctx.lineTo(ax2 + 0.8, az2 - 1.0);
          ctx.stroke();
        } else {
          // 雪枭（snow-owl）: circle body + two triangle ears + two dot eyes
          wobblyCircle(ctx, rng, ax2, az2, 0.65, 0.12);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ax2 - 0.3, az2 - 0.65);
          ctx.lineTo(ax2 - 0.55, az2 - 1.1);
          ctx.lineTo(ax2 - 0.05, az2 - 0.95);
          ctx.closePath();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ax2 + 0.3, az2 - 0.65);
          ctx.lineTo(ax2 + 0.55, az2 - 1.1);
          ctx.lineTo(ax2 + 0.05, az2 - 0.95);
          ctx.closePath();
          ctx.stroke();
          (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.ink;
          ctx.fillRect(ax2 - 0.2, az2 - 0.25, 0.15, 0.15);
          ctx.fillRect(ax2 + 0.05, az2 - 0.25, 0.15, 0.15);
        }
      } else {
        // 轮换：长颈鹿/象/鹿 by index
        const kind = ai % 3;
        if (kind === 0) {
          // 长颈鹿：长脖子竖线 + 小圆头
          ctx.beginPath();
          ctx.moveTo(ax2, az2);
          ctx.lineTo(ax2 + 0.3, az2 - 1.8); // 脖颈斜线
          ctx.stroke();
          wobblyCircle(ctx, rng, ax2 + 0.3, az2 - 2.0, 0.35, 0.12);
          ctx.stroke();
          // 斑点（2个小方点）
          ctx.fillRect(ax2 - 0.2, az2 - 0.5, 0.25, 0.25);
          ctx.fillRect(ax2 + 0.1, az2 - 0.8, 0.2, 0.2);
        } else if (kind === 1) {
          // 象：大耳朵圆身
          wobblyCircle(ctx, rng, ax2, az2, 0.75, 0.12); // 身体
          ctx.stroke();
          // 大耳朵（左侧半圆弧）
          ctx.beginPath();
          ctx.arc(ax2 - 0.75, az2, 0.5, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
        } else {
          // 鹿：分叉角
          ctx.beginPath();
          ctx.moveTo(ax2, az2);
          ctx.lineTo(ax2, az2 - 1.2); // 脖颈
          ctx.stroke();
          // 左分叉
          ctx.beginPath();
          ctx.moveTo(ax2, az2 - 1.0);
          ctx.lineTo(ax2 - 0.5, az2 - 1.5);
          ctx.moveTo(ax2 - 0.3, az2 - 1.2);
          ctx.lineTo(ax2 - 0.7, az2 - 1.1);
          ctx.stroke();
          // 右分叉
          ctx.beginPath();
          ctx.moveTo(ax2, az2 - 1.0);
          ctx.lineTo(ax2 + 0.5, az2 - 1.5);
          ctx.moveTo(ax2 + 0.3, az2 - 1.2);
          ctx.lineTo(ax2 + 0.7, az2 - 1.1);
          ctx.stroke();
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 旷野元素 — 湿地森林                                                   */
/* ------------------------------------------------------------------ */

function paintWetland(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cz: number,
  theme: string,
  isHarbor: boolean,
): void {
  const isSnow = theme === 'snow';
  const poolColor = isHarbor ? '#b8d4c0' : isSnow ? '#ccdce8' : PAPER.water;
  const poolCount = 3 + Math.floor(rng() * 4); // 3-6

  // 水洼群
  for (let pi = 0; pi < poolCount; pi++) {
    const px = cx + (rng() - 0.5) * 18;
    const pz = cz + (rng() - 0.5) * 14;
    const pr = 2 + rng() * 3;
    (ctx as unknown as Record<string, unknown>).fillStyle = poolColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = isSnow ? 0.6 : 0.5;
    wobblyCircle(ctx, rng, px, pz, pr, 0.18);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    wobblyCircle(ctx, rng, px, pz, pr, 0.10);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  if (isSnow) {
    // 冻结湿地：冰面裂纹代替芦苇
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#8ab4d0';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
    for (let ci = 0; ci < 4; ci++) {
      const cpx = cx + (rng() - 0.5) * 16;
      const cpz = cz + (rng() - 0.5) * 12;
      const crackPts: [number, number][] = [];
      for (let ck = 0; ck < 5; ck++) {
        crackPts.push([cpx + (rng() - 0.5) * 4, cpz + (rng() - 0.5) * 4]);
      }
      wobblyPath(ctx, rng, crackPts, 0.2);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  } else {
    // 芦苇丛（3-5 簇，每簇 4-6 短竖线 + 顶端小点）
    const reedClusterCount = 3 + Math.floor(rng() * 3);
    for (let rc = 0; rc < reedClusterCount; rc++) {
      const rx = cx + (rng() - 0.5) * 20;
      const rz = cz + (rng() - 0.5) * 16;
      const reedCount = 4 + Math.floor(rng() * 3);
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#8a9860';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      for (let ri = 0; ri < reedCount; ri++) {
        const rrx = rx + (rng() - 0.5) * 2.5;
        const rrz = rz + (rng() - 0.5) * 2.0;
        const rh = 1.5 + rng() * 1.0;
        ctx.beginPath();
        ctx.moveTo(rrx, rrz);
        ctx.lineTo(rrx + (rng() - 0.5) * 0.3, rrz - rh);
        ctx.stroke();
        // 顶端小圆点
        (ctx as unknown as Record<string, unknown>).fillStyle = '#6a7850';
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(rrx + (rng() - 0.5) * 0.3, rrz - rh - 0.15, 0.15, 0, Math.PI * 2);
        ctx.fill();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }
    }
  }

  // 木栈道（窄双线折线穿过湿地，3-5 段）
  const boardwalkSegments = 3 + Math.floor(rng() * 3);
  const bwPts: [number, number][] = [];
  for (let bi = 0; bi < boardwalkSegments; bi++) {
    bwPts.push([
      cx + (rng() - 0.5) * 16,
      cz - 8 + bi * (16 / boardwalkSegments) + (rng() - 0.5) * 3,
    ]);
  }
  if (bwPts.length >= 2) {
    const bwLeft = offsetPolyline(bwPts as ReadonlyArray<readonly [number, number]>, 0.4);
    const bwRight = offsetPolyline(bwPts as ReadonlyArray<readonly [number, number]>, -0.4);
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#9a7a5e';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyPath(ctx, rng, bwLeft, 0.3);
    ctx.stroke();
    wobblyPath(ctx, rng, bwRight, 0.3);
    ctx.stroke();
    // 横板短线
    for (let bi = 0; bi < bwPts.length - 1; bi++) {
      const tx = (bwPts[bi][0] + bwPts[bi + 1][0]) / 2;
      const tz = (bwPts[bi][1] + bwPts[bi + 1][1]) / 2;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(tx - 0.5, tz);
      ctx.lineTo(tx + 0.5, tz);
      ctx.stroke();
    }
  }

  // 2-3 棵水边树
  const waterTreeCount = 2 + Math.floor(rng() * 2);
  for (let wt = 0; wt < waterTreeCount; wt++) {
    const wtx = cx + (rng() - 0.5) * 20;
    const wtz = cz + (rng() - 0.5) * 16;
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
    scribbleBlob(ctx, rng, wtx, wtz, 1.0 + rng() * 0.5);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 层 6.5 — 旷野填充                                                    */
/* ------------------------------------------------------------------ */

function paintWilderness(
  ctx: CanvasRenderingContext2D,
  city: CityModel,
  params: WorldParams,
  transport: TransportNet,
  wsPrefix: string,
): void {
  const rng = rng0(wsPrefix + ':wild');
  const { T, riverDist, RIVER_W } = params;
  const theme = city.theme;
  const biome = getBiome(theme);

  const isSnow = theme === 'snow';
  const isMountain = theme === 'mountain';
  const isHarbor = theme === 'harbor';

  // 候选点生成：80 个
  const candidates: [number, number][] = [];
  for (let i = 0; i < 80; i++) {
    const x = (rng() * 2 - 1) * T * 0.9;
    const z = (rng() * 2 - 1) * T * 0.9;

    // 离区团块 > 8
    let tooClose = false;
    for (const d of city.districts) {
      if (d.polygon.length >= 2) {
        const pd = polyDist(x, z, d.polygon);
        if (pd < 8) { tooClose = true; break; }
      }
    }
    if (tooClose) continue;

    // 离水 > 8
    if (params.waterStyle === 'sea' && params.seaData) {
      if (params.seaData.coastDist(x, z) < 8) continue;
    } else {
      if (riverDist(x, z) < RIVER_W + 8) continue;
    }

    // 离铁路折线 > 4
    let nearRail = false;
    for (const edge of transport.rails) {
      if (edge.pts.length >= 2) {
        const pd = polyDist(x, z, edge.pts);
        if (pd < 4) { nearRail = true; break; }
      }
    }
    if (nearRail) continue;

    // harbor：海岸方向留空（沙滩空旷）
    if (isHarbor && params.seaData && params.seaData.coastDist(x, z) < 20) continue;

    candidates.push([x, z]);
  }

  if (candidates.length === 0) return;

  // 草甸色斑：5-10 个
  const meadowCount = 5 + Math.floor(rng() * 6);
  const meadowColor = isSnow ? '#dce8f0' : '#c8e098';
  for (let i = 0; i < Math.min(meadowCount, candidates.length); i++) {
    const [cx, cz] = candidates[i % candidates.length];
    const r = 6 + rng() * 6;
    (ctx as unknown as Record<string, unknown>).fillStyle = meadowColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.15;
    scribbleBlob(ctx, rng, cx, cz, r);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  // 森林块：4-8 片（snow 主题用三角松，普通用 scribbleBlob）
  const forestPatchCount = Math.min(4 + Math.floor(rng() * 5), Math.max(0, candidates.length - meadowCount));
  const forestDensity = isMountain ? 1.5 : 1.0;
  const forestBlobColor = isMountain ? '#c0d8a0' : '#d4ecb0';

  // 先计算每片的 blobR，找最大片升级为「深林」
  const forestBlobRs: number[] = [];
  for (let fi = 0; fi < forestPatchCount; fi++) {
    forestBlobRs.push(8 + rng() * 6);
  }
  const deepForestIdx = forestBlobRs.indexOf(Math.max(...forestBlobRs.length ? forestBlobRs : [0]));

  for (let fi = 0; fi < forestPatchCount; fi++) {
    const candidateIdx = (meadowCount + fi) % candidates.length;
    const [cx, cz] = candidates[candidateIdx];
    const blobR = forestBlobRs[fi];
    const isDeep = fi === deepForestIdx && forestPatchCount > 0;

    // 底斑
    (ctx as unknown as Record<string, unknown>).fillStyle = forestBlobColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.25;
    scribbleBlob(ctx, rng, cx, cz, blobR);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 深林：外缘额外绿斑
    if (isDeep) {
      (ctx as unknown as Record<string, unknown>).fillStyle = '#b8d4a0';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.15;
      scribbleBlob(ctx, rng, cx, cz, blobR * 1.3);
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 树数量：深林 20-40，普通 8-20
    const baseCount = isDeep ? 20 + Math.floor(rng() * 21) : 8 + Math.floor(rng() * 13);
    const treeCount = Math.round(baseCount * forestDensity);

    for (let ti = 0; ti < treeCount; ti++) {
      const tx = cx + (rng() - 0.5) * blobR * 1.5;
      const tz = cz + (rng() - 0.5) * blobR * 1.5;
      const tr = 1.2 + rng() * 1.0;

      if (isSnow) {
        // snow：三角松（与原有实现一致）
        const h = tr * 2.2;
        const trunkH = h * 0.4;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(tx, tz + trunkH * 0.5);
        ctx.lineTo(tx, tz + trunkH);
        ctx.stroke();
        for (let li = 0; li < 3; li++) {
          const ly = tz - h * 0.7 + li * (h * 0.3);
          const lw = h * 0.2 + li * h * 0.15;
          (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
          (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(tx, ly);
          ctx.lineTo(tx - lw, ly + h * 0.25);
          ctx.lineTo(tx + lw, ly + h * 0.25);
          ctx.closePath();
          ctx.fill();
          (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
          (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(tx, ly);
          ctx.lineTo(tx - h * 0.06, ly + h * 0.1);
          ctx.lineTo(tx + h * 0.06, ly + h * 0.1);
          ctx.closePath();
          ctx.fill();
          (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        }
      } else {
        // 普通圆团树
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
        scribbleBlob(ctx, rng, tx, tz, tr);
        ctx.fill();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
        ctx.beginPath();
        ctx.moveTo(tx, tz);
        ctx.lineTo(tx, tz + 1.5 + rng() * 0.8);
        ctx.stroke();
      }
    }

    // 深林：内部林间小径（虚线，4-6 个折点）
    if (isDeep) {
      const trailSegCount = 4 + Math.floor(rng() * 3);
      const trailPts: [number, number][] = [];
      for (let tsi = 0; tsi < trailSegCount; tsi++) {
        trailPts.push([
          cx + (rng() - 0.5) * blobR * 1.2,
          cz - blobR * 0.6 + tsi * (blobR * 1.2 / trailSegCount) + (rng() - 0.5) * 2,
        ]);
      }
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
      dashedPath(ctx, trailPts, [2, 3]);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }

  // 大公园：1-2 个
  const parkCount = 1 + Math.floor(rng() * 2);
  for (let pi = 0; pi < parkCount; pi++) {
    if (candidates.length === 0) break;
    const candidateIdx = (meadowCount + forestPatchCount + pi) % candidates.length;
    const [cx, cz] = candidates[candidateIdx];

    // 草地底
    const grassR = 12 + rng() * 6;
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.2;
    scribbleBlob(ctx, rng, cx, cz, grassR);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 环形小径
    const pathR = 5 + rng() * 3;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.roadEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.2;
    wobblyCircle(ctx, rng, cx, cz, pathR, 0.08);
    ctx.stroke();

    // 池塘
    const pondR = 2 + rng() * 1;
    const pondColor = isSnow ? '#ccdce8' : PAPER.water;
    (ctx as unknown as Record<string, unknown>).fillStyle = pondColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    wobblyCircle(ctx, rng, cx, cz, pondR, 0.12);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 长椅两笔
    const benchOff = pathR * 0.6;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(cx - 1.5, cz + benchOff);
    ctx.lineTo(cx + 1.5, cz + benchOff);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 1.5, cz + benchOff + 0.7);
    ctx.lineTo(cx + 1.5, cz + benchOff + 0.7);
    ctx.stroke();
  }

  // 动物园：0-2 处（rng 决定，candidates 足够时出现）
  const zooCount = Math.min(
    Math.floor(rng() * 3), // 0-2
    Math.max(0, candidates.length - meadowCount - forestPatchCount - parkCount),
  );
  for (let zi = 0; zi < zooCount; zi++) {
    const candidateIdx = (meadowCount + forestPatchCount + parkCount + zi) % candidates.length;
    const [zx, zz] = candidates[candidateIdx];
    paintZoo(ctx, rng, zx, zz, theme);
  }

  // 湿地：0-2 处
  const wetlandCount = Math.min(
    Math.floor(rng() * 3), // 0-2
    Math.max(0, candidates.length - meadowCount - forestPatchCount - parkCount - zooCount),
  );
  for (let wi2 = 0; wi2 < wetlandCount; wi2++) {
    const candidateIdx = (meadowCount + forestPatchCount + parkCount + zooCount + wi2) % candidates.length;
    const [wx2, wz2] = candidates[candidateIdx];
    paintWetland(ctx, rng, wx2, wz2, theme, isHarbor);
  }

  void biome;
}

/* ------------------------------------------------------------------ */
/* 主函数（重构）                                                        */
/* ------------------------------------------------------------------ */

export interface CityPainter {
  hitItems: HitItem[];
  drawStatic(ctx: CanvasRenderingContext2D): void;
}

/**
 * buildCityPainter — 将「绘制指令」与「worldcanvas 承载」解耦。
 *
 * drawStatic 可重复调用且输出完全一致：
 *   - 所有 rng0(seed) 在 drawStatic 内部创建，不依赖外部状态。
 *   - 传入的 ctx 应已设置好世界坐标变换（由 hiCanvas 或 worldcanvas 负责）。
 *
 * hitItems 在数据准备阶段算好，不依赖 draw。
 */
export function buildCityPainter(
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
): CityPainter {
  // 数据准备：构建交通网（纯数据，可缓存）
  const transport = buildTransport(city, params, wsPrefix);

  // 构建 HitItem[]：先 district polygon，后 building circle
  const hitItems: HitItem[] = [];

  // 街区 polygon（先）
  for (const district of city.districts) {
    hitItems.push({
      kind: 'district',
      shape: { type: 'polygon', pts: district.polygon },
      data: { type: 'district', district },
    });
  }

  // 建筑 circle（后，hit 倒序 = 建筑最上层优先命中）
  for (const district of city.districts) {
    for (const b of district.buildings) {
      hitItems.push({
        kind: 'building',
        shape: { type: 'circle', x: b.x, z: b.z, r: footprintR(b) + 0.5 },
        data: { type: 'building', b, dir: district.dir },
      });
    }
  }

  // drawStatic：可重复调用，内部自行创建所有 rng
  // ctx 必须已设置世界坐标变换（世界单位 → 像素）
  // tileBounds 使用整个城市扩展范围；hiCanvas 路径下 ctx 覆盖完整区域
  function drawStatic(ctx: CanvasRenderingContext2D): void {
    // 从 ctx 当前变换反推世界范围（hiCanvas 下为 viewport→world，worldcanvas 下为 tile 范围）
    // 这里我们使用全城市范围的边界框以保证完整绘制
    const xs = city.districts.flatMap((d) => [d.x, d.x + d.width]);
    const zs = city.districts.flatMap((d) => [d.z, d.z + d.depth]);
    const expand = 130;
    const minX = (xs.length ? Math.min(...xs) : -60) - expand;
    const minZ = (zs.length ? Math.min(...zs) : -60) - expand;
    const maxX = (xs.length ? Math.max(...xs) : 60) + expand;
    const maxZ = (zs.length ? Math.max(...zs) : 60) + expand;

    // 层 1 中的纸底色使用 biome ground
    const biome = getBiome(city.theme);

    // 层 1 — 纸底
    const bgRng = rng0(wsPrefix + ':bg');
    paintBackground(ctx, minX, minZ, maxX, maxZ, bgRng, biome.ground.paper, biome.ground.patch);

    // 层 2 — 山脉（按 biome 参数）
    const mtnRng = rng0(wsPrefix + ':mtn');
    const mSpec = biome.mountains;
    const isMountain = city.theme === 'mountain';
    paintMountains(
      ctx, params, mtnRng,
      mSpec.proximity, mSpec.density, mSpec.snowline,
      isMountain ? 2 : 1,
    );

    // 层 3 — 水系（按 waterStyle 分派）
    const waterStyle = params.waterStyle ?? 'river';
    if (waterStyle === 'sea') {
      const seaRng = rng0(wsPrefix + ':sea');
      paintSea(ctx, params, seaRng);
      // harbor 无大河，跳过 paintRiver / paintCanal
    } else if (waterStyle === 'frozen') {
      const frozenRng = rng0(wsPrefix + ':frozen');
      paintFrozenRiver(ctx, params, frozenRng);
      // 仍绘制运河（但冻河版本会在 paintCanal 中保持不变）
      const canalRng = rng0(wsPrefix + ':canal');
      paintCanal(ctx, params, canalRng);
    } else if (waterStyle === 'torrent') {
      const torrentRng = rng0(wsPrefix + ':torrent');
      paintTorrentRiver(ctx, params, torrentRng);
      // mountain 无运河（canalPts 原则上正常生成，但 mountain 忽略它）
    } else {
      // river（plains 默认）
      const riverRng = rng0(wsPrefix + ':river');
      paintRiver(ctx, params, riverRng);
      const canalRng = rng0(wsPrefix + ':canal');
      paintCanal(ctx, params, canalRng);
    }

    // 层 3c — 湖泊
    paintLakes(ctx, params, wsPrefix);

    // 层 3d — 桥
    const bridgeRng = rng0(wsPrefix + ':bridge');
    paintBridges(ctx, city.roads, params, bridgeRng);

    // 层 4 — 街区补丁
    paintDistricts(ctx, city.districts, wsPrefix, city.theme);

    // 层 5 — 道路（只画 main 和 avenue）
    paintRoads(ctx, city.roads, wsPrefix);

    // 层 5.5 — 跨区交通网
    paintTransport(ctx, transport, params, wsPrefix);

    // 层 6 — 公园/池塘
    paintParks(ctx, city.districts, wsPrefix);

    // 层 6.5 — 旷野填充
    paintWilderness(ctx, city, params, transport, wsPrefix);

    // 层 7 — 建筑
    paintBuildings(ctx, city.districts, wsPrefix);

    // 层 8 — 树木
    paintTrees(ctx, city.districts, wsPrefix, city.theme);

    // 层 9 — 专属元素（extras）
    paintExtras(ctx, params, city, wsPrefix, minX, minZ, maxX, maxZ);
  }

  return { hitItems, drawStatic };
}

/**
 * paintCity — 向后兼容的旧 API。
 * 内部用 buildCityPainter 实现；现有测试不需改动。
 */
export function paintCity(
  world: WorldCanvas,
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
): HitItem[] {
  const painter = buildCityPainter(city, params, wsPrefix);
  world.paint((ctx) => painter.drawStatic(ctx));
  return painter.hitItems;
}
