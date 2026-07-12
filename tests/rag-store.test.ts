import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Chunk } from '../src/server/rag/chunker.js';
import { FileVectorStore, type DocRecord } from '../src/server/rag/store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'noto-rag-'));
});

function mkChunk(docPath: string, i: number, text: string): Chunk {
  return {
    id: `${docPath}#${i}`,
    docPath,
    title: path.basename(docPath, '.md'),
    headings: [],
    index: i,
    startLine: 1,
    endLine: 1,
    text,
    hash: `h-${docPath}-${i}`,
  };
}

function mkDoc(docPath: string, chunkCount: number, model = 'm1'): DocRecord {
  return { docPath, docHash: `dh-${docPath}`, mtimeMs: 1, chunkCount, indexedAt: 2, model, dims: 3 };
}

const V = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  xy: [Math.SQRT1_2, Math.SQRT1_2, 0],
};

describe('FileVectorStore', () => {
  it('upsert 后可按余弦降序检索', async () => {
    const s = new FileVectorStore(dir);
    await s.load();
    await s.upsertDoc(mkDoc('a.md', 2), [mkChunk('a.md', 0, 'A0'), mkChunk('a.md', 1, 'A1')], [V.x, V.y]);
    const hits = s.search(V.xy, 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(s.meta()).toMatchObject({ model: 'm1', dims: 3, docCount: 1, chunkCount: 2 });
  });

  it('落盘后重载往返一致', async () => {
    const s1 = new FileVectorStore(dir);
    await s1.load();
    await s1.upsertDoc(mkDoc('a.md', 1), [mkChunk('a.md', 0, '正文')], [V.x]);
    const s2 = new FileVectorStore(dir);
    await s2.load();
    expect(s2.meta().chunkCount).toBe(1);
    expect(s2.search(V.x, 1)[0].chunk.text).toBe('正文');
    expect(s2.search(V.x, 1)[0].score).toBeCloseTo(1, 5);
  });

  it('重复 upsert 同文档：旧片段被整体替换', async () => {
    const s = new FileVectorStore(dir);
    await s.load();
    await s.upsertDoc(mkDoc('a.md', 2), [mkChunk('a.md', 0, 'old0'), mkChunk('a.md', 1, 'old1')], [V.x, V.y]);
    await s.upsertDoc(mkDoc('a.md', 1), [mkChunk('a.md', 0, 'new0')], [V.y]);
    expect(s.meta().chunkCount).toBe(1);
    expect(s.chunks()[0].text).toBe('new0');
    expect(s.search(V.y, 5)[0].score).toBeCloseTo(1, 5);
  });

  it('removeDoc 移除片段与向量并保持对齐', async () => {
    const s = new FileVectorStore(dir);
    await s.load();
    await s.upsertDoc(mkDoc('a.md', 1), [mkChunk('a.md', 0, 'A')], [V.x]);
    await s.upsertDoc(mkDoc('b.md', 1), [mkChunk('b.md', 0, 'B')], [V.y]);
    await s.removeDoc('a.md');
    expect(s.docs().map((d) => d.docPath)).toEqual(['b.md']);
    const hits = s.search(V.y, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.text).toBe('B');
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it('嵌入模型变更时整库清空重建', async () => {
    const s = new FileVectorStore(dir);
    await s.load();
    await s.upsertDoc(mkDoc('a.md', 1, 'm1'), [mkChunk('a.md', 0, 'A')], [V.x]);
    await s.upsertDoc(mkDoc('b.md', 1, 'm2'), [mkChunk('b.md', 0, 'B')], [V.y]);
    expect(s.meta().model).toBe('m2');
    expect(s.docs().map((d) => d.docPath)).toEqual(['b.md']);
  });

  it('查询向量维度不符返回空', async () => {
    const s = new FileVectorStore(dir);
    await s.load();
    await s.upsertDoc(mkDoc('a.md', 1), [mkChunk('a.md', 0, 'A')], [V.x]);
    expect(s.search([1, 0], 5)).toEqual([]);
  });

  it('损坏的库文件按空库处理', async () => {
    const s1 = new FileVectorStore(dir);
    await s1.load();
    await s1.upsertDoc(mkDoc('a.md', 1), [mkChunk('a.md', 0, 'A')], [V.x]);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'vectors.bin'), Buffer.from([1, 2, 3])); // 行数错位
    const s2 = new FileVectorStore(dir);
    await s2.load();
    expect(s2.meta().chunkCount).toBe(0);
  });
});
