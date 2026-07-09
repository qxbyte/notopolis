/**
 * render2d/dynamic.ts — 动态层 2D 涂鸦化
 *
 * 绘制市民（火柴人）、车辆（俯视涂鸦小车）、红绿灯状态、
 * 火车、帆船/快艇、飞机。
 *
 * 不导入 THREE 或 agents/vehicles/city/roads（有 THREE 依赖）；
 * 所有纯逻辑在此文件内重新实现。
 */

import type { CityModel } from '@shared/types';
import type { WorldParams } from '../world/params';
import type { HitItem } from './hit';
import { rng0 } from '../util/seed';
import { buildPolyline, polyAt, segHit } from '../util/poly';
import { PAPER, dashedPath } from './sketch';

/* ============================================================
   内部类型
   ============================================================ */

interface DynTrafficLight {
  x: number;
  z: number;
  off: number;
}

interface DynTrafficStop {
  s: number;
  light: DynTrafficLight;
  axis: 'main' | 'avenue';
}

interface DynRoad {
  pts: [number, number][];
  lens: number[];
  total: number;
  kind: 'main' | 'avenue';
  stops: DynTrafficStop[];
}

type CitizenKind = 'road' | 'idle';

interface CitizenState {
  kind: CitizenKind;
  age: 'kid' | 'adult' | 'elder';
  female: boolean;
  skinTone: string;
  clothColor: string;
  phase: number;
  speed: number;
  /** road 市民 */
  road?: DynRoad;
  side?: number;
  /** idle 市民 */
  spot?: { x: number; z: number; r: number };
}

interface CarState {
  road: DynRoad;
  phase0: number;   // 初始相位（确定性）
  speed: number;
  lane: number;
  isBus: boolean;
  bodyColor: string;
}

/* ============================================================
   DynamicLayer 公开接口
   ============================================================ */

export interface DynamicLayer {
  draw(ctx: CanvasRenderingContext2D, t: number): void;
  hitables(): HitItem[];
  /** 测试辅助：市民总数 */
  citizenCount(): number;
  /** 测试辅助：返回第 i 辆车当前 s 值（phase 映射后的归一化弧长） */
  debugCarS(i: number): number;
  /** 测试辅助：返回所有市民的 kind */
  debugCitizenKinds(): CitizenKind[];
}

/* ============================================================
   调色板工具
   ============================================================ */

const SKIN_TONES = ['#f5d5b0', '#e8c09a', '#d9a878', '#b5885c', '#8a5c3a', '#6b4530'];
const CLOTH_PALETTE = ['#c0453a', '#3e6b9e', '#4f8a3f', '#d08f2e', '#8e5a9e', '#4fa8a0', '#9e4f6b', '#6b6b9e'];
const CAR_COLORS_HEX = ['#d94848', '#3e6b9e', '#d08f2e', '#4fa8a0', '#f2f2f2', '#8e5a9e'];

/* ============================================================
   lightGreen（本地实现，不依赖 roads.ts）
   ============================================================ */

function lightGreen(light: DynTrafficLight, axis: 'main' | 'avenue', t: number): boolean {
  const c = (t + light.off) % 8;
  if (axis === 'main') return c < 3.6;
  return c >= 4 && c < 7.6;
}

/* ============================================================
   computeTrafficLights（本地实现，不依赖 roads.ts）
   ============================================================ */

function computeDynTrafficLights(roads: DynRoad[]): DynTrafficLight[] {
  const lights: DynTrafficLight[] = [];
  const mainRoads = roads.filter(r => r.kind === 'main');
  const avenueRoads = roads.filter(r => r.kind === 'avenue');

  for (const mr of mainRoads) {
    if (lights.length >= 8) break;
    for (const ar of avenueRoads) {
      if (lights.length >= 8) break;
      const hit = segHit(mr.pts[0], mr.pts[1], ar.pts[0], ar.pts[1]);
      if (!hit) continue;
      const light: DynTrafficLight = {
        x: hit[0],
        z: hit[1],
        off: lights.length * 2.3,
      };
      lights.push(light);
      mr.stops.push({ s: hit[2], light, axis: 'main' });
      ar.stops.push({ s: hit[3], light, axis: 'avenue' });
    }
  }
  return lights;
}

