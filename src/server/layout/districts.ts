import { hashSeed, mulberry32 } from './rng.js';

export interface Plot {
  dir: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  polygon: [number, number][];
}

const UNIT_AREA = 64; // 每篇笔记占据的世界面积（4x4 建筑格 × 4 格余量）
const R_SCALE = 1.2; // 团块半径系数（确保楼位格子够用）
const MIN_GAP = 12; // 旷野最小间隙
const TARGET_GAP = 22; // 目标间隙（候选选取策略）
const MAX_CANDIDATES = 80; // 每次散布候选点数
const POLY_VERTS = 18; // 有机多边形顶点数

/**
 * 射线法判断点 (x, z) 是否在多边形 poly 内部（或边界上）。
 */
export function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 以 (cx, cz) 为中心、基础半径 R 生成 18 顶点有机多边形。
 * 使用三种正弦扰动叠加，顶点半径比 max/min ≥ 1.25。
 */
function buildOrganicPolygon(
  cx: number,
  cz: number,
  R: number,
  rng: () => number,
): [number, number][] {
  const φ1 = rng() * Math.PI * 2;
  const φ2 = rng() * Math.PI * 2;
  const φ3 = rng() * Math.PI * 2;

  const points: [number, number][] = [];
  for (let i = 0; i < POLY_VERTS; i++) {
    const θ = (i / POLY_VERTS) * Math.PI * 2;
    const r =
      R *
      (0.7 +
        0.16 * Math.sin(3 * θ + φ1) +
        0.11 * Math.sin(5 * θ + φ2) +
        0.08 * Math.sin(2 * θ + φ3));
    points.push([cx + r * Math.cos(θ), cz + r * Math.sin(θ)]);
  }
  return points;
}

/**
 * 从多边形顶点推导 bbox（x/z/width/depth）。
 */
function bboxFromPolygon(polygon: [number, number][]): {
  x: number;
  z: number;
  width: number;
  depth: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [px, pz] of polygon) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  return { x: minX, z: minZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * 散落式聚落布局：每个目录一个有机团块，拉开散布在世界地图上。
 * 签名不变：counts → Plot[]
 */
export function layoutDistricts(counts: { dir: string; count: number }[]): Plot[] {
  const items = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  const total = items.reduce((s, c) => s + c.count, 0);
  if (total === 0) return [];

  // 计算每个团块的半径
  const radii = items.map((item) => Math.sqrt((item.count * UNIT_AREA) / Math.PI) * R_SCALE);
  const maxR = Math.max(...radii);

  // 世界散布半径
  const SPREAD_R = Math.max(Math.sqrt(total * UNIT_AREA) * 0.95, maxR * 2.2);

  // 已放置中心点集合
  const placed: Array<{ cx: number; cz: number; R: number }> = [];
  const centers: Array<{ cx: number; cz: number }> = [];

  const plots: Plot[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const R = radii[idx];

    // 每个团块用独立的 rng（由 dir 哈希生成）
    const rng = mulberry32(hashSeed(item.dir));
    // 消耗3次生成φ1/φ2/φ3，保证多边形确定性
    const rngScatter = mulberry32(hashSeed('scatter:' + item.dir));

    let cx: number;
    let cz: number;

    if (idx === 0) {
      // 最大的落在离原点 ≤ SPREAD_R*0.25 的种子随机位置
      const r0 = rngScatter() * SPREAD_R * 0.25;
      const a0 = rngScatter() * Math.PI * 2;
      cx = r0 * Math.cos(a0);
      cz = r0 * Math.sin(a0);
    } else {
      // 生成候选点，使用目标间隙策略
      let bestCx = 0;
      let bestCz = 0;
      let bestGap = -Infinity;

      // 目标间隙候选（gap ≥ MIN_GAP，选 |gap - TARGET_GAP| 最小者）
      let bestTargetCx = 0;
      let bestTargetCz = 0;
      let bestTargetDist = Infinity;

      for (let c = 0; c < MAX_CANDIDATES; c++) {
        // 均匀撒在半径 SPREAD_R 圆内（拒绝采样 → 均匀分布）
        let candX: number;
        let candZ: number;
        let u: number, v: number;
        do {
          u = rngScatter() * 2 - 1;
          v = rngScatter() * 2 - 1;
        } while (u * u + v * v > 1);
        candX = u * SPREAD_R;
        candZ = v * SPREAD_R;

        // 与所有已放置团块的最小间隙
        let minGap = Infinity;
        for (const p of placed) {
          const dist = Math.sqrt((candX - p.cx) ** 2 + (candZ - p.cz) ** 2);
          const gap = dist - R - p.R;
          if (gap < minGap) minGap = gap;
        }

        // 兜底：记录 gap 最大的候选
        if (minGap > bestGap) {
          bestGap = minGap;
          bestCx = candX;
          bestCz = candZ;
        }

        // 目标间隙策略：gap ≥ MIN_GAP 时，选 |gap - TARGET_GAP| 最小者
        if (minGap >= MIN_GAP) {
          const targetDist = Math.abs(minGap - TARGET_GAP);
          if (targetDist < bestTargetDist) {
            bestTargetDist = targetDist;
            bestTargetCx = candX;
            bestTargetCz = candZ;
          }
        }
      }

      // 优先使用目标间隙候选，若无满足 MIN_GAP 的候选则退回最大 gap
      if (bestTargetDist < Infinity) {
        cx = bestTargetCx;
        cz = bestTargetCz;
      } else {
        cx = bestCx;
        cz = bestCz;
      }
    }

    placed.push({ cx, cz, R });
    centers.push({ cx, cz });

    const polygon = buildOrganicPolygon(cx, cz, R, rng);
    const bbox = bboxFromPolygon(polygon);

    plots.push({
      dir: item.dir,
      ...bbox,
      polygon,
    });
  }

  return plots;
}
