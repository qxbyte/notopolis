/**
 * render2d/hit.ts — 命中测试（hit testing）for Notopolis 2D render layer.
 *
 * 支持 circle、rect、polygon 三种形状。
 * 倒序遍历：最后添加的 item 最上层，优先命中。
 */

export type HitShape =
  | { type: 'circle'; x: number; z: number; r: number }
  | { type: 'rect';   x: number; z: number; w: number; h: number }
  | { type: 'polygon'; pts: [number, number][] };

export interface HitItem {
  kind: string;
  shape: HitShape;
  data: unknown;
}

/**
 * 射线法判断点是否在多边形内部（x/z 坐标轴）。
 * 从点 (px, pz) 向右发射水平射线，统计与多边形各边的交叉数，奇数=内部。
 */
function pointInPolygon(px: number, pz: number, pts: [number, number][]): boolean {
  let inside = false;
  let j = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/**
 * hitTest — 在 items 列表中查找命中给定世界坐标 (x, z) 的最上层 item。
 *
 * 倒序遍历，返回第一个命中的 HitItem，若无命中返回 null。
 */
export function hitTest(x: number, z: number, items: HitItem[]): HitItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const s = item.shape;

    if (s.type === 'circle') {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= s.r * s.r) {
        return item;
      }
    } else if (s.type === 'rect') {
      if (x >= s.x && x <= s.x + s.w && z >= s.z && z <= s.z + s.h) {
        return item;
      }
    } else if (s.type === 'polygon') {
      if (pointInPolygon(x, z, s.pts)) {
        return item;
      }
    }
  }
  return null;
}
