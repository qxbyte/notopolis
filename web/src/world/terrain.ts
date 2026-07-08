/**
 * world/terrain.ts
 * 地形网格：顶点位移 + 顶点色
 * 算法与参数值与雏形 buildTerrain 段完全一致，只做模块化移植。
 */

import * as THREE from 'three';
import { fbm } from '../util/noise';
import { polyDist, lakeShapeR } from '../util/poly';
import type { WorldParams } from './params';

/**
 * terrainH — 世界坐标 (x, z) 处的地形高度。
 * 单独导出，供植被（F 后续任务）采样地高。
 */
export function terrainH(x: number, z: number, p: WorldParams): number {
  const { cityHalfW, cityHalfD, RIVER_W, cosM, sinM, canalPts, lakes } = p;
  const maxHalf = Math.max(cityHalfW, cityHalfD);

  // 城区留平地（矩形软边）
  const dx = Math.max(0, Math.abs(x) - (cityHalfW + 8));
  const dz = Math.max(0, Math.abs(z) - (cityHalfD + 8));
  const cityDist = Math.hypot(dx, dz);
  const open = Math.min(1, cityDist / 26);

  // 起伏丘陵（托底：任何洼地不低于 -0.5，保证河岸永远高于水面）
  let h = Math.max(-0.5, (fbm(x * 0.02, z * 0.02) - 0.32) * 6 * open);

  // 山脉带（方向由世界种子决定）
  const mProj = x * cosM + z * sinM;
  const mBand = Math.min(1, Math.max(0, (mProj - (maxHalf + 55)) / 90));
  if (mBand > 0) h += Math.pow(fbm(x * 0.013 + 5, z * 0.013), 2.2) * 74 * mBand;

  // 河道下切（渐变到固定河床深度）
  const rd = p.riverDist(x, z);
  if (rd < RIVER_W + 7) {
    const s = 1 - rd / (RIVER_W + 7);
    h = h * (1 - s) - 5 * s;
  }

  // 野外湖泊下切 / 尽头湖浅盆（不规则岸线）
  for (const lk of lakes) {
    const dx2 = x - lk.x, dz2 = z - lk.z;
    const d = Math.hypot(dx2, dz2);
    if (d < lk.r * 1.15 + 8) {
      const rEff = lakeShapeR(lk.seed, lk.r, Math.atan2(dz2, dx2));
      if (d < rEff + 8) {
        const s = 1 - Math.max(0, d - rEff) / 8;
        h = lk.city ? h * (1 - s) - 1.4 * s : h * (1 - s) - 3.2 * s;
      }
    }
  }

  // 运河沟槽（支流经过处下切出浅河道）
  const cd = polyDist(x, z, canalPts);
  if (cd < 6) h = Math.min(h, -0.9 + (cd / 6) * 1.1);

  return h;
}

export function buildTerrain(scene: THREE.Scene, p: WorldParams): void {
  const { T, cityHalfW, cityHalfD, RIVER_W, lakes, canalPts } = p;

  const seg = 170;
  const geo = new THREE.PlaneGeometry(T * 2, T * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors: number[] = [];

  const grass = new THREE.Color(0xb8b45e);
  const meadow = new THREE.Color(0x9da84e);
  const rock = new THREE.Color(0x8f887a);
  const snow = new THREE.Color(0xf2f6f8);
  const sand = new THREE.Color(0xcdb478);
  const lawnA = new THREE.Color(0x58a83a); // 城区草坪双色条纹 A
  const lawnB = new THREE.Color(0x69bc48); // 城区草坪双色条纹 B

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainH(x, z, p);
    pos.setY(i, h);

    const c = new THREE.Color();
    const patch = fbm(x * 0.05 + 71, z * 0.05 + 23);
    c.copy(grass).lerp(meadow, patch);

    // 城区周边：部落冲突式饱和草坪 + 修剪条纹
    if (Math.abs(x) < cityHalfW + 42 && Math.abs(z) < cityHalfD + 42 && h < 3) {
      c.lerp(((Math.floor(x / 3.5) + Math.floor(z / 3.5)) & 1) === 0 ? lawnB : lawnA, 0.8);
    }

    if (p.riverDist(x, z) < RIVER_W + 4) c.lerp(sand, 0.55);

    for (const lk of lakes) {
      const dx2 = x - lk.x, dz2 = z - lk.z;
      const d = Math.hypot(dx2, dz2);
      if (
        d < lk.r * 1.15 + 4 &&
        d < lakeShapeR(lk.seed, lk.r, Math.atan2(dz2, dx2)) + 4
      ) {
        c.lerp(sand, 0.6);
      }
    }

    if (polyDist(x, z, canalPts) < 3.2) c.lerp(sand, 0.5);
    if (h > 10) c.lerp(rock, Math.min(1, (h - 10) / 12));
    if (h > 30) c.lerp(snow, Math.min(1, (h - 30) / 14));

    colors.push(c.r, c.g, c.b);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  terrain.receiveShadow = true;
  scene.add(terrain);
}
