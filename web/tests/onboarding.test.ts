// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorldVault } from '../src/api';

vi.mock('../src/api', () => ({
  fetchWorld: vi.fn(),
  addVault: vi.fn(),
  removeVault: vi.fn(),
}));

import { showHome, showOnboarding } from '../src/ui/onboarding';
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

afterEach(() => {
  document.getElementById('onboarding')?.remove();
  vi.clearAllMocks();
});

describe('showHome (仓库管理首页)', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  it('renders NOTOPOLIS title and subtitle', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const overlay = document.getElementById('onboarding')!;
    expect(overlay.textContent).toContain('NOTOPOLIS');
    expect(overlay.textContent).toContain('仓库管理');
  });

  it('renders vault list from fetchWorld', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({
      vaults: [makeVault('a', 'Vault A'), makeVault('b', 'Vault B')],
    });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const overlay = document.getElementById('onboarding')!;
    expect(overlay.textContent).toContain('Vault A');
    expect(overlay.textContent).toContain('Vault B');
  });

  it('shows ok badge with noteCount and tier label when vault.ok=true', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({
      vaults: [makeVault('a', 'Vault A', true)],
    });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const overlay = document.getElementById('onboarding')!;
    // 状态徽标包含篇数和 tier 中文名
    expect(overlay.textContent).toContain('10 篇');
    expect(overlay.textContent).toContain('聚落村庄');
    const badge = overlay.querySelector('.vault-badge--ok');
    expect(badge).not.toBeNull();
  });

  it('shows warn badge when vault.ok=false', async () => {
    const badVault = makeVault('c', 'Bad Vault', false);
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [badVault] });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const overlay = document.getElementById('onboarding')!;
    expect(overlay.textContent).toContain('⚠ 无法读取');
    const badge = overlay.querySelector('.vault-badge--warn');
    expect(badge).not.toBeNull();
  });

  it('addVault called with correct args', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    vi.mocked(addVault).mockResolvedValue(makeVault('new', 'Test') as ReturnType<typeof addVault> extends Promise<infer T> ? T : never);

    showHome(parent, { onEnter: vi.fn() });
    await flush();

    const overlay = document.getElementById('onboarding')!;
    const pathInput = overlay.querySelector<HTMLInputElement>('#ob-path')!;
    const nameInput = overlay.querySelector<HTMLInputElement>('#ob-name')!;
    const themeSelect = overlay.querySelector<HTMLSelectElement>('#ob-theme')!;
    const addBtn = overlay.querySelector<HTMLButtonElement>('#ob-add-btn')!;

    pathInput.value = '/some/path';
    nameInput.value = 'Test';
    themeSelect.value = 'mountain';

    // fetchWorld called again after add
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('new', 'Test')] });

    addBtn.click();
    await flush();

    expect(addVault).toHaveBeenCalledWith('Test', '/some/path', 'mountain');
  });

  it('enter button disabled when no vaults', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    expect(foundBtn.disabled).toBe(true);
  });

  it('enter button enabled after vault exists', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'A')] });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    expect(foundBtn.disabled).toBe(false);
  });

  it('enter button shows ⚑ 进入世界', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    showHome(parent, { onEnter: vi.fn() });
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    expect(foundBtn.textContent).toContain('进入世界');
  });

  it('onEnter called on enter button click', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'A')] });
    const onEnter = vi.fn();
    showHome(parent, { onEnter });
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    foundBtn.click();
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('backward-compat: showOnboarding(parent, onDone) still works', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'A')] });
    const onDone = vi.fn();
    showOnboarding(parent, onDone);
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    foundBtn.click();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
