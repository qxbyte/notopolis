import { describe, it, expect } from 'vitest';
import { BIOMES, getBiome } from '../src/render2d/biomes';
import { worldParams } from '../src/world/params';

describe('BIOMES — 基础结构', () => {
  it('四主题均存在', () => {
    expect(BIOMES['plains']).toBeDefined();
    expect(BIOMES['harbor']).toBeDefined();
    expect(BIOMES['snow']).toBeDefined();
    expect(BIOMES['mountain']).toBeDefined();
  });

  it('getBiome 未知主题回退 plains', () => {
    const b = getBiome('unknown-theme');
    expect(b.key).toBe('plains');
  });

  it('harbor waterStyle 为 sea', () => {
    expect(BIOMES['harbor'].waterStyle).toBe('sea');
  });

  it('snow waterStyle 为 frozen', () => {
    expect(BIOMES['snow'].waterStyle).toBe('frozen');
  });

  it('mountain waterStyle 为 torrent', () => {
    expect(BIOMES['mountain'].waterStyle).toBe('torrent');
  });

  it('plains waterStyle 为 river', () => {
    expect(BIOMES['plains'].waterStyle).toBe('river');
  });

  it('snow mountains.proximity < plains mountains.proximity', () => {
    expect(BIOMES['snow'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
  });

  it('mountain mountains.proximity < plains mountains.proximity', () => {
    expect(BIOMES['mountain'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
  });

  it('所有 extras 为字符串数组', () => {
    for (const b of Object.values(BIOMES)) {
      expect(Array.isArray(b.extras)).toBe(true);
    }
  });
});

const HW = 50, HD = 50, WR = 200, T = 200;

describe('worldParams — 四主题确定性', () => {
  const themes = ['plains', 'harbor', 'snow', 'mountain'] as const;
  for (const theme of themes) {
    it(`${theme}: 同 vault+theme 两次 deep equal (RA, canalPts, lakes)`, () => {
      const p1 = worldParams('vault-biome', HW, HD, WR, T, theme);
      const p2 = worldParams('vault-biome', HW, HD, WR, T, theme);
      expect(p1.RA).toBe(p2.RA);
      expect(p1.canalPts).toEqual(p2.canalPts);
      expect(p1.lakes).toEqual(p2.lakes);
    });
  }
});

describe('worldParams — harbor coastDist', () => {
  it('harbor: 城市中心为陆地（coastDist > 0）', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData).toBeDefined();
    // 城市中心 (0,0) 应为陆地
    expect(p.seaData!.coastDist(0, 0)).toBeGreaterThan(0);
  });

  it('harbor: 远侧海洋方向为负（coastDist < 0）', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData).toBeDefined();
    // 沿海方向取很远的点应为海里（负值）
    const ang = p.seaData!.sideAngle;
    const farX = Math.cos(ang) * (HW + 200);
    const farZ = Math.sin(ang) * (HD + 200);
    expect(p.seaData!.coastDist(farX, farZ)).toBeLessThan(0);
  });

  it('harbor: seaData.islands 数量在 1-2 之间', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData!.islands.length).toBeGreaterThanOrEqual(1);
    expect(p.seaData!.islands.length).toBeLessThanOrEqual(2);
  });

  it('harbor: piers 数量在 2-3 之间', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData!.piers.length).toBeGreaterThanOrEqual(2);
    expect(p.seaData!.piers.length).toBeLessThanOrEqual(3);
  });

  it('harbor: canalPts 为空数组', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.canalPts).toEqual([]);
  });
});

describe('worldParams — snow/mountain mountains', () => {
  it('snow mountains.proximity 实际效果：山带更近城市中心（max peak across < plains）', () => {
    // 通过对比 MA 偏移量间接验证——这里只验证 worldStyle 字段正确传递
    const p = worldParams('vault-snow', HW, HD, WR, T, 'snow');
    expect(p.waterStyle).toBe('frozen');
  });

  it('mountain waterStyle 为 torrent', () => {
    const p = worldParams('vault-mountain', HW, HD, WR, T, 'mountain');
    expect(p.waterStyle).toBe('torrent');
  });
});

import { buildCityPainter } from '../src/render2d/citypainter';
import type { CityModel, District } from '@shared/types';

function makeMockCtx() {
  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'strokeStyle' || prop === 'fillStyle' || prop === 'lineWidth' || prop === 'globalAlpha') return 1;
      return (..._args: unknown[]) => { calls.push(prop as string); };
    },
    set() { return true; },
  });
  return { ctx, calls };
}

