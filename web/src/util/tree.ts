/**
 * util/tree.ts — 从 notePath 列表构建可展开/收起的目录树（工地/园丁面板共用）。
 * 纯数据 + HTML 渲染（无框架），可单测。
 */

export interface TreeLeaf<T> {
  notePath: string;
  data: T;
}

export interface TreeNode<T> {
  name: string; // 目录名（根为 ''）
  path: string; // 完整目录路径
  folders: TreeNode<T>[];
  leaves: { name: string; notePath: string; data: T }[];
  count: number; // 该节点下叶子总数
}

/** 构建目录树 */
export function buildTree<T>(leaves: TreeLeaf<T>[]): TreeNode<T> {
  const root: TreeNode<T> = { name: '', path: '', folders: [], leaves: [], count: 0 };
  const folderIndex = new Map<string, TreeNode<T>>(); // path → node

  for (const lf of leaves) {
    const parts = lf.notePath.split('/');
    const fileName = parts[parts.length - 1].replace(/\.md$/, '');
    let node = root;
    node.count++;
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      prefix = prefix ? prefix + '/' + seg : seg;
      let child = folderIndex.get(prefix);
      if (!child) {
        child = { name: seg, path: prefix, folders: [], leaves: [], count: 0 };
        folderIndex.set(prefix, child);
        node.folders.push(child);
      }
      child.count++;
      node = child;
    }
    node.leaves.push({ name: fileName, notePath: lf.notePath, data: lf.data });
  }

  sortNode(root);
  collapseChains(root);
  return root;
}

function sortNode<T>(node: TreeNode<T>): void {
  node.folders.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  for (const f of node.folders) sortNode(f);
}

/** 合并「只有一个子目录、没有叶子」的链，让深路径显示为一行（如 A/B/C） */
function collapseChains<T>(node: TreeNode<T>): void {
  for (const f of node.folders) collapseChains(f);
  const merged: TreeNode<T>[] = [];
  for (let f of node.folders) {
    while (f.leaves.length === 0 && f.folders.length === 1) {
      const only = f.folders[0];
      f = { name: f.name + '/' + only.name, path: only.path, folders: only.folders, leaves: only.leaves, count: f.count };
    }
    merged.push(f);
  }
  node.folders = merged;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * 渲染目录树为 HTML。folders 默认展开；leafRow 由调用方提供每个叶子的行 HTML。
 * depth 用于缩进。
 */
export function renderTree<T>(
  node: TreeNode<T>,
  leafRow: (leaf: { name: string; notePath: string; data: T }, depth: number) => string,
  depth = 0,
): string {
  let html = '';
  for (const f of node.folders) {
    const pad = depth * 14 + 12;
    html +=
      `<div class="tree-folder">` +
      `<div class="tree-folder-head" style="padding-left:${pad}px">` +
      `<span class="tree-toggle">▾</span>` +
      `<span class="tree-fname">${esc(f.name)}</span>` +
      `<span class="tree-count">${f.count}</span>` +
      `</div>` +
      `<div class="tree-children">${renderTree(f, leafRow, depth + 1)}</div>` +
      `</div>`;
  }
  for (const lf of node.leaves) {
    html += leafRow(lf, depth);
  }
  return html;
}
