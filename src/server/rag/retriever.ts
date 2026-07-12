/**
 * rag/retriever.ts — 检索质量层：混合召回 → RRF 融合 → 轻量重排 → 过滤链。
 * 过滤链顺序固定：minScore（向量分）→ 片段 hash 去重 → 单文档上限 → 上下文预算。
 * 纯函数导出，便于单测；嵌入函数注入，测试离线可跑。
 */
import type { RagConfig, RagHit } from '../../shared/types.js';
import type { Chunk } from './chunker.js';
import type { KeywordIndex } from './keyword.js';
import type { VectorStore } from './store.js';

export type RetrieveMode = 'hybrid' | 'vector' | 'keyword';

export interface ScoredChunk {
  chunk: Chunk;
  /** 展示/阈值用分数：向量余弦（关键词单路时为归一化 BM25） */
  score: number;
  vecScore?: number;
  kwScore?: number;
}

const RRF_K = 60;
/** 召回宽度 = topK × 4（两路各自），融合后收敛 */
const WIDTH_FACTOR = 4;

/** RRF 融合：score = Σ 1/(k + rank)。对两路分数尺度不敏感，免调权。 */
export function fuseRRF(lists: ScoredChunk[][], k = RRF_K): ScoredChunk[] {
  const acc = new Map<string, { item: ScoredChunk; rrf: number }>();
  for (const list of lists) {
    list.forEach((sc, rank) => {
      const prev = acc.get(sc.chunk.id);
      const rrf = 1 / (k + rank + 1);
      if (prev) {
        prev.rrf += rrf;
        prev.item.vecScore = prev.item.vecScore ?? sc.vecScore;
        prev.item.kwScore = prev.item.kwScore ?? sc.kwScore;
        prev.item.score = Math.max(prev.item.score, sc.score);
      } else {
        acc.set(sc.chunk.id, { item: { ...sc }, rrf });
      }
    });
  }
  return [...acc.values()]
    .sort((a, b) => b.rrf - a.rrf || b.item.score - a.item.score)
    .map((x) => x.item);
}

/** 片段内容 hash 去重：跨文档的重复片段只保留排名最高者 */
export function dedupeByHash(list: ScoredChunk[]): ScoredChunk[] {
  const seen = new Set<string>();
  return list.filter((sc) => {
    if (seen.has(sc.chunk.hash)) return false;
    seen.add(sc.chunk.hash);
    return true;
  });
}

/** 单文档片段上限：防一篇长文垄断上下文 */
export function capPerDoc(list: ScoredChunk[], perDocLimit: number): ScoredChunk[] {
  const counts = new Map<string, number>();
  return list.filter((sc) => {
    const n = counts.get(sc.chunk.docPath) ?? 0;
    if (n >= perDocLimit) return false;
    counts.set(sc.chunk.docPath, n + 1);
    return true;
  });
}

/** 上下文字符预算打包：按序累积，超预算即止（至少保留 1 条） */
export function packContext(list: ScoredChunk[], maxContextChars: number): ScoredChunk[] {
  const out: ScoredChunk[] = [];
  let used = 0;
  for (const sc of list) {
    if (out.length > 0 && used + sc.chunk.text.length > maxContextChars) break;
    out.push(sc);
    used += sc.chunk.text.length;
  }
  return out;
}

export interface RetrieveDeps {
  store: VectorStore;
  kwIndex: KeywordIndex;
  /** query → 归一化向量（注入 embed.ts 或测试假嵌入） */
  embedQuery: (q: string) => Promise<number[]>;
}

export async function retrieve(
  query: string,
  deps: RetrieveDeps,
  opts: RagConfig['retrieval'],
  mode: RetrieveMode = 'hybrid',
): Promise<ScoredChunk[]> {
  const width = Math.max(1, opts.topK) * WIDTH_FACTOR;
  const effMode: RetrieveMode = mode === 'hybrid' && !opts.hybrid ? 'vector' : mode;

  const lists: ScoredChunk[][] = [];

  if (effMode !== 'keyword') {
    const qv = await deps.embedQuery(query);
    const vecHits = deps.store
      .search(qv, width)
      .filter((h) => h.score >= opts.minScore)
      .map((h) => ({ chunk: h.chunk, score: h.score, vecScore: h.score }));
    lists.push(vecHits);
  }
  if (effMode !== 'vector') {
    const kwHits = deps.kwIndex.search(query, width).map((h) => ({
      chunk: h.chunk,
      // BM25 分数无界，压到 0-1 便于统一展示（不参与融合排序）
      score: Math.min(1, h.score / 10),
      kwScore: h.score,
    }));
    lists.push(kwHits);
  }

  let fused = lists.length === 1 ? lists[0] : fuseRRF(lists);

  // 轻量重排：查询词覆盖率微调（RRF 名次为主，覆盖率打破并列）
  const idByPos = new Map<string, number>();
  deps.store.chunks().forEach((c, i) => idByPos.set(c.id, i));
  fused = fused
    .map((sc, rank) => {
      const idx = idByPos.get(sc.chunk.id);
      const cov = idx === undefined ? 0 : deps.kwIndex.coverage(query, idx);
      return { sc, key: -rank + cov * 1.5 }; // 覆盖率满分可抵 1.5 个名次
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.sc);

  return packContext(capPerDoc(dedupeByHash(fused), opts.perDocLimit), opts.maxContextChars).slice(
    0,
    opts.topK,
  );
}

export function toHit(sc: ScoredChunk): RagHit {
  return {
    id: sc.chunk.id,
    docPath: sc.chunk.docPath,
    title: sc.chunk.title,
    headings: sc.chunk.headings,
    startLine: sc.chunk.startLine,
    endLine: sc.chunk.endLine,
    text: sc.chunk.text,
    score: Math.round(sc.score * 1000) / 1000,
  };
}
