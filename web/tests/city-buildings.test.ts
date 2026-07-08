/**
 * web/tests/city-buildings.test.ts
 * TDD 测试：buildBuildings / updateBuildings
 * 覆盖：pickables、userData、确定性、glowWindows、dormant、construction、windmill 分布、动画
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Building, CityModel } from '@shared/types';
import { buildBuildings, updateBuildings, type SmokePuff } from '../src/city/buildings';

// --------------------------------------------------------------------------
// fixture
// --------------------------------------------------------------------------

const NOW = 1_000_000_000_000;
const DAY = 86400000;

const buildings: Building[] = [
  // 0: isCivic（区府）
  {
    notePath: 'dir/README.md', title: 'README', x: 5, z: 5, rotY: 0,
    size: 2, landmark: false, construction: false, isCivic: true,
    mainStreet: false, mtimeMs: NOW - 10 * DAY, wordCount: 100, inlinks: 5,
    openTasks: 0, excerpt: '',
  },
  // 1: landmark（地标 → temple）
  {
    notePath: 'dir/landmark.md', title: 'Landmark', x: 15, z: 5, rotY: 0,
    size: 3, landmark: true, construction: false, isCivic: false,
    mainStreet: false, mtimeMs: NOW - 10 * DAY, wordCount: 200, inlinks: 10,
    openTasks: 0, excerpt: '',
  },
  // 2: construction（脚手架）
  {
    notePath: 'dir/wip.md', title: 'WIP', x: 25, z: 5, rotY: 0,
    size: 2, landmark: false, construction: true, isCivic: false,
    mainStreet: false, mtimeMs: NOW - 10 * DAY, wordCount: 50, inlinks: 0,
    openTasks: 3, excerpt: '',
  },
  // 3: dormant（ageDays > 180）
  {
    notePath: 'dir/old.md', title: 'Old', x: 35, z: 5, rotY: 0,
    size: 1, landmark: false, construction: false, isCivic: false,
    mainStreet: false, mtimeMs: NOW - 200 * DAY, wordCount: 30, inlinks: 0,
    openTasks: 0, excerpt: '',
  },
  // 4: active（ageDays < 7，触发 glowWindows；dir/active.md → cottage arch，glowCount=1，确定性已验证）
  {
    notePath: 'dir/active.md', title: 'Active', x: 5, z: 20, rotY: 0,
    size: 2, landmark: false, construction: false, isCivic: false,
    mainStreet: false, mtimeMs: NOW - 3 * DAY, wordCount: 80, inlinks: 2,
    openTasks: 0, excerpt: '',
  },
  // 5: 普通（非 active/dormant，size:1）
  {
    notePath: 'dir/normal.md', title: 'Normal', x: 15, z: 20, rotY: 0,
    size: 1, landmark: false, construction: false, isCivic: false,
    mainStreet: false, mtimeMs: NOW - 30 * DAY, wordCount: 60, inlinks: 1,
    openTasks: 0, excerpt: '',
  },
];

const city: CityModel = {
  vaultId: 'test', name: 'Test', theme: 'plains', tier: 'city',
  districts: [{
    dir: 'dir', x: 0, z: 0, width: 50, depth: 50,
    polygon: [[0, 0], [50, 0], [50, 50], [0, 50]],
    isInbox: false,
    buildings,
  }],
  roads: [],
  noteCount: 6, activeCount7d: 1, generatedAt: NOW,
};

// --------------------------------------------------------------------------
// 辅助：构造只含单楼的 CityModel
// --------------------------------------------------------------------------

function singleBuildingCity(b: Building): CityModel {
  return {
    vaultId: 'test', name: 'Test', theme: 'plains', tier: 'city',
    districts: [{
      dir: 'dir', x: 0, z: 0, width: 50, depth: 50,
      polygon: [[0, 0], [50, 0], [50, 50], [0, 50]],
      isInbox: false,
      buildings: [b],
    }],
    roads: [],
    noteCount: 1, activeCount7d: 0, generatedAt: NOW,
  };
}

// --------------------------------------------------------------------------
// 测试用 mock scene
// --------------------------------------------------------------------------

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

// --------------------------------------------------------------------------
// 1. pickables.length === 6
// --------------------------------------------------------------------------

describe('buildBuildings — pickables', () => {
  it('pickables.length 等于建筑数量（6）', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(result.pickables.length).toBe(6);
  });
});

// --------------------------------------------------------------------------
// 2. userData 和 traverse
// --------------------------------------------------------------------------

describe('buildBuildings — userData', () => {
  it('每个 pickable.userData.type === "building"', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    for (const p of result.pickables) {
      expect(p.userData.type).toBe('building');
    }
  });

  it('pickable.userData.b 对应建筑对象（notePath 相等）', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    const allBuildings = city.districts.flatMap(d => d.buildings);
    for (let i = 0; i < result.pickables.length; i++) {
      expect(result.pickables[i].userData.b.notePath).toBe(allBuildings[i].notePath);
    }
  });

  it('traverse：每个子对象的 userData.root 指向 pickable', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    const root = result.pickables[0];
    root.traverse((o) => {
      expect(o.userData.root).toBe(root);
    });
  });
});

// --------------------------------------------------------------------------
// 3. 确定性
// --------------------------------------------------------------------------

describe('buildBuildings — 确定性', () => {
  it('两次调用：第一个 pickable 的 children.length 相同', () => {
    const r1 = buildBuildings(makeScene(), city, 0, 0, NOW);
    const r2 = buildBuildings(makeScene(), city, 0, 0, NOW);
    expect(r1.pickables[0].children.length).toBe(r2.pickables[0].children.length);
  });

  it('两次调用：第一个子对象位置 x/y/z 相同（toBeCloseTo）', () => {
    const r1 = buildBuildings(makeScene(), city, 0, 0, NOW);
    const r2 = buildBuildings(makeScene(), city, 0, 0, NOW);
    const c1 = r1.pickables[0].children[0];
    const c2 = r2.pickables[0].children[0];
    expect(c1.position.x).toBeCloseTo(c2.position.x, 5);
    expect(c1.position.y).toBeCloseTo(c2.position.y, 5);
    expect(c1.position.z).toBeCloseTo(c2.position.z, 5);
  });
});

// --------------------------------------------------------------------------
// 4. active 楼产生 glowWindows
// --------------------------------------------------------------------------

describe('buildBuildings — glowWindows', () => {
  it('active 楼（#4）使结果中有 glowWindows', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(result.glowWindows.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// 5. dormant 楼不产生 glowWindows
// --------------------------------------------------------------------------

describe('buildBuildings — dormant 无 glowWindows', () => {
  it('只有 dormant 楼时 glowWindows.length === 0', () => {
    const dormantBuilding = buildings[3]; // ageDays = 200 > 180
    const dormantCity = singleBuildingCity(dormantBuilding);
    const result = buildBuildings(makeScene(), dormantCity, 0, 0, NOW);
    expect(result.glowWindows.length).toBe(0);
  });
});

// --------------------------------------------------------------------------
// 6. construction 楼子对象数 > 普通楼
// --------------------------------------------------------------------------

describe('buildBuildings — construction 脚手架', () => {
  it('construction 楼（#2）子对象数 > 普通楼（#5）', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(result.pickables[2].children.length).toBeGreaterThan(
      result.pickables[5].children.length
    );
  });
});

// --------------------------------------------------------------------------
// 7. windmill arch 分布测试
// --------------------------------------------------------------------------

describe('buildBuildings — windmill 分布', () => {
  it('200 个普通楼中，windmill 出现次数 > 0 且 < 80（200*0.4）', () => {
    // 200 个非 civic/landmark/size:3 的普通楼，触发 arch 随机分支
    const manyBuildings: Building[] = Array.from({ length: 200 }, (_, i) => ({
      notePath: `dir/note${i}.md`,
      title: `Note ${i}`,
      x: (i % 20) * 5,
      z: Math.floor(i / 20) * 5,
      rotY: 0,
      size: 2 as const, // size:2 会走 cottage/townhouse/... 分支或 22% 设施分支
      landmark: false,
      construction: false,
      isCivic: false,
      mainStreet: false,
      mtimeMs: NOW - 30 * DAY, // 普通，非 active 非 dormant
      wordCount: 50,
      inlinks: 0,
      openTasks: 0,
      excerpt: '',
    }));

    const manyCity: CityModel = {
      vaultId: 'test', name: 'Test', theme: 'plains', tier: 'city',
      districts: [{
        dir: 'dir', x: 0, z: 0, width: 200, depth: 200,
        polygon: [[0, 0], [200, 0], [200, 200], [0, 200]],
        isInbox: false,
        buildings: manyBuildings,
      }],
      roads: [],
      noteCount: 200, activeCount7d: 0, generatedAt: NOW,
    };

    const result = buildBuildings(makeScene(), manyCity, 0, 0, NOW);
    const windmillCount = result.windmills.length;
    expect(windmillCount).toBeGreaterThan(0);
    expect(windmillCount).toBeLessThan(80);
  });
});

// --------------------------------------------------------------------------
// 8. updateBuildings 不抛异常
// --------------------------------------------------------------------------

describe('updateBuildings', () => {
  it('updateBuildings(result, 1.5) 不抛异常', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(() => updateBuildings(result, 1.5)).not.toThrow();
  });

  it('updateBuildings 可以多次调用', () => {
    const scene = makeScene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(() => {
      updateBuildings(result, 0);
      updateBuildings(result, 0.5);
      updateBuildings(result, 10);
    }).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 9. smoke 动画公式对齐原型（四处修正）
// --------------------------------------------------------------------------

describe('updateBuildings — smoke animation formulas', () => {
  it('phase 步长 i*0.33，position 含 sin(t+i)*0.15*ph 横漂与 +0.4 y 偏置，z 固定 base.z，opacity 0.55，scale 起点 0.5', () => {
    // 手工构造一个含 1 个 smoke（3 puffs）的 result
    const result: ReturnType<typeof buildBuildings> = {
      pickables: [],
      glowWindows: [],
      smokes: [],
      windmills: [],
    };

    // 创建 3 个 puff mesh
    const basePos = new THREE.Vector3(5, 10, 3);
    const seed = 3.14;
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xdedede, transparent: true, opacity: 0.7 })
      );
      p.position.copy(basePos);
      puffs.push(p);
    }
    result.smokes.push({ puffs, base: basePos.clone(), seed });

    // 调用 updateBuildings(result, t=1)
    const t = 1;
    updateBuildings(result, t);

    const smoke = result.smokes[0];
    const puff0 = smoke.puffs[0];

    // 计算预期 phase（i=0）
    const expectedPhase = ((t * 0.4 + seed + 0 * 0.33) % 1);

    // 断言 position.x === base.x + Math.sin(1+0) * 0.15 * expectedPhase
    const expectedX = smoke.base.x + Math.sin(t + 0) * 0.15 * expectedPhase;
    expect(puff0.position.x).toBeCloseTo(expectedX, 5);

    // 断言 position.y === base.y + 0.4 + expectedPhase * 1.8
    const expectedY = smoke.base.y + 0.4 + expectedPhase * 1.8;
    expect(puff0.position.y).toBeCloseTo(expectedY, 5);

    // 断言 position.z === base.z（固定不变）
    expect(puff0.position.z).toBeCloseTo(smoke.base.z, 5);

    // 断言 scale.x === 0.5 + expectedPhase * 1.1
    const expectedScale = 0.5 + expectedPhase * 1.1;
    expect(puff0.scale.x).toBeCloseTo(expectedScale, 5);

    // 断言 opacity === 0.55 * (1 - expectedPhase)
    const expectedOpacity = 0.55 * (1 - expectedPhase);
    expect((puff0.material as THREE.MeshLambertMaterial).opacity).toBeCloseTo(expectedOpacity, 5);
  });
});
