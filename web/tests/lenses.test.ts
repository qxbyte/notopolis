import { describe, expect, it } from 'vitest';
import { LENSES, lensById, gardenSetOf, lensHitBuildings } from '../src/render2d/lenses';
import type { Building, CityModel, District } from '@shared/types';

function b(overrides: Partial<Building>): Building {
  return {
    notePath: 'x.md', title: 'x', x: 0, z: 0, rotY: 0, size: 1,
    landmark: false, construction: false, isCivic: false, mainStreet: false,
    mtimeMs: 100, wordCount: 0, inlinks: 0, openTasks: 0, excerpt: '', outlinks: [],
    ...overrides,
  };
}
function city(buildings: Building[]): CityModel {
  const d: District = { dir: 'A', x: 0, z: 0, width: 10, depth: 10, polygon: [], isInbox: false, buildings };
  return {
    vaultId: 'v', name: 'v', theme: 'plains', tier: 'village',
    districts: [d], roads: [], noteCount: buildings.length, activeCount7d: 0, generatedAt: 0,
  };
}

const tasks = lensById('tasks');
const orphans = lensById('orphans');
const garden = lensById('garden');

describe('lens 谓词', () => {
  it('tasks: construction', () => {
    expect(tasks.match(b({ construction: true }), { gardenSet: new Set() })).toBe(true);
    expect(tasks.match(b({ construction: false }), { gardenSet: new Set() })).toBe(false);
  });

  it('orphans: 零入链零出链且非 civic', () => {
    const ctx = { gardenSet: new Set<string>() };
    expect(orphans.match(b({ inlinks: 0, outlinks: [] }), ctx)).toBe(true);
    // 有入链 → 非孤岛
    expect(orphans.match(b({ inlinks: 1 }), ctx)).toBe(false);
    // 有出链 → 非孤岛
    expect(orphans.match(b({ outlinks: ['y.md'] }), ctx)).toBe(false);
    // civic 豁免（区府不算孤岛）
    expect(orphans.match(b({ isCivic: true, inlinks: 0, outlinks: [] }), ctx)).toBe(false);
  });

  it('garden: 在 gardenSet 中', () => {
    const ctx = { gardenSet: new Set(['a.md']) };
    expect(garden.match(b({ notePath: 'a.md' }), ctx)).toBe(true);
    expect(garden.match(b({ notePath: 'b.md' }), ctx)).toBe(false);
  });
});

describe('gardenSetOf', () => {
  it('取 mtimeMs 最旧的 5 栋，排除 civic', () => {
    const c = city([
      b({ notePath: 'civic.md', mtimeMs: 1, isCivic: true }), // 排除
      ...[10, 20, 30, 40, 50, 60].map((m, i) => b({ notePath: `n${i}.md`, mtimeMs: m })),
    ]);
    const set = gardenSetOf(c, 5);
    expect(set.size).toBe(5);
    expect(set.has('civic.md')).toBe(false);
    // 最旧 5 个 = n0..n4（10..50），不含 n5(60)
    expect(set.has('n0.md')).toBe(true);
    expect(set.has('n5.md')).toBe(false);
  });

  it('并列 mtimeMs 按 notePath 字典序', () => {
    const c = city([
      b({ notePath: 'b.md', mtimeMs: 100 }),
      b({ notePath: 'a.md', mtimeMs: 100 }),
      b({ notePath: 'c.md', mtimeMs: 200 }),
    ]);
    const set = gardenSetOf(c, 2);
    expect([...set].sort()).toEqual(['a.md', 'b.md']);
  });

  it('笔记数 < n 全收', () => {
    const c = city([b({ notePath: 'a.md', mtimeMs: 1 })]);
    expect(gardenSetOf(c, 5).size).toBe(1);
  });
});

describe('lensHitBuildings', () => {
  it('none 返回空', () => {
    const c = city([b({ construction: true })]);
    expect(lensHitBuildings(c, 'none', { gardenSet: new Set() })).toEqual([]);
  });
  it('orphans 命中数 = 孤岛数', () => {
    const c = city([
      b({ notePath: 'iso.md', inlinks: 0, outlinks: [] }),
      b({ notePath: 'linked.md', inlinks: 2 }),
      b({ notePath: 'readme.md', isCivic: true, inlinks: 0, outlinks: [] }),
    ]);
    const hits = lensHitBuildings(c, 'orphans', { gardenSet: new Set() });
    expect(hits.map((h) => h.notePath)).toEqual(['iso.md']);
  });
});

describe('LENSES 注册表', () => {
  it('含 none/tasks/orphans/garden 四项', () => {
    expect(LENSES.map((l) => l.id)).toEqual(['none', 'tasks', 'orphans', 'garden']);
  });
});
