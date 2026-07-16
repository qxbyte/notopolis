/**
 * render2d/transport.ts — 跨区交通网纯数据计算层
 *
 * 输出 TransportNet（铁路/车站/机场/轮渡），全部为纯数据，
 * 不依赖 canvas/ctx，可被 citypainter（静态渲染）和 dynamic.ts（L3，动态层）复用。
 *
 * 所有随机通过 rng0(seed) 生成，禁止 Math.random。
 */

import type { CityModel, District } from '@shared/types';
import type { WorldParams } from '../world/params';
import { buildPolyline, polyDist } from '../util/poly';
import { rng0 } from '../util/seed';

/* ------------------------------------------------------------------ */
/* 导出类型                                                              */
/* ------------------------------------------------------------------ */

export interface RailEdge {
  pts: [number, number][];          // 弧弯折线点集（含首末 = 区中心，≥ 9 点）
  lens: number[];                   // 各段长度（buildPolyline 产出）
  total: number;                    // 总弧长
  bridges: [number, number][];      // [[s1,s2],...] 单位=弧长参数 0-1
  tunnels: [number, number][];      // [[s1,s2],...] 单位=弧长参数 0-1
}

export interface StationPos {
  x: number;
  z: number;
  districtDir: string;              // 所属区 dir
}

export interface Airport {
  x: number;
  z: number;
  ang: number;        // 跑道朝向（弧度）
  len: number;        // 跑道长度（36）
  width: number;      // 跑道宽度（7）
  apron: { dx: number; dz: number };   // 停机坪中心（相对机场原点的偏移，在局部坐标系下）
  tower: { dx: number; dz: number };   // 塔台位置（局部坐标）
  hangar: { dx: number; dz: number };  // 机库位置（局部坐标）
  accessRoad: [number, number][];       // 跑道端到最近聚落中心的折线（世界坐标）
}

export interface FerryRoute {
  route: [number, number][];        // 航线折线点（世界坐标）
  docks: { x: number; z: number; districtDir: string }[];  // 两端渡口
  accessPaths: [[number, number][], [number, number][]];   // 两条乡间小路（区边缘顶点 → 渡口）
}

export interface MSTEdgePublic {
  from: number;  // district index
  to: number;    // district index
}

export interface TransportNet {
  rails: RailEdge[];
  stations: StationPos[];
  airport: Airport | null;
  ferry: FerryRoute | null;
  mstEdges: MSTEdgePublic[];
}

/* ------------------------------------------------------------------ */
/* 内部辅助：区中心                                                      */
/* ------------------------------------------------------------------ */

function districtCenter(d: District): [number, number] {
  return [d.x + d.width / 2, d.z + d.depth / 2];
}

/* ------------------------------------------------------------------ */
/* Prim MST                                                             */
/* ------------------------------------------------------------------ */

interface MSTEdge {
  from: number;
  to: number;
}

function primMST(centers: [number, number][]): MSTEdge[] {
  const n = centers.length;
  if (n <= 1) return [];

  const inSet = new Set<number>([0]);
  const edges: MSTEdge[] = [];

  while (inSet.size < n) {
    let bestDist = Infinity;
    let bestFrom = -1;
    let bestTo = -1;

    for (const from of inSet) {
      for (let to = 0; to < n; to++) {
        if (inSet.has(to)) continue;
        const [ax, az] = centers[from];
        const [bx, bz] = centers[to];
        const d = Math.hypot(bx - ax, bz - az);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = from;
          bestTo = to;
        }
      }
    }

    if (bestTo === -1) break;
    inSet.add(bestTo);
    edges.push({ from: bestFrom, to: bestTo });
  }

  return edges;
}

/* ------------------------------------------------------------------ */
/* 弧弯折线（二次贝塞尔 8 段采样，共 9 点）                              */
/* ------------------------------------------------------------------ */

function sampleBezier(
  ax: number, az: number,
  cx: number, cz: number,
  bx: number, bz: number,
  segments: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * ax + 2 * mt * t * cx + t * t * bx;
    const z = mt * mt * az + 2 * mt * t * cz + t * t * bz;
    pts.push([x, z]);
  }
  return pts;
}