/* ============================================================
   railAt（环线位置，本地实现）
   ============================================================ */

function railAt(
  s: number,
  railPts: [number, number][],
  segLens: number[],
  railTotal: number,
): [number, number, number] {
  s = ((s % railTotal) + railTotal) % railTotal;
  for (let i = 0; i < 4; i++) {
    if (s <= segLens[i] || i === 3) {
      const p = railPts[i];
      const q = railPts[(i + 1) % 4];
      const f = segLens[i] > 0 ? Math.min(1, s / segLens[i]) : 0;
      const x = p[0] + (q[0] - p[0]) * f;
      const z = p[1] + (q[1] - p[1]) * f;
      const ang = Math.atan2(q[0] - p[0], q[1] - p[1]);
      return [x, z, ang];
    }
    s -= segLens[i];
  }
  return [railPts[0][0], railPts[0][1], 0];
}

/* ============================================================
   drawCitizen — 世界坐标系火柴人
   ============================================================ */

function drawCitizen(
  ctx: CanvasRenderingContext2D,
  c: CitizenState,
  x: number,
  z: number,
  ang: number,
  t: number,
): void {
  const isKid = c.age === 'kid';
  const isElder = c.age === 'elder';
  const scale = isKid ? 0.6 : 1;

  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);
  if (scale !== 1) ctx.scale(scale, scale);

  const lw = 0.1;
  const ink = PAPER.ink;

  // 走路摆动
  const isIdle = c.kind === 'idle';
  const swing = isIdle
    ? Math.sin(t * 4 + c.phase * Math.PI * 2) * 0.25
    : Math.sin(t * 8 + c.phase * Math.PI * 2) * 0.6;

  // 头
  const headR = 0.28;
  (ctx as unknown as Record<string, unknown>).fillStyle = c.skinTone;
  (ctx as unknown as Record<string, unknown>).strokeStyle = ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, -1.1, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 老人白发点
  if (isElder) {
    (ctx as unknown as Record<string, unknown>).fillStyle = '#e8e8e8';
    ctx.beginPath();
    ctx.arc(0, -1.35, 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // 身体
  (ctx as unknown as Record<string, unknown>).strokeStyle = ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = lw;
  if (c.female) {
    // 女 = 三角裙摆线
    ctx.beginPath();
    ctx.moveTo(0, -0.82);
    ctx.lineTo(0, -0.3);
    ctx.stroke();
    // 裙摆三角
    (ctx as unknown as Record<string, unknown>).strokeStyle = c.clothColor;
    ctx.beginPath();
    ctx.moveTo(0, -0.3);
    ctx.lineTo(-0.35, 0.25);
    ctx.lineTo(0.35, 0.25);
    ctx.closePath();
    ctx.stroke();
  } else {
    // 男 = 直线身体
    (ctx as unknown as Record<string, unknown>).strokeStyle = c.clothColor;
    ctx.beginPath();
    ctx.moveTo(0, -0.82);
    ctx.lineTo(0, -0.1);
    ctx.stroke();
  }

  // 四肢（ink 颜色）
  (ctx as unknown as Record<string, unknown>).strokeStyle = ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = lw;

  // 手臂
  const armSwing = swing * 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -0.7);
  ctx.lineTo(-0.4, -0.4 + armSwing * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -0.7);
  ctx.lineTo(0.4, -0.4 - armSwing * 0.3);
  ctx.stroke();

  // 腿
  ctx.beginPath();
  ctx.moveTo(0, -0.1);
  ctx.lineTo(-0.3, 0.45 + Math.abs(swing) * 0.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -0.1);
  ctx.lineTo(0.3, 0.45 - Math.abs(swing) * 0.15);
  ctx.stroke();

  // 老人拐杖
  if (isElder) {
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#6f5a3e';
    ctx.beginPath();
    ctx.moveTo(0.38, -0.3);
    ctx.lineTo(0.42, 0.55);
    ctx.stroke();
  }

  ctx.restore();
}

