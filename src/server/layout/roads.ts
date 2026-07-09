import type { District, GraphResult, Road } from '../../shared/types.js';
import { pointInPolygon } from './districts.js';
import { buildDistrictRoads } from './districtroads.js';

function dirOf(p: string): string {
  return p.includes('/') ? p.split('/')[0] : '';
}

/**
 * 沿 from→to 步进，返回刚走出 poly 的点（跨区路从区边界出发，不穿过区内部压建筑）。
 * from 不在 poly 内时原样返回。
 */
function exitPoint(
  from: [number, number],
  to: [number, number],
  poly: [number, number][],
): [number, number] {
  if (!pointInPolygon(from[0], from[1], poly)) return from;
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  if (len < 1) return from;
  const STEP = 2;
  for (let s = STEP; s < len; s += STEP) {
    const x = from[0] + (dx / len) * s;
    const z = from[1] + (dz / len) * s;
    if (!pointInPolygon(x, z, poly)) return [x, z];
  }
  return from;
}

export function buildRoads(districts: District[], graph: GraphResult): Road[] {
  const roads: Road[] = [];
  const pos = new Map<string, [number, number]>();

  for (const d of districts) {
    roads.push(...buildDistrictRoads(d));
    for (const b of d.buildings) pos.set(b.notePath, [b.x, b.z]);
  }

  for (const [from, to] of graph.intraDirEdges) {
    const a = pos.get(from);
    const b = pos.get(to);
    if (a && b) roads.push({ kind: 'street', points: [a, b] });
  }

  const center = new Map(
    districts.map((d) => [d.dir, [d.x + d.width / 2, d.z + d.depth / 2] as [number, number]]),
  );

  // 从 polygon 顶点推导每个区的等效半径（最大顶点距中心距离）
  const radius = new Map<string, number>();
  for (const d of districts) {
    const cx = d.x + d.width / 2;
    const cz = d.z + d.depth / 2;
    let maxR = 0;
    for (const [px, pz] of d.polygon) {
      const r = Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
      if (r > maxR) maxR = r;
    }
    radius.set(d.dir, maxR);
  }

  const pairCount = new Map<string, number>();
  for (const [from, to] of graph.crossDirEdges) {
    const key = [dirOf(from), dirOf(to)].sort().join('\n');
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  [...pairCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .forEach(([key]) => {
      const [d1, d2] = key.split('\n');
      const c1 = center.get(d1);
      const c2 = center.get(d2);
      if (!c1 || !c2) return;
      // 仅连接中心距 < R_i + R_j + 70 的相邻区（远距离交给铁路）
      const dist = Math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2);
      const ri = radius.get(d1) ?? 0;
      const rj = radius.get(d2) ?? 0;
      if (dist < ri + rj + 70) {
        // 两端裁剪到区边界，避免穿过区内部压到建筑
        const poly1 = districts.find((d) => d.dir === d1)?.polygon ?? [];
        const poly2 = districts.find((d) => d.dir === d2)?.polygon ?? [];
        const p1 = poly1.length >= 3 ? exitPoint(c1, c2, poly1) : c1;
        const p2 = poly2.length >= 3 ? exitPoint(c2, c1, poly2) : c2;
        roads.push({ kind: 'avenue', points: [p1, p2] });
      }
    });
  return roads;
}
