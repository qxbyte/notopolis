import { describe, expect, it } from 'vitest';
import type { Chunk } from '../src/server/rag/chunker.js';
import { KeywordIndex, tokenize } from '../src/server/rag/keyword.js';

function mkChunk(id: number, text: string, title = '笔记'): Chunk {
  return {
    id: `d${id}.md#0`,
    docPath: `d${id}.md`,
    title,
    headings: [],
    index: 0,
    startLine: 1,
    endLine: 1,
    text,
    hash: `h${id}`,
  };
}

describe('tokenize', () => {
  it('拉丁词小写整词 + 中文二元组', () => {
    expect(tokenize('RRF 融合')).toEqual(['rrf', '融合']);
    expect(tokenize('检索增强')).toEqual(['检索', '索增', '增强']);
  });
  it('单个汉字退化为单字 token', () => {
    expect(tokenize('墨')).toEqual(['墨']);
  });
  it('数字与下划线并入拉丁词', () => {
    expect(tokenize('err_404 发生')).toEqual(['err_404', '发生']);
  });
});

describe('KeywordIndex (BM25)', () => {
  const chunks = [
    mkChunk(1, '向量检索负责语义召回，关键词检索负责精确召回。'),
    mkChunk(2, '今天天气很好，适合出门散步。'),
    mkChunk(3, 'RRF 融合两路检索结果，k 取 60。'),
  ];
  const idx = new KeywordIndex(chunks);

  it('含查询词的片段排前，无关片段不返回', () => {
    const hits = idx.search('检索 召回', 10);
    expect(hits[0].chunk.docPath).toBe('d1.md');
    expect(hits.map((h) => h.chunk.docPath)).not.toContain('d2.md');
  });

  it('精确术语（拉丁词）可召回', () => {
    const hits = idx.search('RRF', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.docPath).toBe('d3.md');
  });

  it('coverage 返回查询词覆盖率', () => {
    expect(idx.coverage('RRF 融合', 2)).toBe(1);
    expect(idx.coverage('RRF 融合', 1)).toBe(0);
  });

  it('空查询/空索引安全返回空', () => {
    expect(idx.search('', 5)).toEqual([]);
    expect(new KeywordIndex([]).search('检索', 5)).toEqual([]);
  });
});
