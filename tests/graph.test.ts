import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/server/graph.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

describe('buildGraph', () => {
  it('统计被引数/孤儿/同区与跨区边', async () => {
    const { notes } = await scanVault(FIXTURE);
    const g = buildGraph(notes);
    // Transformer 被 README、RAG、Git 技巧引用
    expect(g.inlinks['01-AI/Transformer.md']).toBe(3);
    expect(g.inlinks['01-AI/RAG.md']).toBe(2); // README + Transformer
    expect(g.orphans).toEqual(['99-Inbox/随手记.md']);
    expect(g.intraDirEdges).toContainEqual(['01-AI/Transformer.md', '01-AI/RAG.md']);
    expect(g.crossDirEdges).toContainEqual(['02-Dev/Git 技巧.md', '01-AI/Transformer.md']);
  });

  it('outlinks：已解析、去重、无自引用；孤儿零出链', async () => {
    const { notes } = await scanVault(FIXTURE);
    const g = buildGraph(notes);
    // Transformer 出链到 RAG（同区已解析）
    expect(g.outlinks['01-AI/Transformer.md']).toContain('01-AI/RAG.md');
    // 无自引用
    for (const [from, tos] of Object.entries(g.outlinks)) {
      expect(tos).not.toContain(from);
      // 去重
      expect(new Set(tos).size).toBe(tos.length);
    }
    // 孤儿零出链
    expect(g.outlinks['99-Inbox/随手记.md']).toEqual([]);
    // 每个 outlinks 目标都是真实存在的 notePath
    const paths = new Set(notes.map((n) => n.path));
    for (const tos of Object.values(g.outlinks)) {
      for (const t of tos) expect(paths.has(t)).toBe(true);
    }
  });
});
