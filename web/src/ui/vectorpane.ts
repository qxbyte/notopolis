/**
 * ui/vectorpane.ts — 「向量库」管理面板（嵌入设置中心弹窗）。
 * 三层钻取：① 库概览卡（计数/磁盘/模型一致性 + 重建/清空动作）
 *          ② 文档表（搜索 + 状态筛选 + 行内 重新入库/移除/查看）
 *          ③ 切片检视（章节链/行号/字符数，折叠全文，返回列表）
 * 设计文档：Obsidian「Notopolis 向量库管理页面设计」。
 */
import {
  fetchWorld,
  ragClearStore,
  ragDocChunks,
  ragDocs,
  ragIndex,
  ragProgress,
  ragRemoveDoc,
  ragStats,
} from '../api';
import type { RagChunkInfo, RagDocStatus, RagStats } from '@shared/types';
import { confirmDialog } from './confirm';
import { createDropdown } from './dropdown';
import { ICON } from './icons';
import { toast } from './toast';

export interface VectorPane {
  refresh(): void;
  dispose(): void;
}

type Filter = 'all' | 'indexed' | 'stale' | 'none';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function sealOf(state: RagDocStatus['state']): string {
  if (state === 'indexed') return `<span class="rag-seal" title="已入库">${ICON.sealIndexed}</span>`;
  if (state === 'stale') return `<span class="rag-seal" title="内容已更新，建议重新入库">${ICON.sealStale}</span>`;
  return '';
}

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  indexed: '已入库',
  stale: '过期',
  none: '未入库',
};