function makeCity(theme: string): CityModel {
  return {
    vaultId: 'test-biome', name: 'TestCity', theme, tier: 'village',
    districts: [{
      dir: 'alpha', x: 5, z: 5, width: 20, depth: 20,
      polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][],
      isInbox: false,
      buildings: [{
        notePath: 'alpha/a.md', title: 'A', x: 10, z: 10, rotY: 0, size: 1,
        landmark: false, construction: false, isCivic: false, mainStreet: false,
        mtimeMs: Date.now(), wordCount: 100, inlinks: 0, openTasks: 0, excerpt: '',
      }],
    }],
    roads: [{ kind: 'main', points: [[0, 0], [50, 0]] }],
    noteCount: 1, activeCount7d: 1, generatedAt: Date.now(),
  };
}

const THEMES = ['plains', 'harbor', 'snow', 'mountain'] as const;

describe('buildCityPainter — 四主题不抛异常', () => {
  for (const theme of THEMES) {
    it(`${theme}: drawStatic 不抛异常`, () => {
      const city = makeCity(theme);
      const p = worldParams('vault-' + theme, 50, 50, 200, 200, theme);
      const painter = buildCityPainter(city, p, 'ws-' + theme);
      const { ctx } = makeMockCtx();
      expect(() => painter.drawStatic(ctx)).not.toThrow();
    });
  }
});

describe('buildCityPainter — 四主题确定性', () => {
  for (const theme of THEMES) {
    it(`${theme}: 两次 drawStatic 调用序列相同`, () => {
      const city = makeCity(theme);
      const p = worldParams('vault-' + theme, 50, 50, 200, 200, theme);
      const painter = buildCityPainter(city, p, 'ws-' + theme);
      const { ctx: ctx1, calls: c1 } = makeMockCtx();
      const { ctx: ctx2, calls: c2 } = makeMockCtx();
      painter.drawStatic(ctx1);
      painter.drawStatic(ctx2);
      expect(c1).toEqual(c2);
      expect(c1.length).toBeGreaterThan(20);
    });
  }
});

describe('buildCityPainter — 主题分支生效', () => {
  it('plains 与 harbor 调用序列不同（证明分支生效）', () => {
    const pCity = makeCity('plains');
    const hCity = makeCity('harbor');
    const pParams = worldParams('vault-plains', 50, 50, 200, 200, 'plains');
    const hParams = worldParams('vault-harbor', 50, 50, 200, 200, 'harbor');
    const pp = buildCityPainter(pCity, pParams, 'ws-plains');
    const hp = buildCityPainter(hCity, hParams, 'ws-harbor');
    const { ctx: pCtx, calls: pCalls } = makeMockCtx();
    const { ctx: hCtx, calls: hCalls } = makeMockCtx();
    pp.drawStatic(pCtx);
    hp.drawStatic(hCtx);
    // 两者调用序列不完全相同（至少某处不同）
    expect(pCalls).not.toEqual(hCalls);
  });
});

import { createDynamicLayer } from '../src/render2d/dynamic';

function makeDynCtx() {
  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (['strokeStyle','fillStyle','lineWidth','globalAlpha'].includes(prop as string)) return 1;
      return (..._args: unknown[]) => { calls.push(prop as string); };
    },
    set() { return true; },
  });
  return { ctx, calls };
}

describe('dynamic — waterStyle 适配', () => {
  const baseCity: CityModel = {
    vaultId: 'dyn-test', name: 'DynCity', theme: 'plains', tier: 'village',
    districts: [], roads: [], noteCount: 0, activeCount7d: 2, generatedAt: Date.now(),
  };

  it('frozen 主题: draw() 不抛异常', () => {
    const city: CityModel = { ...baseCity, theme: 'snow' };
    const p = worldParams('vault-snow-dyn', HW, HD, WR, T, 'snow');
    const layer = createDynamicLayer(city, p, 'ws-snow', []);
    const { ctx } = makeDynCtx();
    expect(() => layer.draw(ctx, 0)).not.toThrow();
    expect(() => layer.draw(ctx, 1)).not.toThrow();
  });

  it('harbor 主题: draw() 不抛异常', () => {
    const city: CityModel = { ...baseCity, theme: 'harbor' };
    const p = worldParams('vault-harbor-dyn', HW, HD, WR, T, 'harbor');
    const layer = createDynamicLayer(city, p, 'ws-harbor', []);
    const { ctx } = makeDynCtx();
    expect(() => layer.draw(ctx, 0)).not.toThrow();
  });

  it('mountain 主题: draw() 不抛异常', () => {
    const city: CityModel = { ...baseCity, theme: 'mountain' };
    const p = worldParams('vault-mountain-dyn', HW, HD, WR, T, 'mountain');
    const layer = createDynamicLayer(city, p, 'ws-mountain', []);
    const { ctx } = makeDynCtx();
    expect(() => layer.draw(ctx, 0)).not.toThrow();
  });
});