/* ============================================================
   drawCar — 俯视涂鸦小车
   ============================================================ */

function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  ang: number,
  color: string,
  isBus: boolean,
): void {
  const w = isBus ? 0.9 : 0.75;
  const h = isBus ? 2.6 : 1.5;
  const ink = PAPER.ink;

  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  // 车身圆角矩形（pastel 填充 + ink 轮廓）
  const rx = w / 2, rz = h / 2;
  (ctx as unknown as Record<string, unknown>).fillStyle = color;
  (ctx as unknown as Record<string, unknown>).strokeStyle = ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
  ctx.beginPath();
  ctx.roundRect(-rx, -rz, w, h, 0.18);
  ctx.fill();
  ctx.stroke();

  // 前挡风短线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.65, -rz + 0.28);
  ctx.lineTo(rx * 0.65, -rz + 0.28);
  ctx.stroke();

  // bus 车窗排线
  if (isBus) {
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.06;
    for (let wi = 0; wi < 3; wi++) {
      const wz = -rz + 0.8 + wi * 0.55;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.6, wz);
      ctx.lineTo(rx * 0.6, wz);
      ctx.stroke();
    }
  }

  // 4 个轮子点
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.ink;
  const wheelPositions: [number, number][] = [
    [-rx + 0.08, -rz + 0.25],
    [ rx - 0.08, -rz + 0.25],
    [-rx + 0.08,  rz - 0.25],
    [ rx - 0.08,  rz - 0.25],
  ];
  if (isBus) {
    // 多加两个中间轮
    wheelPositions.push(
      [-rx + 0.08, 0],
      [ rx - 0.08, 0],
    );
  }
  for (const [wx, wz] of wheelPositions) {
    ctx.beginPath();
    ctx.arc(wx, wz, 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ============================================================
   drawTrafficLight — 路口三色点
   ============================================================ */

function drawTrafficLightDot(
  ctx: CanvasRenderingContext2D,
  light: DynTrafficLight,
  t: number,
): void {
  const px = light.x + 1.3;
  const pz = light.z + 1.3;
  const r = 0.25;

  const c = (t + light.off) % 8;
  const yellow = (c >= 3.6 && c < 4) || c >= 7.6;
  const mainGo = c < 3.6;

  // 颜色: red / yellow / green
  const states = [
    { fill: !mainGo && !yellow ? '#e23b3b' : undefined },  // red
    { fill: yellow ? '#f2c53a' : undefined },               // yellow
    { fill: mainGo && !yellow ? '#3fd45a' : undefined },   // green
  ];

  for (let i = 0; i < 3; i++) {
    const dotZ = pz + i * 0.65;
    if (states[i].fill) {
      // 实心亮色
      (ctx as unknown as Record<string, unknown>).fillStyle = states[i].fill!;
      ctx.beginPath();
      ctx.arc(px, dotZ, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 空心
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(px, dotZ, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/* ============================================================
   drawTrain — 车头+车厢圆角矩形，烟囱冒烟
   ============================================================ */

function drawTrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  ang: number,
  isEngine: boolean,
  t: number,
): void {
  const w = 0.9;
  const h = isEngine ? 1.9 : 1.7;
  const color = isEngine ? '#c0453a' : '#3e6b9e';

  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  (ctx as unknown as Record<string, unknown>).fillStyle = color;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.1;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 0.15);
  ctx.fill();
  ctx.stroke();

  // 车窗
  if (!isEngine) {
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, -h * 0.3);
    ctx.lineTo(w * 0.4, -h * 0.3);
    ctx.stroke();
  }

  // 烟囱冒烟（机车）
  if (isEngine) {
    const puff1 = Math.sin(t * 3) * 0.3;
    const puff2 = Math.sin(t * 3 + 1.5) * 0.25;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0.05, -h / 2 - 0.4 + puff1, 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.05 + puff2 * 0.3, -h / 2 - 0.75 + puff2, 0.12, 0, Math.PI * 2);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  ctx.restore();
}

/* ============================================================
   drawBoat — 帆船
   ============================================================ */

function drawBoat(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  ang: number,
): void {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  // 船身弧线
  (ctx as unknown as Record<string, unknown>).strokeStyle = '#7a5c3e';
  (ctx as unknown as Record<string, unknown>).fillStyle = '#9a7a5e';
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-0.7, -1.3);
  ctx.quadraticCurveTo(-0.9, 0, -0.7, 1.3);
  ctx.lineTo(0.7, 1.3);
  ctx.quadraticCurveTo(0.9, 0, 0.7, -1.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 三角帆
  (ctx as unknown as Record<string, unknown>).fillStyle = '#f0ead8';
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(0, -1.0);
  ctx.lineTo(0, 0.6);
  ctx.lineTo(0.8, -0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/* ============================================================
   drawSpeedboat — 快艇
   ============================================================ */

function drawSpeedboat(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  ang: number,
): void {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  // 梭形船身
  (ctx as unknown as Record<string, unknown>).fillStyle = '#f2f2f2';
  (ctx as unknown as Record<string, unknown>).strokeStyle = '#d94848';
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(0, -1.0);
  ctx.quadraticCurveTo(0.45, -0.2, 0.4, 0.8);
  ctx.lineTo(-0.4, 0.8);
  ctx.quadraticCurveTo(-0.45, -0.2, 0, -1.0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 尾迹两短线
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.water;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.07;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-0.25, 0.9);
  ctx.lineTo(-0.45, 1.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.25, 0.9);
  ctx.lineTo(0.45, 1.8);
  ctx.stroke();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  ctx.restore();
}

/* ============================================================
   drawPlane — 小十字剪影 + 虚线尾迹弧
   ============================================================ */

function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  ang: number,
  t: number,
  worldR: number,
): void {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  // 机身
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
  ctx.beginPath();
  ctx.moveTo(0, -1.2);
  ctx.lineTo(0, 1.2);
  ctx.stroke();

  // 机翼
  ctx.beginPath();
  ctx.moveTo(-1.6, 0.2);
  ctx.lineTo(1.6, 0.2);
  ctx.stroke();

  // 尾翼
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-0.65, 0.9);
  ctx.lineTo(0.65, 0.9);
  ctx.stroke();

  ctx.restore();

  // 虚线尾迹弧（在世界坐标系中绘制）
  const R = worldR * 1.6;
  const a = t * 0.1;
  const trailPts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const aa = a - i * 0.06;
    trailPts.push([Math.cos(aa) * R, Math.sin(aa) * R]);
  }
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
  dashedPath(ctx, trailPts, [4, 5.3]); // dashedPath 内部按 sketch SCALE(0.15) 换算 → 实际约 0.6/0.8 世界单位
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
}

/* ============================================================
   createDynamicLayer — 工厂函数
   ============================================================ */

export function createDynamicLayer(
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
  parks: { x: number; z: number; r: number }[],
): DynamicLayer {
  const rng = rng0(wsPrefix + ':dyn0');

  // ---- 路网预处理（只取 main + avenue）----
  const dynRoads: DynRoad[] = [];
  for (const r of city.roads) {
    if (r.kind !== 'main' && r.kind !== 'avenue') continue;
    const pts: [number, number][] = [r.points[0], r.points[1]];
    const poly = buildPolyline(pts);
    dynRoads.push({
      pts: poly.pts,
      lens: poly.lens,
      total: poly.total,
      kind: r.kind,
      stops: [],
    });
  }

  // ---- 红绿灯 ----
  const trafficLights = computeDynTrafficLights(dynRoads);

  // ---- 市民 ----
  const nV = Math.min(34, Math.max(6, city.activeCount7d * 2));
  const citizens: CitizenState[] = [];

  // walkables = main + avenue 路（已在 dynRoads 中）
  const walkables = dynRoads;
  // 60% 路网 / 40% 公园（有公园时）
  const parkSpots = parks.length > 0 ? parks : [];

  for (let i = 0; i < nV; i++) {
    const crng = rng0(wsPrefix + ':villager:' + i);

    // 年龄
    const roll = crng();
    const age: 'kid' | 'adult' | 'elder' =
      roll < 0.18 ? 'kid' : roll < 0.82 ? 'adult' : 'elder';
    const female = crng() < 0.5;
    const skinTone = SKIN_TONES[Math.floor(crng() * SKIN_TONES.length)];
    const clothColor = CLOTH_PALETTE[Math.floor(crng() * CLOTH_PALETTE.length)];

    const ageMul = age === 'elder' ? 0.5 : age === 'kid' ? 1.35 : 1;

    // 60/40 路网/公园分配（当有公园时）
    const useIdle = parkSpots.length > 0 && i % 5 >= 3;

    let kind: CitizenKind;
    let road: DynRoad | undefined;
    let spot: { x: number; z: number; r: number } | undefined;
    let side: number | undefined;

    if (useIdle && parkSpots.length > 0) {
      kind = 'idle';
      spot = parkSpots[i % parkSpots.length];
    } else if (walkables.length > 0) {
      kind = 'road';
      road = walkables[i % walkables.length];
      side = i % 2 ? 0.8 : -0.8;
    } else {
      // 无路可走：idle 于原点
      kind = 'idle';
      spot = { x: 0, z: 0, r: 5 };
    }

    citizens.push({
      kind,
      age,
      female,
      skinTone,
      clothColor,
      phase: (i * 0.37) % 1,
      speed: kind === 'idle'
        ? (0.13 + (i % 3) * 0.05) * ageMul
        : (0.02 + (i % 5) * 0.006) * ageMul,
      road,
      side,
      spot,
    });
  }

  // ---- 车辆 ----
  const cars: CarState[] = [];
  const carRoads = dynRoads.filter(r => r.total > 8);
  for (let i = 0; i < carRoads.length && cars.length < 10; i++) {
    const n = 1 + (i % 2);
    for (let k = 0; k < n && cars.length < 10; k++) {
      const isBus = (i + k) % 4 === 0;
      const bodyColor = CAR_COLORS_HEX[(i * 2 + k) % CAR_COLORS_HEX.length];
      cars.push({
        road: carRoads[i],
        phase0: (i * 0.31 + k * 0.5) % 1,
        speed: isBus ? 0.028 : 0.045 + (k % 3) * 0.01,
        lane: k % 2 === 0 ? 0.55 : -0.55,
        isBus,
        bodyColor,
      });
    }
  }

  // ---- 火车环线 ----
  const railM = 9;
  const railPts: [number, number][] = [
    [-params.cityHalfW - railM, -params.cityHalfD - railM],
    [ params.cityHalfW + railM, -params.cityHalfD - railM],
    [ params.cityHalfW + railM,  params.cityHalfD + railM],
    [-params.cityHalfW - railM,  params.cityHalfD + railM],
  ];
  const segLens = railPts.map((p, i) => {
    const q = railPts[(i + 1) % 4];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const railTotal = segLens.reduce((a, b) => a + b, 0);

  // ---- 可变状态（红灯停车）----
  // carTravels[i] 存储第 i 辆车的 travel time（只有不在红灯时才推进）
  // 初始化为 phase0 对应的 travel 值
  const carTravels: number[] = cars.map(c => c.phase0);
  let lastDrawT = -1;

  /* ----------------------------------------------------------
     draw
     ---------------------------------------------------------- */

  function draw(ctx: CanvasRenderingContext2D, t: number): void {
    // 推进 carTravels（红灯停车逻辑）
    const dt = lastDrawT < 0 ? 0 : t - lastDrawT;
    lastDrawT = t;

    if (dt > 0 && dt < 2) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        const phase = carTravels[i];
        const sNow = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        const dirSign = phase < 0.5 ? 1 : -1;
        let halted = false;
        for (const st of c.road.stops) {
          const ahead = (st.s - sNow) * dirSign * c.road.total;
          if (ahead > 0.3 && ahead < 2.4 && !lightGreen(st.light, st.axis, t)) {
            halted = true;
            break;
          }
        }
        if (!halted) {
          carTravels[i] = (carTravels[i] + c.speed * dt) % 1;
        }
      }
    }

    // ---- 市民 ----
    for (let i = 0; i < citizens.length; i++) {
      const c = citizens[i];
      let cx: number, cz: number, ang: number;

      if (c.kind === 'road' && c.road) {
        const phase = (c.phase + c.speed * t) % 1;
        const sPar = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        const [px, pz, roadAng] = polyAt(c.road, sPar);
        const side = c.side ?? 0;
        cx = px + Math.cos(roadAng) * side;
        cz = pz - Math.sin(roadAng) * side;
        ang = roadAng + (phase < 0.5 ? 0 : Math.PI);
      } else if (c.spot) {
        const a = t * c.speed + c.phase * Math.PI * 2;
        const r = c.spot.r * (0.55 + 0.35 * Math.sin(a * 0.7 + c.phase * 5));
        cx = c.spot.x + Math.cos(a) * r;
        cz = c.spot.z + Math.sin(a) * r;
        ang = -a + Math.PI / 2;
      } else {
        continue;
      }

      drawCitizen(ctx, c, cx, cz, ang, t);
    }

    // ---- 车辆 ----
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const phase = carTravels[i];
      const sPar = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const [px, pz, roadAng] = polyAt(c.road, sPar);
      const carX = px + Math.cos(roadAng) * c.lane;
      const carZ = pz - Math.sin(roadAng) * c.lane;
      const carAng = roadAng + (phase < 0.5 ? 0 : Math.PI);

      drawCar(ctx, carX, carZ, carAng, c.bodyColor, c.isBus);
    }

    // ---- 火车 ----
    const s0 = t * 5;
    for (let i = 0; i < 3; i++) {
      const [tx, tz, tang] = railAt(s0 - i * 2.4, railPts, segLens, railTotal);
      // 朝向：看下一点
      const [tx2, tz2] = railAt(s0 - i * 2.4 + 0.6, railPts, segLens, railTotal);
      const tAng = Math.atan2(tx2 - tx, tz2 - tz);
      void tang; // railAt 已返回 ang，这里用上面计算的 tAng
      drawTrain(ctx, tx, tz, tAng, i === 0, t);
    }

    // ---- 帆船 ----
    const { riverWorld, T } = params;
    const bv = ((t * 2.2) % (T * 1.2)) - T * 0.6;
    const [bx1, bz1] = riverWorld(bv);
    const [bx2, bz2] = riverWorld(bv + 1);
    const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
    drawBoat(ctx, bx1, bz1, boatAng);

    // ---- 快艇 ----
    const sv = T * 0.6 - ((t * 7) % (T * 1.2));
    const [sx1, sz1] = riverWorld(sv);
    const [sx2, sz2] = riverWorld(sv - 1);
    const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
    drawSpeedboat(ctx, sx1, sz1, sbAng);

    // ---- 飞机 ----
    const a = t * 0.1;
    const R = params.worldR * 1.6;
    const planeX = Math.cos(a) * R;
    const planeZ = Math.sin(a) * R;
    const planeAng = Math.atan2(-Math.sin(a), Math.cos(a));
    drawPlane(ctx, planeX, planeZ, planeAng, t, params.worldR);

    // ---- 红绿灯状态点 ----
    for (const light of trafficLights) {
      drawTrafficLightDot(ctx, light, t);
    }
  }

  /* ----------------------------------------------------------
     debugCarS — 返回第 i 辆车当前 s 值（归一化弧长）
     ---------------------------------------------------------- */

  function debugCarS(i: number): number {
    if (i < 0 || i >= carTravels.length) return 0;
    const phase = carTravels[i];
    return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  }

  return {
    draw,
    hitables: () => [],
    citizenCount: () => nV,
    debugCarS,
    debugCitizenKinds: () => citizens.map(c => c.kind),
  };
}
