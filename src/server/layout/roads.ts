import type { District, GraphResult, Road } from '../../shared/types.js';

function dirOf(p: string): string {
  return p.includes('/') ? p.split('/')[0] : '';
}

export function buildRoads(districts: District[], graph: GraphResult): Road[] {
  const roads: Road[] = [];
  const pos = new Map<string, [number, number]>();

  for (const d of districts) {
    roads.push({
      kind: 'main',
      points: [
        [d.x, d.z + d.depth / 2],
        [d.x + d.width, d.z + d.depth / 2],
      ],
    });
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
      if (c1 && c2) roads.push({ kind: 'avenue', points: [c1, c2] });
    });
  return roads;
}
