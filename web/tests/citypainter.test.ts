// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CityModel, District } from '@shared/types';
import { paintCity } from '../src/render2d/citypainter';
import { PAPER } from '../src/render2d/sketch';
import { worldParams } from '../src/world/params';

/* ----------------------------------------------------------------
   Fixture
   ---------------------------------------------------------------- */

const NOW = Date.now();
const YEAR_AGO = NOW - 400 * 86400000; // dormant > 365 天

const distA: District = {
  dir: 'alpha', x: 5, z: 5, width: 20, depth: 20,
  polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][],
  isInbox: false,
  buildings: [
    {
      notePath: 'alpha/a.md', title: 'A', x: 5, z: 5, rotY: 0, size: 1,
      landmark: false, construction: false, isCivic: false, mainStreet: false,
      mtimeMs: NOW, wordCount: 100, inlinks: 0, openTasks: 0, excerpt: '',
    },
    {
      notePath: 'alpha/b.md', title: 'B', x: 10, z: 10, rotY: 0, size: 2,
      landmark: true, construction: false, isCivic: false, mainStreet: false,
      mtimeMs: NOW, wordCount: 200, inlinks: 5, openTasks: 0, excerpt: '',
    },
    {
      notePath: 'alpha/c.md', title: 'C', x: 15, z: 15, rotY: 0, size: 3,
      landmark: false, construction: true, isCivic: false, mainStreet: false,
      mtimeMs: NOW, wordCount: 50, inlinks: 0, openTasks: 3, excerpt: '',
    },
  ],
};

const distB: District = {
  dir: 'beta', x: 30, z: 5, width: 20, depth: 20,
  polygon: [[25, 0], [45, 0], [45, 20], [25, 20]] as [number, number][],
  isInbox: true,
  buildings: [
    {
      notePath: 'beta/d.md', title: 'D', x: 30, z: 5, rotY: 0, size: 1,
      landmark: false, construction: false, isCivic: true, mainStreet: false,
      mtimeMs: NOW, wordCount: 300, inlinks: 10, openTasks: 0, excerpt: '',
    },
    {
      notePath: 'beta/e.md', title: 'E', x: 35, z: 15, rotY: 0, size: 1,
      landmark: false, construction: false, isCivic: false, mainStreet: false,
      mtimeMs: YEAR_AGO, wordCount: 10, inlinks: 0, openTasks: 0, excerpt: '',
    },
  ],
};

const fixture: CityModel = {
  vaultId: 'test', name: 'TestCity', theme: 'plains', tier: 'village',
  districts: [distA, distB],
  roads: [
    { kind: 'main',   points: [[0, 0], [50, 0]] },
    { kind: 'avenue', points: [[0, 10], [50, 10]] },
    { kind: 'street', points: [[10, 0], [10, 20]] }, // ← 不应被绘制
  ],
  noteCount: 5, activeCount7d: 3, generatedAt: NOW,
};

const params = worldParams('test', 50, 50, 60, 60);

/* ----------------------------------------------------------------
   Mock WorldCanvas
   ---------------------------------------------------------------- */

function makeMockWorld() {
  const calls: string[] = [];    // 记录 ctx 上调用的方法名
  const strokeStyles: string[] = [];

  const mockCtx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'strokeStyle') return strokeStyles[strokeStyles.length - 1] ?? '';
      return (..._args: unknown[]) => { calls.push(prop); };
    },
    set(_t, prop: string, val: unknown) {
      if (prop === 'strokeStyle') strokeStyles.push(val as string);
      return true;
    },
  });

  const world = {
    paint(fn: (ctx: CanvasRenderingContext2D, tb: { minX: number; minZ: number; maxX: number; maxZ: number }) => void) {
      fn(mockCtx, { minX: -60, minZ: -60, maxX: 60, maxZ: 60 });
    },
    blit() {},
    tiles() { return { count: 1, pxSize: 960 }; },
  };

  return { world, calls, strokeStyles };
}

/* ----------------------------------------------------------------
   Tests
   ---------------------------------------------------------------- */

describe('T1 — HitItem 数量与顺序', () => {
  it('HitItem 数 = 5建筑 + 2街区 = 7，建筑在后', () => {
    const { world } = makeMockWorld();
    const hits = paintCity(world as never, fixture, params, 'test');
    expect(hits).toHaveLength(7);
    // 前 2 个是街区 polygon
    expect(hits[0].kind).toBe('district');
    expect(hits[1].kind).toBe('district');
    // 后 5 个是建筑 circle
    for (const h of hits.slice(2)) expect(h.kind).toBe('building');
  });
});

describe('T2 — 确定性', () => {
  it('两次 paintCity 调用序列完全相同', () => {
    const { world: w1, calls: c1 } = makeMockWorld();
    const { world: w2, calls: c2 } = makeMockWorld();
    paintCity(w1 as never, fixture, params, 'test');
    paintCity(w2 as never, fixture, params, 'test');
    expect(c1).toEqual(c2);
    expect(c1.length).toBeGreaterThan(50); // 确保画了东西
  });
});

describe('T3 — dormant 建筑墨色', () => {
  it('dormant 建筑（>365天）strokeStyle 与 active 建筑不同', () => {
    const { world, strokeStyles } = makeMockWorld();
    paintCity(world as never, fixture, params, 'test');
    // strokeStyles 序列中应同时含有 PAPER.ink 和非 ink/空 的值
    const hasInk = strokeStyles.some(s => s === PAPER.ink);
    const hasFaded = strokeStyles.some(s => s !== PAPER.ink && s !== '');
    expect(hasInk).toBe(true);
    expect(hasFaded).toBe(true);
  });
});

describe('T4 — street kind 不产生额外绘制', () => {
  it('street kind road 不增加绘制调用', () => {
    // 去掉 street road 的 fixture
    const noStreet: CityModel = { ...fixture, roads: fixture.roads.filter(r => r.kind !== 'street') };

    const { world: w1, calls: c1 } = makeMockWorld();
    const { world: w2, calls: c2 } = makeMockWorld();
    paintCity(w1 as never, fixture, params, 'test');   // 含 street
    paintCity(w2 as never, noStreet, params, 'test');  // 不含 street

    // 调用数相同（street 没有贡献任何绘制）
    expect(c1.length).toBe(c2.length);
  });
});

describe('T5 — 聚落内树木减量', () => {
  it('聚落内树木 quadraticCurveTo 调用数低于旧公式上界', () => {
    const { world, calls } = makeMockWorld();
    paintCity(world as never, fixture, params, 'test');
    // scribbleBlob does exactly 14 quadraticCurveTo per call.
    // With area/40 (old): distA+distB → max(2,10) + max(2,10) = 10+10 = 20 trees
    //   → 20 × 14 = 280 from trees alone; total ~2430 with other sources (MEASURED)
    // With area/120 (new): max(1,3) + max(1,3) = 3+3 = 6 trees
    //   → 6 × 14 = 84 from trees; drop by ~196; total ~2234 (expected)
    // Threshold < 2300: safely 130 units below old baseline (2430), well above new (2234).
    // This ensures robust detection of formula change with large safety margin.
    const qcCount = calls.filter(c => c === 'quadraticCurveTo').length;
    expect(qcCount).toBeLessThan(2300);
  });
});
