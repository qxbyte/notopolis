/**
 * world/params.ts
 * 纯函数：从 vaultPath + 城市尺寸推导世界参数。
 * 算法与参数值与雏形 prototype/public/index.html「世界种子」段完全一致。
 * wrng 消费顺序必须与雏形严格对齐——任何顺序变动都会改变世界面貌。
 */

import { rng0 } from '../util/seed';
import { fbm } from '../util/noise';
import { polyDist } from '../util/poly';
import { getBiome, WaterStyle } from '../render2d/biomes';

export interface SeaData {
  sideAngle: number;
  coastPts: [number, number][];
  coastDist: (x: number, z: number) => number;
  islands: { x: number; z: number; r: number }[];
  lighthousePos: { x: number; z: number };
  piers: { x: number; z: number; angle: number }[];
}

export interface Lake {
  x: number;
  z: number;
  r: number;
  city?: boolean;
  seed: number;
}

export interface WorldParams {
  // 河流参数
  RA: number;
  cosR: number;
  sinR: number;
  riverBaseD: number;
  RIVER_W: number;
  riverU: (v: number) => number;
  riverWorld: (v: number) => [number, number];
  riverDist: (x: number, z: number) => number;

  // 山脉参数
  MA: number;
  cosM: number;
  sinM: number;

  // 运河
  canalPts: [number, number][];
  canalY: number[];
  canalEndY: number;

  // 湖泊
  lakes: Lake[];

  // 原始输入（供 terrain/water 使用）
  cityHalfW: number;
  cityHalfD: number;
  worldR: number;
  T: number;

  // 主题
  theme: string;
  waterStyle: WaterStyle;
  // harbor 专属（其他主题为 undefined）
  seaData?: SeaData;
}

