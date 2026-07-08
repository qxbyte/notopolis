/**
 * city/roads.ts
 * 道路预处理、红绿灯逻辑、道路网格与红绿灯网格构建。
 */

import * as THREE from 'three';
import { SoftBox } from '../scene/softbox';
import type { CityModel, Road } from '@shared/types';
import { rng0 } from '../util/seed';
import { buildPolyline, segHit } from '../util/poly';

// --------------------------------------------------------------------------
// 类型导出
// --------------------------------------------------------------------------

export interface TrafficStop {
  s: number;
  light: TrafficLight;
  axis: 'main' | 'avenue';
}

export interface TrafficLight {
  x: number;
  z: number;
  off: number;
  mats: { r: THREE.MeshBasicMaterial; y: THREE.MeshBasicMaterial; g: THREE.MeshBasicMaterial } | null;
}

export type RoadWithPts = Road & {
  pts: [number, number][];
  lens: number[];
  total: number;
  stops?: TrafficStop[];
};

// --------------------------------------------------------------------------
// 纯函数：prepareRoads
// --------------------------------------------------------------------------

/**
 * 对 city.roads 做预处理，返回带 pts/lens/total 的新数组。
 * street 类型道路做蜿蜒化处理，main/avenue 保留直线两端点。
 * pts 坐标是原始世界坐标（不减 cx/cz），渲染时再减。
 */
export function prepareRoads(city: CityModel, cx: number, cz: number): RoadWithPts[] {
  void cx; void cz; // pts 用原始坐标，cx/cz 渲染时减
  const result: RoadWithPts[] = [];

  for (const r of city.roads) {
    const a: [number, number] = r.points[0];
    const b: [number, number] = r.points[1];

    let pts: [number, number][];

    if (r.kind === 'street') {
      const rc = rng0('curve:' + r.points.join(','));
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;

      const k1 = 2 + Math.floor(rc() * 2);
      const k2 = 4 + Math.floor(rc() * 3);
      const A1 = Math.min(4.5, len * 0.16) * (0.6 + rc() * 0.8) * (rc() < 0.5 ? -1 : 1);
      const A2 = Math.min(2.2, len * 0.07) * (0.5 + rc());
      const p1 = rc() * Math.PI * 2, p2 = rc() * Math.PI * 2;

      const N = 18;
      pts = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const env = Math.sin(Math.PI * u);
        const off = (A1 * Math.sin(u * Math.PI * k1 + p1) + A2 * Math.sin(u * Math.PI * k2 + p2)) * env;
        pts.push([a[0] + dx * u + nx * off, a[1] + dz * u + nz * off]);
      }
    } else {
      // main / avenue: 直线两端点
      pts = [a, b];
    }

    const poly = buildPolyline(pts);
    const road: RoadWithPts = {
      ...r,
      pts: poly.pts,
      lens: poly.lens,
      total: poly.total,
      stops: [],
    };
    result.push(road);
  }

  return result;
}

// --------------------------------------------------------------------------
// 纯函数：computeTrafficLights
// --------------------------------------------------------------------------

/**
 * 用 segHit 找 main × avenue 交点，生成红绿灯并挂 stops 到对应道路。
 * 最多 8 个灯。
 */
export function computeTrafficLights(roads: RoadWithPts[]): TrafficLight[] {
  const trafficLights: TrafficLight[] = [];

  const mainRoads = roads.filter(r => r.kind === 'main');
  const avenueRoads = roads.filter(r => r.kind === 'avenue');

  for (const mr of mainRoads) {
    if (trafficLights.length >= 8) break;
    for (const ar of avenueRoads) {
      if (trafficLights.length >= 8) break;
      const hit = segHit(mr.points[0], mr.points[1], ar.points[0], ar.points[1]);
      if (!hit) continue;
      const light: TrafficLight = {
        x: hit[0],
        z: hit[1],
        off: trafficLights.length * 2.3,
        mats: null,
      };
      trafficLights.push(light);
      mr.stops!.push({ s: hit[2], light, axis: 'main' });
      ar.stops!.push({ s: hit[3], light, axis: 'avenue' });
    }
  }

  return trafficLights;
}

