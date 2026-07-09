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
): void {
  // 填充纸底色
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.paper;
  ctx.fillRect(minX, minZ, maxX - minX, maxZ - minZ);

  // 2000 个稀疏噪点
  (ctx as unknown as Record<string, unknown>).fillStyle = 'rgba(90,90,86,0.05)';
  for (let i = 0; i < 2000; i++) {
    const nx = minX + rng() * (maxX - minX);
    const nz = minZ + rng() * (maxZ - minZ);
    ctx.fillRect(nx, nz, 1, 1);
  }

  // 140 条短纤维线
  (ctx as unknown as Record<string, unknown>).strokeStyle = 'rgba(90,90,86,0.07)';
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
  for (let i = 0; i < 140; i++) {
    const fx = minX + rng() * (maxX - minX);
    const fz = minZ + rng() * (maxZ - minZ);
    const angle = rng() * Math.PI * 2;
    const len = 4 + rng() * 6; // 4-10 世界单位
    ctx.beginPath();
    ctx.moveTo(fx, fz);
    ctx.lineTo(fx + Math.cos(angle) * len, fz + Math.sin(angle) * len);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* 层 2 — 山脉                                                          */
/* ------------------------------------------------------------------ */

function paintMountains(
  ctx: CanvasRenderingContext2D,
  params: WorldParams,
  rng: () => number,
): void {
  const { cosM, sinM, worldR } = params;

  // 山脉垂直方向（旋转90度）
  const perpX = -sinM;
  const perpZ = cosM;

  // 在山脉带两侧各取 5-8 个山峰采样点
  const peakCount = 5 + Math.floor(rng() * 4); // 5-8

  for (let i = 0; i < peakCount; i++) {
    // 沿山脉方向的位置
    const along = (rng() - 0.5) * worldR * 1.8;
    // 垂直于山脉方向的偏移（山脉带宽）
    const across = (worldR * 0.6) + rng() * worldR * 0.5;

    const cx = cosM * along + perpX * across;
    const cz = sinM * along + perpZ * across;

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
    const snowY = cz - peakH * 0.85;
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
): void {
  for (const district of districts) {
    const rng = rng0(wsPrefix + ':dist:' + district.dir);
    const poly = district.polygon;

    // 街区 pastel 填充
    const pastelColor = PAPER.pastels[hashStr(district.dir) % 6];
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
      (ctx as unknown as Record<string, unknown>).font = `italic ${fontSize}px cursive`;
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
/* 层 8 — 树木                                                          */
/* ------------------------------------------------------------------ */

function paintTrees(
  ctx: CanvasRenderingContext2D,
  districts: District[],
  wsPrefix: string,
): void {
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
    const treeCount = Math.max(2, Math.floor(area / 40));

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

      // 树冠（一次 beginPath，fill 与 stroke 共享同一路径）
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
      scribbleBlob(ctx, rng, tx, tz, tr);
      ctx.fill();
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

      // 树干（短竖线 2-3 个单位高）
      const trunkH = 2 + rng();
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(tx, tz);
      ctx.lineTo(tx, tz + trunkH);
      ctx.stroke();

      placed++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 主函数                                                               */
/* ------------------------------------------------------------------ */

export function paintCity(
  world: WorldCanvas,
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
): HitItem[] {
  world.paint((ctx, tileBounds) => {
    const { minX, minZ, maxX, maxZ } = tileBounds;

    // 层 1 — 纸底
    const bgRng = rng0(wsPrefix + ':bg');
    paintBackground(ctx, minX, minZ, maxX, maxZ, bgRng);

    // 层 2 — 山脉
    const mtnRng = rng0(wsPrefix + ':mtn');
    paintMountains(ctx, params, mtnRng);

    // 层 3a — 河流
    const riverRng = rng0(wsPrefix + ':river');
    paintRiver(ctx, params, riverRng);

    // 层 3b — 运河
    const canalRng = rng0(wsPrefix + ':canal');
    paintCanal(ctx, params, canalRng);

    // 层 3c — 湖泊
    paintLakes(ctx, params, wsPrefix);

    // 层 3d — 桥
    const bridgeRng = rng0(wsPrefix + ':bridge');
    paintBridges(ctx, city.roads, params, bridgeRng);

    // 层 4 — 街区补丁
    paintDistricts(ctx, city.districts, wsPrefix);

    // 层 5 — 道路（只画 main 和 avenue）
    paintRoads(ctx, city.roads, wsPrefix);

    // 层 6 — 公园/池塘
    paintParks(ctx, city.districts, wsPrefix);

    // 层 7 — 建筑
    paintBuildings(ctx, city.districts, wsPrefix);

    // 层 8 — 树木
    paintTrees(ctx, city.districts, wsPrefix);
  });

  // 构建 HitItem[]：先 district polygon，后 building circle
  const hits: HitItem[] = [];

  // 街区 polygon（先）
  for (const district of city.districts) {
    hits.push({
      kind: 'district',
      shape: { type: 'polygon', pts: district.polygon },
      data: { type: 'district', district },
    });
  }

  // 建筑 circle（后，hit 倒序 = 建筑最上层优先命中）
  for (const district of city.districts) {
    for (const b of district.buildings) {
      hits.push({
        kind: 'building',
        shape: { type: 'circle', x: b.x, z: b.z, r: footprintR(b) + 0.5 },
        data: { type: 'building', b, dir: district.dir },
      });
    }
  }

  return hits;
}
