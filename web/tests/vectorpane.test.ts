// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVectorPane } from '../src/ui/vectorpane';

const STATS = {
  docTotal: 3,
  indexed: 1,
  stale: 1,
  none: 1,
  chunkCount: 5,
  dims: 3,
  model: 'text-embedding-v4',
  bytes: 2048,
  lastIndexedAt: 1700000000000,
  modelMismatch: false,
};

const DOCS = [
  { path: '01-AI/RAG.md', title: 'RAG', state: 'indexed', chunkCount: 3, indexedAt: 1700000000000, model: 'text-embedding-v4' },
  { path: '01-AI/Agent.md', title: 'Agent', state: 'stale', chunkCount: 2, indexedAt: 1700000000000, model: 'text-embedding-v4' },
  { path: '02-Dev/Git.md', title: 'Git', state: 'none', chunkCount: 0, indexedAt: null, model: null },
];

const CHUNKS = [
  { index: 0, headings: ['架构', '检索层'], startLine: 45, endLine: 88, chars: 486, hash: 'a3f2b1c4d5e6f7a8', text: '混合检索：关键词精确召回 + 向量语义召回。' },
  { index: 1, headings: [], startLine: 90, endLine: 120, chars: 320, hash: 'b4c5d6e7f8a9b0c1', text: '第二片内容。' },
];

function stubFetch(over: { stats?: Partial<typeof STATS> } = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes('/api/world')) return json({ vaults: [{ id: 'v1', name: '测试城' }] });
    if (u.includes('/stats')) return json({ ...STATS, ...over.stats });
    if (u.includes('/doc/chunks')) return json({ chunks: CHUNKS });
    if (u.includes('/docs')) return json({ docs: DOCS });
    if (u.includes('/progress')) {
      return json({ running: false, total: 0, done: 0, skipped: 0, current: null, errors: [], startedAt: null, finishedAt: null });
    }
    if (u.includes('/store') && init?.method === 'DELETE') return json({ ok: true });
    return json({});
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function calls(): string[] {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => `${(c[1] as RequestInit)?.method ?? 'GET'} ${c[0]}`,
  );
}

