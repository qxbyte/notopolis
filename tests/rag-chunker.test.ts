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
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headings).toEqual(['架构']);
    expect(chunks[1].headings).toEqual(['架构', '检索层']);
  });

  it('同级标题替换章节栈而非叠加', () => {
    const raw = '## A\n\n甲。\n\n## B\n\n乙。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    expect(chunks[1].headings).toEqual(['B']);
  });

  it('章节链不同但含空格时不误判为同章节', () => {
    // ['A B'] vs ['A','B'] 若用空格 join 比较会碰撞——必须按数组逐项比较
    const raw = '# A B\n\n甲内容够长撑开一段。\n\n# A\n\n## B\n\n乙内容也够长撑一段。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    expect(chunks.find((c) => c.text.includes('甲内容'))!.headings).toEqual(['A B']);
    expect(chunks.find((c) => c.text.includes('乙内容'))!.headings).toEqual(['A', 'B']);
  });

  it('记录原文行号区间（含 frontmatter 偏移）', () => {
    const raw = '---\nk: v\n---\n# 标题\n\n第一段。';
    const [c] = chunkMarkdown(raw, DOC, '设计');
    expect(c.startLine).toBe(6); // 「第一段。」在原文第 6 行
    expect(c.endLine).toBe(6);
  });

  it('未超限的代码块原子不拆', () => {
    const code = '```js\n' + 'const x = 1;\n'.repeat(5) + '```';
    const chunks = chunkMarkdown(`前文。\n\n${code}\n\n后文。`, DOC, '设计', { maxChars: 200 });
    const codeChunk = chunks.find((c) => c.text.includes('const x = 1;'));
    expect(codeChunk).toBeDefined();
    expect((codeChunk!.text.match(/const x = 1;/g) ?? []).length).toBe(5);
  });

  it('超过 maxChars 封片，相邻片带尾部重叠', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `第${i}段内容，足够长的一句话来撑字数。`);
    const chunks = chunkMarkdown(paras.join('\n\n'), DOC, '设计', {
      maxChars: 40,
      overlapChars: 30,
      minChars: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].overlap).toBeTruthy();
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

describe('重叠上下文（overlap 独立字段）', () => {
  const opts = { maxChars: 40, overlapChars: 30, minChars: 0 };

  it('overlap 不进 text，text 与行号区间一一对应', () => {
    const raw = '第一段甲乙丙丁。\n\n第二段戊己庚辛。\n\n第三段壬癸子丑。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 10, overlapChars: 10, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.includes('…')).toBe(false);
    expect(chunks[1].text.includes('第一段')).toBe(false);
    expect(chunks[1].overlap).toContain('第一段');
  });

  it('overlap 按整行取，不切词', () => {
    const raw = '短行。\n结尾完整一行。\n\n下一段的内容在这里。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 16, overlapChars: 8, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // 重叠必须是前片的完整行尾，而不是裸字符切出来的半个词
    expect(chunks[1].overlap).toBe('结尾完整一行。');
  });

  it('跨标题边界不做重叠', () => {
    const raw = '# 甲\n\n甲的内容。\n\n# 乙\n\n乙的内容。';
    const chunks = chunkMarkdown(raw, DOC, '设计', opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].overlap).toBeUndefined();
  });

  it('hash 只算主体文本，不受前片影响', () => {
    const a = chunkMarkdown('前段填充内容够长。\n\n目标段落文本。', DOC, '设计', {
      maxChars: 12,
      overlapChars: 10,
      minChars: 0,
    });
    const b = chunkMarkdown('换一段前文也够长。\n\n目标段落文本。', DOC, '设计', {
      maxChars: 12,
      overlapChars: 10,
      minChars: 0,
    });
    const ca = a.find((c) => c.text === '目标段落文本。');
    const cb = b.find((c) => c.text === '目标段落文本。');
    expect(ca && cb).toBeTruthy();
    expect(ca!.hash).toBe(cb!.hash);
  });
});

