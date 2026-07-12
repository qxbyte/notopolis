// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorldVault } from '../src/api';

vi.mock('../src/api', () => ({
  fetchWorld: vi.fn(),
  addVault: vi.fn(),
  removeVault: vi.fn(),
}));

import { createVaultPane } from '../src/ui/vaultpane';
import { fetchWorld, addVault, removeVault } from '../src/api';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const makeVault = (id: string, name: string, ok = true): WorldVault => ({
  id,
  name,
  path: `/vaults/${id}`,
  theme: 'plains',
  noteCount: 10,
  tier: 'village',
  ok,
  reason: ok ? undefined : '路径不存在',
});

describe('createVaultPane（配置仓库面板）', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
    vi.clearAllMocks();
  });

  it('reload 渲染仓库列表与状态徽标', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({
      vaults: [makeVault('a', 'Vault A'), makeVault('b', 'Bad Vault', false)],
    });
    const pane = createVaultPane(mount);
    pane.reload();
    await flush();
    expect(mount.textContent).toContain('Vault A');
    expect(mount.textContent).toContain('10 篇');
    expect(mount.textContent).toContain('聚落村庄');
    expect(mount.querySelector('.vault-badge--ok')).not.toBeNull();
    expect(mount.textContent).toContain('⚠ 无法读取');
    expect(mount.querySelector('.vault-badge--warn')).not.toBeNull();
    pane.dispose();
  });

  it('无仓库时显示空状态引导', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    const pane = createVaultPane(mount);
    pane.reload();
    await flush();
    expect(mount.querySelector('.vm-empty')!.textContent).toContain('第一座城邦');
    pane.dispose();
  });

  it('添加仓库：传参正确并触发 onChanged', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    vi.mocked(addVault).mockResolvedValue(makeVault('new', 'Test'));
    const pane = createVaultPane(mount);
    const onChanged = vi.fn();
    pane.onChanged = onChanged;
    pane.reload();
    await flush();

    mount.querySelector<HTMLInputElement>('#ob-path')!.value = '/some/path';
    mount.querySelector<HTMLInputElement>('#ob-name')!.value = 'Test';
    // 自定义下拉：展开 → 点选「山地雄关」
    mount.querySelector<HTMLElement>('#ob-theme .dd-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    mount.querySelector<HTMLElement>('#ob-theme .dd-item[data-v="mountain"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('new', 'Test')] });
    mount.querySelector<HTMLButtonElement>('#ob-add-btn')!.click();
    await flush();

    expect(addVault).toHaveBeenCalledWith('Test', '/some/path', 'mountain');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(mount.querySelector('.vault-list')!.textContent).toContain('Test');
    pane.dispose();
  });

  it('路径/名称为空时提示错误且不调用 addVault', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    const pane = createVaultPane(mount);
    pane.reload();
    await flush();
    mount.querySelector<HTMLButtonElement>('#ob-add-btn')!.click();
    await flush();
    expect(mount.querySelector('#ob-error')!.textContent).toContain('请填写');
    expect(addVault).not.toHaveBeenCalled();
    pane.dispose();
  });

  it('删除仓库触发 removeVault 与 onChanged', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'Vault A')] });
    vi.mocked(removeVault).mockResolvedValue(undefined);
    const pane = createVaultPane(mount);
    const onChanged = vi.fn();
    pane.onChanged = onChanged;
    pane.reload();
    await flush();
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    mount.querySelector<HTMLButtonElement>('.del-btn')!.click();
    await flush();
    expect(removeVault).toHaveBeenCalledWith('a');
    expect(onChanged).toHaveBeenCalledOnce();
    pane.dispose();
  });
});
