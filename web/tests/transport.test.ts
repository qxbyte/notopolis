// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CityModel, District, Building } from '@shared/types';
import { buildTransport } from '../src/render2d/transport';
import { worldParams } from '../src/world/params';
import { buildCityPainter } from '../src/render2d/citypainter';

/* ----------------------------------------------------------------
   Test Factories
   ---------------------------------------------------------------- */

const NOW = Date.now();

function makeBuilding(x: number, z: number, notePath: string): Building {
  return {
    notePath,
    title: notePath,
    x, z,
    rotY: 0, size: 1,
    landmark: false, construction: false, isCivic: false, mainStreet: false,
    mtimeMs: NOW, wordCount: 100, inlinks: 0, openTasks: 0, excerpt: '',
  };
}

function makeDistrict(dir: string, cx: number, cz: number): District {
  // Center at (cx, cz), width=20 depth=20
  const x = cx - 10, z = cz - 10;
  return {
    dir,
    x, z,
    width: 20, depth: 20,
    polygon: [
      [x, z], [x + 20, z], [x + 20, z + 20], [x, z + 20],
    ] as [number, number][],
    isInbox: false,
    buildings: [makeBuilding(cx, cz, dir + '/a.md')],
  };
}

function makeTestCity(n: number): CityModel {
  const districts: District[] = [];
  // Spread districts at different positions
  const positions: [number, number][] = [
    [0, 0], [50, 0], [100, 0], [0, 50], [100, 50],
    [-50, 0], [0, -50], [50, 50], [-50, 50],
  ];
  for (let i = 0; i < n; i++) {
    const [cx, cz] = positions[i % positions.length];
    districts.push(makeDistrict('dist' + i, cx + i * 3, cz + i * 3));
  }
  return {
    vaultId: 'test',
    name: 'TestCity',
    theme: 'plains',
    tier: 'village',
    districts,
    roads: [],
    noteCount: n * 10,
    activeCount7d: 1,
    generatedAt: NOW,
  };
}

function makeTestParams(theme = 'plains') {
  return worldParams('test', 50, 50, 60, 60, theme);
}

/* ----------------------------------------------------------------
   Mock ctx for citypainter tests
   ---------------------------------------------------------------- */

function makeMockCtx(): { ctx: CanvasRenderingContext2D; callCount: () => number } {
  let count = 0;
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (typeof prop === 'string') {
        return (..._args: unknown[]) => { count++; };
      }
      return undefined;
    },
    set() { return true; },
  });
  return { ctx, callCount: () => count };
}

/* ----------------------------------------------------------------
   T1 — MST 边数
   ---------------------------------------------------------------- */

describe('T1 MST edge count', () => {
  it('3 districts → 2 rail edges', () => {
    const city = makeTestCity(3);
    const params = makeTestParams();
    const net = buildTransport(city, params, 'test');
    expect(net.rails).toHaveLength(2);
  });

  it('5 districts → 4 rail edges', () => {
    const city = makeTestCity(5);
    const params = makeTestParams();
    const net = buildTransport(city, params, 'test');
    expect(net.rails).toHaveLength(4);
  });

  it('1 district → 0 rail edges', () => {
    const city = makeTestCity(1);
    const params = makeTestParams();
    const net = buildTransport(city, params, 'test');
    expect(net.rails).toHaveLength(0);
  });
});

/* ----------------------------------------------------------------
   T2 — 确定性
   ---------------------------------------------------------------- */

describe('T2 determinism', () => {
  it('two identical calls produce identical rails/stations/airport/ferry', () => {
    const city = makeTestCity(4);
    const params = makeTestParams();
    const r1 = buildTransport(city, params, 'test');
    const r2 = buildTransport(city, params, 'test');
    expect(r1.rails).toEqual(r2.rails);
    expect(r1.stations).toEqual(r2.stations);
    expect(r1.airport).toEqual(r2.airport);
    // ferry: exclude function members by comparing key fields
    if (r1.ferry === null) {
      expect(r2.ferry).toBeNull();
    } else {
      expect(r2.ferry).not.toBeNull();
      expect(r1.ferry!.route).toEqual(r2.ferry!.route);
      expect(r1.ferry!.docks).toEqual(r2.ferry!.docks);
    }
  });
});

