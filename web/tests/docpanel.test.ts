// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocPanel } from '../src/ui/docpanel';
import type { RagDocStatus } from '@shared/types';

const DOCS: RagDocStatus[] = [
  { path: '01-AI/RAG.md', title: 'RAG', state: 'indexed', chunkCount: 3, indexedAt: 1700000000000, model: 'text-embedding-v4' },
  { path: '01-AI/Transformer.md', title: 'Transformer', state: 'stale', chunkCount: 2, indexedAt: 1700000000000, model: 'text-embedding-v4' },
  { path: '01-AI/papers/Attention.md', title: 'Attention', state: 'none', chunkCount: 0, indexedAt: null, model: null },
  { path: '02-Dev/Git.md', title: 'Git', state: 'none', chunkCount: 0, indexedAt: null, model: null },
];

function stubFetch(enabled: boolean, docs = DOCS): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/api/rag/config')) {
      return json({ enabled, embedding: { mode: 'local', local: {}, remote: {} }, chat: { mode: 'off' }, retrieval: {} });
    }
    if (u.includes('/docs')) return json({ docs });
    if (u.includes('/progress')) {
      return json({ running: false, total: 0, done: 0, skipped: 0, current: null, errors: [], startedAt: null, finishedAt: null });
    }
    return json({});
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('createDocPanel', () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('三态印章标记：indexed 实心章、stale 虚线章、none 无章', async () => {
    stubFetch(true);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open();
    await flush();
    const rows = [...container.querySelectorAll('.panel-item')];
    expect(rows).toHaveLength(4);
    const seals = container.querySelectorAll('.rag-seal');
    expect(seals).toHaveLength(2); // indexed + stale
    const indexedRow = rows.find((r) => r.getAttribute('data-path') === '01-AI/RAG.md')!;
    expect(indexedRow.querySelector('.rag-seal')!.getAttribute('title')).toContain('已入库 · 3 片');
    const staleRow = rows.find((r) => r.getAttribute('data-path') === '01-AI/Transformer.md')!;
    expect(staleRow.querySelector('.rag-seal')!.getAttribute('title')).toContain('重新入库');
    panel.dispose();
  });

  it('入库按钮只在一级目录：文档行/子目录无按钮，一级目录带待入库计数（含子目录）', async () => {
    stubFetch(true);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open();
    await flush();
    // 文档行一律没有入库按钮
    expect(container.querySelector('.panel-item .act-index')).toBeNull();
    // 仅一级目录有按钮：01-AI（stale 1 + 子目录 none 1 = 入库 2）、02-Dev（入库 1）；
    // 子目录 papers 无按钮
    const folderActs = [...container.querySelectorAll<HTMLElement>('.tree-folder-head .act-index')];
    expect(folderActs).toHaveLength(2);
    const ai = folderActs.find((a) => a.dataset.paths?.includes('RAG.md'))!;
    expect(ai.textContent).toBe('入库 2');
    expect(ai.dataset.paths!.split('|')).toHaveLength(3); // 一级目录按钮携带含子目录的全部文档
    const dev = folderActs.find((a) => a.dataset.paths?.includes('Git.md'))!;
    expect(dev.textContent).toBe('入库 1');
    // 顶部「全部入库 3」（3 篇待处理）
    expect(container.querySelector('.act-index-all')!.textContent).toBe('全部入库 3');
    panel.dispose();
  });

  it('目录全部已入库 → 按钮显示「更新」并带 act-update；有待入库 → 「入库 N」', async () => {
    const docs: RagDocStatus[] = [
      { path: '01-Done/a.md', title: 'a', state: 'indexed', chunkCount: 2, indexedAt: 1, model: 'm' },
      { path: '01-Done/b.md', title: 'b', state: 'indexed', chunkCount: 2, indexedAt: 1, model: 'm' },
      { path: '02-Todo/c.md', title: 'c', state: 'none', chunkCount: 0, indexedAt: null, model: null },
    ];
    stubFetch(true, docs);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open();
    await flush();
    const acts = [...container.querySelectorAll<HTMLElement>('.tree-folder-head .act-index')];
    const done = acts.find((a) => a.dataset.paths?.includes('01-Done/a.md'))!;
    expect(done.textContent).toBe('更新');
    expect(done.classList.contains('act-update')).toBe(true);
    const todo = acts.find((a) => a.dataset.paths?.includes('02-Todo/c.md'))!;
    expect(todo.textContent).toBe('入库 1');
    expect(todo.classList.contains('act-update')).toBe(false);
    panel.dispose();
  });

  it('RAG 未启用降级：提示条出现、入库按钮隐藏、点击文档行仍可定位', async () => {
    stubFetch(false);
    const onLocate = vi.fn();
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate });
    panel.open();
    await flush();
    expect(container.querySelector('.docpanel-hint')).toBeTruthy();
    expect(container.querySelector('.act-index')).toBeNull();
    expect(container.querySelector('.act-index-all')).toBeNull();
    const row = container.querySelector<HTMLElement>('.panel-item')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLocate).toHaveBeenCalledWith(row.getAttribute('data-path'));
    panel.dispose();
  });

  it('点击文档行定位；点击目录入库按钮不触发定位', async () => {
    stubFetch(true);
    const onLocate = vi.fn();
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate });
    panel.open();
    await flush();
    container.querySelector<HTMLElement>('.panel-item')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLocate).toHaveBeenCalledTimes(1);
    container.querySelector<HTMLElement>('.tree-folder-head .act-index')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLocate).toHaveBeenCalledTimes(1); // 入库按钮点击不定位
    panel.dispose();
  });

  it('open(selectPath)：来路文档带选中色，其余行不带', async () => {
    stubFetch(true);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open('01-AI/Transformer.md');
    await flush();
    const sel = container.querySelector('.panel-item.selected')!;
    expect(sel.getAttribute('data-path')).toBe('01-AI/Transformer.md');
    expect(container.querySelectorAll('.panel-item.selected')).toHaveLength(1);
    panel.dispose();
  });

  it('单按钮切换目录树折叠态：收起后按钮变展开，再点恢复', async () => {
    stubFetch(true);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open();
    await flush();
    const folders = container.querySelectorAll('.tree-folder');
    expect(folders.length).toBeGreaterThan(0);
    const btn = container.querySelector<HTMLElement>('.tree-toggle-all')!;
    expect(btn.title).toBe('全部收起'); // 初始树展开 → 按钮是收起
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect([...folders].every((f) => f.classList.contains('collapsed'))).toBe(true);
    expect(btn.title).toBe('全部展开'); // 收起后按钮变展开
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect([...folders].every((f) => !f.classList.contains('collapsed'))).toBe(true);
    expect(btn.title).toBe('全部收起');
    panel.dispose();
  });

  it('点击目录入库按钮：立即出现进度条并发起 index 请求', async () => {
    stubFetch(true);
    const panel = createDocPanel(container, { vaultId: 'v1', onLocate: () => undefined });
    panel.open();
    await flush();
    const btn = container.querySelector<HTMLElement>('.tree-folder-head .act-index')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // 点击瞬间（未等请求回包）就渲染进度条
    expect(container.querySelector('.docpanel-progress .dp-bar')).toBeTruthy();
    await flush();
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/api/rag/v1/index') && !u.includes('progress'))).toBe(true);
    panel.dispose();
  });
});
