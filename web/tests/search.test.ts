import { describe, expect, it } from 'vitest';
import { searchNotes, type SearchItem } from '../src/util/search';

const ITEMS: SearchItem[] = [
  { notePath: '01-AI/RAG.md', title: 'RAG', dir: '01-AI' },
  { notePath: '01-AI/Transformer.md', title: 'Transformer', dir: '01-AI' },
  { notePath: '01-AI/RAGtime.md', title: 'RAGtime', dir: '01-AI' },
  { notePath: '02-Notes/检索增强.md', title: '检索增强生成', dir: '02-Notes' },
  { notePath: '03-Deep/内含 rag 字样.md', title: '内含 rag 字样', dir: '03-Deep' },
];

describe('searchNotes', () => {
  it('打分次序：全等 > 前缀 > 包含', () => {
    const hits = searchNotes('rag', ITEMS);
    // RAG 全等(1000) 最前，RAGtime 前缀(800) 其次，「内含 rag 字样」包含(600) 再次
    expect(hits[0].title).toBe('RAG');
    expect(hits[0].score).toBe(1000);
    expect(hits[1].title).toBe('RAGtime');
    expect(hits[1].score).toBe(800);
    const contains = hits.find((h) => h.title === '内含 rag 字样');
    expect(contains?.score).toBe(600);
  });

  it('大小写不敏感', () => {
    expect(searchNotes('RAG', ITEMS)[0].title).toBe('RAG');
    expect(searchNotes('rag', ITEMS)[0].title).toBe('RAG');
  });

  it('中文包含命中', () => {
    const hits = searchNotes('检索', ITEMS);
    expect(hits.some((h) => h.title === '检索增强生成')).toBe(true);
  });

  it('路径包含（标题不含但路径含）得 400', () => {
    // 查 '02-notes'：标题都不含，仅路径含
    const hits = searchNotes('02-notes', ITEMS);
    expect(hits.length).toBe(1);
    expect(hits[0].score).toBe(400);
  });

  it('子序列仅在 q 长度 ≥ 2 时生效', () => {
    // 'tf' 是 'Transformer' 的子序列（t..f），标题不含 'tf' 连续串
    const hits = searchNotes('tf', ITEMS);
    expect(hits.some((h) => h.title === 'Transformer' && h.score === 200)).toBe(true);
    // 单字符 'z' 不触发子序列（且不包含），无命中
    expect(searchNotes('z', ITEMS).length).toBe(0);
  });

  it('limit 截断', () => {
    expect(searchNotes('a', ITEMS, 2).length).toBeLessThanOrEqual(2);
  });

  it('空 / 空白查询返回空', () => {
    expect(searchNotes('', ITEMS)).toEqual([]);
    expect(searchNotes('   ', ITEMS)).toEqual([]);
  });

  it('同分按 title.localeCompare 稳定排序', () => {
    const items: SearchItem[] = [
      { notePath: 'b.md', title: 'beta', dir: '' },
      { notePath: 'a.md', title: 'alpha', dir: '' },
    ];
    // 'a' 前缀命中 alpha(800)、包含命中 beta(600) → alpha 先（分更高）
    const hits = searchNotes('a', items);
    expect(hits[0].title).toBe('alpha');
  });
});
