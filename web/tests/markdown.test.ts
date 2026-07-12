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

  it('表格：表头+分隔+数据行渲染为 table', () => {
    const html = renderMarkdown('| 需求 | 任务 |\n| --- | --- |\n| R-001 | T-002 |\n| R-002 | T-003 |');
    expect(html).toBe(
      '<table><thead><tr><th>需求</th><th>任务</th></tr></thead>' +
        '<tbody><tr><td>R-001</td><td>T-002</td></tr><tr><td>R-002</td><td>T-003</td></tr></tbody></table>',
    );
  });

  it('表格：对齐语法与单元格内联样式', () => {
    const html = renderMarkdown('| 左 | 中 | 右 |\n| --- | :---: | ---: |\n| a | **b** | `c` |');
    expect(html).toContain('<th style="text-align:center">中</th>');
    expect(html).toContain('<td style="text-align:right"><code>c</code></td>');
    expect(html).toContain('<td style="text-align:center"><strong>b</strong></td>');
  });

  it('表格：单横线对齐单元（:-:）与含行内代码的真实样例', () => {
    const src = [
      '| 菜单 | 路由 | 查询 | 导出 | 需求 | 状态 |',
      '| -------- | ----------------------------------- | :-: | :----: | --- | :----: |',
      '| 凭证清单 | `/certificate/list` | ✅ | ✅(自定义) | — | ✅ 无需修改 |',
    ].join('\n');
    const html = renderMarkdown(src);
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:center">查询</th>');
    expect(html).toContain('<td><code>/certificate/list</code></td>');
  });

  it('表格：数据行缺列按空单元格补齐', () => {
    const ragged = renderMarkdown('| a | b |\n| --- | --- |\n| 只有一列 |');
    expect(ragged).toContain('<td>只有一列</td><td></td>');
  });

  it('表格：分隔行后隔空行的数据行仍归入本表格（笔记常见写法）', () => {
    const src = '| 子菜单 | 路由 |\n| --- | --- |\n\n| 合同清单 | `/a` |\n| 计提 | `/b` |';
    const html = renderMarkdown(src);
    expect(html).toContain('<th>子菜单</th>');
    expect(html).toContain('<td>合同清单</td>');
    expect(html).toContain('<td>计提</td>');
    expect((html.match(/<table>/g) ?? []).length).toBe(1); // 是一张表，不是表头表+段落
  });

  it('==高亮== 渲染为 mark，代码段内不处理', () => {
    expect(renderMarkdown('结论：==租赁资产== 需要重点关注')).toContain(
      '<mark class="md-mark">租赁资产</mark>',
    );
    expect(renderMarkdown('`a == b` 是比较')).toContain('<code>a == b</code>');
    expect(renderMarkdown('`a == b` 是比较')).not.toContain('<mark');
  });

  it('表格：行尾竖线省略的行也归入表格（GFM 合法写法）', () => {
    const src = [
      '| 菜单 | 路由 | 状态 |',
      '| --- | --- | --- |',
      '| 业务单据 | `/a` | ✅ 无需修改',
      '| 流水单据 | `/b` | ✅ 无需修改',
    ].join('\n');
    const html = renderMarkdown(src);
    expect((html.match(/<tr>/g) ?? []).length).toBe(3); // 表头 + 两行数据
    expect(html).toContain('<td>业务单据</td>');
    expect(html).toContain('<td>流水单据</td>');
    expect(html).not.toContain('<p>');
  });

  it('表格：没有分隔行的连续 | 行渲染为无表头表格', () => {
    const html = renderMarkdown('| a | b |\n| c | d |');
    expect(html).toBe(
      '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
    );
    expect(html).not.toContain('<thead>');
  });
});
