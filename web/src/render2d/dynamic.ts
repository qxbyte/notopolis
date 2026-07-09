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
import { buildTransport, RailEdge } from './transport';

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

/** 火车状态（可变） */
interface TrainState {
  edgeIdx: number;     // 当前 RailEdge 索引
  s: number;           // 沿边的弧长位置 0..edge.total
  dir: 1 | -1;         // 移动方向
  fromNode: number;    // 来自哪个区节点（避免立即 U 形转弯）
  stopTimer: number;   // 停站倒计时（秒）
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
  /** 测试辅助：返回第 i 辆火车当前世界坐标，若不存在返回 null */
  debugTrainPos(i: number): { x: number; z: number } | null;
  /** 测试辅助：返回渡轮当前世界坐标，若不存在返回 null */
  debugFerryPos(): { x: number; z: number } | null;
  /** 测试辅助：返回帆船当前世界坐标（仅限最近一次 draw 后更新） */
  debugBoatPos(): { x: number; z: number } | null;
}

/* ============================================================
   调色板工具
   ============================================================ */

const SKIN_TONES = ['#f5d5b0', '#e8c09a', '#d9a878', '#b5885c', '#8a5c3a', '#6b4530'];
const CLOTH_PALETTE = ['#c0453a', '#3e6b9e', '#4f8a3f', '#d08f2e', '#8e5a9e', '#4fa8a0', '#9e4f6b', '#6b6b9e'];
const CAR_COLORS_HEX = ['#d94848', '#3e6b9e', '#d08f2e', '#4fa8a0', '#f2f2f2', '#8e5a9e'];

/** ping-pong 往返：将 t 映射到 [0, total]，无回卷瞬移 */
function pingPong(t: number, total: number): number {
  const cycle = total * 2;
  const p = ((t % cycle) + cycle) % cycle;
  return p < total ? p : cycle - p;
}

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
   隧道检测辅助
   ============================================================ */

