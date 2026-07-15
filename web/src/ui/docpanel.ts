/**
 * ui/docpanel.ts — 「文书档案」侧栏：地图页「常规」按钮打开。
 * 全量文档目录树 + 目录/文档级「入库」按钮 + 印章式向量化标记：
 *   实心红章✓ = 已入库 · 琥珀虚线章↻ = 内容已变更需重新入库 · 无章 = 未入库。
 * RAG 未启用时降级为纯文档目录浏览器（定位可用，入库按钮隐藏）。
 */
import { ragDocs, ragGetConfig, ragIndex, ragProgress } from '../api';
import type { RagDocStatus } from '@shared/types';
import { buildTree, renderTree } from '../util/tree';
import { ICON } from './icons';
import { createSidePanel } from './panel';

export interface DocPanel {
  /** selectPath 传入时该文档行带选中色并滚动到可视区（卡片「返回列表」用） */
  open(selectPath?: string): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  onClose?: () => void;
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

function sealOf(d: RagDocStatus): string {
  if (d.state === 'indexed') {
    const at = d.indexedAt ? new Date(d.indexedAt).toLocaleString() : '';
    return `<span class="rag-seal" title="已入库 · ${d.chunkCount} 片 · ${esc(d.model ?? '')} · ${at}">${ICON.sealIndexed}</span>`;
  }
  if (d.state === 'stale') {
    return `<span class="rag-seal" title="内容已更新，建议重新入库">${ICON.sealStale}</span>`;
  }
  return '';
}

export function createDocPanel(
  container: HTMLElement,
  opts: {
    vaultId: string;
    onLocate: (notePath: string) => void;
  },
): DocPanel {
  const panel = createSidePanel(container, '文书档案');
  const body = panel.body;

  let ragEnabled = false;
  let docs: RagDocStatus[] = [];
  let selectedPath: string | null = null; // 从卡片返回时高亮的文档
  let scrollPending = false; // 选中行滚动到可视区（仅返回动作后的首次渲染）
  let treeCollapsed = false; // 目录树整体折叠态（展开/收起切换按钮，跨刷新保持）
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function render(progressHTML = ''): void {
    if (docs.length === 0) {
      body.innerHTML = '<div class="panel-empty">仓库中没有文档。</div>';
      return;
    }
    const hint = ragEnabled
      ? ''
      : '<div class="docpanel-hint">未启用向量检索——到「⚙ 设置」开启后，这里可将文档切片向量化入库。</div>';
    const indexedN = docs.filter((d) => d.state === 'indexed').length;
    const pendingN = docs.length - indexedN;
    const head =
      `<div class="panel-group-head">共 ${docs.length} 篇 · 已入库 ${indexedN}` +
      (ragEnabled
        ? ` <span class="act act-index-all${pendingN > 0 ? '' : ' act-update'}">${pendingN > 0 ? `全部入库 ${pendingN}` : '全部更新'}</span>`
        : '') +
      `<span class="tree-tools">` +
      `<button class="tree-tool tree-toggle-all" title="${treeCollapsed ? '全部展开' : '全部收起'}">${treeCollapsed ? ICON.expandAll : ICON.collapseAll}</button>` +
      `</span></div>`;

    const byPath = new Map(docs.map((d) => [d.path, d]));
    const tree = buildTree(docs.map((d) => ({ notePath: d.path, data: d })));
    const treeHTML = renderTree(
      tree,
      (leaf, depth) => {
        // 文档行不放入库按钮（入库以目录为单位），只留印章标记与定位
        const d = leaf.data;
        const pad = (depth + 1) * 14 + 12;
        const sel = d.path === selectedPath ? ' selected' : '';
        return (
          `<div class="panel-item tree-leaf${sel}" data-path="${esc(d.path)}" title="${esc(d.path)}" style="padding-left:${pad}px">` +
          `<span class="grow"><span class="doc-name">${esc(leaf.name)}</span>${sealOf(d)}</span>` +
          `</div>`
        );
      },
      0,
      (node, depth) => {
        // 入库按钮只挂在一级目录（子目录内容随一级目录整体入库）
        if (!ragEnabled || depth > 0) return '';
        // 发送目录下全部文档（含子目录），内容未变的服务端按 hash 自动跳过
        const all = collect(node);
        const pending = all.filter((p) => byPath.get(p)?.state !== 'indexed').length;
        // 全部已入库 → 「更新」（点它仍走入库流程，服务端按 hash 跳过未变的）；否则「入库 N」
        const done = pending === 0;
        const label = done ? '更新' : `入库 ${pending}`;
        const cls = done ? 'act act-index act-update tree-act' : 'act act-index tree-act';
        return `<span class="${cls}" data-paths="${esc(all.join('|'))}">${label}</span>`;
      },
    );
    body.innerHTML = progressHTML + hint + head + treeHTML;
    // 折叠态跨刷新保持（树 HTML 默认展开渲染）
    if (treeCollapsed) {
      for (const f of body.querySelectorAll('.tree-folder')) f.classList.add('collapsed');
    }
    // 返回列表：选中行滚动到可视区（jsdom 无 scrollIntoView，须守卫）
    if (scrollPending && selectedPath) {
      scrollPending = false;
      const row = body.querySelector<HTMLElement>('.panel-item.selected');
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'center' });
      }
    }
  }

  /** 收集子树全部叶子路径 */
  function collect(node: { folders: unknown[]; leaves: { notePath: string }[] }): string[] {
    const out: string[] = node.leaves.map((l) => l.notePath);
    for (const f of node.folders as { folders: unknown[]; leaves: { notePath: string }[] }[]) {
      out.push(...collect(f));
    }
    return out;
  }

  async function refresh(): Promise<void> {
    try {
      const [cfg, list] = await Promise.all([ragGetConfig(), ragDocs(opts.vaultId)]);
      ragEnabled = cfg.enabled;
      docs = list;
      render();
      void resumePollIfRunning();
    } catch (e) {
      body.innerHTML = `<div class="panel-empty">文档列表加载失败：${esc((e as Error).message)}</div>`;
    }
  }

  function progressHTML(done: number, total: number, current: string | null, errors: number): string {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      `<div class="docpanel-progress">` +
      `<div class="dp-bar"><div class="dp-fill" style="width:${pct}%"></div></div>` +
      `<div class="dp-text">入库中 ${done}/${total}${errors ? ` · ${errors} 失败` : ''}` +
      (current ? `<br><span class="dp-cur">${esc(current)}</span>` : '') +
      `</div></div>`
    );
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const p = await ragProgress(opts.vaultId);
      if (p.running) {
        render(progressHTML(p.done, p.total, p.current, p.errors.length));
        body.classList.add('indexing');
        pollTimer = setTimeout(() => void poll(), 1000);
        return;
      }
      body.classList.remove('indexing');
      // 任务结束：重取状态（印章即时更新）
      docs = await ragDocs(opts.vaultId);
      const errN = p.errors.length;
      render(
        p.finishedAt
          ? `<div class="docpanel-progress done">入库完成：${p.done - p.skipped - errN} 篇更新 · ${p.skipped} 篇未变跳过${errN ? ` · ${errN} 篇失败` : ''}</div>`
          : '',
      );
    } catch {
      body.classList.remove('indexing');
    }
  }

  async function resumePollIfRunning(): Promise<void> {
    try {
      const p = await ragProgress(opts.vaultId);
      if (p.running) void poll();
    } catch {
      /* 进度不可用时静默 */
    }
  }

  async function startIndex(paths: string[]): Promise<void> {
    // 点击即刻显示进度条（0/N），不等首次轮询回包
    render(progressHTML(0, paths.length, null, 0));
    body.classList.add('indexing');
    try {
      await ragIndex(opts.vaultId, paths);
      void poll();
    } catch (e) {
      body.classList.remove('indexing');
      render(`<div class="docpanel-progress err">入库失败：${esc((e as Error).message)}</div>`);
    }
  }

  function onBodyClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    // 目录树展开/收起切换（单按钮：收起后变展开，展开后变收起）
    const toggleAll = el.closest<HTMLElement>('.tree-toggle-all');
    if (toggleAll) {
      treeCollapsed = !treeCollapsed;
      for (const f of body.querySelectorAll('.tree-folder')) {
        f.classList.toggle('collapsed', treeCollapsed);
      }
      toggleAll.innerHTML = treeCollapsed ? ICON.expandAll : ICON.collapseAll;
      toggleAll.title = treeCollapsed ? '全部展开' : '全部收起';
      return;
    }
    const idx = el.closest<HTMLElement>('.act-index');
    if (idx && !body.classList.contains('indexing')) {
      e.stopPropagation(); // 目录行按钮不触发展开/收起
      const paths = (idx.dataset.paths ?? '').split('|').filter(Boolean);
      if (paths.length) void startIndex(paths);
      return;
    }
    if (el.closest('.act-index-all') && !body.classList.contains('indexing')) {
      void startIndex(docs.map((d) => d.path)); // 全量发送，未变更的服务端跳过
      return;
    }
    const fhead = el.closest<HTMLElement>('.tree-folder-head');
    if (fhead) {
      fhead.parentElement?.classList.toggle('collapsed');
      return;
    }
    // 点击文档行即定位（无独立按钮）
    const notePath = el.closest<HTMLElement>('.panel-item')?.getAttribute('data-path');
    if (notePath) opts.onLocate(notePath);
  }
  body.addEventListener('click', onBodyClick);

  return {
    open(selectPath?: string): void {
      if (selectPath !== undefined) {
        selectedPath = selectPath;
        scrollPending = true;
      }
      panel.open();
      void refresh();
    },
    close: panel.close,
    toggle(): void {
      if (panel.isOpen()) panel.close();
      else {
        panel.open();
        void refresh();
      }
    },
    isOpen: panel.isOpen,
    set onClose(fn: (() => void) | undefined) {
      panel.onClose = fn;
    },
    get onClose(): (() => void) | undefined {
      return panel.onClose;
    },
    dispose(): void {
      disposed = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      body.removeEventListener('click', onBodyClick);
      panel.dispose();
    },
  };
}
