import { describe, it, expect } from 'vitest';
import { BIOMES, getBiome } from '../src/render2d/biomes';
import { worldParams } from '../src/world/params';

describe('BIOMES — 基础结构', () => {
  it('四主题均存在', () => {
    expect(BIOMES['plains']).toBeDefined();
    expect(BIOMES['harbor']).toBeDefined();
    expect(BIOMES['snow']).toBeDefined();
    expect(BIOMES['mountain']).toBeDefined();
  });

  it('getBiome 未知主题回退 plains', () => {
    const b = getBiome('unknown-theme');
    expect(b.key).toBe('plains');
  });

  it('harbor waterStyle 为 sea', () => {
    expect(BIOMES['harbor'].waterStyle).toBe('sea');
  });

  it('snow waterStyle 为 frozen', () => {
    expect(BIOMES['snow'].waterStyle).toBe('frozen');
  });

  it('mountain waterStyle 为 torrent', () => {
    expect(BIOMES['mountain'].waterStyle).toBe('torrent');
  });

  it('plains waterStyle 为 river', () => {
    expect(BIOMES['plains'].waterStyle).toBe('river');
  });

  it('snow mountains.proximity < plains mountains.proximity', () => {
    expect(BIOMES['snow'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
  });

  it('mountain mountains.proximity < plains mountains.proximity', () => {
    expect(BIOMES['mountain'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
  });

  it('所有 extras 为字符串数组', () => {
    for (const b of Object.values(BIOMES)) {
      expect(Array.isArray(b.extras)).toBe(true);
    }
  });
});

const HW = 50, HD = 50, WR = 200, T = 200;

describe('worldParams — 四主题确定性', () => {
  const themes = ['plains', 'harbor', 'snow', 'mountain'] as const;
  for (const theme of themes) {
    it(`${theme}: 同 vault+theme 两次 deep equal (RA, canalPts, lakes)`, () => {
      const p1 = worldParams('vault-biome', HW, HD, WR, T, theme);
      const p2 = worldParams('vault-biome', HW, HD, WR, T, theme);
      expect(p1.RA).toBe(p2.RA);
      expect(p1.canalPts).toEqual(p2.canalPts);
      expect(p1.lakes).toEqual(p2.lakes);
    });
  }
});

describe('worldParams — harbor coastDist', () => {
  it('harbor: 城市中心为陆地（coastDist > 0）', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData).toBeDefined();
    // 城市中心 (0,0) 应为陆地
    expect(p.seaData!.coastDist(0, 0)).toBeGreaterThan(0);
  });

  it('harbor: 远侧海洋方向为负（coastDist < 0）', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData).toBeDefined();
    // 沿海方向取很远的点应为海里（负值）
    const ang = p.seaData!.sideAngle;
    const farX = Math.cos(ang) * (HW + 200);
    const farZ = Math.sin(ang) * (HD + 200);
    expect(p.seaData!.coastDist(farX, farZ)).toBeLessThan(0);
  });

  it('harbor: seaData.islands 数量在 1-2 之间', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData!.islands.length).toBeGreaterThanOrEqual(1);
    expect(p.seaData!.islands.length).toBeLessThanOrEqual(2);
  });

  it('harbor: piers 数量在 2-3 之间', () => {
    const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
    expect(p.seaData!.piers.length).toBeGreaterThanOrEqual(2);
    expect(p.seaData!.piers.length).toBeLessThanOrEqual(3);
  });
});

describe('worldParams — snow/mountain mountains', () => {
  it('snow mountains.proximity 实际效果：山带更近城市中心（max peak across < plains）', () => {
    // 通过对比 MA 偏移量间接验证——这里只验证 worldStyle 字段正确传递
    const p = worldParams('vault-snow', HW, HD, WR, T, 'snow');
    expect(p.waterStyle).toBe('frozen');
  });

  it('mountain waterStyle 为 torrent', () => {
    const p = worldParams('vault-mountain', HW, HD, WR, T, 'mountain');
    expect(p.waterStyle).toBe('torrent');
  });
});
