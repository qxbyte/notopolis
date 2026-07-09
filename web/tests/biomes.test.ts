import { describe, it, expect } from 'vitest';
import { BIOMES, getBiome } from '../src/render2d/biomes';

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
