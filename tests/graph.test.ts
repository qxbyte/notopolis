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
});
