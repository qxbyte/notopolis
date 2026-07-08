/**
 * world/params.ts
 * 纯函数：从 vaultPath + 城市尺寸推导世界参数。
 * 算法与参数值与雏形 prototype/public/index.html「世界种子」段完全一致。
 * wrng 消费顺序必须与雏形严格对齐——任何顺序变动都会改变世界面貌。
 */

import { rng0 } from '../util/seed';
import { fbm } from '../util/noise';
import { polyDist } from '../util/poly';

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
}

export function worldParams(
  vaultPath: string,
  cityHalfW: number,
  cityHalfD: number,
  worldR: number,
  T: number
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

  // 支流运河：从大河随机位置分出，穿过城区，汇入对侧尽头湖
  const canalPts: [number, number][] = [];
  {
    const v0 = (wrng() - 0.5) * maxHalf * 1.4;
    const P0 = riverWorld(v0);
    const dirC = Math.atan2(-P0[1], -P0[0]); // 指向城心
    const perp = dirC + Math.PI / 2;
    const canalLen = Math.hypot(P0[0], P0[1]) + maxHalf * 1.35 + 8 + wrng() * 12;
    const a1 = 3.5 + wrng() * 3, k1 = 1.6 + wrng() * 1.4, ph = wrng() * Math.PI * 2;
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const d = canalLen * u;
      const off = Math.sin(u * Math.PI * k1 + ph) * a1 * Math.sin(Math.PI * Math.min(1, u * 1.2));
      canalPts.push([
        P0[0] + Math.cos(dirC) * d + Math.cos(perp) * off,
        P0[1] + Math.sin(dirC) * d + Math.sin(perp) * off,
      ]);
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

  return {
    RA, cosR, sinR,
    riverBaseD, RIVER_W,
    riverU, riverWorld, riverDist,
    MA, cosM, sinM,
    canalPts, canalY, canalEndY,
    lakes,
    cityHalfW, cityHalfD, worldR, T,
  };
}
