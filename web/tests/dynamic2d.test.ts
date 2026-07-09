// @vitest-environment jsdom
/**
 * dynamic2d.test.ts — 动态层 2D 涂鸦化测试
 */
import { describe, it, expect } from 'vitest';
import type { CityModel } from '@shared/types';
import { createDynamicLayer } from '../src/render2d/dynamic';
import { worldParams } from '../src/world/params';

/* ----------------------------------------------------------------
   Mock CanvasRenderingContext2D
   ---------------------------------------------------------------- */

interface TranslateCall { x: number; z: number }

function makeMockCtx() {
  const translateCalls: TranslateCall[] = [];
  const saveCalls: number[] = [];
  const fillStyleHistory: string[] = [];
  let callCount = 0;

  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'lineWidth') return 0.1;
      if (prop === 'fillStyle') return fillStyleHistory[fillStyleHistory.length - 1] ?? '';
      if (prop === 'strokeStyle') return '';
      if (prop === 'globalAlpha') return 1;

      return (...args: unknown[]) => {
        callCount++;
        if (prop === 'translate') {
          translateCalls.push({ x: args[0] as number, z: args[1] as number });
        }
        if (prop === 'save') {
          saveCalls.push(Date.now());
        }
      };
    },
    set(_t, prop: string, val: unknown) {
      if (prop === 'fillStyle') fillStyleHistory.push(val as string);
      return true;
    },
  });

  return {
    ctx,
    translateCalls,
    saveCalls,
    get callCount() { return callCount; },
  };
}

/* ----------------------------------------------------------------
   Fixtures
   ---------------------------------------------------------------- */

const baseCity: CityModel = {
  vaultId: 'test',
  name: 'TestCity',
  theme: 'plains',
  tier: 'village',
  districts: [],
  roads: [
    { kind: 'main',   points: [[-20, 0],  [20, 0]]  },
    { kind: 'avenue', points: [[0, -20],  [0, 20]]  },
    { kind: 'street', points: [[-10, 5],  [10, 5]]  },  // street — 不参与 walkables
  ],
  noteCount: 10,
  activeCount7d: 5,
  generatedAt: Date.now(),
};

const cityWithOnlyStreet: CityModel = {
  ...baseCity,
  roads: [
    { kind: 'street', points: [[-10, 0], [10, 0]] },
    { kind: 'street', points: [[0, -10], [0, 10]] },
  ],
};

const params = worldParams('test', 50, 50, 80, 80);

const noParks: { x: number; z: number; r: number }[] = [];

/* ----------------------------------------------------------------
   T1 — 市民数量公式
   ---------------------------------------------------------------- */

describe('T1 — 市民数量公式 min(34, max(6, activeCount7d * 2))', () => {
  it('activeCount7d=5 → 10 个市民', () => {
    const layer = createDynamicLayer(baseCity, params, 'test', noParks);
    expect(layer.citizenCount()).toBe(10);
  });

  it('activeCount7d=0 → 最少 6 个市民', () => {
    const city0: CityModel = { ...baseCity, activeCount7d: 0 };
    const layer = createDynamicLayer(city0, params, 'test', noParks);
    expect(layer.citizenCount()).toBe(6);
  });

  it('activeCount7d=20 → 最多 34 个市民', () => {
    const city20: CityModel = { ...baseCity, activeCount7d: 20 };
    const layer = createDynamicLayer(city20, params, 'test', noParks);
    expect(layer.citizenCount()).toBe(34);
  });
});

/* ----------------------------------------------------------------
   T2 — 确定性
   ---------------------------------------------------------------- */

describe('T2 — 同种子两次 draw 结果相同（确定性）', () => {
  it('两次 createDynamicLayer + draw(t=1) 产生相同 translate 调用序列', () => {
    const m1 = makeMockCtx();
    const m2 = makeMockCtx();

    const layer1 = createDynamicLayer(baseCity, params, 'test', noParks);
    const layer2 = createDynamicLayer(baseCity, params, 'test', noParks);

    layer1.draw(m1.ctx, 1);
    layer2.draw(m2.ctx, 1);

    // translate 调用数量相同
    expect(m1.translateCalls.length).toBe(m2.translateCalls.length);
    expect(m1.translateCalls.length).toBeGreaterThan(0);

    // 每个 translate 位置相同（在一定精度内）
    for (let i = 0; i < m1.translateCalls.length; i++) {
      expect(m1.translateCalls[i].x).toBeCloseTo(m2.translateCalls[i].x, 3);
      expect(m1.translateCalls[i].z).toBeCloseTo(m2.translateCalls[i].z, 3);
    }
  });

  it('draw 产生非空绘制（callCount > 0）', () => {
    const m = makeMockCtx();
    const layer = createDynamicLayer(baseCity, params, 'test', noParks);
    layer.draw(m.ctx, 1);
    expect(m.callCount).toBeGreaterThan(10);
  });
});

