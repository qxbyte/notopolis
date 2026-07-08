/**
 * agents/vehicles.ts
 * 交通工具（汽车、自行车、火车、飞机、帆船、快艇）的生成与动画。
 * 参数值与 prototype/public/index.html「交通工具」段严格一致。
 */

import * as THREE from 'three';
import { polyAt } from '../util/poly';
import { lightGreen } from '../city/roads';
import type { RoadWithPts, TrafficLight } from '../city/roads';
import type { WorldParams } from '../world/params';

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface CarState {
  g: THREE.Group;
  road: RoadWithPts;
  phase: number;
  speed: number;
  lane: number;
}

export interface BikeState {
  g: THREE.Group;
  road: RoadWithPts;
  phase: number;
  speed: number;
}

export interface VehiclesResult {
  cars: CarState[];
  bikes: BikeState[];
  train: THREE.Group[];
  plane: THREE.Group;
  boat: THREE.Group;
  speedboat: THREE.Group;
  railPts: [number, number][];
  segLens: number[];
  railTotal: number;
  worldParams: WorldParams;
}

export interface SpawnVehiclesOpts {
  roads: RoadWithPts[];
  trafficLights: TrafficLight[];
  cityHalfW: number;
  cityHalfD: number;
  cx: number;
  cz: number;
  worldParams: WorldParams;
}

// --------------------------------------------------------------------------
// 颜色
// --------------------------------------------------------------------------

const carColors = [0xd94848, 0x3e6b9e, 0xd08f2e, 0x4fa8a0, 0xf2f2f2, 0x8e5a9e];

// --------------------------------------------------------------------------
// 内部工具
// --------------------------------------------------------------------------

function mat(color: number, opts?: { side?: THREE.Side }): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

// --------------------------------------------------------------------------
// makeCar
// --------------------------------------------------------------------------

function makeCar(type: 'bus' | 'car', color: number): THREE.Group {
  const g = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10);

  function addWheels(zs: number[], xs: number[]): void {
    for (const z of zs) {
      for (const x of xs) {
        const w = new THREE.Mesh(wheelGeo, mat(0x2e3238));
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.16, z);
        g.add(w);
      }
    }
  }

  if (type === 'bus') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 2.6), mat(color));
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);

    const win = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 1.9), mat(0xbfe0ea));
    win.position.y = 0.72;
    g.add(win);

    addWheels([-0.9, 0, 0.9], [-0.42, 0.42]);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 1.5), mat(color));
    body.position.y = 0.38;
    body.castShadow = true;
    g.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.32, 0.75), mat(0xbfe0ea));
    cabin.position.set(0, 0.7, -0.1);
    g.add(cabin);

    addWheels([-0.5, 0.5], [-0.38, 0.38]);
  }

  return g;
}

// --------------------------------------------------------------------------
// makeTrainUnit
// --------------------------------------------------------------------------

function makeTrainUnit(isEngine: boolean, color: number): THREE.Group {
  const g = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10);

  const bodyLen = isEngine ? 1.9 : 1.7;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, bodyLen), mat(color));
  body.position.y = 0.6;
  body.castShadow = true;
  g.add(body);

  if (isEngine) {
    // nose 颜色硬编码 0x3a4048，不随车身主色（与原型一致）
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10), mat(0x3a4048));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.55, 1.2);
    g.add(nose);

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 8), mat(0x2e3238));
    stack.position.set(0, 1.15, 1.35);
    g.add(stack);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.7), mat(color));
    cab.position.set(0, 1.15, -0.4);
    g.add(cab);
  } else {
    const winStrip = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.25, 1.3), mat(0xbfe0ea));
    winStrip.position.y = 0.8;
    g.add(winStrip);
  }

  // 车轮
  for (const z of [-0.5, 0.5]) {
    for (const x of [-0.4, 0.4]) {
      const w = new THREE.Mesh(wheelGeo, mat(0x2e3238));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.16, z);
      g.add(w);
    }
  }

  return g;
}

// --------------------------------------------------------------------------
// spawnVehicles
// --------------------------------------------------------------------------

