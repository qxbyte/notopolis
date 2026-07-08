/**
 * world/vegetation.ts
 * 野外植被与云层——从 prototype/public/index.html 行 472–544 移植。
 */

import * as THREE from 'three';
import { rng0 } from '../util/seed';
import type { WorldParams } from './params';
import { terrainH } from './terrain';
import { polyDist } from '../util/poly';

export interface CloudState {
  g: THREE.Group;
  v: number;
}

export function buildWilds(scene: THREE.Scene, p: WorldParams, wsPrefix: string): void {
  const rnd = rng0(wsPrefix + ':wilds');
  const { RIVER_W, lakes, canalPts, cityHalfW, cityHalfD, T } = p;

  const treeGeoA = new THREE.ConeGeometry(1, 2.6, 7);
  const treeGeoB = new THREE.SphereGeometry(1.1, 7, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1, 5);
  const matPine = new THREE.MeshLambertMaterial({ color: 0x2f8a3c });
  const matOak = new THREE.MeshLambertMaterial({ color: 0x4fae3f });
  const matTrunk = new THREE.MeshLambertMaterial({ color: 0x7a5c38 });

  function plantTree(x: number, z: number, s: number): void {
    const h = terrainH(x, z, p);
    if (h > 13 || h < -0.4) return;
    if (p.riverDist(x, z) < RIVER_W + 4) return;
    for (const lk of lakes) {
      if (Math.hypot(x - lk.x, z - lk.z) < lk.r + 2) return;
    }
    if (polyDist(x, z, canalPts) < 4) return;
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, matTrunk);
    trunk.position.y = 0.5;
    const crown = new THREE.Mesh(
      rnd() < 0.65 ? treeGeoA : treeGeoB,
      rnd() < 0.65 ? matPine : matOak
    );
    crown.position.y = 2;
    crown.castShadow = s > 1.3;
    g.add(trunk, crown);
    g.position.set(x, h, z);
    g.scale.setScalar(s);
    scene.add(g);
  }

  // 散生树 150 棵
  for (let i = 0; i < 150; i++) {
    const x = (rnd() - 0.5) * T * 1.9;
    const z = (rnd() - 0.5) * T * 1.9;
    if (Math.abs(x) < cityHalfW + 12 && Math.abs(z) < cityHalfD + 12) continue;
    plantTree(x, z, 0.8 + rnd() * 1.4);
  }

  // 树林团簇 14 组
  for (let gi = 0; gi < 14; gi++) {
    const gx = (rnd() - 0.5) * T * 1.7;
    const gz = (rnd() - 0.5) * T * 1.7;
    if (Math.abs(gx) < cityHalfW + 18 && Math.abs(gz) < cityHalfD + 18) continue;
    if (terrainH(gx, gz, p) > 11) continue;
    const n = 6 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = rnd() * 8;
      plantTree(gx + Math.cos(a) * rr, gz + Math.sin(a) * rr, 0.9 + rnd() * 1.3);
    }
  }

  // 岩石 40 块
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8f8a7c, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * T * 1.8;
    const z = (rnd() - 0.5) * T * 1.8;
    if (Math.abs(x) < cityHalfW + 10 && Math.abs(z) < cityHalfD + 10) continue;
    const h = terrainH(x, z, p);
    if (h < -1) continue;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, h + 0.3, z);
    rock.scale.set(0.6 + rnd() * 2, 0.5 + rnd() * 1.2, 0.6 + rnd() * 2);
    rock.rotation.y = rnd() * Math.PI;
    scene.add(rock);
  }
}

export function buildClouds(
  scene: THREE.Scene,
  p: WorldParams,
  wsPrefix: string
): CloudState[] {
  const rnd = rng0(wsPrefix + ':clouds');
  const { T } = p;
  const clouds: CloudState[] = [];
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
  });

  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 4, 7, 6), mat);
      puff.position.set(j * 4.5 - n * 2, rnd() * 1.5, rnd() * 3);
      puff.scale.y = 0.55;
      g.add(puff);
    }
    g.position.set(
      (rnd() - 0.5) * T * 1.6,
      55 + rnd() * 30,
      (rnd() - 0.5) * T * 1.6
    );
    scene.add(g);
    clouds.push({ g, v: 0.6 + rnd() * 0.8 });
  }

  return clouds;
}

export function updateClouds(clouds: CloudState[], _t: number, T: number): void {
  for (const c of clouds) {
    c.g.position.x += c.v * 0.016;
    if (c.g.position.x > T * 1.1) c.g.position.x = -T * 1.1;
  }
}