export function worldParams(
  vaultPath: string,
  cityHalfW: number,
  cityHalfD: number,
  worldR: number,
  T: number,
  theme: string = 'plains',
  settlements: { x: number; z: number; r: number }[] = [],
): WorldParams {
  // ========== 世界种子：一切地貌参数由 vault 决定，不同仓库不同世界 ==========
  const wrng = rng0('world:' + vaultPath);
  const maxHalf = Math.max(cityHalfW, cityHalfD);

  // 大河：随机方位角 + 随机离城距离，沿切向蜿蜒（不一定在城市哪一侧）
  const RA = wrng() * Math.PI * 2;
  const cosR = Math.cos(RA), sinR = Math.sin(RA);
  const riverBaseD = maxHalf + 26 + wrng() * 20;
  const RIVER_W = 6 + wrng() * 3;
  const riverU = (v: number) =>
    riverBaseD + Math.sin(v * 0.017) * 13 + (fbm(11, v * 0.05) - 0.5) * 18;

  function riverWorld(v: number): [number, number] {
    // 河心线上参数 v 处的世界坐标
    const u = riverU(v);
    return [u * cosR - v * sinR, u * sinR + v * cosR];
  }

  function riverDist(x: number, z: number): number {
    // 点到河心线的近似距离
    const u = x * cosR + z * sinR, v = -x * sinR + z * cosR;
    return Math.abs(u - riverU(v));
  }

  // 山脉：与河流方位错开的随机方向
  const MA = RA + Math.PI * (0.55 + wrng() * 0.9);
  const cosM = Math.cos(MA), sinM = Math.sin(MA);

  // 支流运河：从大河随机位置分出，作为短支流延伸至附近，避开聚落
  const canalPts: [number, number][] = [];
  {
    const v0 = (wrng() - 0.5) * maxHalf * 1.4;
    const P0 = riverWorld(v0);

    // 辅助：检查一个点与所有聚落的最小 gap（dist - r）
    function minSettlementGap(px: number, pz: number): number {
      if (settlements.length === 0) return Infinity;
      let minGap = Infinity;
      for (const s of settlements) {
        const gap = Math.hypot(px - s.x, pz - s.z) - s.r;
        if (gap < minGap) minGap = gap;
      }
      return minGap;
    }

    // 候选终点生成：在河附近选离河 60–140 单位、且与所有聚落 gap ≥ 10 的随机点
    // 取 40 候选中 gap 最大者；消耗 wrng 以保证确定性序列不断裂
    let bestEndX = 0, bestEndZ = 0, bestGap = -Infinity;
    const CANDIDATES = 40;
    for (let ci = 0; ci < CANDIDATES; ci++) {
      const ang = wrng() * Math.PI * 2;
      const dist = 60 + wrng() * 80; // 60–140 单位
      const ex = P0[0] + Math.cos(ang) * dist;
      const ez = P0[1] + Math.sin(ang) * dist;
      const gap = minSettlementGap(ex, ez);
      if (gap > bestGap) {
        bestGap = gap;
        bestEndX = ex;
        bestEndZ = ez;
      }
    }

    const ph = wrng() * Math.PI * 2;

    // 生成运河路径（最多 5 轮重试以避让聚落侵入）
    const MAX_RETRY = 5;
    let accepted = false;
    for (let retry = 0; retry < MAX_RETRY && !accepted; retry++) {
      if (retry > 0) {
        // 重新抽终点（继续消耗 wrng）
        let retryBestX = bestEndX, retryBestZ = bestEndZ, retryBestGap = -Infinity;
        for (let ci = 0; ci < CANDIDATES; ci++) {
          const ang = wrng() * Math.PI * 2;
          const dist = 60 + wrng() * 80;
          const ex = P0[0] + Math.cos(ang) * dist;
          const ez = P0[1] + Math.sin(ang) * dist;
          const gap = minSettlementGap(ex, ez);
          if (gap > retryBestGap) {
            retryBestGap = gap;
            retryBestX = ex;
            retryBestZ = ez;
          }
        }
        bestEndX = retryBestX;
        bestEndZ = retryBestZ;
      }

      const canalLen = Math.hypot(bestEndX - P0[0], bestEndZ - P0[1]);
      const dirC = Math.atan2(bestEndZ - P0[1], bestEndX - P0[0]);
      const perp = dirC + Math.PI / 2;

      // 振幅与波数与长度成比例
      const a1 = Math.max(4, Math.min(18, canalLen * 0.10));
      const k1 = Math.max(1.6, canalLen / 70);
      const N = Math.max(20, Math.ceil(canalLen / 8));

      const pts: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const d = canalLen * u;
        const off = Math.sin(u * Math.PI * k1 + ph) * a1 * Math.sin(Math.PI * Math.min(1, u * 1.2));
        pts.push([
          P0[0] + Math.cos(dirC) * d + Math.cos(perp) * off,
          P0[1] + Math.sin(dirC) * d + Math.sin(perp) * off,
        ]);
      }

      // 检查路径采样点是否侵入任何聚落（gap < 2）
      let invaded = false;
      if (settlements.length > 0) {
        for (const pt of pts) {
          if (minSettlementGap(pt[0], pt[1]) < 2) {
            invaded = true;
            break;
          }
        }
      }

      if (!invaded || retry === MAX_RETRY - 1) {
        // 接受这条路径
        canalPts.push(...pts);
        accepted = true;
      }
    }
  }

  // 湖泊：运河尽头湖 + 随机散布的野外湖（避开河与运河）
  const lakes: Lake[] = [{
    x: canalPts[canalPts.length - 1][0],
    z: canalPts[canalPts.length - 1][1],
    r: 6 + wrng() * 3,
    city: true,
    seed: Math.floor(wrng() * 97),
  }];
  for (let attempts = 0; lakes.length < 4 && attempts < 50; attempts++) {
    const ang = wrng() * Math.PI * 2;
    const dist = maxHalf * (1.9 + wrng() * 2.6);
    const lx = Math.cos(ang) * dist, lz = Math.sin(ang) * dist;
    if (Math.abs(lx) > T * 0.85 || Math.abs(lz) > T * 0.85) continue;
    if (riverDist(lx, lz) < RIVER_W + 18) continue;
    if (polyDist(lx, lz, canalPts) < 20) continue;
    lakes.push({ x: lx, z: lz, r: 8 + wrng() * 5, seed: Math.floor(wrng() * 97) });
  }

  // 运河水位剖面（提前计算：湖泊水位与其联动）：
  // 城内 0.55（浮于地块上）→ 野外 -0.35（贴地）→ 入河口降至河水位
  const canalY = canalPts.map((p) => {
    const outX = Math.max(0, Math.abs(p[0]) - cityHalfW);
    const outZ = Math.max(0, Math.abs(p[1]) - cityHalfD);
    const dOut = Math.hypot(outX, outZ);
    let y = 0.55 + (-0.35 - 0.55) * Math.min(1, dOut / 14);
    const dRiver = riverDist(p[0], p[1]);
    if (dRiver < 16) y = Math.min(y, -0.62 + (y + 0.62) * (dRiver / 16));
    return y;
  });
  const canalEndY = canalY[canalY.length - 1];

  // harbor：不生成大河，改生成海岸线
  let seaData: SeaData | undefined;
  if (theme === 'harbor') {
    const wrngHarbor = rng0('harbor:' + vaultPath);
    // 海在哪一侧（方位角）
    const sideAngle = wrngHarbor() * Math.PI * 2;
    const cosSide = Math.cos(sideAngle), sinSide = Math.sin(sideAngle);
    // 海岸线基准距离（城市边缘外一侧）
    const coastBaseD = maxHalf + 30 + wrngHarbor() * 20;
    const N_COAST = 40;
    // 采样海岸线 40 点（垂直于 sideAngle 方向延伸）
    const coastPts: [number, number][] = [];
    for (let i = 0; i <= N_COAST; i++) {
      const v = (i / N_COAST - 0.5) * (maxHalf * 3.5);
      const waver = Math.sin(v * 0.023) * 12 + (wrngHarbor() - 0.5) * 8;
      const d = coastBaseD + waver;
      // 海湾凹弧：1-2 个随机凹陷
      coastPts.push([cosSide * d - sinSide * v, sinSide * d + cosSide * v]);
    }
    // 符号距离函数：点投影到 sideAngle 轴的距离；负 = 越过海岸（海里）
    function coastDist(x: number, z: number): number {
      // 沿 sideAngle 方向的投影距离
      const proj = x * cosSide + z * sinSide;
      // 找最近海岸线点的 v 坐标（垂直分量）
      const vProj = -x * sinSide + z * cosSide;
      // 对应 v 处的海岸基准距离（简化：用最近采样点插值）
      const idx = Math.max(0, Math.min(N_COAST, Math.round((vProj / (maxHalf * 3.5) + 0.5) * N_COAST)));
      const cp = coastPts[idx] ?? coastPts[N_COAST];
      const coastProjD = cp[0] * cosSide + cp[1] * sinSide;
      return coastProjD - proj; // 正 = 陆地侧，负 = 海里
    }
    // 小岛（1-2 个，在海里）
    const islandCount = 1 + Math.floor(wrngHarbor() * 2);
    const islands: { x: number; z: number; r: number }[] = [];
    for (let ii = 0; ii < islandCount; ii++) {
      const iv = (wrngHarbor() - 0.5) * maxHalf * 2;
      const id = coastBaseD + 25 + wrngHarbor() * 20;
      islands.push({
        x: cosSide * id - sinSide * iv,
        z: sinSide * id + cosSide * iv,
        r: 5 + wrngHarbor() * 5,
      });
    }
    // 灯塔（海岬位置 = 海岸线曲率较高处，简化取首/尾1/4处）
    const ltIdx = Math.floor(wrngHarbor() * 10);
    const lighthousePos = { x: coastPts[ltIdx][0], z: coastPts[ltIdx][1] };
    // 码头（城市朝海边缘 2-3 个）
    const pierCount = 2 + Math.floor(wrngHarbor() * 2);
    const piers: { x: number; z: number; angle: number }[] = [];
    for (let pi = 0; pi < pierCount; pi++) {
      const pv = (wrngHarbor() - 0.5) * maxHalf * 1.6;
      const pd = maxHalf * 0.85 + wrngHarbor() * 8;
      piers.push({
        x: cosSide * pd - sinSide * pv,
        z: sinSide * pd + cosSide * pv,
        angle: sideAngle,
      });
    }
    seaData = { sideAngle, coastPts, coastDist, islands, lighthousePos, piers };
    // harbor 主题：运河置空（无内陆运河，只有入海河道）
    canalPts.length = 0;
  }

  return {
    RA, cosR, sinR,
    riverBaseD, RIVER_W,
    riverU, riverWorld, riverDist,
    MA, cosM, sinM,
    canalPts, canalY, canalEndY,
    lakes,
    cityHalfW, cityHalfD, worldR, T,
    theme,
    waterStyle: getBiome(theme).waterStyle,
    seaData,
  };
}