/* ----------------------------------------------------------------
   T3 — pts 点数 ≥ 9
   ---------------------------------------------------------------- */

describe('T3 pts point count', () => {
  it('each rail edge has >= 9 pts (8 bezier segments + 1)', () => {
    const city = makeTestCity(3);
    const params = makeTestParams();
    const net = buildTransport(city, params, 'test');
    for (const edge of net.rails) {
      expect(edge.pts.length).toBeGreaterThanOrEqual(9);
    }
  });
});

/* ----------------------------------------------------------------
   T4 — bridge 检测
   ---------------------------------------------------------------- */

describe('T4 bridge detection', () => {
  it('rail crossing a river should have bridges', () => {
    // Two districts on opposite sides of x=15 (midpoint), river at x≈15
    const distA = makeDistrict('west', -20, 0);  // center (-20,0)
    const distB = makeDistrict('east', 50, 0);   // center (50,0)
    const city: CityModel = {
      vaultId: 'test', name: 'TestCity', theme: 'plains', tier: 'village',
      districts: [distA, distB],
      roads: [],
      noteCount: 20, activeCount7d: 1, generatedAt: NOW,
    };

    // Custom params with river crossing at x≈15
    const baseParams = makeTestParams();
    const mockParams = {
      ...baseParams,
      // Override riverDist to return small value near x=15
      riverDist: (x: number, _z: number) => Math.abs(x - 15),
      RIVER_W: 6,
    };

    const net = buildTransport(city, mockParams, 'bridge-test');
    // The rail edge from (-20,0) to (50,0) must cross x=15
    expect(net.rails.length).toBe(1);
    expect(net.rails[0].bridges.length).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------------------
   T5 — tunnel 检测
   ---------------------------------------------------------------- */

describe('T5 tunnel detection', () => {
  it('rail going into mountain zone should have tunnels', () => {
    // cosM=1, sinM=0, worldR=60 → mProj = x; threshold = worldR*0.55 = 33
    // dist A at x=0, dist B at x=60 (mProj=60 > 33)
    const distA = makeDistrict('valley', 0, 0);
    const distB = makeDistrict('mountain', 60, 0);
    const city: CityModel = {
      vaultId: 'test', name: 'TestCity', theme: 'mountain', tier: 'village',
      districts: [distA, distB],
      roads: [],
      noteCount: 20, activeCount7d: 1, generatedAt: NOW,
    };

    const baseParams = makeTestParams();
    const mockParams = {
      ...baseParams,
      cosM: 1,
      sinM: 0,
      worldR: 60,
    };

    const net = buildTransport(city, mockParams, 'tunnel-test');
    expect(net.rails.length).toBe(1);
    expect(net.rails[0].tunnels.length).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------------------
   T6 — 机场间距约束
   ---------------------------------------------------------------- */

describe('T6 airport distance constraint', () => {
  it('airport is not null when noteCount>=80 and far from district', () => {
    // Single district near origin, noteCount=80
    const dist0 = makeDistrict('center', 0, 0);  // center (0,0)
    const city: CityModel = {
      vaultId: 'test', name: 'TestCity', theme: 'plains', tier: 'city',
      districts: [dist0],
      roads: [],
      noteCount: 80, activeCount7d: 1, generatedAt: NOW,
    };
    const params = makeTestParams();
    const net = buildTransport(city, params, 'airport-test');
    expect(net.airport).not.toBeNull();
    if (net.airport) {
      // Must be far from district center (0,0)
      const d = Math.hypot(net.airport.x, net.airport.z);
      expect(d).toBeGreaterThan(15);
      expect(net.airport.len).toBe(26);
    }
  });
});

/* ----------------------------------------------------------------
   T7 — 轮渡 river 两岸
   ---------------------------------------------------------------- */

describe('T7 ferry river two sides', () => {
  it('districts on opposite sides of river → ferry is not null with 2 docks', () => {
    // cosR=1, sinR=0 → riverU = proj on x axis
    // dist A at x=-30 (left side), dist B at x=40 (right side)
    const distA = makeDistrict('west', -30, 0);
    const distB = makeDistrict('east', 40, 0);
    const city: CityModel = {
      vaultId: 'test', name: 'TestCity', theme: 'plains', tier: 'village',
      districts: [distA, distB],
      roads: [],
      noteCount: 20, activeCount7d: 1, generatedAt: NOW,
    };

    const baseParams = makeTestParams();
    const mockParams = {
      ...baseParams,
      cosR: 1,
      sinR: 0,
      waterStyle: 'river' as const,
      riverDist: (x: number, _z: number) => Math.abs(x),  // river at x=0
      RIVER_W: 6,
    };

    const net = buildTransport(city, mockParams, 'ferry-river-test');
    expect(net.ferry).not.toBeNull();
    expect(net.ferry!.docks).toHaveLength(2);
  });
});

/* ----------------------------------------------------------------
   T8 — 轮渡 null 情形
   ---------------------------------------------------------------- */

describe('T8 ferry null case', () => {
  it('all districts on same side of river → ferry is null', () => {
    // Both districts on positive x side (same sign riverU)
    const distA = makeDistrict('east1', 30, 0);
    const distB = makeDistrict('east2', 50, 20);
    const city: CityModel = {
      vaultId: 'test', name: 'TestCity', theme: 'plains', tier: 'village',
      districts: [distA, distB],
      roads: [],
      noteCount: 20, activeCount7d: 1, generatedAt: NOW,
    };

    const baseParams = makeTestParams();
    const mockParams = {
      ...baseParams,
      cosR: 1,
      sinR: 0,
      waterStyle: 'river' as const,
      riverDist: (x: number, _z: number) => Math.abs(x - 200),  // river far away
      RIVER_W: 6,
    };

    const net = buildTransport(city, mockParams, 'ferry-null-test');
    expect(net.ferry).toBeNull();
  });
});

/* ----------------------------------------------------------------
   T9 — citypainter 接入验证
   ---------------------------------------------------------------- */

describe('T9 citypainter integration', () => {
  it('drawStatic is deterministic (same call count on two runs)', () => {
    const city = makeTestCity(3);
    // Override noteCount to 90 to get airport
    const city90: CityModel = { ...city, noteCount: 90 };
    const params = makeTestParams();

    const { ctx: ctx1, callCount: count1 } = makeMockCtx();
    const { ctx: ctx2, callCount: count2 } = makeMockCtx();

    const painter1 = buildCityPainter(city90, params, 'test-t9');
    const painter2 = buildCityPainter(city90, params, 'test-t9');

    painter1.drawStatic(ctx1);
    painter2.drawStatic(ctx2);

    expect(count1()).toBe(count2());
    expect(count1()).toBeGreaterThan(50);
  });

  it('noteCount=90 has more draw calls than noteCount=5 (airport)', () => {
    const cityBase = makeTestCity(3);
    const city90: CityModel = { ...cityBase, noteCount: 90 };
    const city5: CityModel = { ...cityBase, noteCount: 5 };
    const params = makeTestParams();

    const { ctx: ctx90, callCount: count90 } = makeMockCtx();
    const { ctx: ctx5, callCount: count5 } = makeMockCtx();

    buildCityPainter(city90, params, 'test-t9-90').drawStatic(ctx90);
    buildCityPainter(city5, params, 'test-t9-5').drawStatic(ctx5);

    // city90 has airport, so more draw calls
    expect(count90()).toBeGreaterThan(count5());
  });
});