function inTunnel(arcPos: number, edge: RailEdge): boolean {
  if (edge.total <= 0) return false;
  const sNorm = arcPos / edge.total;
  return edge.tunnels.some(([t1, t2]) => sNorm >= t1 && sNorm <= t2);
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
  const w = 1.53;               // 0.9 * 1.7
  const h = isEngine ? 3.23 : 2.89;  // 1.9*1.7 / 1.7*1.7
  const color = isEngine ? '#e05540' : '#5284c0';

  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(-ang);

  (ctx as unknown as Record<string, unknown>).fillStyle = color;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.22;
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
    ctx.arc(0.05, -h / 2 - 0.6 + puff1, 0.27, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.05 + puff2 * 0.45, -h / 2 - 1.125 + puff2, 0.18, 0, Math.PI * 2);
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

  // ---- 交通网络（铁路/机场/轮渡）----
  const net = buildTransport(city, params, wsPrefix);

  // ---- 火车：基于 MST 图行走 ----
  // 邻接表：节点（区索引）→ [{edgeIdx, otherNode}]
  const adjList = new Map<number, { edgeIdx: number; otherNode: number }[]>();

  if (net.rails.length > 0 && city.districts.length >= 2) {
    for (let ei = 0; ei < net.mstEdges.length; ei++) {
      const { from, to } = net.mstEdges[ei];
      if (!adjList.has(from)) adjList.set(from, []);
      if (!adjList.has(to)) adjList.set(to, []);
      adjList.get(from)!.push({ edgeIdx: ei, otherNode: to });
      adjList.get(to)!.push({ edgeIdx: ei, otherNode: from });
    }
  }

  // 初始化列车（数量 = clamp(floor(rails/2), 1, 4)，确定性分散）
  const trainStates: TrainState[] = [];
  const TRAIN_SPEED = 4.5;     // 世界单位/秒
  const TRAIN_STOP_TIME = 2.5; // 站停时间（秒）
  const CAR_SPACING = 2.5;     // 车厢间距（弧长）
  const N_CARS = 3;            // 车头 + 2节车厢

  if (adjList.size >= 2 && net.rails.length > 0) {
    const numTrains = Math.max(1, Math.min(4, Math.floor(net.rails.length / 2)));
    for (let i = 0; i < numTrains; i++) {
      const trainRng = rng0(wsPrefix + ':train:' + i);
      const edgeIdx = Math.floor(i * net.rails.length / numTrains);
      const edge = net.rails[edgeIdx];
      const mstEdge = net.mstEdges[edgeIdx];
      const s = trainRng() * edge.total * 0.8;
      const dir: 1 | -1 = trainRng() > 0.5 ? 1 : -1;
      trainStates.push({
        edgeIdx,
        s,
        dir,
        fromNode: mstEdge.from,
        stopTimer: 0,
      });
    }
  }

  // 可变状态
  const carTravels: number[] = cars.map(c => c.phase0);
  let lastDrawT = -1;

  // 火车可变状态（按 dt 更新）
  const trainMutable: TrainState[] = trainStates.map(s => ({ ...s }));

  // 当前帧的火车位置（用于 debugTrainPos）
  const trainPositions: { x: number; z: number }[] = [];

  /* ----------------------------------------------------------
     火车节点到达处理：选下一条边
     ---------------------------------------------------------- */

  function trainArriveNode(
    train: TrainState,
    arrivedNode: number,
  ): void {
    // 停站
    train.stopTimer = TRAIN_STOP_TIME;

    const adj = adjList.get(arrivedNode) ?? [];
    // 找不回头的边（otherNode != fromNode），按 edgeIdx 升序选最小
    const forward = adj.filter(a => a.otherNode !== train.fromNode);

    if (forward.length > 0) {
      // 有前进方向
      const next = forward.reduce((best, cur) => cur.edgeIdx < best.edgeIdx ? cur : best);
      train.edgeIdx = next.edgeIdx;
      train.fromNode = arrivedNode;
      train.dir = 1;
      train.s = 0;
    } else {
      // 叶节点：反向
      train.fromNode = arrivedNode;
      train.dir = -train.dir as 1 | -1;
      // 位置保持在边的端点
      const edge = net.rails[train.edgeIdx];
      train.s = train.dir === 1 ? 0 : edge.total;
    }
  }

  /* ----------------------------------------------------------
     draw
     ---------------------------------------------------------- */

  function draw(ctx: CanvasRenderingContext2D, t: number): void {
    const dt = lastDrawT < 0 ? 0 : t - lastDrawT;
    lastDrawT = t;

    // ---- 推进 carTravels（红灯停车逻辑）----
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

    // ---- 推进火车状态 ----
    if (dt > 0 && dt < 5) {
      for (const train of trainMutable) {
        if (train.stopTimer > 0) {
          train.stopTimer = Math.max(0, train.stopTimer - dt);
        } else {
          const edge = net.rails[train.edgeIdx];
          train.s += train.dir * TRAIN_SPEED * dt;

          if (train.s >= edge.total) {
            // 到达 to 节点
            train.s = edge.total;
            const arrivedNode = train.dir === 1
              ? net.mstEdges[train.edgeIdx].to
              : net.mstEdges[train.edgeIdx].from;
            trainArriveNode(train, arrivedNode);
          } else if (train.s <= 0) {
            // 到达 from 节点
            train.s = 0;
            // dir=-1 时 s 减到 0，到达 from 端
            const arrivedNode = train.dir === -1
              ? net.mstEdges[train.edgeIdx].from
              : net.mstEdges[train.edgeIdx].to;
            trainArriveNode(train, arrivedNode);
          }
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

    // ---- 火车（沿 MST 轨道行走）----
    // 清空位置缓存
    trainPositions.length = 0;

    for (let ti = 0; ti < trainMutable.length; ti++) {
      const train = trainMutable[ti];
      const edge = net.rails[train.edgeIdx];

      // 记录车头位置（用于 debug）
      let headRecorded = false;

      for (let j = 0; j < N_CARS; j++) {
        // 车厢在车头后方
        const carArcPos = train.s - j * CAR_SPACING * train.dir;
        const clampedPos = Math.max(0, Math.min(edge.total, carArcPos));

        // 隧道内不绘制
        if (inTunnel(clampedPos, edge)) continue;

        const sNorm = edge.total > 0 ? clampedPos / edge.total : 0;
        const [tx, tz, tang] = polyAt(edge, sNorm);

        // 朝向修正（沿行进方向）
        const lookAheadPos = Math.max(0, Math.min(edge.total, clampedPos + train.dir * 0.6));
        const lookNorm = edge.total > 0 ? lookAheadPos / edge.total : 0;
        const [tx2, tz2] = polyAt(edge, lookNorm);
        const tAng = train.dir === 1
          ? Math.atan2(tx2 - tx, tz2 - tz)
          : Math.atan2(tx - tx2, tz - tz2);
        void tang;

        if (!headRecorded && j === 0) {
          trainPositions.push({ x: tx, z: tz });
          headRecorded = true;
        }

        drawTrain(ctx, tx, tz, tAng, j === 0, t);
      }

      if (!headRecorded) {
        // 隧道中的火车，记录一个隐藏位置
        const sNorm = edge.total > 0 ? train.s / edge.total : 0;
        const [tx, tz] = polyAt(edge, Math.max(0, Math.min(1, sNorm)));
        trainPositions.push({ x: tx, z: tz });
      }
    }

    // ---- 帆船 / 快艇 — 按 waterStyle 分派 ----
    const waterStyle = params.waterStyle ?? 'river';

    if (waterStyle === 'frozen') {
      // 冻河：不出船
    } else if (waterStyle === 'sea' && params.seaData) {
      // 海：沿海岸线采样点巡航
      const coastPts = params.seaData.coastPts;
      const totalPts = coastPts.length - 1;
      if (totalPts < 1) {
        // 跳过
      } else {
        // 帆船：沿海岸往返
        const COAST_BOAT_SPEED = 0.35;  // points/秒
        const boatPosF = pingPong(t * COAST_BOAT_SPEED, totalPts);
        const ci1 = Math.min(Math.floor(boatPosF), totalPts - 1);
        const ci2 = Math.min(ci1 + 1, totalPts);
        const [bx1, bz1] = coastPts[ci1];
        const [bx2, bz2] = coastPts[ci2];
        const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
        const cosSide = Math.cos(params.seaData.sideAngle);
        const sinSide = Math.sin(params.seaData.sideAngle);
        const boatOffDist = 22;  // 固定偏移，不用 t*0.1 随机
        lastBoatPos = { x: bx1 + cosSide * boatOffDist, z: bz1 + sinSide * boatOffDist };
        drawBoat(ctx, bx1 + cosSide * boatOffDist, bz1 + sinSide * boatOffDist, boatAng);

        // 快艇
        const COAST_SB_SPEED = 0.28;
        const sbPosF = pingPong(t * COAST_SB_SPEED + totalPts * 0.5, totalPts);
        const ci3 = Math.min(Math.floor(sbPosF), totalPts - 1);
        const ci4 = Math.min(ci3 + 1, totalPts);
        const [sx1, sz1] = coastPts[ci3];
        const [sx2, sz2] = coastPts[ci4];
        const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
        drawSpeedboat(ctx, sx1 + cosSide * 35, sz1 + sinSide * 35, sbAng);
      }

      // 渡轮（harbor 的 ferry 是到岛屿的）
      if (net.ferry) {
        _drawFerry(ctx, t, net);
      }
    } else if (waterStyle === 'torrent') {
      // 激流：只出小舟（用 drawBoat 缩小）——在窄河上漂
      const { riverWorld: rw2, T: T2 } = params;
      const bv2 = pingPong(t * 2.0, T2 * 1.0) - T2 * 0.5;
      const [bx3, bz3] = rw2(bv2);
      const [bx4, bz4] = rw2(bv2 + 0.5);
      const boatAng2 = Math.atan2(bx4 - bx3, bz4 - bz3);
      lastBoatPos = { x: bx3, z: bz3 };
      ctx.save();
      ctx.translate(bx3, bz3);
      ctx.scale(0.6, 0.6);
      ctx.translate(-bx3, -bz3);
      drawBoat(ctx, bx3, bz3, boatAng2);
      ctx.restore();

      // 渡轮（torrent 两岸）
      if (net.ferry) {
        _drawFerry(ctx, t, net);
      }
    } else {
      // river（plains 默认）— pingPong 无瞬移
      const { riverWorld, T } = params;
      const BOAT_SPEED = 2.0;   // ≤ 2.5 单位/秒
      const bv = pingPong(t * BOAT_SPEED, T * 1.0) - T * 0.5;
      const [bx1, bz1] = riverWorld(bv);
      const [bx2, bz2] = riverWorld(bv + 0.5);
      const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
      lastBoatPos = { x: bx1, z: bz1 };
      drawBoat(ctx, bx1, bz1, boatAng);

      const SPEEDBOAT_SPEED = 2.5;  // ≤ 3 单位/秒
      const sv = pingPong(t * SPEEDBOAT_SPEED + T * 0.5, T * 1.0) - T * 0.5;
      const [sx1, sz1] = riverWorld(sv);
      const [sx2, sz2] = riverWorld(sv + 0.5);
      const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
      drawSpeedboat(ctx, sx1, sz1, sbAng);

      // 渡轮（river 两岸）
      if (net.ferry) {
        _drawFerry(ctx, t, net);
      }
    }

    // ---- 飞机 ----
    if (net.airport) {
      _drawAirportPlane(ctx, t, net, city, params);
    } else {
      // 无机场：保持原来的大圆环绕
      const a = t * 0.1;
      const R = params.worldR * 1.6;
      const planeX = Math.cos(a) * R;
      const planeZ = Math.sin(a) * R;
      const planeAng = Math.atan2(-Math.sin(a), Math.cos(a));
      drawPlane(ctx, planeX, planeZ, planeAng, t, params.worldR);
    }

    // ---- 红绿灯状态点 ----
    for (const light of trafficLights) {
      drawTrafficLightDot(ctx, light, t);
    }
  }

  /* ----------------------------------------------------------
     渡轮绘制辅助
     ---------------------------------------------------------- */

  // 渡轮当前位置缓存（用于 debug）
  let lastFerryPos: { x: number; z: number } | null = null;

  // 帆船当前位置缓存（用于 debug）
  let lastBoatPos: { x: number; z: number } | null = null;

  function _drawFerry(
    ctx: CanvasRenderingContext2D,
    t: number,
    net: ReturnType<typeof buildTransport>,
  ): void {
    const ferry = net.ferry!;
    const [d1, d2] = ferry.docks;
    const dx = d2.x - d1.x;
    const dz = d2.z - d1.z;
    const routeLen = Math.hypot(dx, dz);
    if (routeLen < 0.1) return;

    // period = 往返各 routeLen/3 秒 + 各端停 2 秒
    const travelTime = routeLen / 3;
    const period = travelTime * 2 + 4;

    const p = (t % period) / period;  // 0..1 in full period

    let fx: number, fz: number, fAng: number;

    // 将 period 分成 4 段：出发停留、前进、到达停留、返回
    const stopFrac = 2 / period;          // 两端各停 2 秒对应的 fraction
    const moveFrac = travelTime / period;  // 移动对应的 fraction

    // [0, stopFrac): dock1 停留
    // [stopFrac, stopFrac+moveFrac): dock1→dock2
    // [stopFrac+moveFrac, 2*stopFrac+moveFrac): dock2 停留
    // [2*stopFrac+moveFrac, 1): dock2→dock1

    if (p < stopFrac) {
      fx = d1.x; fz = d1.z;
      fAng = Math.atan2(dx, dz);
    } else if (p < stopFrac + moveFrac) {
      const moveP = (p - stopFrac) / moveFrac;
      fx = d1.x + dx * moveP;
      fz = d1.z + dz * moveP;
      fAng = Math.atan2(dx, dz);
    } else if (p < 2 * stopFrac + moveFrac) {
      fx = d2.x; fz = d2.z;
      fAng = Math.atan2(-dx, -dz);
    } else {
      const moveP = (p - (2 * stopFrac + moveFrac)) / moveFrac;
      fx = d2.x - dx * moveP;
      fz = d2.z - dz * moveP;
      fAng = Math.atan2(-dx, -dz);
    }

    lastFerryPos = { x: fx, z: fz };
    drawBoat(ctx, fx, fz, fAng);
  }

  /* ----------------------------------------------------------
     机场飞机绘制辅助
     ---------------------------------------------------------- */

  function _drawAirportPlane(
    ctx: CanvasRenderingContext2D,
    t: number,
    net: ReturnType<typeof buildTransport>,
    city: CityModel,
    params: WorldParams,
  ): void {
    const airport = net.airport!;
    const cosAng = Math.cos(airport.ang);
    const sinAng = Math.sin(airport.ang);
    const halfLen = airport.len / 2;  // 18

    // 跑道两端（世界坐标）
    const runwayEndA: [number, number] = [
      airport.x - cosAng * halfLen,
      airport.z - sinAng * halfLen,
    ];
    const runwayEndB: [number, number] = [
      airport.x + cosAng * halfLen,
      airport.z + sinAng * halfLen,
    ];

    // 停机坪中心（局部坐标转世界坐标）
    // 局部坐标系：沿跑道 = local X，垂直 = local Z
    // 世界坐标 = 旋转(ang) × 局部坐标 + 机场中心
    const apronWorldX = airport.x + cosAng * airport.apron.dx - sinAng * airport.apron.dz;
    const apronWorldZ = airport.z + sinAng * airport.apron.dx + cosAng * airport.apron.dz;

    // 目标区（第一个区中心，若无区则取原点）
    const targetDistrict = city.districts.length > 0 ? city.districts[0] : null;
    const targetX = targetDistrict ? targetDistrict.x + targetDistrict.width / 2 : 0;
    const targetZ = targetDistrict ? targetDistrict.z + targetDistrict.depth / 2 : 0;
    const CRUISE_R = 18;

    // 周期 60 秒
    const period = 60;
    const p = (t % period) / period;

    // 段时长（秒）→ 归一化比例
    const T_APRON  = 5 / period;   // 停机坪停留：[0, T_APRON)
    const T_TAXIAB = 5 / period;   // 滑跑 A→B：[T_APRON, T_APRON+T_TAXIAB)
    const T_CLIMB  = 8 / period;   // 爬升：[.., ..)
    const T_CRUISE = 25 / period;  // 巡航：[.., ..)
    const T_RETURN = 8 / period;   // 返航：[.., ..)
    // 剩余 9s = 降落滑跑 B→A

    const P1 = T_APRON;
    const P2 = P1 + T_TAXIAB;
    const P3 = P2 + T_CLIMB;
    const P4 = P3 + T_CRUISE;
    const P5 = P4 + T_RETURN;
    // P6 = 1.0

    // 巡航圆终点（ang=2π=0，即 ang=0 处）= (targetX + R, targetZ)
    const cruiseEndX = targetX + CRUISE_R;
    const cruiseEndZ = targetZ;

    let planeX: number, planeZ: number, planeAng: number, drawScale: number;

    if (p < P1) {
      // 停机坪停留
      planeX = apronWorldX;
      planeZ = apronWorldZ;
      planeAng = airport.ang;
      drawScale = 1.0;
    } else if (p < P2) {
      // 滑跑 A→B
      const pp = (p - P1) / T_TAXIAB;
      planeX = runwayEndA[0] + (runwayEndB[0] - runwayEndA[0]) * pp;
      planeZ = runwayEndA[1] + (runwayEndB[1] - runwayEndA[1]) * pp;
      planeAng = airport.ang;  // 沿跑道方向
      drawScale = 1.0;
    } else if (p < P3) {
      // 爬升：从跑道 B 端 → 巡航圆起点(cruiseEndX, cruiseEndZ)
      const pp = (p - P2) / T_CLIMB;
      const fromX = runwayEndB[0], fromZ = runwayEndB[1];
      const toX = cruiseEndX, toZ = cruiseEndZ;
      planeX = fromX + (toX - fromX) * pp;
      planeZ = fromZ + (toZ - fromZ) * pp;
      const dx = toX - fromX, dz = toZ - fromZ;
      // drawPlane 中 rotate(-ang) 后机身沿 z 轴，机头指向 -z
      // 飞机向 (dx, dz) 方向飞 → ang = atan2(dx, dz)
      planeAng = Math.atan2(dx, dz);
      drawScale = 1.0 + 0.5 * pp;  // 1.0 → 1.5（升高感）
    } else if (p < P4) {
      // 巡航：顺时针绕目标区（0 → 2π）
      const pp = (p - P3) / T_CRUISE;
      const circleAng = pp * Math.PI * 2;  // 0 → 2π
      planeX = targetX + Math.cos(circleAng) * CRUISE_R;
      planeZ = targetZ + Math.sin(circleAng) * CRUISE_R;
      // 顺时针切线方向 = (-sin, cos) → ang = atan2(-sinA, cosA)
      // 但 drawPlane rotate(-ang) 机头 -z：ang = atan2(-sinA, cosA) 使机头朝切线
      // 实际：飞机在 (cos(a), sin(a)) 处顺时针，切线 = (-sin(a), cos(a))
      // 要让飞机面向 (-sinA, cosA)：ang = atan2(-sinA, cosA)
      planeAng = Math.atan2(-Math.sin(circleAng), Math.cos(circleAng));
      drawScale = 1.5;
    } else if (p < P5) {
      // 返航：从巡航圆终点 → 跑道 B 端
      const pp = (p - P4) / T_RETURN;
      const fromX = cruiseEndX, fromZ = cruiseEndZ;
      const toX = runwayEndB[0], toZ = runwayEndB[1];
      planeX = fromX + (toX - fromX) * pp;
      planeZ = fromZ + (toZ - fromZ) * pp;
      const dx = toX - fromX, dz = toZ - fromZ;
      planeAng = Math.atan2(dx, dz);
      drawScale = 1.5 - 0.5 * pp;  // 1.5 → 1.0
    } else {
      // 降落滑跑 B→A（注意：降落从 B 到 A，朝向与起飞相反）
      const pp = (p - P5) / (1 - P5);
      planeX = runwayEndB[0] + (runwayEndA[0] - runwayEndB[0]) * pp;
      planeZ = runwayEndB[1] + (runwayEndA[1] - runwayEndB[1]) * pp;
      // 从 B 飞向 A，方向 = A - B
      const dx = runwayEndA[0] - runwayEndB[0];
      const dz = runwayEndA[1] - runwayEndB[1];
      planeAng = Math.atan2(dx, dz);
      drawScale = 1.0;
    }

    // 带缩放绘制飞机（scale 模拟高度感）
    ctx.save();
    if (drawScale !== 1.0) {
      ctx.translate(planeX, planeZ);
      ctx.scale(drawScale, drawScale);
      ctx.translate(-planeX, -planeZ);
    }
    drawPlane(ctx, planeX, planeZ, planeAng, t, params.worldR);
    ctx.restore();
  }

  /* ----------------------------------------------------------
     debugCarS — 返回第 i 辆车当前 s 值（归一化弧长）
     ---------------------------------------------------------- */

  function debugCarS(i: number): number {
    if (i < 0 || i >= carTravels.length) return 0;
    const phase = carTravels[i];
    return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  }

  function debugTrainPos(i: number): { x: number; z: number } | null {
    if (i < 0 || i >= trainPositions.length) return null;
    return trainPositions[i];
  }

  function debugFerryPos(): { x: number; z: number } | null {
    return lastFerryPos;
  }

  function debugBoatPos(): { x: number; z: number } | null {
    return lastBoatPos;
  }

  return {
    draw,
    hitables: () => [],
    citizenCount: () => nV,
    debugCarS,
    debugCitizenKinds: () => citizens.map(c => c.kind),
    debugTrainPos,
    debugFerryPos,
    debugBoatPos,
  };
}