function buildArcPts(
  ax: number, az: number,
  bx: number, bz: number,
  rng: () => number,
): [number, number][] {
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  const edgeLen = Math.hypot(bx - ax, bz - az) || 1;
  // 垂直方向
  const perpX = -(bz - az) / edgeLen;
  const perpZ = (bx - ax) / edgeLen;
  // 弧弯偏移（用 rng）
  const offset = (rng() * 2 - 1) * 0.15 * edgeLen;
  const ctrlX = midX + perpX * offset;
  const ctrlZ = midZ + perpZ * offset;
  // 8 段采样 → 9 点
  return sampleBezier(ax, az, ctrlX, ctrlZ, bx, bz, 8);
}

/* ------------------------------------------------------------------ */
/* bridge / tunnel 区间检测（弧长归一化参数 0-1）                        */
/* ------------------------------------------------------------------ */

/**
 * 将"逐段标记"转换为合并区间 [s1, s2]（弧长参数 0-1）
 */
function mergeSegmentFlags(
  flags: boolean[],
  lens: number[],
  total: number,
): [number, number][] {
  const intervals: [number, number][] = [];
  let cumLen = 0;
  let inInterval = false;
  let intervalStart = 0;

  for (let i = 0; i < flags.length; i++) {
    const segStart = cumLen / total;
    const segEnd = (cumLen + lens[i]) / total;
    if (flags[i]) {
      if (!inInterval) {
        intervalStart = segStart;
        inInterval = true;
      }
    } else {
      if (inInterval) {
        intervals.push([intervalStart, segStart]);
        inInterval = false;
      }
    }
    cumLen += lens[i];
    // handle end
    if (i === flags.length - 1 && inInterval) {
      intervals.push([intervalStart, segEnd]);
    }
  }
  return intervals;
}

function detectBridges(
  pts: [number, number][],
  lens: number[],
  total: number,
  params: WorldParams,
): [number, number][] {
  const { riverDist, RIVER_W } = params;
  const threshold = RIVER_W + 2;
  const flags: boolean[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    flags.push(riverDist(mx, mz) < threshold);
  }

  return mergeSegmentFlags(flags, lens, total);
}

function detectTunnels(
  pts: [number, number][],
  lens: number[],
  total: number,
  params: WorldParams,
): [number, number][] {
  const { cosM, sinM, worldR } = params;
  const threshold = worldR * 0.55;
  const flags: boolean[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    // 使用线段两端点判断（取中点）
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const mProj = mx * cosM + mz * sinM;
    flags.push(mProj > threshold);
  }

  return mergeSegmentFlags(flags, lens, total);
}

/* ------------------------------------------------------------------ */
/* 车站位置：polygon 顶点中最靠近第一条铁路边方向的顶点，外推 2 单位       */
/* ------------------------------------------------------------------ */

function buildStation(
  district: District,
  railEdge: RailEdge | null,
): StationPos {
  const poly = district.polygon;
  const [cx, cz] = districtCenter(district);

  if (!railEdge || poly.length === 0) {
    return { x: cx, z: cz, districtDir: district.dir };
  }

  // 铁路边方向：取首末两点的方向向量
  const firstPt = railEdge.pts[0];
  const lastPt = railEdge.pts[railEdge.pts.length - 1];
  // 确定该区的端（首或末）
  const distToFirst = Math.hypot(firstPt[0] - cx, firstPt[1] - cz);
  const distToLast = Math.hypot(lastPt[0] - cx, lastPt[1] - cz);
  const railEnd = distToFirst < distToLast ? firstPt : lastPt;
  const dirX = railEnd[0] - cx;
  const dirZ = railEnd[1] - cz;
  const dirLen = Math.hypot(dirX, dirZ) || 1;
  const normDirX = dirX / dirLen;
  const normDirZ = dirZ / dirLen;

  // polygon 顶点中内积最大的
  let bestV: [number, number] = poly[0];
  let bestDot = -Infinity;
  for (const v of poly) {
    const vx = v[0] - cx;
    const vz = v[1] - cz;
    const dot = vx * normDirX + vz * normDirZ;
    if (dot > bestDot) {
      bestDot = dot;
      bestV = v;
    }
  }

  // 外推 2 单位
  const outX = bestV[0] + normDirX * 2;
  const outZ = bestV[1] + normDirZ * 2;
  return { x: outX, z: outZ, districtDir: district.dir };
}

