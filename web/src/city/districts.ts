/**
 * city/districts.ts
 * 区块多边形地板、道路装饰（公园、池塘、灌木花丛）。
 */

import * as THREE from 'three';
import type { CityModel, District } from '@shared/types';
import { hashStr, rng0 } from '../util/seed';
import { irregularDisc, irregularRing } from '../world/water';

// --------------------------------------------------------------------------
// 内部材质工厂
// --------------------------------------------------------------------------

function waterMat(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: 0x2fa4e8,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
}

function sandMat(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: 0xd9c9a0, side: THREE.DoubleSide });
}

// --------------------------------------------------------------------------
// 主函数
// --------------------------------------------------------------------------

export function buildDistricts(
  scene: THREE.Scene,
  city: CityModel,
  cx: number,
  cz: number,
  wsPrefix: string
): { plates: THREE.Mesh[]; parks: { x: number; z: number; r: number }[]; idleSpots: { x: number; z: number; r: number }[] } {
  const plates: THREE.Mesh[] = [];
  const parks: { x: number; z: number; r: number }[] = [];
  const idleSpots: { x: number; z: number; r: number }[] = [];

  for (const d of city.districts) {
    // ---- polygon 地块 ----
    const hue = 0.21 + ((hashStr(d.dir || 'root') % 60) - 30) / 520;
    const shape = new THREE.Shape(d.polygon.map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    const plate = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.5, 0.52) })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.receiveShadow = true;
    plate.userData = { type: 'district', dir: d.dir, district: d };
    scene.add(plate);
    plates.push(plate);

    // rim: 省略（polygon 形状使均匀 rim 实现复杂，选择省略以保持代码简洁）

    // ---- 公园/广场 ----
    buildPark(scene, d, cx, cz, wsPrefix, parks);

    // ---- 居民区小池塘 ----
    buildPond(scene, d, cx, cz, wsPrefix);

    // ---- 灌木花丛 ----
    buildShrubs(scene, d, cx, cz, wsPrefix);

    // ---- idleSpots：isCivic 建筑（区府广场）----
    for (const b of d.buildings) {
      if (b.isCivic) {
        idleSpots.push({ x: b.x, z: b.z, r: 2.4 });
      }
    }
  }

  // idleSpots = 公园 parks + 区府广场
  idleSpots.push(...parks);

  return { plates, parks, idleSpots };
}

// --------------------------------------------------------------------------
// 内部：公园
// --------------------------------------------------------------------------

function buildPark(
  scene: THREE.Scene,
  d: District,
  cx: number,
  cz: number,
  wsPrefix: string,
  parks: { x: number; z: number; r: number }[]
): void {
  const rnd = rng0(wsPrefix + ':park:' + d.dir);
  let bestDist = 0;
  let px = d.x, pz = d.z;

  for (let i = 0; i < 14; i++) {
    const tx = d.x + 2 + rnd() * (d.width - 4);
    const tz = d.z + 2 + rnd() * (d.depth - 4);
    let minD = 1e9;
    for (const b of d.buildings) {
      const dd = Math.hypot(b.x - tx, b.z - tz);
      if (dd < minD) minD = dd;
    }
    if (minD > bestDist) {
      bestDist = minD;
      px = tx; pz = tz;
    }
  }

  if (bestDist < 2.2) return;

  // 草坪
  const lawn = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.1, 20),
    new THREE.MeshLambertMaterial({ color: 0x6fc452 })
  );
  lawn.position.set(px - cx, 0.56, pz - cz);
  scene.add(lawn);

  // 小水池
  const pond = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 0.06, 14),
    new THREE.MeshLambertMaterial({ color: 0x45aed4 })
  );
  pond.position.set(px - cx + 0.9, 0.62, pz - cz - 0.5);
  scene.add(pond);

  // 2 棵树
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5c3e });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3a8c28 });
  for (let t = 0; t < 2; t++) {
    const tx2 = px - cx + (t === 0 ? -1.2 : 0.3);
    const tz2 = pz - cz + (t === 0 ? 0.5 : -1.0);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 5), trunkMat);
    trunk.position.set(tx2, 0.86, tz2);
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.55, 7, 6), crownMat);
    crown.position.set(tx2, 1.55, tz2);
    scene.add(crown);
  }

  // 长椅
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.12, 0.25),
    new THREE.MeshLambertMaterial({ color: 0x8a6a45 })
  );
  bench.position.set(px - cx - 0.4, 0.62, pz - cz + 1.0);
  scene.add(bench);

  parks.push({ x: px, z: pz, r: 1.6 });
}

// --------------------------------------------------------------------------
// 内部：居民区小池塘
// --------------------------------------------------------------------------

function buildPond(
  scene: THREE.Scene,
  d: District,
  cx: number,
  cz: number,
  wsPrefix: string
): void {
  const rnd = rng0(wsPrefix + ':deco:' + d.dir);
  if (d.buildings.length < 5 || rnd() >= 0.75) return;

  let bestDist = 0;
  let best: [number, number] = [d.x + d.width / 2, d.z + d.depth / 2];

  for (let i = 0; i < 16; i++) {
    const tx = d.x + 3 + rnd() * (d.width - 6);
    const tz = d.z + 3 + rnd() * (d.depth - 6);
    let minD = 1e9;
    for (const b of d.buildings) {
      const dd = Math.hypot(b.x - tx, b.z - tz);
      if (dd < minD) minD = dd;
    }
    if (minD > bestDist) {
      bestDist = minD;
      best = [tx, tz];
    }
  }

  if (bestDist < 2.6) return;

  const r = 1.2 + rnd() * 1.2;
  const pSeed = hashStr('pond:' + d.dir) % 23;

  const ring = irregularRing(pSeed, r, 0.55, 0, sandMat());
  ring.position.set(best[0] - cx, 0.575, best[1] - cz);
  scene.add(ring);

  const disc = irregularDisc(pSeed, r, 0, waterMat(), 0.99);
  disc.position.set(best[0] - cx, 0.61, best[1] - cz);
  scene.add(disc);
}

// --------------------------------------------------------------------------
// 内部：灌木花丛
// --------------------------------------------------------------------------

function buildShrubs(
  scene: THREE.Scene,
  d: District,
  cx: number,
  cz: number,
  wsPrefix: string
): void {
  // 与雏形差异：灌木使用独立 rng 种子（':shrub:'）而非与池塘共享 ':deco:' 流——主动解耦，视觉等价
  const rndS = rng0(wsPrefix + ':shrub:' + d.dir);

  const nB = 3 + Math.floor(rndS() * 4);
  const flowerColors = [0xe84a6f, 0xf2c53a, 0xffffff, 0xb46fe0];

  for (let b = 0; b < nB; b++) {
    const bx = d.x + 1.5 + rndS() * (d.width - 3);
    const bz = d.z + 1.5 + rndS() * (d.depth - 3);

    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 + rndS() * 0.3, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x3f9138 })
    );
    bush.scale.y = 0.7;
    bush.castShadow = true;
    bush.position.set(bx - cx, 0.62, bz - cz);
    scene.add(bush);

    if (rndS() < 0.7) {
      for (let f = 0; f < 4; f++) {
        const flower = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 5, 5),
          new THREE.MeshLambertMaterial({ color: flowerColors[Math.floor(rndS() * 4)] })
        );
        flower.position.set(
          bx - cx + (rndS() - 0.5) * 1.8,
          0.6,
          bz - cz + (rndS() - 0.5) * 1.8
        );
        scene.add(flower);
      }
    }
  }
}
