/**
 * agents/citizens.ts
 * 市民（村民）的生成与动画。
 * 参数值与 prototype/public/index.html「市民与河船」段严格一致。
 */

import * as THREE from 'three';
import { SoftBox } from '../scene/softbox';
import { rng0 } from '../util/seed';
import { polyAt } from '../util/poly';
import type { RoadWithPts } from '../city/roads';

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface VillagerState {
  g: THREE.Group;
  kind: 'idle' | 'road';
  spot?: { x: number; z: number; r: number };
  road?: RoadWithPts;
  phase: number;
  speed: number;
  side?: number;
}

export interface CitizensResult {
  villagers: VillagerState[];
}

export interface SpawnCitizensOpts {
  wsPrefix: string;
  activeCount7d: number;
  walkables: RoadWithPts[];
  idleSpots: { x: number; z: number; r: number }[];
  cx: number;
  cz: number;
}

// --------------------------------------------------------------------------
// 颜色常量（原值）
// --------------------------------------------------------------------------

const skinTones   = [0xf5d5b0, 0xe8c09a, 0xd9a878, 0xb5885c, 0x8a5c3a, 0x6b4530];
const hairColors  = [0x2e2a26, 0x4a342a, 0x6b4a2f, 0x8a6a3a, 0xc9a04f, 0x3a3a44];
const clothPalette = [0xc0453a, 0x3e6b9e, 0x4f8a3f, 0xd08f2e, 0x8e5a9e, 0x4fa8a0, 0x9e4f6b, 0x6b6b9e];

// --------------------------------------------------------------------------
// 内部工具函数
// --------------------------------------------------------------------------

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function limb(r1: number, r2: number, len: number, color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r1, r2, len, 6);
  geo.translate(0, -len / 2, 0);
  return new THREE.Mesh(geo, mat(color));
}

// --------------------------------------------------------------------------
// makeVillager：按雏形 rnd 消费顺序严格生成村民 Group
// --------------------------------------------------------------------------

