import type { Road } from '../../shared/types.js';
import { hashSeed, mulberry32 } from './rng.js';
import { pointInPolygon } from './districts.js';

/** buildDistrictRoads 只依赖区块的几何形状与目录名（District 与 Plot 均满足） */
export interface DistrictShape {
  dir: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  polygon: [number, number][];
}

const STEP = 1; // 弦裁剪步进（世界单位）
const INSET = 2; // 路端离区界的收缩量
const MIN_LEN = 9; // 短于此长度的弦不成路

/**
 * 沿方向 theta 过点 (px, pz) 的弦，向两侧步进直到走出多边形，
 * 再各收缩 INSET。总长不足 MIN_LEN 返回 null。
 */
function clipChord(
  px: number,
  pz: number,
  theta: number,
  poly: [number, number][],
  maxR: number,
): [number, number][] | null {
  if (!pointInPolygon(px, pz, poly)) return null;
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  let s1 = 0;
  while (s1 < maxR && pointInPolygon(px + dx * (s1 + STEP), pz + dz * (s1 + STEP), poly)) s1 += STEP;
  let s2 = 0;
  while (s2 < maxR && pointInPolygon(px - dx * (s2 + STEP), pz - dz * (s2 + STEP), poly)) s2 += STEP;
  const a = s1 - INSET;
  const b = s2 - INSET;
  if (a + b < MIN_LEN) return null;
  return [
    [px + dx * a, pz + dz * a],
    [px - dx * b, pz - dz * b],
  ];
}

/**
 * 区内路网：道路数量随区块半径增长（R/13，1~5 条）。
 * 第一条恒为 main（过区中心的主街），其余为 avenue，
 * 角度均匀分布 + 抖动，位置带垂向偏移，全部裁剪在 polygon 内。
 * 纯函数，由 dir 哈希驱动，确定性。
 */
export function buildDistrictRoads(plot: DistrictShape): Road[] {
  const cx = plot.x + plot.width / 2;
  const cz = plot.z + plot.depth / 2;
  let R = 0;
  for (const [px, pz] of plot.polygon) {
    R = Math.max(R, Math.hypot(px - cx, pz - cz));
  }

  const rng = mulberry32(hashSeed('droads:' + plot.dir));
  const n = Math.max(1, Math.min(5, Math.round(R / 13)));
  const theta0 = rng() * Math.PI;

  const roads: Road[] = [];
  for (let i = 0; i < n; i++) {
    const theta = theta0 + (i * Math.PI) / n + (rng() - 0.5) * 0.35;
    const off = i === 0 ? 0 : (rng() - 0.5) * R * 0.55;
    const px = cx + Math.cos(theta + Math.PI / 2) * off;
    const pz = cz + Math.sin(theta + Math.PI / 2) * off;
    const seg = clipChord(px, pz, theta, plot.polygon, R * 1.2);
    if (seg) {
      roads.push({ kind: roads.length === 0 ? 'main' : 'avenue', points: seg });
    }
  }

  // 保底：弦全部失败时退回横贯 bbox 的主街（旧行为）
  if (roads.length === 0) {
    roads.push({
      kind: 'main',
      points: [
        [plot.x, cz],
        [plot.x + plot.width, cz],
      ],
    });
  }
  return roads;
}
