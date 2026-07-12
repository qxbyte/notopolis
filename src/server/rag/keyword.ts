/**
 * rag/keyword.ts — BM25 关键词索引（混合检索的精确召回路）。
 * 分词：小写拉丁词/数字 + CJK 二元组（bigram）——对术语、错误码等精确词可靠，
 * 与向量路的语义召回互补。纯函数 + 轻量类，可单测。
 */
import type { Chunk } from './chunker.js';

const K1 = 1.5;
const B = 0.75;

/** 分词：拉丁词整词 + 中文二元组（单字文档级过短时退化为单字） */
export function tokenize(s: string): string[] {
  const lower = s.toLowerCase();
  const tokens: string[] = [];
  for (const m of lower.matchAll(/[a-z0-9_]+/g)) tokens.push(m[0]);
  const cjk = lower.match(/[一-鿿]/g) ?? [];
  if (cjk.length === 1) tokens.push(cjk[0]);
  for (let i = 0; i + 1 < cjk.length; i++) tokens.push(cjk[i] + cjk[i + 1]);
  return tokens;
}

export class KeywordIndex {
  private docTokens: Map<string, number>[] = []; // 每片的词频
  private docLen: number[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private chunkList: Chunk[] = [];

  constructor(chunks: Chunk[]) {
    this.chunkList = chunks;
    for (const c of chunks) {
      const tf = new Map<string, number>();
      const toks = tokenize(`${c.title} ${c.headings.join(' ')} ${c.text}`);
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docTokens.push(tf);
      this.docLen.push(toks.length);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docLen.length
      ? this.docLen.reduce((s, v) => s + v, 0) / this.docLen.length
      : 0;
  }

  /** BM25 检索，返回按分数降序的 [{chunk, score}]（零分不返回） */
  search(query: string, topN: number): { chunk: Chunk; score: number }[] {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0 || this.chunkList.length === 0) return [];
    const N = this.chunkList.length;
    const scored: { chunk: Chunk; score: number }[] = [];
    for (let i = 0; i < N; i++) {
      let score = 0;
      const tf = this.docTokens[i];
      for (const t of qTokens) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * this.docLen[i]) / (this.avgLen || 1)));
      }
      if (score > 0) scored.push({ chunk: this.chunkList[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  /** 查询词在片段中的覆盖率（0-1），重排阶段的微调信号 */
  coverage(query: string, chunkIdx: number): number {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0) return 0;
    const tf = this.docTokens[chunkIdx];
    let hit = 0;
    for (const t of qTokens) if (tf.has(t)) hit++;
    return hit / qTokens.length;
  }
}

// 关键词索引按 store 数据版本缓存（store 写入后自动失效重建）
const kwCache = new Map<string, { version: number; index: KeywordIndex }>();

export function keywordIndexFor(key: string, version: number, chunks: Chunk[]): KeywordIndex {
  const hit = kwCache.get(key);
  if (hit && hit.version === version) return hit.index;
  const index = new KeywordIndex(chunks);
  kwCache.set(key, { version, index });
  return index;
}