describe('createVectorPane（向量库管理面板）', () => {
  let mount: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('概览卡：计数/磁盘/模型/动作按钮齐全', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    const text = mount.textContent!;
    expect(text).toContain('文档 · 已入库 1');
    expect(text).toContain('切片 · 过期 1');
    expect(text).toContain('2.0 KB');
    expect(text).toContain('text-embedding-v4');
    expect(mount.querySelector('.vp-act-stale')!.textContent).toBe('重建过期 1');
    expect(mount.querySelector('.vp-act-all')).toBeTruthy();
    expect(mount.querySelector('.vp-act-clear')).toBeTruthy();
    pane.dispose();
  });

  it('状态徽标在独立列（不在省略号容器内，长路径不吞标记）', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    const indexedRow = mount.querySelector<HTMLElement>('.vp-row[data-path="01-AI/RAG.md"]')!;
    expect(indexedRow.querySelector('.vp-path .rag-seal')).toBeNull(); // 不在路径 span 里
    expect(indexedRow.querySelector('.vp-state .rag-seal')).toBeTruthy(); // 在独立状态列
    // 未入库行也有状态列占位，保证列对齐
    const noneRow = mount.querySelector<HTMLElement>('.vp-row[data-path="02-Dev/Git.md"]')!;
    expect(noneRow.querySelector('.vp-state')).toBeTruthy();
    expect(noneRow.querySelector('.vp-state .rag-seal')).toBeNull();
    pane.dispose();
  });

  it('入库动作按状态措辞：未入库=入库、过期=更新、已入库=重新入库', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    const label = (p: string): string | null =>
      mount.querySelector(`.vp-row[data-path="${p}"] .vp-reindex`)?.textContent ?? null;
    expect(label('02-Dev/Git.md')).toBe('入库');
    expect(label('01-AI/Agent.md')).toBe('更新');
    expect(label('01-AI/RAG.md')).toBe('重新入库');
    pane.dispose();
  });

  it('模型不一致时飘黄警示', async () => {
    stubFetch({ stats: { modelMismatch: true, model: 'old-model' } });
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    expect(mount.querySelector('.vp-warn')!.textContent).toContain('不一致');
    pane.dispose();
  });

  it('状态筛选与路径搜索', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    expect(mount.querySelectorAll('.vp-row')).toHaveLength(3);
    // 筛「过期」
    mount.querySelector<HTMLElement>('.vp-tab[data-f="stale"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mount.querySelectorAll('.vp-row')).toHaveLength(1);
    expect(mount.querySelector('.vp-row')!.getAttribute('data-path')).toBe('01-AI/Agent.md');
    // 回「全部」再按路径搜索
    mount.querySelector<HTMLElement>('.vp-tab[data-f="all"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const search = mount.querySelector<HTMLInputElement>('.vp-search')!;
    search.value = 'git';
    search.dispatchEvent(new Event('input'));
    expect(mount.querySelectorAll('.vp-row')).toHaveLength(1);
    expect(mount.querySelector('.vp-row')!.getAttribute('data-path')).toBe('02-Dev/Git.md');
    pane.dispose();
  });

  it('查看 → 切片检视（章节链/行号/字符数 + 入库时间信息），展开全文，返回列表', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    const row = mount.querySelector<HTMLElement>('.vp-row[data-path="01-AI/RAG.md"]')!;
    row.querySelector<HTMLElement>('.vp-view')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    // 头部带入库时间与模型，用户可核对入库是否真的发生
    const head = mount.querySelector('.vp-chunk-doc')!;
    expect(head.textContent).toContain('入库于');
    expect(head.textContent).toContain('text-embedding-v4');
    const chunks = mount.querySelectorAll('.vp-chunk');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].textContent).toContain('架构 › 检索层');
    expect(chunks[0].textContent).toContain('L45-88');
    expect(chunks[0].textContent).toContain('486 字');
    // 点头部展开全文
    chunks[0].querySelector<HTMLElement>('.vp-chunk-head')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(chunks[0].classList.contains('expanded')).toBe(true);
    // 返回列表
    mount.querySelector<HTMLElement>('.vp-back')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mount.querySelectorAll('.vp-row')).toHaveLength(3);
    pane.dispose();
  });

  it('清空向量库走确认弹窗：取消不发请求，确认才 DELETE 并出提示条', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    mount.querySelector<HTMLElement>('.vp-act-clear')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const overlay = document.querySelector('.confirm-overlay')!;
    expect(overlay.textContent).toContain('清空向量库');
    expect(overlay.querySelector('.confirm-ok.danger')).toBeTruthy(); // 危险色确认键
    // 取消
    overlay.querySelector<HTMLElement>('.confirm-cancel')!.click();
    await flush();
    expect(calls().some((c) => c.startsWith('DELETE') && c.includes('/store'))).toBe(false);
    // 再来一次并确认
    mount.querySelector<HTMLElement>('.vp-act-clear')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector<HTMLElement>('.confirm-overlay .confirm-ok')!.click();
    await flush();
    expect(calls().some((c) => c.startsWith('DELETE') && c.includes('/store'))).toBe(true);
    expect(document.querySelector('#toast-root .toast')!.textContent).toContain('已清空');
    pane.dispose();
  });

  it('重建过期：确认后只提交 stale 文档路径', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    mount.querySelector<HTMLElement>('.vp-act-stale')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector<HTMLElement>('.confirm-overlay .confirm-ok')!.click();
    await flush();
    const idxCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).includes('/index') && !String(c[0]).includes('progress'),
    )!;
    const body = JSON.parse(String((idxCall[1] as RequestInit).body));
    expect(body.paths).toEqual(['01-AI/Agent.md']);
    pane.dispose();
  });

  it('行内入库/移除都有确认层：取消后不发任何变更请求', async () => {
    stubFetch();
    const pane = createVectorPane(mount);
    pane.refresh();
    await flush();
    const row = mount.querySelector<HTMLElement>('.vp-row[data-path="02-Dev/Git.md"]')!;
    row.querySelector<HTMLElement>('.vp-reindex')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.confirm-overlay')!.textContent).toContain('入库该文档');
    document.querySelector<HTMLElement>('.confirm-overlay .confirm-cancel')!.click();
    await flush();
    expect(calls().some((c) => c.includes('/index') && !c.includes('progress'))).toBe(false);
    // 移除也有确认
    const indexed = mount.querySelector<HTMLElement>('.vp-row[data-path="01-AI/RAG.md"]')!;
    indexed.querySelector<HTMLElement>('.vp-remove')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.confirm-overlay')!.textContent).toContain('移除');
    document.querySelector<HTMLElement>('.confirm-overlay .confirm-cancel')!.click();
    await flush();
    expect(calls().some((c) => c.startsWith('DELETE') && c.includes('/doc?'))).toBe(false);
    pane.dispose();
  });
});
