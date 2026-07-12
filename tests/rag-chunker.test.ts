import { describe, expect, it } from 'vitest';
import {
  chunkMarkdown,
  cleanMarkdown,
  contentHash,
  embedInput,
} from '../src/server/rag/chunker.js';

const DOC = 'notes/设计.md';

describe('cleanMarkdown', () => {
  it('剥离 frontmatter 并给出正文起始行', () => {
    const raw = '---\ntitle: x\ntags: [a]\n---\n正文第一行';
    const { content, frontmatter, bodyStartLine } = cleanMarkdown(raw);
    expect(content).toBe('正文第一行');
    expect(frontmatter.title).toBe('x');
    expect(bodyStartLine).toBe(5);
  });

  it('无 frontmatter 时正文从第 1 行开始', () => {
    const { content, bodyStartLine } = cleanMarkdown('hello\nworld');
    expect(content).toBe('hello\nworld');
    expect(bodyStartLine).toBe(1);
  });

  it('统一 CRLF 为 LF', () => {
    expect(cleanMarkdown('a\r\nb').content).toBe('a\nb');
  });
});

describe('chunkMarkdown', () => {
  it('章节链跟随标题层级', () => {
    const raw = '# 架构\n\n概述段。\n\n## 检索层\n\n检索细节。';
    const chunks = chunkMarkdown(raw, DOC, '设计');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headings).toEqual(['架构']);
    expect(chunks[1].headings).toEqual(['架构', '检索层']);
  });

  it('同级标题替换章节栈而非叠加', () => {
    const raw = '## A\n\n甲。\n\n## B\n\n乙。';
    const chunks = chunkMarkdown(raw, DOC, '设计');
    expect(chunks[1].headings).toEqual(['B']);
  });

  it('记录原文行号区间（含 frontmatter 偏移）', () => {
    const raw = '---\nk: v\n---\n# 标题\n\n第一段。';
    const [c] = chunkMarkdown(raw, DOC, '设计');
    expect(c.startLine).toBe(6); // 「第一段。」在原文第 6 行
    expect(c.endLine).toBe(6);
  });

  it('代码块原子不拆', () => {
    const code = '```js\n' + 'const x = 1;\n'.repeat(50) + '```';
    const chunks = chunkMarkdown(`前文。\n\n${code}\n\n后文。`, DOC, '设计', { maxChars: 100 });
    const codeChunk = chunks.find((c) => c.text.includes('const x = 1;'));
    expect(codeChunk).toBeDefined();
    expect((codeChunk!.text.match(/const x = 1;/g) ?? []).length).toBe(50);
  });

  it('超过 maxChars 封片，相邻片带尾部重叠', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `第${i}段内容，足够长的一句话来撑字数。`);
    const chunks = chunkMarkdown(paras.join('\n\n'), DOC, '设计', {
      maxChars: 40,
      overlapChars: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.startsWith('…')).toBe(true);
  });

  it('片段 id 与 hash 稳定', () => {
    const a = chunkMarkdown('内容 A。', DOC, '设计');
    const b = chunkMarkdown('内容 A。', DOC, '设计');
    expect(a[0].id).toBe(`${DOC}#0`);
    expect(a[0].hash).toBe(b[0].hash);
    expect(contentHash('x')).toHaveLength(16);
  });

  it('空文档产出零片段', () => {
    expect(chunkMarkdown('---\nk: v\n---\n', DOC, '设计')).toHaveLength(0);
  });
});

describe('embedInput', () => {
  it('前缀 = 标题 > 章节链', () => {
    const [c] = chunkMarkdown('# 检索\n\n正文。', DOC, '设计');
    expect(embedInput(c)).toBe('设计 > 检索\n正文。');
  });
});