/* ------------------------------------------------------------------ */
/* harbor 入海判断：若弯偏移后仍有点入海，接受并标记 bridge              */
/* ------------------------------------------------------------------ */

function checkSeaIntersection(pts: [number, number][], params: WorldParams): boolean {
  if (!params.seaData) return false;
  const { coastDist } = params.seaData;
  return pts.some(([x, z]) => coastDist(x, z) < 0);
}

/* ------------------------------------------------------------------ */
/* 机场                                                                 */
/* ------------------------------------------------------------------ */

function buildAirport(
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
): Airport | null {
  if (city.noteCount < 80) return null;

  const rng = rng0(wsPrefix + ':airport');
  const { T, riverDist, RIVER_W, cosM, sinM, worldR } = params;
  const mountainThreshold = worldR * 0.5;

  // 机场必须落在可平移地图内（expand ≈ worldR*0.55），不用满 T 范围
  const AIRPORT_R = Math.min(T * 0.9, worldR * 1.3);
  for (let i = 0; i < 40; i++) {
    const x = (rng() * 2 - 1) * AIRPORT_R;
    const z = (rng() * 2 - 1) * AIRPORT_R;

    // 距离水检查
    if (riverDist(x, z) < RIVER_W + 10) continue;

    // 山带检查（不能在山里）
    const mProj = x * cosM + z * sinM;
    if (mProj > mountainThreshold) continue;

    // 距所有区团块 > 15
    let tooClose = false;
    for (const d of city.districts) {
      const [dcx, dcz] = districtCenter(d);
      // 用 bbox 近似：检查与区中心距离
      const dx = Math.max(0, Math.abs(x - dcx) - d.width / 2);
      const dz = Math.max(0, Math.abs(z - dcz) - d.depth / 2);
      const dist = Math.hypot(dx, dz);
      if (dist < 15) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // 同时用 polyDist 也检查 polygon
    let tooClosePoly = false;
    for (const d of city.districts) {
      if (d.polygon.length >= 2) {
        const pd = polyDist(x, z, d.polygon);
        if (pd < 15) {
          tooClosePoly = true;
          break;
        }
      }
    }
    if (tooClosePoly) continue;

    const ang = rng() * Math.PI;

    // 局部坐标下的位置（相对 airport 中心 (x,z)，局部坐标系：沿跑道为 X，垂直为 Z）
    const halfLen = 18;   // len/2 = 36/2
    const apronDx = halfLen * 0.3;   // 停机坪在跑道中段靠近一侧
    const apronDz = -10;              // 停机坪在跑道侧方（负 Z = 跑道法向一侧）
    const towerDx = halfLen;          // 塔台在跑道末端
    const towerDz = -8;
    const hangarDx = -halfLen * 0.4;  // 机库在跑道中段另一端
    const hangarDz = -8;

    // accessRoad：从跑道末端（世界坐标）到最近聚落中心，折线 2-3 点
    // 跑道末端世界坐标
    const cosAng = Math.cos(ang), sinAng = Math.sin(ang);
    const runwayEndX = x + cosAng * halfLen;
    const runwayEndZ = z + sinAng * halfLen;

    // 找最近聚落中心
    let nearestCx = runwayEndX, nearestCz = runwayEndZ;
    let nearestDist = Infinity;
    for (const d of city.districts) {
      const dcx = d.x + d.width / 2;
      const dcz = d.z + d.depth / 2;
      const dd = Math.hypot(dcx - x, dcz - z);
      if (dd < nearestDist) {
        nearestDist = dd;
        nearestCx = dcx;
        nearestCz = dcz;
      }
    }
    // 折线：跑道末端 → 中间折点（偏向聚落方向）→ 聚落中心
    const midX = (runwayEndX + nearestCx) / 2 + (rng() - 0.5) * 20;
    const midZ = (runwayEndZ + nearestCz) / 2 + (rng() - 0.5) * 20;
    const accessRoad: [number, number][] = [
      [runwayEndX, runwayEndZ],
      [midX, midZ],
      [nearestCx, nearestCz],
    ];

    return {
      x, z, ang, len: 36, width: 7,
      apron: { dx: apronDx, dz: apronDz },
      tower: { dx: towerDx, dz: towerDz },
      hangar: { dx: hangarDx, dz: hangarDz },
      accessRoad,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 轮渡                                                                 */
/* ------------------------------------------------------------------ */

function buildFerry(
  city: CityModel,
  params: WorldParams,
): FerryRoute | null {
  const { waterStyle } = params;

  if (waterStyle === 'sea') {
    // harbor: 从离海最近的区取最近海顶点作渡口，终点为 islands[0]
    const sea = params.seaData;
    if (!sea || sea.islands.length === 0) return null;
    const { coastDist, islands } = sea;

    // 找离海最近的区（polygon 顶点 coastDist 最小 = 最接近海或入海）
    let bestDist = Infinity;
    let bestVert: [number, number] | null = null;
    let bestDistDir = '';

    for (const d of city.districts) {
      for (const v of d.polygon) {
        const cd = coastDist(v[0], v[1]);
        if (cd < bestDist) {
          bestDist = cd;
          bestVert = [v[0], v[1]];
          bestDistDir = d.dir;
        }
      }
    }

    if (!bestVert) return null;

    const dock1 = { x: bestVert[0], z: bestVert[1], districtDir: bestDistDir };
    const dock2 = { x: islands[0].x, z: islands[0].z, districtDir: 'island' };
    const route: [number, number][] = [
      [dock1.x, dock1.z],
      [dock2.x, dock2.z],
    ];

    return { route, docks: [dock1, dock2], accessPaths: [[], []] };
  }

  // river / torrent: 找相对河心线 u_signed 符号相反的两个区
  // u_signed = (x*cosR + z*sinR) - riverU(-x*sinR + z*cosR)
  const { cosR, sinR, riverU: riverUFn } = params;

  function uSigned(cx: number, cz: number): number {
    const v = -cx * sinR + cz * cosR;
    return cx * cosR + cz * sinR - riverUFn(v);
  }

  let distA: District | null = null;
  let distB: District | null = null;
  let uSignedA = 0;
  let uSignedB = 0;

  outer:
  for (let i = 0; i < city.districts.length; i++) {
    const [cxA, czA] = districtCenter(city.districts[i]);
    const uA = uSigned(cxA, czA);
    for (let j = i + 1; j < city.districts.length; j++) {
      const [cxB, czB] = districtCenter(city.districts[j]);
      const uB = uSigned(cxB, czB);
      // 符号相反 → 两区在河的不同侧
      if (uA * uB < 0) {
        distA = city.districts[i];
        distB = city.districts[j];
        uSignedA = uA;
        uSignedB = uB;
        break outer;
      }
    }
  }

  if (!distA || !distB) return null;

  // 计算两区中心的河向坐标系纵向坐标 v（v = -x·sinR + z·cosR）
  const [cxA, czA] = districtCenter(distA);
  const [cxB, czB] = districtCenter(distB);
  const vA = -cxA * sinR + czA * cosR;
  const vB = -cxB * sinR + czB * cosR;
  // 渡口过河点：取两区 v 坐标的中点作为跨河 v*
  const vCross = (vA + vB) / 2;

  // 渡口在河心线处的 u 坐标
  const uCenter = riverUFn(vCross);

  // 两渡口分居河两岸，偏移 RIVER_W/2 + 1.8（各自在该侧的岸边）
  const { RIVER_W } = params;
  const dockOffset = RIVER_W / 2 + 1.8;

  // 根据 uSignedA/uSignedB 的符号确定各区在哪一侧
  // uSigned > 0 → 在河的正 u 侧；uSigned < 0 → 在负 u 侧
  const uA_dock = uCenter + (uSignedA > 0 ? dockOffset : -dockOffset);
  const uB_dock = uCenter + (uSignedB > 0 ? dockOffset : -dockOffset);

  // 换回世界坐标：x = u·cosR - v·sinR, z = u·sinR + v·cosR
  const dockAx = uA_dock * cosR - vCross * sinR;
  const dockAz = uA_dock * sinR + vCross * cosR;
  const dockBx = uB_dock * cosR - vCross * sinR;
  const dockBz = uB_dock * sinR + vCross * cosR;

  const dock1 = { x: dockAx, z: dockAz, districtDir: distA.dir };
  const dock2 = { x: dockBx, z: dockBz, districtDir: distB.dir };

  // 航线：短线垂直过河（dockA → dockB）
  const route: [number, number][] = [[dockAx, dockAz], [dockBx, dockBz]];

  // accessPaths：从各区 polygon 上距渡口最近的顶点到渡口
  function nearestPolyVert(d: District, tx: number, tz: number): [number, number] {
    let bestV: [number, number] = [d.x + d.width / 2, d.z + d.depth / 2];
    let bestDist = Infinity;
    for (const v of d.polygon) {
      const dd = Math.hypot(v[0] - tx, v[1] - tz);
      if (dd < bestDist) {
        bestDist = dd;
        bestV = [v[0], v[1]];
      }
    }
    return bestV;
  }

  const edgeA = nearestPolyVert(distA, dockAx, dockAz);
  const edgeB = nearestPolyVert(distB, dockBx, dockBz);

  const accessPaths: [[number, number][], [number, number][]] = [
    [edgeA, [dockAx, dockAz]],
    [edgeB, [dockBx, dockBz]],
  ];

  return { route, docks: [dock1, dock2], accessPaths };
}

/* ------------------------------------------------------------------ */
/* 主函数                                                               */
/* ------------------------------------------------------------------ */

export function buildTransport(
  city: CityModel,
  params: WorldParams,
  wsPrefix: string,
): TransportNet {
  const districts = city.districts;
  const centers = districts.map(districtCenter);
  const mstEdges = primMST(centers);

  // 每区对应的第一条铁路边（用于车站定位）
  const districtFirstEdge = new Map<number, RailEdge>();

  const railRng = rng0(wsPrefix + ':rail');

  const rails: RailEdge[] = mstEdges.map(({ from, to }) => {
    const [ax, az] = centers[from];
    const [bx, bz] = centers[to];

    let pts = buildArcPts(ax, az, bx, bz, railRng);

    // harbor：如果折线入海，尝试反向弯曲；若重试仍入海则标记整段为跨海桥
    let seaBridge = false;  // 标记是否为跨海桥（整段 bridges = [[0,1]]）

    if (params.waterStyle === 'sea' && params.seaData && checkSeaIntersection(pts, params)) {
      // 重新生成一次（railRng 已消耗，需回到下一次调用来反向——这里用 offset 反号重算）
      const midX = (ax + bx) / 2;
      const midZ = (az + bz) / 2;
      const edgeLen = Math.hypot(bx - ax, bz - az) || 1;
      const perpX = -(bz - az) / edgeLen;
      const perpZ = (bx - ax) / edgeLen;
      // 取当前 rng 状态的上一个值（无法回退，所以直接用固定反向）
      // offset 取最后消耗的 rng 值的反向（实际实现：用一个独立 rng 重算）
      const retryRng = rng0(wsPrefix + ':rail:retry:' + from + ':' + to);
      const retryOffset = -(retryRng() * 2 - 1) * 0.15 * edgeLen;
      const ctrlX = midX + perpX * retryOffset;
      const ctrlZ = midZ + perpZ * retryOffset;
      pts = sampleBezier(ax, az, ctrlX, ctrlZ, bx, bz, 8);

      if (checkSeaIntersection(pts, params)) {
        // 重试后仍入海 → 接受为跨海桥，整段标记为 bridge
        seaBridge = true;
      }
    }

    const polyline = buildPolyline(pts);
    const bridges: [number, number][] = seaBridge
      ? [[0, 1]]
      : detectBridges(pts, polyline.lens, polyline.total, params);
    const tunnels = detectTunnels(pts, polyline.lens, polyline.total, params);

    const edge: RailEdge = {
      pts,
      lens: polyline.lens,
      total: polyline.total,
      bridges,
      tunnels,
    };

    // 记录首次出现的铁路边（用于车站）
    if (!districtFirstEdge.has(from)) districtFirstEdge.set(from, edge);
    if (!districtFirstEdge.has(to)) districtFirstEdge.set(to, edge);

    return edge;
  });

  // 车站
  const stations: StationPos[] = districts.map((d, i) => {
    const edge = districtFirstEdge.get(i) ?? null;
    return buildStation(d, edge);
  });

  // 机场
  const airport = buildAirport(city, params, wsPrefix);

  // 轮渡
  const ferry = buildFerry(city, params);

  return { rails, stations, airport, ferry, mstEdges };
}
