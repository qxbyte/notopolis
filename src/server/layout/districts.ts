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
const SAMPLE_STEP = 4; // 沿边每 ~4 单位取一个采样点
const MAX_INWARD_RATIO = 0.18; // 最大向内扰动比例（半边长的 18%）
const CORNER_SCALE = 0.5; // 角点扰动缩放系数

interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

/**
 * 沿 bbox 周界采样点，向内扰动生成不规则多边形。
 * 只向内扰动 → 多个街区天然不重叠。
 * 角点参与扰动但幅度减半（保持大致四角形态）。
 */
function buildPolygon(rect: Rect, rng: () => number): [number, number][] {
  const { x, z, width, depth } = rect;
  const hw = width / 2; // x 方向半边长
  const hd = depth / 2; // z 方向半边长
  const cx = x + hw;
  const cz = z + hd;

  // 最大向内扰动距离（各方向独立）
  const maxDx = hw * MAX_INWARD_RATIO;
  const maxDz = hd * MAX_INWARD_RATIO;

  const points: [number, number][] = [];

  // 辅助：沿一条边（从 start 到 end，不含终点）采样，包含起点（角点）
  // dir: 'right' | 'down' | 'left' | 'up' 表示前进方向，用于判断向内的法线方向
  const sampleEdge = (
    x0: number, z0: number,
    x1: number, z1: number,
    inNormX: number, inNormZ: number,
    isStartCorner: boolean,
  ) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const edgeLen = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.round(edgeLen / SAMPLE_STEP));

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const bx = x0 + dx * t;
      const bz = z0 + dz * t;

      // 判断是否为角点（i === 0 且 isStartCorner）
      const isCorner = i === 0 && isStartCorner;
      const scale = isCorner ? CORNER_SCALE : 1.0;

      // 向内扰动：rng() in [0,1)，只向内（法线方向为正）
      const pertX = rng() * maxDx * scale * inNormX;
      const pertZ = rng() * maxDz * scale * inNormZ;

      // 夹紧到 bbox 内
      const px = Math.max(x, Math.min(x + width, bx + pertX));
      const pz = Math.max(z, Math.min(z + depth, bz + pertZ));

      points.push([px, pz]);
    }
  };

  // 四条边，法线方向（向内）：
  // 上边 (z=z): 向内法线 z 方向为 +1（往 z 增大方向）
  // 右边 (x=x+width): 向内法线 x 方向为 -1
  // 下边 (z=z+depth): 向内法线 z 方向为 -1
  // 左边 (x=x): 向内法线 x 方向为 +1
  //
  // 顶点顺序：左上 → 右上 → 右下 → 左下（顺时针）
  sampleEdge(x, z,           x + width, z,           0, 1, true);   // 上边：角点左上
  sampleEdge(x + width, z,   x + width, z + depth,   -1, 0, true);  // 右边：角点右上
  sampleEdge(x + width, z + depth, x, z + depth,     0, -1, true);  // 下边：角点右下
  sampleEdge(x, z + depth,  x, z,                    1, 0, true);   // 左边：角点左下

  // 确保多边形不闭合首尾重复点（渲染时自行闭合）
  return points;
}

/**
 * 射线法判断点 (x, z) 是否在多边形 poly 内部（或边界上）。
 * 供 Task 6 使用。
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

export function layoutDistricts(counts: { dir: string; count: number }[]): Plot[] {
  const items = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
  const total = items.reduce((s, c) => s + c.count, 0);
  if (total === 0) return [];
  const side = Math.ceil(Math.sqrt(total * UNIT_AREA));
  const plots: Plot[] = [];

  function slice(rect: Rect, rest: typeof items, sum: number, horizontal: boolean): void {
    if (rest.length === 0) return;
    if (rest.length === 1) {
      const rng = mulberry32(hashSeed(rest[0].dir));
      const polygon = buildPolygon(rect, rng);
      plots.push({ dir: rest[0].dir, ...rect, polygon });
      return;
    }
    const [head, ...tail] = rest;
    const frac = head.count / sum;
    if (horizontal) {
      const w = rect.width * frac;
      const headRect: Rect = { x: rect.x, z: rect.z, width: w, depth: rect.depth };
      const rng = mulberry32(hashSeed(head.dir));
      const polygon = buildPolygon(headRect, rng);
      plots.push({ dir: head.dir, ...headRect, polygon });
      slice({ ...rect, x: rect.x + w, width: rect.width - w }, tail, sum - head.count, false);
    } else {
      const d = rect.depth * frac;
      const headRect: Rect = { x: rect.x, z: rect.z, width: rect.width, depth: d };
      const rng = mulberry32(hashSeed(head.dir));
      const polygon = buildPolygon(headRect, rng);
      plots.push({ dir: head.dir, ...headRect, polygon });
      slice({ ...rect, z: rect.z + d, depth: rect.depth - d }, tail, sum - head.count, true);
    }
  }

  slice({ x: -side / 2, z: -side / 2, width: side, depth: side }, items, total, true);
  return plots;
}