/* ----------------------------------------------------------------
   T3 — 红灯期间车辆 travel 不推进
   ---------------------------------------------------------------- */

describe('T3 — 红灯停车：红灯期间 carTravel 不前进', () => {
  it('红灯期间连续两次 draw，vehicle s 值不变', () => {
    // 设计：main 路 [-5,0]-[5,0]，length=10（>8 会生成车辆）
    // avenue 在 x=-3.9，使交叉点 st.s = 1.1/10 = 0.11
    // cars[0].phase0=0 → sNow=0，ahead=(0.11-0)*1*10=1.1 in (0.3,2.4)
    // t=4.0 时 c=4，main 轴红灯（c>=3.6）→ halted=true
    const city: CityModel = {
      ...baseCity,
      roads: [
        { kind: 'main',   points: [[-5, 0],   [5, 0]]   },  // length=10 > 8
        { kind: 'avenue', points: [[-3.9, -9], [-3.9, 9]] }, // 在 main 上 st.s≈0.11
      ],
      activeCount7d: 3,
    };

    const layer = createDynamicLayer(city, params, 'test', noParks);
    const m = makeMockCtx();

    // 在红灯状态 t=4.0 draw 两次（c=4, main 轴红）
    const tRed = 4.0;
    layer.draw(m.ctx, tRed);
    const s1 = layer.debugCarS(0);
    layer.draw(makeMockCtx().ctx, tRed + 0.1);
    const s2 = layer.debugCarS(0);

    // s 不应前进（红灯停车）
    expect(Math.abs(s2 - s1)).toBeLessThan(0.001);
  });

  it('绿灯期间连续两次 draw，vehicle s 值前进', () => {
    const city: CityModel = {
      ...baseCity,
      roads: [
        { kind: 'main',   points: [[-30, 0],  [30, 0]]  },
        { kind: 'avenue', points: [[0,  -30], [0,  30]] },
      ],
      activeCount7d: 3,
    };

    const layer = createDynamicLayer(city, params, 'test', noParks);
    const m = makeMockCtx();

    // t=0（main 绿灯）
    const tGreen = 0.0;
    layer.draw(m.ctx, tGreen);
    const s1 = layer.debugCarS(0);
    layer.draw(makeMockCtx().ctx, tGreen + 0.5);
    const s2 = layer.debugCarS(0);

    // s 应该前进了
    expect(s2).toBeGreaterThan(s1);
  });
});

/* ----------------------------------------------------------------
   T4 — street 不在 walkables
   ---------------------------------------------------------------- */

describe('T4 — street 类型道路不在 walkables', () => {
  it('只有 street 路时，市民数量仍按公式，但全部是 idle（无路可走的降级）', () => {
    const layer = createDynamicLayer(cityWithOnlyStreet, params, 'test', noParks);
    // 市民数量应符合公式
    expect(layer.citizenCount()).toBe(10);
    // 所有市民的 kind 应该是 idle（street 不参与 walkables）
    const kinds = layer.debugCitizenKinds();
    for (const k of kinds) {
      expect(k).toBe('idle');
    }
  });

  it('有 main/avenue 路时，部分市民 kind 为 road', () => {
    const layer = createDynamicLayer(baseCity, params, 'test', noParks);
    const kinds = layer.debugCitizenKinds();
    // 应该有至少一个 road 类型市民（60/40 路网/公园分配，公园为空时更多去路网）
    const roadCount = kinds.filter(k => k === 'road').length;
    expect(roadCount).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------------------
   T5 — hitables() 返回空数组
   ---------------------------------------------------------------- */

describe('T5 — hitables() 返回空数组', () => {
  it('动态层不可点击，hitables 为空', () => {
    const layer = createDynamicLayer(baseCity, params, 'test', noParks);
    expect(layer.hitables()).toEqual([]);
  });
});

/* ----------------------------------------------------------------
   T6 — draw 是 t 的纯函数（对于市民/帆船/火车等非车辆元素）
   ---------------------------------------------------------------- */

describe('T6 — draw 位置是 t 的纯函数（非车辆元素）', () => {
  it('相同 t 两次 draw，translate 序列相同', () => {
    const layer = createDynamicLayer(baseCity, params, 'test', noParks);
    const m1 = makeMockCtx();
    const m2 = makeMockCtx();

    // 先 draw(t=2) 推进状态
    layer.draw(m1.ctx, 2);
    // 再 draw(t=5) 两次——这两次应该相同（非车辆部分纯函数）
    layer.draw(makeMockCtx().ctx, 5);
    const m3 = makeMockCtx();
    layer.draw(m3.ctx, 5);
    layer.draw(m2.ctx, 5);

    // 同一 t 的 translate 调用数相同
    expect(m2.translateCalls.length).toBe(m3.translateCalls.length);
  });
});
