import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Chunk } from '../src/server/rag/chunker.js';
import { KeywordIndex } from '../src/server/rag/keyword.js';
import {
  capPerDoc,
  dedupeByHash,
  fuseRRF,
  packContext,
  retrieve,
  type ScoredChunk,
} from '../src/server/rag/retriever.js';
import { FileVectorStore } from '../src/server/rag/store.js';

function mkChunk(docPath: string, i: number, text: string, hash?: string): Chunk {
  return {
    id: `${docPath}#${i}`,
    docPath,
    title: path.basename(docPath, '.md'),
    headings: [],
    index: i,
    startLine: 1,
    endLine: 1,
    text,
    hash: hash ?? `h-${docPath}-${i}`,
  };
}

const sc = (chunk: Chunk, score = 0.5): ScoredChunk => ({ chunk, score });

describe('纯过滤函数', () => {
  it('fuseRRF：双路都靠前的片段融合后最高', () => {
    const a = mkChunk('a.md', 0, 'A');
    const b = mkChunk('b.md', 0, 'B');
    const c = mkChunk('c.md', 0, 'C');
    // a 在两路均第 1；b/c 各只在一路
    const fused = fuseRRF([[sc(a), sc(b)], [sc(a), sc(c)]]);
    expect(fused[0].chunk.id).toBe('a.md#0');
  });

  it('dedupeByHash：跨文档同内容只留排名高者', () => {
    const dup1 = mkChunk('a.md', 0, '同文', 'same');
    const dup2 = mkChunk('b.md', 0, '同文', 'same');
    expect(dedupeByHash([sc(dup1), sc(dup2)]).map((x) => x.chunk.docPath)).toEqual(['a.md']);
  });

  it('capPerDoc：单文档片段数不超上限', () => {
    const list = [0, 1, 2].map((i) => sc(mkChunk('a.md', i, `${i}`)));
    list.push(sc(mkChunk('b.md', 0, 'B')));
    const capped = capPerDoc(list, 2);
    expect(capped.filter((x) => x.chunk.docPath === 'a.md')).toHaveLength(2);
    expect(capped.filter((x) => x.chunk.docPath === 'b.md')).toHaveLength(1);
  });

  it('packContext：超字符预算截断但至少留一条', () => {
    const long = sc(mkChunk('a.md', 0, 'x'.repeat(500)));
    const more = sc(mkChunk('b.md', 0, 'y'.repeat(500)));
    expect(packContext([long, more], 600)).toHaveLength(1);
    expect(packContext([long], 100)).toHaveLength(1); // 单条超预算也保留
  });
});

describe('retrieve 全链路（假嵌入）', () => {
  async function setup() {
    const dir = await mkdtemp(path.join(tmpdir(), 'noto-ret-'));
    const store = new FileVectorStore(dir);
    await store.load();
    // 语义空间：向量检索命中 sem.md；关键词命中 kw.md（向量远离查询）
    const mk = (p: string, v: number[], text: string) =>
      store.upsertDoc(
        { docPath: p, docHash: p, mtimeMs: 1, chunkCount: 1, indexedAt: 2, model: 'm', dims: 3 },
        [mkChunk(p, 0, text)],
        [v],
      );
    await mk('sem.md', [1, 0, 0], '语义相近的内容。');
    await mk('kw.md', [0, 1, 0], '独特术语 zzza 出现在这里。');
    await mk('far.md', [0, 0, 1], '毫不相干。');
    const kwIndex = new KeywordIndex(store.chunks());
    const embedQuery = async () => [0.9, 0.1, 0].map((x) => x / Math.hypot(0.9, 0.1));
    return { store, kwIndex, embedQuery };
  }

  const OPTS = { topK: 5, minScore: 0.3, perDocLimit: 3, maxContextChars: 6000, hybrid: true };

  it('hybrid：语义命中与关键词命中都召回，低于阈值的向量命中被过滤', async () => {
    const deps = await setup();
    const hits = await retrieve('zzza', deps, OPTS, 'hybrid');
    const docs = hits.map((h) => h.chunk.docPath);
    expect(docs).toContain('sem.md'); // 向量路（cos≈0.99）
    expect(docs).toContain('kw.md'); // 关键词路（术语精确命中）
    expect(docs).not.toContain('far.md'); // 向量 0 分 + 无关键词
  });

  it('vector 模式不走关键词路', async () => {
    const deps = await setup();
    const hits = await retrieve('zzza', deps, OPTS, 'vector');
    expect(hits.map((h) => h.chunk.docPath)).toEqual(['sem.md']);
  });

  it('keyword 模式不调用嵌入', async () => {
    const deps = await setup();
    deps.embedQuery = async () => {
      throw new Error('不应被调用');
    };
    const hits = await retrieve('zzza', deps, OPTS, 'keyword');
    expect(hits.map((h) => h.chunk.docPath)).toEqual(['kw.md']);
  });

  it('hybrid=false 配置降级为纯向量', async () => {
    const deps = await setup();
    const hits = await retrieve('zzza', deps, { ...OPTS, hybrid: false }, 'hybrid');
    expect(hits.map((h) => h.chunk.docPath)).toEqual(['sem.md']);
  });

  it('topK 收敛结果数', async () => {
    const deps = await setup();
    const hits = await retrieve('zzza 语义', deps, { ...OPTS, topK: 1 }, 'hybrid');
    expect(hits).toHaveLength(1);
  });
});