function makeVillager(rnd: () => number): THREE.Group {
  const g = new THREE.Group();

  // 年龄
  const roll = rnd();
  const age: 'kid' | 'adult' | 'elder' =
    roll < 0.18 ? 'kid' : roll < 0.82 ? 'adult' : 'elder';

  // 性别
  const female = rnd() < 0.5;

  // 肤色
  const skinC = skinTones[Math.floor(rnd() * skinTones.length)];

  // 衣服颜色
  const cloth = clothPalette[Math.floor(rnd() * clothPalette.length)];

  // 裤子：< 0.5 → 深色；否则 clothPalette[next rnd]
  let pantsC: number;
  if (rnd() < 0.5) {
    pantsC = 0x4a4038;
  } else {
    pantsC = clothPalette[Math.floor(rnd() * clothPalette.length)];
  }

  // 发色
  let hairC: number;
  if (age === 'elder') {
    hairC = rnd() < 0.5 ? 0xe8e8e8 : 0xbfbfbf;
  } else {
    hairC = hairColors[Math.floor(rnd() * hairColors.length)];
  }

  // 秃顶（老人男性）
  const baldElder = age === 'elder' && !female && rnd() < 0.4;

  // 女性：先无条件消费 rnd 决定长发/丸子头（原型所有 female 都消费，包括 kid）
  // 然后 kid female 额外叠加双马尾
  let longHair = false;
  let bun = false;
  if (female) {
    if (rnd() < 0.5) {
      longHair = true;
    } else {
      bun = true;
    }
    // kid female：叠加双马尾（longHair/bun 仍保留）
  }

  // 成年男性：胡子
  let beard = false;
  if (age === 'adult' && !female) {
    beard = rnd() < 0.3;
  }

  // 帽子
  let hatR: number | null = null;
  let hatColor: number | null = null;
  {
    const hroll = rnd();
    if (hroll < 0.15) {
      hatR = 1; // 草帽
    } else if (hroll < 0.28) {
      hatR = 2; // 便帽
      hatColor = clothPalette[Math.floor(rnd() * clothPalette.length)];
    }
  }

  // 背篓
  const basket = rnd() < 0.2;

  // ---- 构建几何体 ----

  // 躯干
  const bodyGeo = female
    ? new THREE.CylinderGeometry(0.13, 0.25, 0.52, 10)
    : new THREE.CylinderGeometry(0.17, 0.18, 0.5, 10);
  const body = new THREE.Mesh(bodyGeo, mat(cloth));
  body.position.y = 0.88;
  if (age === 'elder') body.rotation.x = 0.12;
  g.add(body);

  // 头部
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mat(skinC));
  head.position.y = 1.32;
  if (age === 'elder') head.position.z = 0.06;
  g.add(head);

  // 发型
  if (!baldElder) {
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.168, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      mat(hairC)
    );
    hairCap.position.y = 1.335;
    g.add(hairCap);

    if (female && longHair) {
      const longHairMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 0.32, 8),
        mat(hairC)
      );
      longHairMesh.position.set(0, 1.16, -0.11);
      g.add(longHairMesh);
    }

    if (female && bun) {
      const bunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat(hairC));
      bunMesh.position.set(0, 1.5, -0.06);
      g.add(bunMesh);
    }

    if (female && age === 'kid') {
      // 双马尾
      const tailGeo = new THREE.SphereGeometry(0.07, 7, 7);
      const tailL = new THREE.Mesh(tailGeo, mat(hairC));
      tailL.position.set(-0.16, 1.34, -0.05);
      g.add(tailL);
      const tailR = new THREE.Mesh(tailGeo, mat(hairC));
      tailR.position.set(0.16, 1.34, -0.05);
      g.add(tailR);
    }
  }

  // 胡子（用发色 hairC，与原型一致）
  if (beard) {
    const beardMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(hairC));
    beardMesh.scale.set(1.25, 0.7, 0.7);
    beardMesh.position.set(0, 1.21, 0.11);
    g.add(beardMesh);
  }

  // 手臂
  const armL = limb(0.05, 0.045, 0.4, cloth);
  armL.position.set(-0.21, 1.1, 0);
  g.add(armL);
  const armR = limb(0.05, 0.045, 0.4, cloth);
  armR.position.set(0.21, 1.1, 0);
  g.add(armR);

  // 手掌
  const palmGeo = new THREE.SphereGeometry(0.05, 6, 6);
  const palmL = new THREE.Mesh(palmGeo, mat(skinC));
  palmL.position.y = -0.42;
  armL.add(palmL);
  const palmR = new THREE.Mesh(palmGeo, mat(skinC));
  palmR.position.y = -0.42;
  armR.add(palmR);

  // 腿（女性用肤色，男性用裤色，与原型 female ? skin : pants 一致）
  const legL = limb(0.065, 0.055, 0.4, female ? skinC : pantsC);
  legL.position.set(-0.09, 0.62, 0);
  g.add(legL);
  const legR = limb(0.065, 0.055, 0.4, female ? skinC : pantsC);
  legR.position.set(0.09, 0.62, 0);
  g.add(legR);

  // 老人：拐杖（颜色 0x6f5a3e 与原型一致）
  if (age === 'elder') {
    const cane = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.78, 6),
      mat(0x6f5a3e)
    );
    cane.position.set(0.3, 0.4, 0.12);
    g.add(cane);
  }

  // 帽子（草帽颜色 0xd9c58a 与原型一致）
  if (hatR === 1) {
    const straw = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.15, 9), mat(0xd9c58a));
    straw.position.y = 1.52;
    g.add(straw);
  } else if (hatR === 2 && hatColor !== null) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.1, 9), mat(hatColor));
    cap.position.y = 1.5;
    g.add(cap);
  }

  // 背篓（颜色 0xa87c4f 与原型一致）
  if (basket) {
    const bask = new THREE.Mesh(new SoftBox(0.2, 0.26, 0.14), mat(0xa87c4f));
    bask.position.set(0, 0.95, -0.22);
    g.add(bask);
  }

  // kid 缩放
  if (age === 'kid') {
    g.scale.setScalar(0.6);
  }

  g.userData.age = age;
  g.userData.limbs = { armL, armR, legL, legR };

  return g;
}

// --------------------------------------------------------------------------
// spawnCitizens
// --------------------------------------------------------------------------