// --------------------------------------------------------------------------
// 纯函数：lightGreen
// --------------------------------------------------------------------------

/**
 * 判断某方向的信号灯是否为绿。8 秒周期。
 * main: c < 3.6
 * avenue: c >= 4 && c < 7.6
 */
export function lightGreen(light: TrafficLight, axis: 'main' | 'avenue', t: number): boolean {
  const c = (t + light.off) % 8;
  if (axis === 'main') return c < 3.6;
  return c >= 4 && c < 7.6;
}

// --------------------------------------------------------------------------
// THREE 场景：buildRoadMeshes
// --------------------------------------------------------------------------

export function buildRoadMeshes(
  scene: THREE.Scene,
  roads: RoadWithPts[],
  cx: number,
  cz: number
): void {
  for (const r of roads) {
    if (r.total < 0.5) continue;
    const w = r.kind === 'main' ? 1.9 : r.kind === 'avenue' ? 1.4 : 0.55;
    const mat = new THREE.MeshLambertMaterial({
      color: r.kind === 'street' ? 0xa89a7c : 0xcbbd97,
    });
    const y = r.kind === 'street' ? 0.56 : 0.585;

    for (let i = 0; i < r.pts.length - 1; i++) {
      const ax = r.pts[i][0] - cx, az = r.pts[i][1] - cz;
      const bx = r.pts[i + 1][0] - cx, bz = r.pts[i + 1][1] - cz;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const geo = new SoftBox(len + w * 0.5, 0.07, w);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      scene.add(mesh);
    }
  }
}

// --------------------------------------------------------------------------
// THREE 场景：buildTrafficLightMeshes
// --------------------------------------------------------------------------

export function buildTrafficLightMeshes(
  scene: THREE.Scene,
  lights: TrafficLight[],
  cx: number,
  cz: number
): void {
  for (const light of lights) {
    const px = light.x - cx + 1.3;
    const pz = light.z - cz + 1.3;

    // 立杆
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 2.4, 8),
      new THREE.MeshLambertMaterial({ color: 0x4a5058 })
    );
    pole.position.set(px, 1.55, pz);
    scene.add(pole);

    // 灯箱
    const head = new THREE.Mesh(
      new SoftBox(0.28, 0.78, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x2e3238 })
    );
    head.position.set(px, 2.95, pz);
    scene.add(head);

    // 三色灯 ['r', 'y', 'g']
    const keys = ['r', 'y', 'g'] as const;
    const mats = {} as { r: THREE.MeshBasicMaterial; y: THREE.MeshBasicMaterial; g: THREE.MeshBasicMaterial };
    for (let i = 0; i < 3; i++) {
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), lampMat);
      lamp.position.set(px, 3.18 - i * 0.23, pz + 0.12);
      scene.add(lamp);
      mats[keys[i]] = lampMat;
    }
    light.mats = mats;
  }
}

// --------------------------------------------------------------------------
// THREE 场景：updateTrafficLights
// --------------------------------------------------------------------------

export function updateTrafficLights(lights: TrafficLight[], t: number): void {
  for (const light of lights) {
    if (!light.mats) continue;
    const c = (t + light.off) % 8;
    const yellow = (c >= 3.6 && c < 4) || c >= 7.6;
    const mainGo = c < 3.6;
    light.mats.g.color.setHex(mainGo && !yellow ? 0x3fd45a : 0x1e3a24);
    light.mats.r.color.setHex(!mainGo && !yellow ? 0xe23b3b : 0x3a1e1e);
    light.mats.y.color.setHex(yellow ? 0xf2c53a : 0x3a331e);
  }
}
