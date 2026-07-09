import { describe, expect, it } from 'vitest';
import { groupTasks, totalConstruction } from '../src/util/tasks';
import type { Building, CityModel, District } from '@shared/types';

function b(overrides: Partial<Building>): Building {
  return {
    notePath: 'x.md', title: 'x', x: 0, z: 0, rotY: 0, size: 1,
    landmark: false, construction: false, isCivic: false, mainStreet: false,
    mtimeMs: 0, wordCount: 0, inlinks: 0, openTasks: 0, excerpt: '', outlinks: [],
    ...overrides,
  } as Building;
}
function district(dir: string, buildings: Building[]): District {
  return { dir, x: 0, z: 0, width: 10, depth: 10, polygon: [], isInbox: false, buildings };
}
function city(districts: District[]): CityModel {
  return {
    vaultId: 'v', name: 'v', theme: 'plains', tier: 'village',
    districts, roads: [], noteCount: 0, activeCount7d: 0, generatedAt: 0,
  };
}

describe('groupTasks', () => {
  it('只收 construction，按区分组；组间 total 降序', () => {
    const c = city([
      district('A', [
        b({ notePath: 'A/1.md', title: '1', construction: true, openTasks: 2 }),
        b({ notePath: 'A/2.md', title: '2', construction: false }), // 非工地
      ]),
      district('B', [
        b({ notePath: 'B/1.md', title: '1', construction: true, openTasks: 1 }),
        b({ notePath: 'B/2.md', title: '2', construction: true, openTasks: 3 }),
      ]),
    ]);
    const groups = groupTasks(c);
    // B(2) 在 A(1) 前
    expect(groups.map((g) => g.dir)).toEqual(['B', 'A']);
    expect(groups[0].total).toBe(2);
    expect(groups[1].items.length).toBe(1);
  });

  it('组内 openTasks 降序，再 mtimeMs 降序，再 notePath 字典序', () => {
    const c = city([
      district('A', [
        b({ notePath: 'A/low.md', title: 'low', construction: true, openTasks: 1, mtimeMs: 100 }),
        b({ notePath: 'A/high.md', title: 'high', construction: true, openTasks: 5, mtimeMs: 50 }),
        b({ notePath: 'A/mid1.md', title: 'mid1', construction: true, openTasks: 3, mtimeMs: 200 }),
        b({ notePath: 'A/mid2.md', title: 'mid2', construction: true, openTasks: 3, mtimeMs: 100 }),
      ]),
    ]);
    const items = groupTasks(c)[0].items;
    expect(items.map((i) => i.title)).toEqual(['high', 'mid1', 'mid2', 'low']);
  });

  it('同 total 组按 dir 字典序', () => {
    const c = city([
      district('Z', [b({ notePath: 'Z/1.md', construction: true, openTasks: 1 })]),
      district('A', [b({ notePath: 'A/1.md', construction: true, openTasks: 1 })]),
    ]);
    expect(groupTasks(c).map((g) => g.dir)).toEqual(['A', 'Z']);
  });

  it('无工地返回空数组', () => {
    const c = city([district('A', [b({ construction: false })])]);
    expect(groupTasks(c)).toEqual([]);
  });

  it('totalConstruction 统计全城工地数', () => {
    const c = city([
      district('A', [b({ construction: true }), b({ construction: false })]),
      district('B', [b({ construction: true }), b({ construction: true })]),
    ]);
    expect(totalConstruction(c)).toBe(3);
  });
});
