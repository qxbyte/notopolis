/**
 * util/markdown.ts — 轻量 Markdown → HTML 渲染（无外部依赖）。
 * 覆盖知识笔记常见语法：标题/粗斜体/行内与块级代码/列表/任务/引用/分隔线/链接/wikilink/图片。
 * 输出前已转义，安全用于 innerHTML。纯函数，可单测。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/** 处理非代码文本的行内语法：图片 > 链接 > wikilink > 粗 > 斜 */
function inlineNonCode(s: string): string {
  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => `<img alt="${alt}" src="${url}">`);
  // 链接 [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`,
  );
  // wikilink [[target]] / [[target|alias]] → 样式化 span（显示别名或目标名末段）
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const [target, alias] = String(inner).split('|');
    const label = alias ?? target.split('/').pop();
    return `<span class="md-wikilink">${label}</span>`;
  });
  // 粗体 **x** / __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // 斜体 *x* / _x_
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  return s;
}

/**
 * 行内语法：先按反引号切分，代码段转义后包 <code>，其余段先转义再走 inlineNonCode。
 * 转义在此层完成（block 解析用未转义原文，故标记如 > 不会被提前转义）。
 */
function renderInline(text: string): string {
  const parts = text.split('`');
  let out = '';
  for (let k = 0; k < parts.length; k++) {
    // 奇数下标 = 反引号之间的代码段（仅当存在成对反引号时）
    if (k % 2 === 1 && k < parts.length - 1) {
      out += `<code>${escapeHtml(parts[k])}</code>`;
    } else if (k % 2 === 1) {
      // 未闭合的反引号：原样输出反引号 + 内容
      out += '`' + inlineNonCode(escapeHtml(parts[k]));
    } else {
      out += inlineNonCode(escapeHtml(parts[k]));
    }
  }
  return out;
}

/** Markdown → HTML */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  let paraBuf: string[] = [];
  function flushPara(): void {
    if (paraBuf.length) {
      out.push(`<p>${renderInline(paraBuf.join(' '))}</p>`);
      paraBuf = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```lang
    if (/^```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }

    // 标题 # .. ######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用 >（连续多行合并）
    if (/^>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // 列表（有序/无序/任务），连续行成组
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const task = raw.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            `<li class="md-task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${renderInline(task[2])}</li>`,
          );
        } else {
          items.push(`<li>${renderInline(raw)}</li>`);
        }
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    // 空行 → 段落分隔
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    paraBuf.push(line);
    i++;
  }
  flushPara();
  return out.join('\n');
}
