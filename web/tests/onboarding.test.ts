// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorldVault } from '../src/api';

vi.mock('../src/api', () => ({
  fetchWorld: vi.fn(),
  addVault: vi.fn(),
  removeVault: vi.fn(),
}));

import { showOnboarding } from '../src/ui/onboarding';
import { fetchWorld, addVault, removeVault } from '../src/api';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const makeVault = (id: string, name: string): WorldVault => ({
  id,
  name,
  path: `/vaults/${id}`,
  theme: 'plains',
  noteCount: 10,
  tier: 'village',
  ok: true,
});

afterEach(() => {
  document.getElementById('onboarding')?.remove();
  vi.clearAllMocks();
});

describe('onboarding', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  it('renders vault list from fetchWorld', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({
      vaults: [makeVault('a', 'Vault A'), makeVault('b', 'Vault B')],
    });
    showOnboarding(parent, vi.fn());
    await flush();
    const overlay = document.getElementById('onboarding')!;
    expect(overlay.textContent).toContain('Vault A');
    expect(overlay.textContent).toContain('Vault B');
  });

  it('addVault called with correct args', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    vi.mocked(addVault).mockResolvedValue(makeVault('new', 'Test') as ReturnType<typeof addVault> extends Promise<infer T> ? T : never);

    showOnboarding(parent, vi.fn());
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

  it('found button disabled when no vaults', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [] });
    showOnboarding(parent, vi.fn());
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    expect(foundBtn.disabled).toBe(true);
  });

  it('found button enabled after vault exists', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'A')] });
    showOnboarding(parent, vi.fn());
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    expect(foundBtn.disabled).toBe(false);
  });

  it('onDone called on found button click', async () => {
    vi.mocked(fetchWorld).mockResolvedValue({ vaults: [makeVault('a', 'A')] });
    const onDone = vi.fn();
    showOnboarding(parent, onDone);
    await flush();
    const foundBtn = document.getElementById('onboarding')!.querySelector<HTMLButtonElement>('#ob-found-btn')!;
    foundBtn.click();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