export function spawnVehicles(scene: THREE.Scene, opts: SpawnVehiclesOpts): VehiclesResult {
  const { roads, cityHalfW, cityHalfD, cx, cz, worldParams } = opts;
  const cars: CarState[] = [];
  const bikes: BikeState[] = [];

  // ---- 汽车 ----
  const carRoads = roads.filter(r =>
    r.kind !== 'street' &&
    Math.hypot(r.points[1][0] - r.points[0][0], r.points[1][1] - r.points[0][1]) > 8
  );
  carRoads.forEach((r, i) => {
    const n = 1 + (i % 2);
    for (let k = 0; k < n && cars.length < 10; k++) {
      const isBus = (i + k) % 4 === 0;
      const g = makeCar(isBus ? 'bus' : 'car', carColors[(i * 2 + k) % carColors.length]);
      scene.add(g);
      cars.push({
        g,
        road: r,
        phase: (i * 0.31 + k * 0.5) % 1,
        speed: isBus ? 0.028 : 0.045 + (k % 3) * 0.01,
        lane: k % 2 === 0 ? 0.55 : -0.55,
      });
    }
  });

  // ---- 自行车 ----
  roads
    .filter(r =>
      r.kind === 'street' &&
      Math.hypot(r.points[1][0] - r.points[0][0], r.points[1][1] - r.points[0][1]) > 5
    )
    .slice(0, 6)
    .forEach((r, i) => {
      const bg = new THREE.Group();

      // 车架
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), mat(0xd94848));
      frame.position.y = 0.35;
      bg.add(frame);

      // 车轮
      const wGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10);
      for (const z of [-0.3, 0.3]) {
        const w = new THREE.Mesh(wGeo, mat(0x2e3238));
        w.rotation.z = Math.PI / 2;
        w.position.set(0, 0.2, z);
        bg.add(w);
      }

      // 骑手
      const riderColors = [0x3e6b9e, 0x4f8a3f, 0xd08f2e];
      const rider = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.15, 0.45, 8),
        mat(riderColors[i % 3])
      );
      rider.position.y = 0.65;
      bg.add(rider);

      const rHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0xe8c8a0));
      rHead.position.y = 0.98;
      bg.add(rHead);

      scene.add(bg);
      bikes.push({ g: bg, road: r, phase: (i * 0.4) % 1, speed: 0.08 + (i % 3) * 0.02 });
    });

  // ---- 铁路 ----
  const railM = 9;
  const railPts: [number, number][] = [
    [-cityHalfW - railM, -cityHalfD - railM],
    [ cityHalfW + railM, -cityHalfD - railM],
    [ cityHalfW + railM,  cityHalfD + railM],
    [-cityHalfW - railM,  cityHalfD + railM],
  ];
  const segLens = railPts.map((p, i) => {
    const q = railPts[(i + 1) % 4];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const railTotal = segLens.reduce((a, b) => a + b, 0);

  // 路基 + 双轨网格
  railPts.forEach((p, i) => {
    const q = railPts[(i + 1) % 4];
    const len = segLens[i];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const mid: [number, number] = [(p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - cz];

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(len + 1.2, 0.1, 1.2),
      mat(0x9a8f7c)
    );
    base.position.set(mid[0], 0.08, mid[1]);
    base.rotation.y = -ang;
    scene.add(base);

    for (const off of [-0.28, 0.28]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(len + 1.2, 0.06, 0.08),
        mat(0x555a60)
      );
      rail.position.set(
        mid[0] - Math.sin(ang) * off,
        0.16,
        mid[1] + Math.cos(ang) * off
      );
      rail.rotation.y = -ang;
      scene.add(rail);
    }
  });

  // ---- 火车 ----
  const train: THREE.Group[] = [
    makeTrainUnit(true, 0xc0453a),
    makeTrainUnit(false, 0x3e6b9e),
    makeTrainUnit(false, 0x4f8a3f),
  ];
  for (const u of train) scene.add(u);

  // ---- 飞机 ----
  const planeG = new THREE.Group();
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8), mat(0xf2f2f2));
  fus.rotation.x = Math.PI / 2;
  planeG.add(fus);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 0.5), mat(0xd94848));
  wing.position.set(0, 0.05, 0.2);
  planeG.add(wing);

  const tailW = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.35), mat(0xd94848));
  tailW.position.set(0, 0.1, -1);
  planeG.add(tailW);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.4), mat(0xd94848));
  fin.position.set(0, 0.3, -1);
  planeG.add(fin);

  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), mat(0x2e3238));
  prop.position.set(0, 0, 1.15);
  planeG.add(prop);
  planeG.userData.prop = prop;

  scene.add(planeG);

  // ---- 帆船 boat ----
  const boatG = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 2.6), mat(0x7a5c3e));
  hull.position.y = 0.1;
  boatG.add(hull);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), mat(0x5c4630));
  mast.position.y = 1;
  boatG.add(mast);

  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.1),
    new THREE.MeshLambertMaterial({ color: 0xf0ead8, side: THREE.DoubleSide })
  );
  sail.position.set(0.02, 1.05, 0);
  sail.rotation.y = Math.PI / 2;
  boatG.add(sail);

  scene.add(boatG);

  // ---- 快艇 speedboat ----
  const sbG = new THREE.Group();
  const sbHull = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 1.8), mat(0xf2f2f2));
  sbHull.position.y = 0.12;
  sbG.add(sbHull);

  const sbStripe = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.1, 1.2), mat(0xd94848));
  sbStripe.position.y = 0.25;
  sbG.add(sbStripe);

  const sbShield = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.06), mat(0xbfe0ea));
  sbShield.position.set(0, 0.4, 0.5);
  sbG.add(sbShield);

  scene.add(sbG);

  return {
    cars,
    bikes,
    train,
    plane: planeG,
    boat: boatG,
    speedboat: sbG,
    railPts,
    segLens,
    railTotal,
    worldParams,
  };
}