describe('超长原子块二次切分', () => {
  it('超长代码块按行切窗，每片围栏完整', () => {
    const code = '```js\n' + 'const x = 1;\n'.repeat(50) + '```';
    const chunks = chunkMarkdown(code, DOC, '设计', { maxChars: 200, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    let total = 0;
    for (const c of chunks) {
      expect(c.text.startsWith('```js')).toBe(true);
      expect(c.text.endsWith('```')).toBe(true);
      expect(c.text.length).toBeLessThanOrEqual(250);
      total += (c.text.match(/const x = 1;/g) ?? []).length;
    }
    expect(total).toBe(50); // 内容一行不丢
  });

  it('超长表格按行切窗，每片重复表头', () => {
    const header = '| 名称 | 说明 |\n|---|---|';
    const rows = Array.from({ length: 40 }, (_, i) => `| 项目${i} | 这是第 ${i} 行的说明文字 |`);
    const raw = `${header}\n${rows.join('\n')}`;
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 300, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    let total = 0;
    for (const c of chunks) {
      expect(c.text.startsWith('| 名称 | 说明 |')).toBe(true);
      expect(c.text.split('\n')[1]).toMatch(/^\|[\s:|-]+\|$/);
      total += (c.text.match(/^\| 项目/gm) ?? []).length;
    }
    expect(total).toBe(40); // 数据行不丢不重
  });

  it('无换行的超长单行按句子切', () => {
    const raw = Array.from({ length: 20 }, (_, i) => `第${i}句陈述内容。`).join('');
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 60, minChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(80);
    const joined = chunks.map((c) => c.text).join('');
    expect(joined).toBe(raw); // 句界切分无损
  });
});

describe('过短片段合并（minChars）', () => {
  it('低于 minChars 的片段并入相邻片，headings 取公共前缀', () => {
    const raw = '# 根\n\n## 甲\n\n短。\n\n## 乙\n\n也短。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 1200, minChars: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('短。');
    expect(chunks[0].text).toContain('也短。');
    expect(chunks[0].headings).toEqual(['根']);
  });

  it('连续短片链式合并不突破 maxChars', () => {
    const sections = Array.from(
      { length: 30 },
      (_, i) => `## 节${i}\n\n这一节固定六十个字符左右的内容,${'补'.repeat(38)}。`,
    );
    const chunks = chunkMarkdown(sections.join('\n\n'), DOC, '设计', {
      maxChars: 200,
      minChars: 100,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200);
  });

  it('minChars=0 关闭合并', () => {
    const raw = '# 根\n\n## 甲\n\n短。\n\n## 乙\n\n也短。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    expect(chunks).toHaveLength(2);
  });
});

describe('围栏识别强化', () => {
  it('四反引号围栏内的三反引号是内容，不翻转状态', () => {
    const raw = '````md\n代码示例：\n```js\nconst a = 1;\n```\n说明文字。\n````\n\n# 后续章节\n\n后续内容。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    const fenceChunk = chunks.find((c) => c.text.includes('const a = 1;'));
    expect(fenceChunk).toBeDefined();
    expect(fenceChunk!.text).toContain('说明文字。');
    const tail = chunks.find((c) => c.headings.includes('后续章节'));
    expect(tail).toBeDefined();
    expect(tail!.text).toBe('后续内容。');
  });

  it('``` 与 ~~~ 不互相闭合', () => {
    const raw = '```\n~~~\n内部内容\n~~~\n```';
    const chunks = chunkMarkdown(raw, DOC, '设计', { minChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(raw); // 整块原子，~~~ 不打断 ``` 围栏
  });

  it('blockquote 围栏识别为整体，超限切窗时每片补回围栏', () => {
    const part1 = Array.from({ length: 8 }, (_, i) => `> 状态${i} --> 状态${i + 1}`);
    const part2 = Array.from({ length: 8 }, (_, i) => `> 节点${i} --> 节点${i + 1}`);
    const raw = ['> ```mermaid', ...part1, '', ...part2, '> ```'].join('\n');
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 150, minChars: 0 });
    const pieces = chunks.filter((c) => c.text.includes('-->'));
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.text.startsWith('> ```mermaid')).toBe(true); // 引用中的空行不打断围栏,切窗后围栏补全
      expect(p.text.endsWith('```')).toBe(true);
    }
  });
});

describe('水平线（thematic break）', () => {
  it('--- 不进片段文本，仅作块边界', () => {
    const raw = '第一段。\n\n---\n\n第二段。';
    const chunks = chunkMarkdown(raw, DOC, '设计', { maxChars: 10, minChars: 0 });
    expect(chunks.every((c) => !/^-{3,}$/m.test(c.text))).toBe(true);
    expect(chunks.map((c) => c.text).join('\n')).toContain('第一段。');
    expect(chunks.map((c) => c.text).join('\n')).toContain('第二段。');
  });
});

describe('embedInput', () => {
  it('前缀 = 标题 > 章节链', () => {
    const [c] = chunkMarkdown('# 检索\n\n正文。', DOC, '设计');
    expect(embedInput(c)).toBe('设计 > 检索\n正文。');
  });

  it('有 overlap 时拼在正文前', () => {
    const chunks = chunkMarkdown('前一段落。\n\n目标段落文本。', DOC, '设计', {
      maxChars: 8,
      overlapChars: 10,
      minChars: 0,
    });
    const c = chunks.find((x) => x.text === '目标段落文本。');
    expect(c?.overlap).toBe('前一段落。');
    expect(embedInput(c!)).toBe(`设计\n前一段落。\n目标段落文本。`);
  });
});
