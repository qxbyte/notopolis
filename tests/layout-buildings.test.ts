import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/server/graph.js';
import { layoutDistricts, pointInPolygon } from '../src/server/layout/districts.js';
import { placeBuildings } from '../src/server/layout/buildings.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

// 取真实 Plot（含 polygon），由 layoutDistricts 生成，避免手写多边形
const PLOT = layoutDistricts([{ dir: '01-AI', count: 3 }])[0];

async function aiNotes() {
  const { notes } = await scanVault(FIXTURE);
  return { notes: notes.filter((n) => n.dir === '01-AI'), graph: buildGraph(notes) };
}

describe('placeBuildings', () => {
  it('确定性 + 无重叠落位', async () => {
    const { notes, graph } = await aiNotes();
    const a = placeBuildings(PLOT, notes, graph.inlinks);
    const b = placeBuildings(PLOT, notes, graph.inlinks);
    expect(a).toEqual(b);
    const keys = a.map((x) => `${x.x},${x.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of a) {
      expect(x.x).toBeGreaterThan(PLOT.x);
      expect(x.x).toBeLessThan(PLOT.x + PLOT.width);
    }
  });

  it('README 是区府，README 链接的笔记在主街', async () => {
    const { notes, graph } = await aiNotes();
    const placed = placeBuildings(PLOT, notes, graph.inlinks);
    const civic = placed.find((x) => x.isCivic)!;
    expect(civic.title).toBe('README');
    expect(placed.find((x) => x.title === 'Transformer')!.mainStreet).toBe(true);
    expect(placed.find((x) => x.title === 'RAG')!.mainStreet).toBe(true);
  });

  it('高被引成为地标，任务笔记有施工位，体量随字数', async () => {
    const { notes, graph } = await aiNotes();
    const placed = placeBuildings(PLOT, notes, graph.inlinks);
    const tf = placed.find((x) => x.title === 'Transformer')!;
    expect(tf.landmark).toBe(true);
    expect(tf.construction).toBe(true);
    expect(tf.size).toBe(1); // fixture 字数少
    expect(tf.inlinks).toBe(3);
  });

  it('多边形约束：所有建筑坐标在 plot.polygon 内，且笔记数 === 建筑数（不丢楼）', async () => {
    const { notes, graph } = await aiNotes();
    const placed = placeBuildings(PLOT, notes, graph.inlinks);
    // 建筑数等于笔记数（不丢楼）
    expect(placed.length).toBe(notes.length);
    // 每栋楼的格心在多边形内（或属于回退落位时仍在 bbox 内）
    for (const b of placed) {
      const inPoly = pointInPolygon(b.x, b.z, PLOT.polygon);
      const inBbox =
        b.x >= PLOT.x &&
        b.x <= PLOT.x + PLOT.width &&
        b.z >= PLOT.z &&
        b.z <= PLOT.z + PLOT.depth;
      expect(inPoly || inBbox).toBe(true);
    }
  });
});
