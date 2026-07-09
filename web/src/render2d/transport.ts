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
  ang: number;                      // 跑道朝向（弧度）
  len: number;                      // 跑道长度（固定 26）
}

export interface FerryRoute {
  route: [number, number][];        // 航线折线点（世界坐标）
  docks: { x: number; z: number; districtDir: string }[];  // 两端渡口
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

  for (let i = 0; i < 40; i++) {
    const x = (rng() * 2 - 1) * T * 0.9;
    const z = (rng() * 2 - 1) * T * 0.9;

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
    return { x, z, ang, len: 26 };
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

  if (waterStyle === 'frozen') return null;

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

    return { route, docks: [dock1, dock2] };
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

  // 朝向河的 polygon 顶点：|u_signed| 最小且与区中心同侧
  function closestVertToRiver(d: District, districtUSigned: number): [number, number] {
    let bestV: [number, number] = d.polygon[0];
    let bestAbsU = Infinity;
    for (const v of d.polygon) {
      const vertU = uSigned(v[0], v[1]);
      // 只考虑与区中心同侧的顶点（符号相同），取 |u_signed| 最小的（最靠近河）
      if (vertU * districtUSigned > 0) {
        const absU = Math.abs(vertU);
        if (absU < bestAbsU) {
          bestAbsU = absU;
          bestV = [v[0], v[1]];
        }
      }
    }
    // 如果没有同侧顶点（多边形较小），退回到绝对最近的顶点
    if (bestAbsU === Infinity) {
      for (const v of d.polygon) {
        const absU = Math.abs(uSigned(v[0], v[1]));
        if (absU < bestAbsU) {
          bestAbsU = absU;
          bestV = [v[0], v[1]];
        }
      }
    }
    return bestV;
  }

  const va = closestVertToRiver(distA, uSignedA);
  const vb = closestVertToRiver(distB, uSignedB);

  const dock1 = { x: va[0], z: va[1], districtDir: distA.dir };
  const dock2 = { x: vb[0], z: vb[1], districtDir: distB.dir };
  const route: [number, number][] = [[va[0], va[1]], [vb[0], vb[1]]];

  return { route, docks: [dock1, dock2] };
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
