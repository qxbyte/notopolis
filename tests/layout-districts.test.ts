import { describe, expect, it } from 'vitest';
import { layoutDistricts, pointInPolygon } from '../src/server/layout/districts.js';
import { hashSeed, mulberry32 } from '../src/server/layout/rng.js';
import { placeBuildings } from '../src/server/layout/buildings.js';
import type { NoteMeta } from '../src/shared/types.js';

describe('rng', () => {
  it('同种子同序列，异种子异序列', () => {
    const a = mulberry32(hashSeed('x'));
    const b = mulberry32(hashSeed('x'));
    const c = mulberry32(hashSeed('y'));
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([c(), c(), c()]);
    seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });
});

describe('layoutDistricts', () => {
  const counts = [
    { dir: '01-AI', count: 30 },
    { dir: '02-Dev', count: 10 },
    { dir: '99-Inbox', count: 5 },
  ];

  it('确定性：两次调用完全相同（含 polygon deep equal）', () => {
    const a = layoutDistricts(counts);
    const b = layoutDistricts(counts);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].polygon).toEqual(b[i].polygon);
    }
  });

  it('每个目录一块地', () => {
    const plots = layoutDistricts(counts);
    expect(plots.map((p) => p.dir).sort()).toEqual(['01-AI', '02-Dev', '99-Inbox']);
  });

  it('团块不重叠：两两中心距 > Ri+Rj（Ri 从多边形顶点最大半径推）', () => {
    const plots = layoutDistricts(counts);

    // 从多边形顶点推导中心和最大半径
    function getCircle(plot: typeof plots[0]) {
      // bbox 中心即团块放置中心
      const cx = plot.x + plot.width / 2;
      const cz = plot.z + plot.depth / 2;
      let maxR = 0;
      for (const [px, pz] of plot.polygon) {
        const d = Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
        if (d > maxR) maxR = d;
      }
      return { cx, cz, maxR };
    }

    for (let i = 0; i < plots.length; i++) {
      for (let j = i + 1; j < plots.length; j++) {
        const a = getCircle(plots[i]);
        const b = getCircle(plots[j]);
        const dist = Math.sqrt((a.cx - b.cx) ** 2 + (a.cz - b.cz) ** 2);
        // 不重叠：中心距 > Ri + Rj（允许 1 单位容差，实际间隙远大于此）
        expect(dist).toBeGreaterThan(a.maxR + b.maxR - 1);
      }
    }
  });

  it('散布性：≥3 区时，中心两两最大距离 > 1.4 × 最大团块直径', () => {
    const plots = layoutDistricts(counts);

    // 最大团块直径（取第一个，count 最大）
    const largest = plots[0];
    const largestDiameter = Math.max(largest.width, largest.depth);

    // 所有中心
    const centers = plots.map((p) => ({
      cx: p.x + p.width / 2,
      cz: p.z + p.depth / 2,
    }));

    let maxDist = 0;
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = Math.sqrt(
          (centers[i].cx - centers[j].cx) ** 2 + (centers[i].cz - centers[j].cz) ** 2,
        );
        if (d > maxDist) maxDist = d;
      }
    }

    expect(maxDist).toBeGreaterThan(1.4 * largestDiameter);
  });

  it('面积正相关：polygon 面积（shoelace）单调递减随 count', () => {
    const plots = layoutDistricts(counts);

    function shoelace(poly: [number, number][]): number {
      let area = 0;
      const n = poly.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
      }
      return Math.abs(area) / 2;
    }

    // counts 已按 count 降序排列：30 > 10 > 5
    const areas = plots.map((p) => shoelace(p.polygon));
    expect(areas[0]).toBeGreaterThan(areas[1]);
    expect(areas[1]).toBeGreaterThan(areas[2]);
  });

  it('有机度：每个 polygon 的顶点半径 max/min ≥ 1.25（不是圆/矩形）', () => {
    const plots = layoutDistricts(counts);

    for (const plot of plots) {
      const cx = plot.x + plot.width / 2;
      const cz = plot.z + plot.depth / 2;

      let minR = Infinity;
      let maxR = 0;
      for (const [px, pz] of plot.polygon) {
        const r = Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }

      expect(maxR / minR).toBeGreaterThanOrEqual(1.25);
    }
  });
});

describe('pointInPolygon', () => {
  const counts = [
    { dir: '01-AI', count: 30 },
    { dir: '02-Dev', count: 10 },
    { dir: '99-Inbox', count: 5 },
  ];

  it('bbox 中心点在多边形内返回 true，bbox 外远点返回 false', () => {
    const plots = layoutDistricts(counts);
    for (const p of plots) {
      const cx = p.x + p.width / 2;
      const cz = p.z + p.depth / 2;
      expect(pointInPolygon(cx, cz, p.polygon)).toBe(true);

      // bbox 外远点（偏移超过 bbox 尺寸）
      const farX = p.x - p.width * 2;
      const farZ = p.z - p.depth * 2;
      expect(pointInPolygon(farX, farZ, p.polygon)).toBe(false);
    }
  });
});

describe('密度测试：200 篇笔记团块落位率', () => {
  it('count=200 的团块：placeBuildings 落位点在 polygon 内的比例 ≥ 95%', () => {
    const plots = layoutDistricts([{ dir: 'big', count: 200 }]);
    const plot = plots[0];

    // 构造 200 篇最简笔记
    const notes: NoteMeta[] = Array.from({ length: 200 }, (_, i) => ({
      path: `big/note-${i}.md`,
      title: `Note ${i}`,
      dir: 'big',
      wordCount: 100,
      openTasks: 0,
      links: [],
      frontmatter: {},
      excerpt: '',
      mtimeMs: 0,
      birthtimeMs: 0,
    }));

    const buildings = placeBuildings(plot, notes, {});

    // 统计落在 polygon 内的比例
    const inPoly = buildings.filter((b) => pointInPolygon(b.x, b.z, plot.polygon)).length;
    const ratio = inPoly / buildings.length;

    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });
});
