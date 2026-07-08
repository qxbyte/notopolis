import { describe, it, expect } from 'vitest';
import { rng0, hashStr } from '../src/util/seed';
import { fbm, vnoise } from '../src/util/noise';
import { buildPolyline, polyAt, polyDist, segHit, lakeShapeR } from '../src/util/poly';

describe('seed', () => {
  it('同种子产生相同序列', () => {
    const r1 = rng0('x'), r2 = rng0('x');
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
  it('异种子产生不同序列', () => {
    const r1 = rng0('a'), r2 = rng0('b');
    expect(r1()).not.toBe(r2());
  });
  it('值域 [0, 1)', () => {
    const rng = rng0('test');
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('noise', () => {
  it('fbm 对固定输入确定性', () => {
    expect(fbm(3.7, 8.1)).toBe(fbm(3.7, 8.1));
  });
  it('连续性粗测：相邻点差值 < 0.5', () => {
    expect(Math.abs(fbm(1, 1) - fbm(1.1, 1))).toBeLessThan(0.5);
  });
  it('值域大致 [0, 1]：100 个采样点', () => {
    for (let i = 0; i < 100; i++) {
      const v = fbm(i * 0.37, i * 0.53);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('poly', () => {
  it('buildPolyline 直线段 total = 长度', () => {
    const pl = buildPolyline([[0, 0], [3, 4]]);
    expect(pl.total).toBeCloseTo(5, 5);
    expect(pl.lens).toHaveLength(1);
  });

  it('polyAt s=0 返回起点', () => {
    const pl = buildPolyline([[1, 2], [4, 6]]);
    const [x, z] = polyAt(pl, 0);
    expect(x).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(2, 5);
  });

  it('polyAt s=1 返回终点', () => {
    const pl = buildPolyline([[1, 2], [4, 6]]);
    const [x, z] = polyAt(pl, 1);
    expect(x).toBeCloseTo(4, 5);
    expect(z).toBeCloseTo(6, 5);
  });

  it('polyAt s=0.5 返回中点', () => {
    const pl = buildPolyline([[0, 0], [4, 0]]);
    const [x, z] = polyAt(pl, 0.5);
    expect(x).toBeCloseTo(2, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('segHit 十字相交返回交点', () => {
    const hit = segHit([0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(0.5, 5);
    expect(hit![1]).toBeCloseTo(0.5, 5);
  });

  it('segHit 平行返回 null', () => {
    expect(segHit([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
  });

  it('segHit 端点外（s < 0.05）返回 null', () => {
    // 交点在第一条线段 s=0.03 处（< 0.05，应裁剪为 null）
    // p1=[0,0.5] p2=[1,0.5]，q 在 x=0.03 处垂直穿过，s=0.03/1=0.03 < 0.05
    expect(segHit([0, 0.5], [1, 0.5], [0.03, 0], [0.03, 1])).toBeNull();
  });

  it('lakeShapeR 周期 2π', () => {
    const r = 5, seed = 42;
    const v1 = lakeShapeR(seed, r, 1.234);
    const v2 = lakeShapeR(seed, r, 1.234 + 2 * Math.PI);
    expect(Math.abs(v1 - v2)).toBeLessThan(1e-9);
  });

  it('lakeShapeR 值域 (0.4r, 1.15r)', () => {
    const r = 10, seed = 7;
    for (let i = 0; i < 36; i++) {
      const th = (i / 36) * 2 * Math.PI;
      const v = lakeShapeR(seed, r, th);
      expect(v).toBeGreaterThan(0.4 * r);
      expect(v).toBeLessThan(1.15 * r);
    }
  });
});
