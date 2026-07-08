import { describe, expect, it } from 'vitest';
import { layoutDistricts, pointInPolygon } from '../src/server/layout/districts.js';
import { hashSeed, mulberry32 } from '../src/server/layout/rng.js';

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

  it('确定性：两次调用完全相同', () => {
    expect(layoutDistricts(counts)).toEqual(layoutDistricts(counts));
  });

  it('每个目录一块地，面积与笔记数正相关', () => {
    const plots = layoutDistricts(counts);
    expect(plots.map((p) => p.dir).sort()).toEqual(['01-AI', '02-Dev', '99-Inbox']);
    const area = (d: string) => {
      const p = plots.find((x) => x.dir === d)!;
      return p.width * p.depth;
    };
    expect(area('01-AI')).toBeGreaterThan(area('02-Dev'));
    expect(area('02-Dev')).toBeGreaterThan(area('99-Inbox'));
  });

  it('地块互不重叠', () => {
    const plots = layoutDistricts(counts);
    for (const a of plots)
      for (const b of plots) {
        if (a === b) continue;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapZ = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
        expect(overlapX <= 0.001 || overlapZ <= 0.001).toBe(true);
      }
  });

  it('每个 plot.polygon 顶点数 >= 8 且全部位于其 bbox 内（含边界容差 1e-6）', () => {
    const plots = layoutDistricts(counts);
    for (const p of plots) {
      expect(p.polygon.length).toBeGreaterThanOrEqual(8);
      for (const [px, pz] of p.polygon) {
        expect(px).toBeGreaterThanOrEqual(p.x - 1e-6);
        expect(px).toBeLessThanOrEqual(p.x + p.width + 1e-6);
        expect(pz).toBeGreaterThanOrEqual(p.z - 1e-6);
        expect(pz).toBeLessThanOrEqual(p.z + p.depth + 1e-6);
      }
    }
  });

  it('两次调用输出深度相等（含 polygon）', () => {
    const a = layoutDistricts(counts);
    const b = layoutDistricts(counts);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].polygon).toEqual(b[i].polygon);
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
