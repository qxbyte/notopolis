import { describe, expect, it } from 'vitest';
import { pickWeightedIndex, staleWeight } from '../src/util/random';

describe('pickWeightedIndex', () => {
  it('rand=0 选第一个非零权项', () => {
    expect(pickWeightedIndex([2, 5, 3], 0)).toBe(0);
  });

  it('rand 落在各权重区间', () => {
    // total=10；区间 [0,2)=0, [2,7)=1, [7,10)=2
    expect(pickWeightedIndex([2, 5, 3], 0.1)).toBe(0); // 1.0
    expect(pickWeightedIndex([2, 5, 3], 0.5)).toBe(1); // 5.0
    expect(pickWeightedIndex([2, 5, 3], 0.9)).toBe(2); // 9.0
  });

  it('rand→1 选最后一项', () => {
    expect(pickWeightedIndex([1, 1, 1], 0.999)).toBe(2);
  });

  it('全零权 / 空 → -1', () => {
    expect(pickWeightedIndex([0, 0], 0.5)).toBe(-1);
    expect(pickWeightedIndex([], 0.5)).toBe(-1);
  });

  it('负权当 0 处理', () => {
    // 有效权重只有 index 1
    expect(pickWeightedIndex([-3, 5], 0.5)).toBe(1);
  });

  it('高权项被选中概率更高（分布抽样）', () => {
    const weights = [1, 9];
    let count1 = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickWeightedIndex(weights, i / 1000) === 1) count1++;
    }
    // index 1 权重 90% → 约 900 次
    expect(count1).toBeGreaterThan(850);
    expect(count1).toBeLessThan(950);
  });
});

describe('staleWeight', () => {
  const now = 100 * 86400000; // 第 100 天
  it('刚修改 → 下限 1', () => {
    expect(staleWeight(now, now)).toBe(1);
    expect(staleWeight(now - 0.5 * 86400000, now)).toBe(1); // < 1 天
  });
  it('中等陈旧 → 天数', () => {
    expect(staleWeight(now - 30 * 86400000, now)).toBe(30);
  });
  it('超 365 天 → 上限 365', () => {
    expect(staleWeight(now - 500 * 86400000, now)).toBe(365);
  });
});