export function createVectorPane(mount: HTMLElement): VectorPane {
  mount.innerHTML = `
    <label class="st-field st-evalvault">目标仓库<div class="vp-vault"></div></label>
    <div class="vp-body"><div class="vm-empty">加载中…</div></div>`;

  const vaultDd = createDropdown(mount.querySelector<HTMLElement>('.vp-vault')!);
  const body = mount.querySelector<HTMLElement>('.vp-body')!;

  let vaultId: string | null = null;
  let stats: RagStats | null = null;
  let docs: RagDocStatus[] = [];
  let filter: Filter = 'all';
  let query = '';
  let chunkDoc: string | null = null; // 非空 = 切片检视视图
  let jobActive = false; // 本面板发起/观察到的入库任务（结束时 toast 回执）
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // ---- 渲染 ----

  function countOf(f: Filter): number {
    if (!stats) return 0;
    return f === 'all' ? stats.docTotal : stats[f];
  }

  function overviewHTML(progressHTML = ''): string {
    if (!stats) return '';
    const s = stats;
    return (
      progressHTML +
      (s.modelMismatch
        ? `<div class="vp-warn">库内向量由「${esc(s.model ?? '')}」生成，与当前配置模型不一致——请重建后再检索。</div>`
        : '') +
      `<div class="vp-cards">` +
      `<div class="vp-card"><b>${s.docTotal}</b><span>文档 · 已入库 ${s.indexed}</span></div>` +
      `<div class="vp-card"><b>${s.chunkCount}</b><span>切片 · 过期 ${s.stale}</span></div>` +
      `<div class="vp-card"><b>${fmtBytes(s.bytes)}</b><span>磁盘占用 · ${s.dims || '—'} 维</span></div>` +
      `<div class="vp-card"><b>${esc(s.model ?? '未建库')}</b><span>嵌入模型 · ${fmtTime(s.lastIndexedAt)}</span></div>` +
      `</div>` +
      `<div class="vp-actions">` +
      (s.stale > 0 ? `<button class="vp-btn vp-act-stale">重建过期 ${s.stale}</button>` : '') +
      `<button class="vp-btn vp-act-all">全量重建</button>` +
      `<button class="vp-btn danger vp-act-clear">清空向量库</button>` +
      `</div>`
    );
  }

  function rowsHTML(): string {
    const q = query.trim().toLowerCase();
    const list = docs.filter(
      (d) => (filter === 'all' || d.state === filter) && (!q || d.path.toLowerCase().includes(q)),
    );
    if (list.length === 0) return `<div class="vm-empty">没有匹配的文档</div>`;
    // 入库动作按状态措辞：未入库=入库 · 过期=更新 · 已入库=重新入库
    const actLabel = (state: RagDocStatus['state']): string =>
      state === 'none' ? '入库' : state === 'stale' ? '更新' : '重新入库';
    return list
      .map(
        (d) =>
          `<div class="vp-row" data-path="${esc(d.path)}">` +
          // 徽标独立成列，不进省略号容器——长路径截断时不吞标记
          `<span class="vp-path" title="${esc(d.path)}">${esc(d.path)}</span>` +
          `<span class="vp-state">${sealOf(d.state)}</span>` +
          `<span class="vp-cell">${d.chunkCount ? `${d.chunkCount} 片` : '—'}</span>` +
          `<span class="vp-cell">${d.indexedAt ? new Date(d.indexedAt).toLocaleDateString() : '—'}</span>` +
          `<span class="vp-rowacts">` +
          `<button class="vp-link vp-reindex">${actLabel(d.state)}</button>` +
          (d.state !== 'none' ? `<button class="vp-link vp-remove">移除</button>` : '') +
          (d.state !== 'none' ? `<button class="vp-link vp-view">查看</button>` : '') +
          `</span></div>`,
      )
      .join('');
  }

  function renderList(progressHTML = ''): void {
    chunkDoc = null;
    const tabs = (['all', 'indexed', 'stale', 'none'] as Filter[])
      .map(
        (f) =>
          `<button class="vp-tab${f === filter ? ' active' : ''}" data-f="${f}">${FILTER_LABEL[f]} ${countOf(f)}</button>`,
      )
      .join('');
    body.innerHTML =
      overviewHTML(progressHTML) +
      `<div class="vp-toolbar">${tabs}<input class="vp-search" placeholder="按路径搜索…" value="${esc(query)}" spellcheck="false" /></div>` +
      `<div class="vp-rows">${rowsHTML()}</div>`;
    body.querySelector<HTMLInputElement>('.vp-search')!.addEventListener('input', (e) => {
      query = (e.target as HTMLInputElement).value;
      body.querySelector<HTMLElement>('.vp-rows')!.innerHTML = rowsHTML();
    });
  }

  async function renderChunks(docPath: string): Promise<void> {
    chunkDoc = docPath;
    body.innerHTML = `<div class="vp-chunkhead"><button class="vp-link vp-back">← 返回列表</button></div><div class="vm-empty">加载切片…</div>`;
    let chunks: RagChunkInfo[];
    try {
      chunks = await ragDocChunks(vaultId!, docPath);
    } catch (e) {
      body.innerHTML = `<div class="vp-chunkhead"><button class="vp-link vp-back">← 返回列表</button></div><div class="vm-empty">切片加载失败：${esc((e as Error).message)}</div>`;
      return;
    }
    if (chunkDoc !== docPath) return; // 已切走
    // 入库信息：让用户能核对本次入库是否真的发生（时间/模型/片数）
    const rec = docs.find((d) => d.path === docPath);
    const meta = rec?.indexedAt
      ? `入库于 ${new Date(rec.indexedAt).toLocaleString()} · 模型 ${esc(rec.model ?? '—')}`
      : '未入库';
    const items = chunks
      .map((c) => {
        const trail = c.headings.length ? esc(c.headings.join(' › ')) : '（文首）';
        return (
          `<div class="vp-chunk">` +
          `<div class="vp-chunk-head"><span class="vp-chunk-n">#${c.index}</span>` +
          `<span class="vp-chunk-trail">${trail}</span>` +
          `<span class="vp-chunk-meta">L${c.startLine}-${c.endLine} · ${c.chars} 字 · ${esc(c.hash.slice(0, 8))}…</span></div>` +
          `<div class="vp-chunk-text">${esc(c.text)}</div>` +
          `</div>`
        );
      })
      .join('');
    body.innerHTML =
      `<div class="vp-chunkhead"><button class="vp-link vp-back">← 返回列表</button>` +
      `<span class="vp-chunk-doc" title="${esc(docPath)}">${esc(docPath)} · ${chunks.length} 片 · ${meta}</span></div>` +
      (items || '<div class="vm-empty">该文档没有切片</div>');
  }

  // ---- 数据与动作 ----

  async function loadVaults(): Promise<void> {
    let vaults: { id: string; name: string }[] = [];
    try {
      const w = await fetchWorld();
      if (Array.isArray(w.vaults)) vaults = w.vaults;
    } catch {
      /* 按空处理 */
    }
    if (vaults.length === 0) {
      vaultDd.setOptions([{ value: '', label: '（尚无仓库）' }], '');
      vaultId = null;
      body.innerHTML = '<div class="vm-empty">添加仓库后可用</div>';
      return;
    }
    if (!vaultId || !vaults.some((v) => v.id === vaultId)) vaultId = vaults[0].id;
    vaultDd.setOptions(
      vaults.map((v) => ({ value: v.id, label: v.name })),
      vaultId,
    );
  }

  async function loadData(): Promise<void> {
    if (!vaultId) return;
    try {
      [stats, docs] = await Promise.all([ragStats(vaultId), ragDocs(vaultId)]);
      renderList();
      void resumePollIfRunning();
    } catch (e) {
      body.innerHTML = `<div class="vm-empty">向量库信息加载失败：${esc((e as Error).message)}</div>`;
    }
  }

  function progressHTML(done: number, total: number, current: string | null): string {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      `<div class="vp-progress"><div class="dp-bar"><div class="dp-fill" style="width:${pct}%"></div></div>` +
      `<div class="dp-text">入库中 ${done}/${total}${current ? ` · ${esc(current)}` : ''}</div></div>`
    );
  }

  async function poll(): Promise<void> {
    if (disposed || !vaultId) return;
    try {
      const p = await ragProgress(vaultId);
      if (p.running) {
        jobActive = true;
        if (!chunkDoc) renderList(progressHTML(p.done, p.total, p.current));
        body.classList.add('indexing');
        pollTimer = setTimeout(() => void poll(), 1000);
        return;
      }
      body.classList.remove('indexing');
      // 本面板观察过的任务结束：顶部消息条给出回执
      if (jobActive) {
        jobActive = false;
        const errN = p.errors.length;
        const updated = p.done - p.skipped - errN;
        toast(
          `入库完成：${updated} 篇更新 · ${p.skipped} 篇未变跳过${errN ? ` · ${errN} 篇失败` : ''}`,
          errN ? 'err' : 'ok',
        );
      }
      await loadData(); // 任务结束刷新概览与状态
    } catch {
      body.classList.remove('indexing');
    }
  }

  async function resumePollIfRunning(): Promise<void> {
    if (!vaultId) return;
    try {
      const p = await ragProgress(vaultId);
      if (p.running) void poll();
    } catch {
      /* 静默 */
    }
  }

  async function startIndex(paths: string[]): Promise<void> {
    if (!vaultId || paths.length === 0) return;
    jobActive = true;
    renderList(progressHTML(0, paths.length, null));
    body.classList.add('indexing');
    try {
      await ragIndex(vaultId, paths);
      void poll();
    } catch (e) {
      jobActive = false;
      body.classList.remove('indexing');
      toast(`入库失败：${(e as Error).message}`, 'err');
      renderList();
    }
  }

  /** 确认后执行入库（全部变更动作统一走确认弹窗，防误操作） */
  function confirmIndex(title: string, message: string, paths: string[]): void {
    void confirmDialog({ title, message }).then((ok) => {
      if (ok) void startIndex(paths);
    });
  }

  function onClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    if (body.classList.contains('indexing') && !el.closest('.vp-back')) return;
    if (el.closest('.vp-act-stale')) {
      const stale = docs.filter((d) => d.state === 'stale').map((d) => d.path);
      confirmIndex(`重建 ${stale.length} 篇过期文档？`, '将重新切片并向量化这些内容已变更的文档。', stale);
    } else if (el.closest('.vp-act-all')) {
      confirmIndex(
        `全量重建（${docs.length} 篇）？`,
        '将提交全部文档重新入库；内容未变更的会按 hash 自动跳过，不重复消耗嵌入调用。',
        docs.map((d) => d.path),
      );
    } else if (el.closest('.vp-act-clear')) {
      void confirmDialog({
        title: '清空向量库？',
        message: `将删除该仓库全部 ${stats?.chunkCount ?? 0} 个切片向量，检索/问答将不可用，须重新入库才能恢复。不影响原始笔记文件。`,
        confirmText: '清空',
        danger: true,
      }).then((ok) => {
        if (ok && vaultId) {
          void ragClearStore(vaultId)
            .then(() => {
              toast('向量库已清空', 'ok');
              return loadData();
            })
            .catch((err: Error) => toast(`清空失败：${err.message}`, 'err'));
        }
      });
    } else if (el.closest('.vp-tab')) {
      filter = (el.closest<HTMLElement>('.vp-tab')!.dataset.f ?? 'all') as Filter;
      renderList();
    } else if (el.closest('.vp-back')) {
      renderList();
    } else if (el.closest('.vp-view')) {
      const p = el.closest<HTMLElement>('.vp-row')?.dataset.path;
      if (p) void renderChunks(p);
    } else if (el.closest('.vp-reindex')) {
      const p = el.closest<HTMLElement>('.vp-row')?.dataset.path;
      const state = docs.find((d) => d.path === p)?.state;
      const verb = state === 'none' ? '入库' : state === 'stale' ? '更新' : '重新入库';
      if (p) confirmIndex(`${verb}该文档？`, p, [p]);
    } else if (el.closest('.vp-remove')) {
      const p = el.closest<HTMLElement>('.vp-row')?.dataset.path;
      if (p && vaultId) {
        void confirmDialog({
          title: '从索引移除该文档？',
          message: `${p}（不影响原始笔记文件，可随时重新入库）`,
          confirmText: '移除',
          danger: true,
        }).then((ok) => {
          if (ok && vaultId) {
            void ragRemoveDoc(vaultId, p)
              .then(() => {
                toast(`已从索引移除：${p}`, 'ok');
                return loadData();
              })
              .catch((err: Error) => toast(`移除失败：${err.message}`, 'err'));
          }
        });
      }
    } else if (el.closest('.vp-chunk-head')) {
      el.closest<HTMLElement>('.vp-chunk')?.classList.toggle('expanded');
    }
  }
  body.addEventListener('click', onClick);

  vaultDd.onChange = (v) => {
    vaultId = v || null;
    filter = 'all';
    query = '';
    void loadData();
  };

  return {
    refresh(): void {
      void loadVaults().then(() => loadData());
    },
    dispose(): void {
      disposed = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      body.removeEventListener('click', onClick);
      vaultDd.dispose();
      mount.innerHTML = '';
    },
  };
}
