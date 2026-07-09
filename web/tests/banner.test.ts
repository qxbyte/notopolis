import { describe, expect, it } from 'vitest';
import { summarize } from '../src/ui/banner';
import type { CityDiff } from '@shared/types';

function diff(overrides: Partial<CityDiff>): CityDiff {
  return {
    firstVisit: false, lastVisitAt: 1,
    created: [], updated: [], removed: [], newLandmarks: [],
    tasksDone: 0, tasksAdded: 0,
    ...overrides,
  };
}

describe('summarize', () => {
  it('首访 → null', () => {
    expect(summarize(diff({ firstVisit: true, created: [{ path: 'a', title: 'a' }] }))).toBeNull();
  });

  it('全空 → null', () => {
    expect(summarize(diff({}))).toBeNull();
  });

  it('组合文案顺序：新建 · 翻修 · 完成 · 新增', () => {
    const text = summarize(diff({
      created: [{ path: 'a', title: 'a' }, { path: 'b', title: 'b' }],
      updated: [{ path: 'c', title: 'c' }],
      tasksDone: 4,
      tasksAdded: 2,
    }));
    expect(text).toBe('自上次到访：新建 2 栋 · 翻修 1 栋 · 完成 4 项任务 · 新增 2 项任务');
  });

  it('地标 ≤2 列名', () => {
    const text = summarize(diff({
      newLandmarks: [{ path: 'a', title: 'RAG' }, { path: 'b', title: 'BM25' }],
    }));
    expect(text).toBe('自上次到访：「RAG」、「BM25」升为地标 🏛');
  });

  it('地标 >2 加「等 n 处」', () => {
    const text = summarize(diff({
      newLandmarks: [
        { path: 'a', title: 'RAG' },
        { path: 'b', title: 'BM25' },
        { path: 'c', title: 'HNSW' },
      ],
    }));
    expect(text).toBe('自上次到访：「RAG」、「BM25」等 3 处升为地标 🏛');
  });

  it('拆除计入', () => {
    expect(summarize(diff({ removed: [{ path: 'a', title: 'a' }] }))).toBe('自上次到访：拆除 1 栋');
  });
});