// --------------------------------------------------------------------------
// railAt（内部辅助，暴露供 update 使用）
// --------------------------------------------------------------------------

function railAt(
  s: number,
  railPts: [number, number][],
  segLens: number[],
  railTotal: number
): [number, number] {
  s = ((s % railTotal) + railTotal) % railTotal;
  for (let i = 0; i < 4; i++) {
    if (s <= segLens[i]) {
      const p = railPts[i], q = railPts[(i + 1) % 4];
      const f = s / segLens[i];
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    }
    s -= segLens[i];
  }
  return railPts[0];
}

// --------------------------------------------------------------------------
// updateVehicles
// --------------------------------------------------------------------------

export function updateVehicles(
  result: VehiclesResult,
  t: number,
  cx: number,
  cz: number
): void {
  const { cars, bikes, train, plane, boat, speedboat, railPts, segLens, railTotal, worldParams } = result;

  // ---- 汽车（红灯停车 + polyAt + 车道偏移 + 朝向）----
  for (const c2 of cars) {
    const sNow = c2.phase < 0.5 ? c2.phase * 2 : (1 - c2.phase) * 2;
    const dirSign = c2.phase < 0.5 ? 1 : -1;
    let halted = false;
    for (const st of c2.road.stops ?? []) {
      const ahead = (st.s - sNow) * dirSign * c2.road.total;
      if (
        ahead > 0.3 && ahead < 2.4 &&
        !lightGreen(st.light, c2.road.kind === 'main' ? 'main' : 'avenue', t)
      ) {
        halted = true;
        break;
      }
    }
    if (!halted) c2.phase = (c2.phase + c2.speed * 0.016) % 1;
    const sPar = c2.phase < 0.5 ? c2.phase * 2 : (1 - c2.phase) * 2;
    const [px, pz, ang] = polyAt(c2.road, sPar);
    c2.g.position.set(
      px + Math.cos(ang) * c2.lane - cx,
      0.6,
      pz - Math.sin(ang) * c2.lane - cz
    );
    c2.g.rotation.y = ang + (c2.phase < 0.5 ? 0 : Math.PI);
  }

  // ---- 自行车 ----
  for (const bk of bikes) {
    bk.phase = (bk.phase + bk.speed * 0.016) % 1;
    const sPar = bk.phase < 0.5 ? bk.phase * 2 : (1 - bk.phase) * 2;
    const [px, pz, ang] = polyAt(bk.road, sPar);
    bk.g.position.set(px - cx, 0.58, pz - cz);
    bk.g.rotation.y = ang + (bk.phase < 0.5 ? 0 : Math.PI);
  }

  // ---- 火车（s0=t*5，间隔 2.4）----
  const s0 = t * 5;
  train.forEach((u, i) => {
    const [x, z] = railAt(s0 - i * 2.4, railPts, segLens, railTotal);
    const [x2, z2] = railAt(s0 - i * 2.4 + 0.6, railPts, segLens, railTotal);
    u.position.set(x, 0.2, z);
    u.rotation.y = Math.atan2(x2 - x, z2 - z);
  });

  // ---- 飞机（a=t*0.1，R=worldR*1.6，倾斜 0.22）----
  const a = t * 0.1;
  const R = worldParams.worldR * 1.6;
  plane.position.set(Math.cos(a) * R, 46 + Math.sin(t * 0.5) * 2, Math.sin(a) * R);
  plane.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), 0.22);
  plane.userData.prop.rotation.z = t * 20;

  // ---- 帆船（bv 正向）----
  const { riverWorld, T } = worldParams;
  const bv = ((t * 2.2) % (T * 1.2)) - T * 0.6;
  const [bx1, bz1] = riverWorld(bv);
  const [bx2, bz2] = riverWorld(bv + 1);
  boat.position.set(bx1, -0.55, bz1);
  boat.rotation.y = Math.atan2(bx2 - bx1, bz2 - bz1);

  // ---- 快艇（sv 逆向）----
  const sv = T * 0.6 - ((t * 7) % (T * 1.2));
  const [sx1, sz1] = riverWorld(sv);
  const [sx2, sz2] = riverWorld(sv - 1);
  speedboat.position.set(sx1, -0.5, sz1);
  speedboat.rotation.y = Math.atan2(sx2 - sx1, sz2 - sz1);
}
