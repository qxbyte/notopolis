import { describe, it, expect } from 'vitest';
import { worldParams } from '../src/world/params';

// 固定测试参数：与雏形默认城市规格接近
const VAULT = 'test-vault-alpha';
const HALF_W = 40;
const HALF_D = 40;
const WORLD_R = 200;
const T = 200;

describe('worldParams — 确定性', () => {
  it('同 vaultPath 两次调用 RA 相等', () => {
    const p1 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    const p2 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p1.RA).toBe(p2.RA);
  });

  it('同 vaultPath 两次调用 canalPts deep equal', () => {
    const p1 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    const p2 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p1.canalPts).toEqual(p2.canalPts);
  });

  it('同 vaultPath 两次调用 lakes deep equal', () => {
    const p1 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    const p2 = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p1.lakes).toEqual(p2.lakes);
  });
});

describe('worldParams — 不同 vaultPath', () => {
  it('不同 vaultPath 的 RA 不同', () => {
    const p1 = worldParams('vault-aaa', HALF_W, HALF_D, WORLD_R, T);
    const p2 = worldParams('vault-bbb', HALF_W, HALF_D, WORLD_R, T);
    expect(p1.RA).not.toBe(p2.RA);
  });
});

describe('worldParams — 运河结构', () => {
  it('canalPts[0] 落在河上：riverDist < 1', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    const [x, z] = p.canalPts[0];
    // 入河起点由 P0 = riverWorld(v0) 计算，应精确在河心线上
    // riverU(v0) - riverU(v0) = 0，所以距离应约 0
    expect(p.riverDist(x, z)).toBeLessThan(1);
  });

  it('canalPts 有 31 个点（N=30，i=0..N）', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.canalPts).toHaveLength(31);
  });
});

describe('worldParams — canalY 水位剖面', () => {
  it('canalY 首元素 ≤ -0.55（入河低位）', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    // canalPts[0] 在大河附近，dRiver < 16 → y 被钳制到低位
    expect(p.canalY[0]).toBeLessThanOrEqual(-0.55);
  });

  it('canalY 末端与 canalEndY 一致', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.canalY[p.canalY.length - 1]).toBe(p.canalEndY);
  });

  it('canalY 长度与 canalPts 一致', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.canalY).toHaveLength(p.canalPts.length);
  });
});

describe('worldParams — 湖泊', () => {
  it('lakes.length ≥ 1', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.lakes.length).toBeGreaterThanOrEqual(1);
  });

  it('city 湖在 canal 尾点（lakes[0].city === true）', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.lakes[0].city).toBe(true);
    // city 湖坐标与 canalPts 最后一点一致
    const last = p.canalPts[p.canalPts.length - 1];
    expect(p.lakes[0].x).toBeCloseTo(last[0], 5);
    expect(p.lakes[0].z).toBeCloseTo(last[1], 5);
  });

  it('lakes 数量 ≤ 4', () => {
    const p = worldParams(VAULT, HALF_W, HALF_D, WORLD_R, T);
    expect(p.lakes.length).toBeLessThanOrEqual(4);
  });
});
