/**
 * util/search.ts — 笔记标题/路径模糊搜索（纯函数，可单测）。
 * 只搜标题与路径，不做拼音、不做全文（全文属于 Obsidian 的职责）。
 */

export interface SearchItem {
  notePath: string;
  title: string;
  dir: string;
}
export interface SearchHit extends SearchItem {
  score: number;
}

/** 字符子序列匹配：q 的每个字符按序出现在 s 中 */
function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (const c of s) {
    if (c === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/**
 * 打分（大小写不敏感）：
 * 标题全等 1000 > 标题前缀 800 > 标题包含 600 > 路径包含 400 > 标题子序列 200。
 * 同分按 title.localeCompare。空查询返回空。
 */
export function searchNotes(query: string, items: SearchItem[], limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const it of items) {
    const t = it.title.toLowerCase();
    const p = it.notePath.toLowerCase();
    let score = 0;
    if (t === q) score = 1000;
    else if (t.startsWith(q)) score = 800;
    else if (t.includes(q)) score = 600;
    else if (p.includes(q)) score = 400;
    else if (q.length >= 2 && isSubsequence(q, t)) score = 200;
    if (score > 0) hits.push({ ...it, score });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}
