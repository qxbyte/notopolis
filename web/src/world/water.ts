/**
 * world/water.ts
 * 水系：大河 ribbon、湖泊不规则水面/沙岸、运河、桥梁。
 * 算法与参数值与雏形 buildRiver/irregularDisc/irregularRing/buildCanal/buildBridges 段完全一致。
 */

import * as THREE from 'three';
import { SoftBox } from '../scene/softbox';
import { lakeShapeR, segHit } from '../util/poly';
import type { WorldParams } from './params';
import type { RoadWithPts } from '../city/roads';

// --------------------------------------------------------------------------
// 内部材质工厂
// --------------------------------------------------------------------------

function waterMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: 0x2fa4e8,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
}

function sandMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: 0xd9c9a0, side: THREE.DoubleSide });
}

// --------------------------------------------------------------------------
// 内部：ribbon 构建器（buildCanal 专用）
// --------------------------------------------------------------------------

function ribbon(
  pts: [number, number][],
  ys: number[],
  width: number,
  dy: number,
  mat: THREE.Material
): THREE.Mesh {
  const verts: number[] = [], idx: number[] = [];
  pts.forEach((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const o = pts[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dz = q[1] - o[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    const y = ys[i] + dy;
    verts.push(
      p[0] + (nx * width) / 2, y, p[1] + (nz * width) / 2,
      p[0] - (nx * width) / 2, y, p[1] - (nz * width) / 2
    );
    if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// --------------------------------------------------------------------------
// 不规则水面构建器
// --------------------------------------------------------------------------

export function irregularDisc(
  seed: number,
  r: number,
  y: number,
  mat: THREE.Material,
  scaleR = 1
): THREE.Mesh {
  const segs = 44;
  const verts = [0, y, 0];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const rr = lakeShapeR(seed, r, th) * scaleR;
    verts.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
    if (i) idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function irregularRing(
  seed: number,
  r: number,
  w: number,
  y: number,
  mat: THREE.Material
): THREE.Mesh {
  const segs = 44;
  const verts: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const rr = lakeShapeR(seed, r, th);
    verts.push(
      Math.cos(th) * rr, y, Math.sin(th) * rr,
      Math.cos(th) * (rr + w), y, Math.sin(th) * (rr + w)
    );
    if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// --------------------------------------------------------------------------
// 公开 API
// --------------------------------------------------------------------------

export function buildWater(scene: THREE.Scene, p: WorldParams): void {
  const { T, RIVER_W, canalPts, canalY, canalEndY, lakes } = p;
  const waterMat = waterMaterial();
  const sandMat = sandMaterial();

  // 河水（沿世界种子决定的方位铺设）
  (function buildRiver() {
    const verts: number[] = [], idx: number[] = [];
    const W2 = (RIVER_W + 4) / 2; // 盖过河道斜坡，不留干缝
    let n = 0;
    for (let v = -T * 1.45; v <= T * 1.45; v += 6) {
      const u = p.riverU(v);
      verts.push(
        (u - W2) * p.cosR - v * p.sinR, -0.7, (u - W2) * p.sinR + v * p.cosR,
        (u + W2) * p.cosR - v * p.sinR, -0.7, (u + W2) * p.sinR + v * p.cosR
      );
      if (n) idx.push(2 * n - 2, 2 * n - 1, 2 * n, 2 * n - 1, 2 * n + 1, 2 * n);
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({
      color: 0x2fa4e8, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    })));
  })();

  // 湖泊水面（不规则岸线）
  for (const lk of lakes) {
    const water = irregularDisc(lk.seed, lk.r, 0, waterMat, 0.99);
    water.position.set(lk.x, lk.city ? canalEndY + 0.01 : -0.7, lk.z);
    scene.add(water);
    if (lk.city) {
      const rim = irregularRing(lk.seed, lk.r, 1.2, 0, sandMat);
      rim.position.set(lk.x, canalEndY - 0.02, lk.z);
      scene.add(rim);
    }
  }

  // 运河：大河的支流，蜿蜒穿过居民区
  (function buildCanal() {
    // 沙岸从离开大河河岸后才开始铺，避免横穿大河
    scene.add(ribbon(canalPts.slice(5), canalY.slice(5), 4.2, -0.03, sandMat));
    scene.add(ribbon(canalPts, canalY, 2.6, 0, waterMat));
  })();
}

export function buildBridges(
  scene: THREE.Scene,
  p: WorldParams,
  roads: RoadWithPts[],
  cx: number,
  cz: number
): void {
  const { canalPts, canalY } = p;
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x9a6f45 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x6f5636 });
  let count = 0;

  for (const r of roads) {
    if (count >= 14) break;
    for (let i = 0; i < r.pts.length - 1 && count < 14; i++) {
      const a: [number, number] = [r.pts[i][0] - cx, r.pts[i][1] - cz];
      const b: [number, number] = [r.pts[i + 1][0] - cx, r.pts[i + 1][1] - cz];
      for (let j = 5; j < canalPts.length - 1; j++) {
        const hit = segHit(a, b, canalPts[j], canalPts[j + 1]);
        if (!hit) continue;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const w = r.kind === 'main' ? 2.6 : r.kind === 'avenue' ? 2.1 : 1.3;
        const yDeck = canalY[j] + 0.12;

        const deck = new THREE.Mesh(new SoftBox(5.4, 0.16, w), deckMat);
        deck.position.set(hit[0], yDeck, hit[1]);
        deck.rotation.y = -ang;
        deck.castShadow = true;
        scene.add(deck);

        for (const s of [-1, 1] as const) {
          const rail = new THREE.Mesh(new SoftBox(5.4, 0.32, 0.09), railMat);
          rail.position.set(
            hit[0] + -Math.sin(ang) * s * (w / 2),
            yDeck + 0.24,
            hit[1] + Math.cos(ang) * s * (w / 2)
          );
          rail.rotation.y = -ang;
          scene.add(rail);
        }
        count++;
        break;
      }
    }
  }
}
