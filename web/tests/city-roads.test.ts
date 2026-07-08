/**
 * web/tests/city-roads.test.ts
 * 纯函数测试：prepareRoads、computeTrafficLights、lightGreen；
 * districts 包围盒验证（使用 THREE.Shape + ExtrudeGeometry，无 WebGL）。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { CityModel } from '@shared/types';
import { prepareRoads, computeTrafficLights, lightGreen } from '../src/city/roads';

// --------------------------------------------------------------------------
// 辅助：最小 CityModel fixture
// --------------------------------------------------------------------------

function makeCity(roads: CityModel['roads']): CityModel {
  return {
    vaultId: 'test',
    name: 'Test City',
    theme: 'plains',
    tier: 'city',
    districts: [],
    roads,
    noteCount: 0,
    activeCount7d: 0,
    generatedAt: 0,
  };
}

// --------------------------------------------------------------------------
// prepareRoads 测试
// --------------------------------------------------------------------------

describe('prepareRoads — street 蜿蜒化', () => {
  const city = makeCity([
    { kind: 'street', points: [[0, 0], [20, 0]] },
  ]);

  it('确定性：同输入两次调用结果相同', () => {
    const r1 = prepareRoads(city, 0, 0);
    const r2 = prepareRoads(city, 0, 0);
    expect(r1[0].pts).toEqual(r2[0].pts);
  });

  it('street pts.length === 19', () => {
    const roads = prepareRoads(city, 0, 0);
    expect(roads[0].pts).toHaveLength(19);
  });

  it('street 端点约等于原始端点（误差 < 0.01）', () => {
    const roads = prepareRoads(city, 0, 0);
    const pts = roads[0].pts;
    expect(pts[0][0]).toBeCloseTo(0, 2);
    expect(pts[0][1]).toBeCloseTo(0, 2);
    expect(pts[18][0]).toBeCloseTo(20, 2);
    expect(pts[18][1]).toBeCloseTo(0, 2);
  });

  it('lens.length === pts.length - 1，total > 0', () => {
    const roads = prepareRoads(city, 0, 0);
    expect(roads[0].lens).toHaveLength(18);
    expect(roads[0].total).toBeGreaterThan(0);
  });
});

describe('prepareRoads — main/avenue 直线', () => {
  const city = makeCity([
    { kind: 'main', points: [[-10, 0], [10, 0]] },
    { kind: 'avenue', points: [[0, -10], [0, 10]] },
  ]);

  it('确定性：同输入两次调用结果相同', () => {
    const r1 = prepareRoads(city, 0, 0);
    const r2 = prepareRoads(city, 0, 0);
    expect(r1[0].pts).toEqual(r2[0].pts);
    expect(r1[1].pts).toEqual(r2[1].pts);
  });

  it('非 street pts.length === 2', () => {
    const roads = prepareRoads(city, 0, 0);
    expect(roads[0].pts).toHaveLength(2);
    expect(roads[1].pts).toHaveLength(2);
  });

  it('lens.length === 1，total > 0', () => {
    const roads = prepareRoads(city, 0, 0);
    expect(roads[0].lens).toHaveLength(1);
    expect(roads[0].total).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// computeTrafficLights 测试
// --------------------------------------------------------------------------

describe('computeTrafficLights', () => {
  const city = makeCity([
    { kind: 'main', points: [[-5, 0], [5, 0]] },
    { kind: 'avenue', points: [[0, -5], [0, 5]] },
  ]);
  const roads = prepareRoads(city, 0, 0);
  const mr = roads[0];
  const ar = roads[1];
  const lights = computeTrafficLights(roads);

  it('交叉口生成 1 个红绿灯', () => {
    expect(lights).toHaveLength(1);
  });

  it('main 道路有 1 个 stop，axis 为 main', () => {
    expect(mr.stops).toHaveLength(1);
    expect(mr.stops![0].axis).toBe('main');
  });

  it('avenue 道路有 1 个 stop，axis 为 avenue', () => {
    expect(ar.stops).toHaveLength(1);
    expect(ar.stops![0].axis).toBe('avenue');
  });

  it('灯坐标约为 (0, 0)（误差 < 0.5）', () => {
    expect(lights[0].x).toBeCloseTo(0, 0);
    expect(lights[0].z).toBeCloseTo(0, 0);
  });

  it('灯 off 为 0（第一个）', () => {
    expect(lights[0].off).toBe(0);
  });

  it('mats 初始为 null', () => {
    expect(lights[0].mats).toBeNull();
  });
});

// --------------------------------------------------------------------------
// lightGreen 测试
// --------------------------------------------------------------------------

describe('lightGreen', () => {
  const light = { x: 0, z: 0, off: 0, mats: null };

  it('t=0, off=0, main → true（c=0 < 3.6）', () => {
    expect(lightGreen(light, 'main', 0)).toBe(true);
  });

  it('t=0, off=0, avenue → false（c=0, not >=4 && <7.6）', () => {
    expect(lightGreen(light, 'avenue', 0)).toBe(false);
  });

  it('t=4.5, off=0, main → false（c=4.5 >= 3.6）', () => {
    expect(lightGreen(light, 'main', 4.5)).toBe(false);
  });

  it('t=4.5, off=0, avenue → true（c=4.5 >=4 && <7.6）', () => {
    expect(lightGreen(light, 'avenue', 4.5)).toBe(true);
  });

  it('t=3.7, off=0 → 黄灯区间：main=false, avenue=false', () => {
    // c=3.7 在黄灯区间 3.6-4
    expect(lightGreen(light, 'main', 3.7)).toBe(false);
    expect(lightGreen(light, 'avenue', 3.7)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// districts 包围盒验证（THREE.Shape + ExtrudeGeometry，无 WebGL）
// --------------------------------------------------------------------------

describe('districts — polygon ExtrudeGeometry 包围盒', () => {
  it('包围盒 x/y/z 范围符合预期', () => {
    const polygon: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
    const cx = 5, cz = 4;

    const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;

    // x 范围：[-5, 5]
    expect(bb.min.x).toBeCloseTo(-5, 0);
    expect(bb.max.x).toBeCloseTo(5, 0);

    // y 范围（Shape Y，对应世界 Z 翻转）：[-4, 4]
    expect(bb.min.y).toBeCloseTo(-4, 0);
    expect(bb.max.y).toBeCloseTo(4, 0);

    // z 范围（ExtrudeGeometry depth 方向）：[0, 0.5]
    expect(bb.max.z).toBeCloseTo(0.5, 1);
  });
});
