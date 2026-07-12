// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelPane } from '../src/ui/settings';

const CFG = {
  enabled: true,
  embedding: {
    mode: 'local',
    local: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3-embedding:0.6b' },
    remote: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'text-embedding-v4' },
  },
  chat: {
    mode: 'off',
    local: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3:8b' },
    remote: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-plus' },
  },
  retrieval: { topK: 8, minScore: 0.35, perDocLimit: 3, maxContextChars: 6000, hybrid: true },
};

function stubFetch(putStatus = 200): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status });
    if (u.includes('/api/world')) {
      return json({ vaults: [{ id: 'v1', name: '测试城' }, { id: 'v2', name: '第二城' }] });
    }
    if (u.includes('/feedback/stats')) {
      return json({ total: 0, byKind: { up: 0, down: 0, followup: 0, rewrite: 0 }, recentDown: [] });
    }
    if (init?.method === 'PUT' && putStatus !== 200) {
      return json({ error: '磁盘写入失败' }, putStatus);
    }
    return json(CFG);
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('配置模型面板', () => {
  let mount: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('保存成功：按钮变「已保存 ✓」成功态，状态行不重复显示', async () => {
    stubFetch();
    const pane = createModelPane(mount);
    pane.refresh();
    await flush();
    const btn = mount.querySelector<HTMLButtonElement>('.st-save')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(btn.textContent).toBe('已保存 ✓');
    expect(btn.classList.contains('saved')).toBe(true);
    // 成功反馈只在按钮上，状态行留空（仅错误时使用）
    expect(mount.querySelector('.st-status')!.textContent).toBe('');
    pane.dispose();
  });

  it('保存成功触发 onSaved 回调', async () => {
    stubFetch();
    const pane = createModelPane(mount);
    const onSaved = vi.fn();
    pane.onSaved = onSaved;
    pane.refresh();
    await flush();
    mount.querySelector<HTMLButtonElement>('.st-save')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    pane.dispose();
  });

  it('保存失败：状态行显示原因，按钮恢复可点', async () => {
    stubFetch(500);
    const pane = createModelPane(mount);
    pane.refresh();
    await flush();
    const btn = mount.querySelector<HTMLButtonElement>('.st-save')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(mount.querySelector('.st-status')!.textContent).toContain('磁盘写入失败');
    expect(mount.querySelector('.st-status')!.classList.contains('err')).toBe(true);
    expect(btn.textContent).toBe('保存');
    expect(btn.disabled).toBe(false);
    pane.dispose();
  });

  it('评估区带目标仓库下拉：默认选第一个仓库，展开选项在框下方面板', async () => {
    stubFetch();
    const pane = createModelPane(mount);
    pane.refresh();
    await flush();
    const dd = mount.querySelector<HTMLElement>('.st-eval-vault')!;
    expect(dd.querySelector('.dd-label')!.textContent).toBe('测试城');
    dd.querySelector<HTMLElement>('.dd-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = dd.querySelectorAll('.dd-item');
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains('selected')).toBe(true);
    expect(items[1].textContent).toContain('第二城');
    pane.dispose();
  });
});
