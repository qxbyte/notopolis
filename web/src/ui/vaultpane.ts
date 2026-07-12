/**
 * ui/vaultpane.ts — 「配置仓库」面板（嵌入设置中心弹窗 ui/settingshub.ts）。
 * Obsidian 仓库的列表/添加/删除；增删成功触发 onChanged（世界地图就地刷新）。
 */
import { addVault, fetchWorld, removeVault } from '../api';
import type { WorldVault } from '../api';
import { createDropdown } from './dropdown';

const THEME_LABELS: Record<string, string> = {
  plains: '平原王城',
  mountain: '山地雄关',
  harbor: '海港商邦',
  snow: '雪原孤城',
};

const TIER_LABELS: Record<string, string> = {
  camp: '拓荒营地',
  village: '聚落村庄',
  city: '繁华城市',
  capital: '帝都首府',
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface VaultPane {
  /** 重新拉取并渲染仓库列表（面板每次展示时调用） */
  reload(): void;
  /** 仓库增删成功后触发（世界地图就地刷新用） */
  onChanged?: () => void;
  dispose(): void;
}

export function createVaultPane(mount: HTMLElement): VaultPane {
  mount.innerHTML = `
    <p class="vm-subtitle">每一座 Obsidian 仓库都是一座城邦</p>
    <ul class="vault-list" id="vault-list"></ul>
    <div class="add-form">
      <input id="ob-path" type="text" placeholder="仓库绝对路径，例如 /Users/you/Notes" />
      <input id="ob-name" type="text" placeholder="城邦名称" />
      <div id="ob-theme"></div>
      <button class="add-btn" id="ob-add-btn">＋ 添加仓库</button>
    </div>
    <div class="ob-error" id="ob-error"></div>`;

  const vaultList = mount.querySelector<HTMLUListElement>('#vault-list')!;
  const pathInput = mount.querySelector<HTMLInputElement>('#ob-path')!;
  const nameInput = mount.querySelector<HTMLInputElement>('#ob-name')!;
  const themeDd = createDropdown(mount.querySelector<HTMLElement>('#ob-theme')!);
  themeDd.setOptions(
    Object.entries(THEME_LABELS).map(([value, label]) => ({ value, label })),
    'plains',
  );
  const addBtn = mount.querySelector<HTMLButtonElement>('#ob-add-btn')!;
  const errorDiv = mount.querySelector<HTMLDivElement>('#ob-error')!;

  function renderVaults(vaults: WorldVault[]): void {
    if (vaults.length === 0) {
      vaultList.innerHTML = '<li class="vm-empty">还没有仓库——在下方添加你的第一座城邦。</li>';
      return;
    }
    vaultList.innerHTML = '';
    for (const vault of vaults) {
      const li = document.createElement('li');
      li.className = 'vault-item';
      let badge: string;
      if (vault.ok) {
        const tierLabel = TIER_LABELS[vault.tier] ?? vault.tier;
        badge = `<span class="vault-badge vault-badge--ok">✓ ${vault.noteCount} 篇 · ${escHtml(tierLabel)}</span>`;
      } else {
        badge = `<span class="vault-badge vault-badge--warn">⚠ 无法读取</span>`;
      }
      const themeLabel = THEME_LABELS[vault.theme] ?? vault.theme;
      li.innerHTML = `
        <span class="vault-name">${escHtml(vault.name)}</span>
        <span class="vault-path">${escHtml(vault.path)}</span>
        <span class="vault-theme">${escHtml(themeLabel)}</span>
        ${badge}
        <button class="del-btn" data-id="${escHtml(vault.id)}" title="移除仓库">✕</button>
      `;
      vaultList.appendChild(li);
    }
  }

  async function reload(): Promise<void> {
    try {
      const { vaults } = await fetchWorld();
      renderVaults(vaults);
    } catch {
      errorDiv.textContent = '无法加载仓库列表';
    }
  }

  async function onListClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.del-btn');
    if (!btn?.dataset.id) return;
    try {
      await removeVault(btn.dataset.id);
      await reload();
      api.onChanged?.();
    } catch {
      errorDiv.textContent = '删除仓库失败';
    }
  }

  async function onAdd(): Promise<void> {
    const path = pathInput.value.trim();
    const name = nameInput.value.trim();
    errorDiv.textContent = '';
    if (!path || !name) {
      errorDiv.textContent = '请填写仓库路径和城邦名称';
      return;
    }
    try {
      await addVault(name, path, themeDd.value());
      pathInput.value = '';
      nameInput.value = '';
      await reload();
      api.onChanged?.();
    } catch (err) {
      errorDiv.textContent = err instanceof Error ? err.message : '添加仓库失败';
    }
  }

  const onListClickBound = (e: MouseEvent): void => void onListClick(e);
  const onAddBound = (): void => void onAdd();
  vaultList.addEventListener('click', onListClickBound);
  addBtn.addEventListener('click', onAddBound);

  const api: VaultPane = {
    reload(): void {
      errorDiv.textContent = '';
      void reload();
    },
    dispose(): void {
      vaultList.removeEventListener('click', onListClickBound);
      addBtn.removeEventListener('click', onAddBound);
      themeDd.dispose();
      mount.innerHTML = '';
    },
  };
  return api;
}
