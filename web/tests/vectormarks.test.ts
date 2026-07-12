// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectVectorMarks } from '../src/render2d/vectormarks';
import { footprintR } from '../src/render2d/citypainter';
import type { Building, CityModel } from '@shared/types';

function mkBuilding(notePath: string, x: number, z: number, size: 1 | 2 | 3 = 1): Building {
  return {
    notePath,
    title: notePath,
    x,
    z,
    rotY: 0,
    size,
    landmark: false,
    construction: false,
    isCivic: false,
    mainStreet: false,
    mtimeMs: 0,
    wordCount: 100,
    inlinks: 0,
    openTasks: 0,
    excerpt: '',
    outlinks: [],
  };
}

const CITY = {
  vaultId: 'v1',
  name: '测试城',
  theme: 'plains',
  tier: 'camp',
  districts: [
    {
      dir: '01-AI',
      x: 0,
      z: 0,
      width: 20,
      depth: 20,
      polygon: [],
      isInbox: false,
      buildings: [mkBuilding('01-AI/RAG.md', 3, 4), mkBuilding('01-AI/Agent.md', 8, 9, 3)],
    },
  ],
  roads: [],
  noteCount: 2,
  activeCount7d: 0,
  generatedAt: 0,
} as unknown as CityModel;

describe('collectVectorMarks（藏书阁屋顶饰）', () => {
  it('只为已向量化的建筑生成标记，位置在屋顶上方', () => {
    const marks = collectVectorMarks(CITY, new Set(['01-AI/RAG.md']));
    expect(marks).toHaveLength(1);
    expect(marks[0].x).toBe(3);
    // z 上移 = footprintR + 0.9（屋顶上方）
    expect(marks[0].z).toBeCloseTo(4 - footprintR(mkBuilding('01-AI/RAG.md', 3, 4)) - 0.9, 5);
  });

  it('空集合返回空（RAG 未启用时地图零改动）', () => {
    expect(collectVectorMarks(CITY, new Set())).toHaveLength(0);
  });

  it('大建筑标记位置更高（随 footprintR 缩放）', () => {
    const marks = collectVectorMarks(CITY, new Set(['01-AI/RAG.md', '01-AI/Agent.md']));
    expect(marks).toHaveLength(2);
    const small = marks[0].z - 4; // 相对屋顶中心的偏移
    const big = marks[1].z - 9;
    expect(Math.abs(big)).toBeGreaterThan(Math.abs(small));
  });
});
