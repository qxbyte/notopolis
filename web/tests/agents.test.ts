/**
 * web/tests/agents.test.ts
 * T1: spawnCitizens 数量公式
 * T2: 确定性（同 wsPrefix → 同 villager children 数）
 * T3: updateCitizens 不抛异常且 walker 位置随 t 变化
 * T4: updateVehicles 红灯行为
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildPolyline } from '../src/util/poly';
import type { RoadWithPts, TrafficLight, TrafficStop } from '../src/city/roads';
import { spawnCitizens, updateCitizens } from '../src/agents/citizens';
import { spawnVehicles, updateVehicles } from '../src/agents/vehicles';
import type { WorldParams } from '../src/world/params';

// --------------------------------------------------------------------------
// 辅助：mock scene
// --------------------------------------------------------------------------
function mockScene(): THREE.Scene {
  return { add: vi.fn() } as unknown as THREE.Scene;
}

// --------------------------------------------------------------------------
// 辅助：构造 RoadWithPts（带 stops）
// --------------------------------------------------------------------------
function makeRoad(
  kind: 'main' | 'avenue' | 'street',
  pts: [number, number][],
  stops: TrafficStop[] = []
): RoadWithPts {
  const poly = buildPolyline(pts);
  return {
    kind,
    points: [pts[0], pts[pts.length - 1]],
    pts: poly.pts,
    lens: poly.lens,
    total: poly.total,
    stops,
  };
}

// --------------------------------------------------------------------------
// 辅助：mock WorldParams（只实现 updateVehicles 需要的字段）
// --------------------------------------------------------------------------
function makeWorldParams(): WorldParams {
  const T = 200;
  const worldR = 100;
  return {
    RA: 0, cosR: 1, sinR: 0,
    riverBaseD: 60, RIVER_W: 8,
    riverU: (v: number) => 60 + Math.sin(v * 0.017) * 13,
    riverWorld: (v: number) => [60, v] as [number, number],
    riverDist: (_x: number, _z: number) => 999,
    MA: 1, cosM: 1, sinM: 0,
    canalPts: [[0, 0], [10, 10]] as [number, number][],
    canalY: [0.55, 0.55],
    canalEndY: 0.55,
    lakes: [],
    cityHalfW: 40, cityHalfD: 40,
    worldR, T,
  };
}

// --------------------------------------------------------------------------
// T1: spawnCitizens 数量公式
// --------------------------------------------------------------------------

describe('T1: spawnCitizens 数量公式', () => {
  const baseOpts = {
    wsPrefix: 'test',
    walkables: [makeRoad('main', [[-10, 0], [10, 0]])],
    idleSpots: [],
    cx: 0,
    cz: 0,
  };

  it('activeCount7d=0 → nV=6', () => {
    const result = spawnCitizens(mockScene(), { ...baseOpts, activeCount7d: 0 });
    expect(result.villagers).toHaveLength(6);
  });

  it('activeCount7d=20 → nV=34（上限）', () => {
    const result = spawnCitizens(mockScene(), { ...baseOpts, activeCount7d: 20 });
    expect(result.villagers).toHaveLength(34);
  });

  it('activeCount7d=5 → nV=10（5*2=10，介于6和34之间）', () => {
    const result = spawnCitizens(mockScene(), { ...baseOpts, activeCount7d: 5 });
    expect(result.villagers).toHaveLength(10);
  });
});

// --------------------------------------------------------------------------
// T2: 确定性（同 wsPrefix → 同 villager children 数）
// --------------------------------------------------------------------------

describe('T2: 确定性', () => {
  it('同 wsPrefix 两次 spawn 的第一个 villager children 数一致', () => {
    const opts = {
      wsPrefix: 'vault:alpha',
      activeCount7d: 5,
      walkables: [makeRoad('main', [[-10, 0], [10, 0]])],
      idleSpots: [{ x: 0, z: 0, r: 5 }],
      cx: 0,
      cz: 0,
    };
    const r1 = spawnCitizens(mockScene(), opts);
    const r2 = spawnCitizens(mockScene(), opts);
    expect(r1.villagers[0].g.children.length).toBe(r2.villagers[0].g.children.length);
    expect(r1.villagers[0].g.children.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// T3: updateCitizens 不抛异常且 walker 位置随 t 变化
// --------------------------------------------------------------------------

describe('T3: updateCitizens 行为', () => {
  const road = makeRoad('main', [[-10, 0], [10, 0]]);
  const opts = {
    wsPrefix: 'test:walk',
    activeCount7d: 8,
    walkables: [road],
    idleSpots: [],
    cx: 0,
    cz: 0,
  };

  it('updateCitizens(t=0) 不抛异常', () => {
    const result = spawnCitizens(mockScene(), opts);
    expect(() => updateCitizens(result, 0, 0, 0)).not.toThrow();
  });

  it('road kind villager 位置随 t 变化', () => {
    const result = spawnCitizens(mockScene(), opts);
    // 找一个 road villager
    const walker = result.villagers.find(v => v.kind === 'road');
    expect(walker).toBeDefined();
    if (!walker) return;

    updateCitizens(result, 1, 0, 0);
    const pos1 = walker.g.position.clone();

    updateCitizens(result, 10, 0, 0);
    const pos2 = walker.g.position.clone();

    // 位置应该不同（速度不为零，走了一段）
    const diff = Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y) + Math.abs(pos1.z - pos2.z);
    expect(diff).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// T4: updateVehicles 红灯行为
// --------------------------------------------------------------------------

describe('T4: updateVehicles 红灯行为', () => {
  // light.off = 0 → t=1 green (c=1 < 3.6), t=4 red (c=4 >= 3.6)
  const light: TrafficLight = { x: 0, z: 0, off: 0, mats: null };

  // 停车线在 s=0.5，road 总长 20（从 -10 到 10）
  const stop: TrafficStop = { s: 0.5, light, axis: 'main' };
  const road = makeRoad('main', [[-10, 0], [10, 0]], [stop]);

  // 汽车初始 phase=0.3 → 正向行驶，sNow = 0.3 * 2 = 0.6
  // ahead = (0.5 - 0.6) * 1 * 20 = -2（不在前方，不停车）
  // 改成 phase=0.2 → sNow = 0.4，ahead = (0.5-0.4)*1*20 = 2.0（在 0.3..2.4 之间）→ 红灯停
  const worldParams = makeWorldParams();

  function makeSpawnResult(initialPhase: number) {
    const scene = mockScene();
    // 手动构造 VehiclesResult（不调用 spawnVehicles 以简化测试）
    const carG = new THREE.Group();

    // 创建最小化的 CarState
    const car = {
      g: carG,
      road,
      phase: initialPhase,
      speed: 0.045,
      lane: 0.55,
    };

    // 构造 VehiclesResult
    const boatG = new THREE.Group();
    const speedboatG = new THREE.Group();
    const planeG = new THREE.Group();
    const propG = new THREE.Group();
    planeG.userData.prop = propG;

    return {
      cars: [car],
      bikes: [],
      train: [],
      plane: planeG,
      boat: boatG,
      speedboat: speedboatG,
      railPts: [[-50, -50], [50, -50], [50, 50], [-50, 50]] as [number, number][],
      segLens: [100, 100, 100, 100],
      railTotal: 400,
      worldParams,
    };
  }

  it('红灯时（t=4），car phase 不前进（位置不变）', () => {
    // phase=0.2 → sNow=0.4, ahead=(0.5-0.4)*1*20=2 → 在 (0.3, 2.4) 区间，红灯停
    const result = makeSpawnResult(0.2);
    const car = result.cars[0];

    updateVehicles(result, 4, 0, 0); // t=4, c=4 >= 3.6 → red for main
    const phase1 = car.phase;
    const pos1 = car.g.position.clone();

    updateVehicles(result, 4, 0, 0); // 再次 t=4
    const phase2 = car.phase;
    const pos2 = car.g.position.clone();

    expect(phase1).toBe(phase2); // phase 没变
    expect(pos1.x).toBeCloseTo(pos2.x, 5);
    expect(pos1.z).toBeCloseTo(pos2.z, 5);
  });

  it('绿灯时（t=1），car phase 前进（位置变化）', () => {
    // 先在红灯（t=4）更新一次得到停车位置
    const result = makeSpawnResult(0.2);
    const car = result.cars[0];

    // t=1 (green for main)
    updateVehicles(result, 1, 0, 0);
    const phase1 = car.phase;

    updateVehicles(result, 1, 0, 0);
    const phase2 = car.phase;

    // 绿灯 phase 应该前进
    expect(phase2).not.toBe(phase1);
  });
});
