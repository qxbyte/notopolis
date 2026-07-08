import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/server/parse.js';

describe('parseNote', () => {
  it('解析 frontmatter、双链、任务、字数、摘要', () => {
    const raw = [
      '---',
      'description: 测试摘要',
      '---',
      '# 标题',
      '',
      '这是正文，链接到 [[目标笔记]] 和 [[别名笔记|显示名]] 与 [[章节#小节]]。',
      '',
      '- [ ] 未完成一',
      '- [ ] 未完成二',
      '- [x] 已完成',
      '',
      '```',
      '- [ ] 代码块里的不算',
      '[[代码块里的链接不算]]',
      '```',
    ].join('\n');
    const p = parseNote(raw);
    expect(p.frontmatter.description).toBe('测试摘要');
    expect(p.linkTargets).toEqual(['目标笔记', '别名笔记', '章节']);
    expect(p.openTasks).toBe(2);
    expect(p.excerpt).toBe('测试摘要');
    expect(p.wordCount).toBeGreaterThan(10);
  });

  it('无 frontmatter 时摘要取首段', () => {
    const p = parseNote('# 头\n\n第一段正文。\n\n第二段。');
    expect(p.excerpt).toBe('第一段正文。');
  });
});
