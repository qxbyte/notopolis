// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsHub } from '../src/ui/settingshub';

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes('/api/world')) return json({ vaults: [{ id: 'v1', name: '测试城', path: '/p', theme: 'plains', noteCount: 5, tier: 'camp', ok: true }] });
    if (u.includes('/feedback/stats')) {
      return json({ total: 0, byKind: { up: 0, down: 0, followup: 0, rewrite: 0 }, recentDown: [] });
    }
    if (u.includes('/api/rag/config')) {
      return json({
        enabled: false,
        embedding: { mode: 'local', local: { baseUrl: '', apiKey: '', model: '' }, remote: { baseUrl: '', apiKey: '', model: '' } },
        chat: { mode: 'off', local: { baseUrl: '', apiKey: '', model: '' }, remote: { baseUrl: '', apiKey: '', model: '' } },
        retrieval: { topK: 8, minScore: 0.35, perDocLimit: 3, maxContextChars: 6000, hybrid: true },
      });
    }
    return json({});
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('设置中心弹窗（左菜单 + 右内容）', () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    stubFetch();
  });

  it('默认打开「配置仓库」，菜单项高亮，仓库列表渲染', async () => {
    const hub = createSettingsHub(container);
    hub.open();
    await flush();
    expect(container.querySelector('.hub-overlay')!.classList.contains('open')).toBe(true);
    expect(container.querySelector('#hub-menu-vaults')!.classList.contains('active')).toBe(true);
    const vaultsPane = container.querySelector<HTMLElement>('[data-pane="vaults"]')!;
    expect(vaultsPane.style.display).not.toBe('none');
    expect(vaultsPane.textContent).toContain('测试城');
    expect(container.querySelector<HTMLElement>('[data-pane="models"]')!.style.display).toBe('none');
    hub.dispose();
  });

  it('点击「配置模型」切换面板', async () => {
    const hub = createSettingsHub(container);
    hub.open();
    await flush();
    container.querySelector<HTMLElement>('#hub-menu-models')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(container.querySelector('#hub-menu-models')!.classList.contains('active')).toBe(true);
    const modelsPane = container.querySelector<HTMLElement>('[data-pane="models"]')!;
    expect(modelsPane.style.display).not.toBe('none');
    expect(modelsPane.querySelector('.st-save')).toBeTruthy(); // 模型面板内容已挂载
    expect(container.querySelector<HTMLElement>('[data-pane="vaults"]')!.style.display).toBe('none');
    hub.dispose();
  });

  it('「主题」菜单项切换到主题面板', async () => {
    const hub = createSettingsHub(container);
    hub.open();
    await flush();
    container.querySelector<HTMLElement>('#hub-menu-theme')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(container.querySelector('#hub-menu-theme')!.classList.contains('active')).toBe(true);
    const themePane = container.querySelector<HTMLElement>('[data-pane="theme"]')!;
    expect(themePane.style.display).not.toBe('none');
    expect(themePane.querySelectorAll('.theme-card')).toHaveLength(6);
    hub.dispose();
  });

  it('open 可指定分区；✕ 关闭', async () => {
    const hub = createSettingsHub(container);
    hub.open('models');
    await flush();
    expect(container.querySelector('#hub-menu-models')!.classList.contains('active')).toBe(true);
    container.querySelector<HTMLButtonElement>('.hub-modal .note-close')!.click();
    expect(hub.isOpen()).toBe(false);
    expect(container.querySelector('.hub-overlay')!.classList.contains('open')).toBe(false);
    hub.dispose();
  });

  it('仓库面板增删透传 onVaultsChanged', async () => {
    const hub = createSettingsHub(container);
    const onChanged = vi.fn();
    hub.onVaultsChanged = onChanged;
    hub.open('vaults');
    await flush();
    container.querySelector<HTMLButtonElement>('.del-btn')!.click();
    await flush();
    expect(onChanged).toHaveBeenCalledOnce();
    hub.dispose();
  });
});
