import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

describe('scanVault', () => {
  it('扫描 fixture vault：5 篇笔记，忽略 .obsidian', async () => {
    const r = await scanVault(FIXTURE);
    expect(r.notes.map((n) => n.path)).toEqual([
      '01-AI/RAG.md',
      '01-AI/README.md',
      '01-AI/Transformer.md',
      '02-Dev/Git 技巧.md',
      '99-Inbox/随手记.md',
    ]);
    const tf = r.notes.find((n) => n.title === 'Transformer')!;
    expect(tf.dir).toBe('01-AI');
    expect(tf.openTasks).toBe(1);
    expect(tf.links).toEqual(['RAG']);
    expect(tf.mtimeMs).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
  });

  it('根目录不可读时降级为 errors 而非抛出', async () => {
    const r = await scanVault('/nonexistent/path/xyz');
    expect(r.notes).toEqual([]);
    expect(r.errors.length).toBe(1);
  });
});
