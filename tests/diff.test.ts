import { describe, expect, it } from 'vitest';
import { diffCity, snapshotOf } from '../src/server/diff.js';
import type { Building, CityModel, CitySnapshot, District } from '../src/shared/types.js';

function b(overrides: Partial<Building>): Building {
  return {
    notePath: 'x.md', title: 'x', x: 0, z: 0, rotY: 0, size: 1,
    landmark: false, construction: false, isCivic: false, mainStreet: false,
    mtimeMs: 100, wordCount: 0, inlinks: 0, openTasks: 0, excerpt: '',
    ...overrides,
  } as Building;
}
function city(buildings: Building[]): CityModel {
  const district: District = {
    dir: 'A', x: 0, z: 0, width: 10, depth: 10, polygon: [], isInbox: false, buildings,
  };
  return {
    vaultId: 'v', name: 'v', theme: 'plains', tier: 'village',
    districts: [district], roads: [], noteCount: buildings.length, activeCount7d: 0, generatedAt: 0,
  };
}

describe('diffCity', () => {
  it('首访：prev=null → firstVisit，各数组空', () => {
    const d = diffCity(null, city([b({ notePath: 'A/1.md' })]));
    expect(d.firstVisit).toBe(true);
    expect(d.lastVisitAt).toBeNull();
    expect(d.created).toEqual([]);
    expect(d.updated).toEqual([]);
    expect(d.tasksAdded).toBe(0);
  });

  it('新建：快照无该 path → created，openTasks 全额进 tasksAdded', () => {
    const prev: CitySnapshot = { visitedAt: 1, notes: {} };
    const d = diffCity(prev, city([b({ notePath: 'A/new.md', title: 'new', openTasks: 3 })]));
    expect(d.firstVisit).toBe(false);
    expect(d.created).toEqual([{ path: 'A/new.md', title: 'new' }]);
    expect(d.tasksAdded).toBe(3);
  });

  it('翻修：mtimeMs 变化 → updated；未变不出现', () => {
    const prev: CitySnapshot = {
      visitedAt: 1,
      notes: { 'A/1.md': { mtimeMs: 100, openTasks: 0, landmark: false },
               'A/2.md': { mtimeMs: 100, openTasks: 0, landmark: false } },
    };
    const d = diffCity(prev, city([
      b({ notePath: 'A/1.md', title: '1', mtimeMs: 200 }), // 改
      b({ notePath: 'A/2.md', title: '2', mtimeMs: 100 }), // 未改
    ]));
    expect(d.updated).toEqual([{ path: 'A/1.md', title: '1' }]);
  });

  it('拆除：快照有现在无 → removed，title 从 path 推导', () => {
    const prev: CitySnapshot = {
      visitedAt: 1,
      notes: { 'A/gone.md': { mtimeMs: 100, openTasks: 0, landmark: false } },
    };
    const d = diffCity(prev, city([]));
    expect(d.removed).toEqual([{ path: 'A/gone.md', title: 'gone' }]);
  });

  it('地标晋升：false→true 进 newLandmarks；一直 true 不进', () => {
    const prev: CitySnapshot = {
      visitedAt: 1,
      notes: { 'A/rise.md': { mtimeMs: 100, openTasks: 0, landmark: false },
               'A/king.md': { mtimeMs: 100, openTasks: 0, landmark: true } },
    };
    const d = diffCity(prev, city([
      b({ notePath: 'A/rise.md', title: 'rise', landmark: true }),
      b({ notePath: 'A/king.md', title: 'king', landmark: true }),
    ]));
    expect(d.newLandmarks).toEqual([{ path: 'A/rise.md', title: 'rise' }]);
  });

  it('任务增减：done/added 按笔记逐一累计，互不串扰', () => {
    const prev: CitySnapshot = {
      visitedAt: 1,
      notes: { 'A/a.md': { mtimeMs: 100, openTasks: 5, landmark: false },
               'A/b.md': { mtimeMs: 100, openTasks: 1, landmark: false } },
    };
    const d = diffCity(prev, city([
      b({ notePath: 'A/a.md', mtimeMs: 100, openTasks: 2 }), // 完成 3
      b({ notePath: 'A/b.md', mtimeMs: 100, openTasks: 4 }), // 新增 3
    ]));
    expect(d.tasksDone).toBe(3);
    expect(d.tasksAdded).toBe(3);
  });

  it('确定性：输出数组按 path 排序，同输入两次 deepEqual', () => {
    const prev: CitySnapshot = { visitedAt: 1, notes: {} };
    const c = city([
      b({ notePath: 'A/z.md', title: 'z' }),
      b({ notePath: 'A/a.md', title: 'a' }),
    ]);
    const d1 = diffCity(prev, c);
    const d2 = diffCity(prev, c);
    expect(d1).toEqual(d2);
    expect(d1.created.map((x) => x.path)).toEqual(['A/a.md', 'A/z.md']);
  });

  it('snapshotOf 往返：紧接着再 diff → 全空', () => {
    const c = city([
      b({ notePath: 'A/1.md', mtimeMs: 100, openTasks: 2, landmark: true }),
      b({ notePath: 'A/2.md', mtimeMs: 300 }),
    ]);
    const snap = snapshotOf(c, 999);
    const d = diffCity(snap, c);
    expect(d.created).toEqual([]);
    expect(d.updated).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.newLandmarks).toEqual([]);
    expect(d.tasksDone).toBe(0);
    expect(d.tasksAdded).toBe(0);
    expect(d.lastVisitAt).toBe(999);
  });
});