export function spawnCitizens(scene: THREE.Scene, opts: SpawnCitizensOpts): CitizensResult {
  const { wsPrefix, activeCount7d, walkables, idleSpots, cx, cz } = opts;
  const nV = Math.min(34, Math.max(6, activeCount7d * 2));
  const villagers: VillagerState[] = [];

  for (let i = 0; i < nV; i++) {
    const rnd = rng0(wsPrefix + ':villager:' + i);

    // 消费 rnd 用于决定年龄（这里由 makeVillager 内部消费）
    // ageMul 需要在知道 age 前预判——与雏形对齐：makeVillager 消费第一个 rnd 决定 age
    // 但 ageMul 在外层需要，所以先"偷看"age，再真正创建
    // 方法：用同一个 seed 先跑一次只取 age，再重新创建 rng
    const rndPeek = rng0(wsPrefix + ':villager:' + i);
    const rollPeek = rndPeek();
    const agePeek: 'kid' | 'adult' | 'elder' =
      rollPeek < 0.18 ? 'kid' : rollPeek < 0.82 ? 'adult' : 'elder';
    const ageMul = agePeek === 'elder' ? 0.5 : agePeek === 'kid' ? 1.35 : 1;

    const g = makeVillager(rnd);
    scene.add(g);

    const isIdle = idleSpots.length > 0 && i % 5 >= 3;

    if (isIdle) {
      const spot = idleSpots[i % idleSpots.length];
      villagers.push({
        g,
        kind: 'idle',
        spot,
        phase: (i * 0.37) % 1,
        speed: (0.13 + (i % 3) * 0.05) * ageMul,
      });
    } else if (walkables.length > 0) {
      const road = walkables[i % walkables.length];
      villagers.push({
        g,
        kind: 'road',
        road,
        phase: (i * 0.37) % 1,
        speed: (0.02 + (i % 5) * 0.006) * ageMul,
        side: i % 2 ? 0.8 : -0.8,
      });
    } else {
      // fallback：无路可走则 idle 于原点
      villagers.push({
        g,
        kind: 'idle',
        spot: { x: 0, z: 0, r: 5 },
        phase: (i * 0.37) % 1,
        speed: (0.13 + (i % 3) * 0.05) * ageMul,
      });
    }
  }

  return { villagers };
}

// --------------------------------------------------------------------------
// updateCitizens
// --------------------------------------------------------------------------

export function updateCitizens(result: CitizensResult, t: number, cx: number, cz: number): void {
  for (const v of result.villagers) {
    const limbs = v.g.userData.limbs as {
      armL: THREE.Object3D;
      armR: THREE.Object3D;
      legL: THREE.Object3D;
      legR: THREE.Object3D;
    };

    const bob = 0.34 + Math.abs(Math.sin(t * 7 + v.phase * 9)) * 0.04;

    let swing: number;
    if (v.kind === 'idle') {
      swing = Math.sin(t * 4 + v.phase * 9) * 0.25;
    } else {
      swing = Math.sin(t * 8 + v.phase * 9) * 0.6;
    }
    limbs.armL.rotation.x = swing;
    limbs.armR.rotation.x = -swing;
    limbs.legL.rotation.x = -swing * 0.8;
    limbs.legR.rotation.x = swing * 0.8;

    if (v.kind === 'idle' && v.spot) {
      const a = t * v.speed + v.phase * Math.PI * 2;
      const r = v.spot.r * (0.55 + 0.35 * Math.sin(a * 0.7 + v.phase * 5));
      v.g.position.set(
        v.spot.x + Math.cos(a) * r - cx,
        bob,
        v.spot.z + Math.sin(a) * r - cz
      );
      v.g.rotation.y = -a + Math.PI / 2;
    } else if (v.kind === 'road' && v.road) {
      v.phase = (v.phase + v.speed * 0.016) % 1;
      const sPar = v.phase < 0.5 ? v.phase * 2 : (1 - v.phase) * 2;
      const [px, pz, ang] = polyAt(v.road, sPar);
      v.g.position.set(
        px + Math.cos(ang) * (v.side ?? 0) - cx,
        bob,
        pz - Math.sin(ang) * (v.side ?? 0) - cz
      );
      v.g.rotation.y = ang + (v.phase < 0.5 ? 0 : Math.PI);
    }
  }
}
