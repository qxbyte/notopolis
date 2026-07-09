import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/util/markdown';

describe('renderMarkdown', () => {
  it('标题', () => {
    expect(renderMarkdown('# 标题')).toBe('<h1>标题</h1>');
    expect(renderMarkdown('### 三级')).toBe('<h3>三级</h3>');
  });

  it('粗体/斜体/行内代码', () => {
    expect(renderMarkdown('**粗** *斜* `code`')).toBe('<p><strong>粗</strong> <em>斜</em> <code>code</code></p>');
  });

  it('行内代码内的 * 不被解析为斜体', () => {
    expect(renderMarkdown('`a*b*c`')).toBe('<p><code>a*b*c</code></p>');
  });

  it('正文数字不被误伤（占位符 bug 回归）', () => {
    expect(renderMarkdown('第 3 章 有 5 节')).toBe('<p>第 3 章 有 5 节</p>');
  });

  it('链接与 wikilink', () => {
    expect(renderMarkdown('[名](http://x)')).toContain('<a href="http://x" target="_blank" rel="noopener">名</a>');
    expect(renderMarkdown('见 [[A/B|别名]]')).toContain('<span class="md-wikilink">别名</span>');
    expect(renderMarkdown('[[A/B]]')).toContain('<span class="md-wikilink">B</span>');
  });

  it('无序/有序列表', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('任务列表', () => {
    const html = renderMarkdown('- [ ] 待办\n- [x] 完成');
    expect(html).toContain('<input type="checkbox" disabled> 待办');
    expect(html).toContain('<input type="checkbox" disabled checked> 完成');
  });

  it('引用块', () => {
    expect(renderMarkdown('> 引用一行')).toBe('<blockquote>引用一行</blockquote>');
  });

  it('代码块保留内容不转义为语法', () => {
    const html = renderMarkdown('```\nconst x = **1**;\n```');
    expect(html).toBe('<pre><code>const x = **1**;</code></pre>');
  });

  it('分隔线', () => {
    expect(renderMarkdown('---')).toBe('<hr>');
  });

  it('HTML 转义防注入', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('段落按空行分隔', () => {
    expect(renderMarkdown('第一段\n\n第二段')).toBe('<p>第一段</p>\n<p>第二段</p>');
  });
});
