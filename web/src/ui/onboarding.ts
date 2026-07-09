/**
 * ui/onboarding.ts
 * 仓库管理首页——添加、查看、删除 Obsidian 仓库；进入世界地图。
 */

import { fetchWorld, addVault, removeVault } from '../api';
import type { WorldVault } from '../api';

const THEME_LABELS: Record<string, string> = {
  plains: '平原王城',
  mountain: '山地雄关',
  harbor: '海港商邦',
  snow: '雪原孤城',
};

export interface HomeOptions {
  onEnter: () => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
}

export function showHome(parent: HTMLElement, options: HomeOptions | (() => void)): void {
  // 兼容旧调用方式：showHome(parent, onDone)
  const onEnter = typeof options === 'function' ? options : options.onEnter;

  const overlay = document.createElement('div');
  overlay.id = 'onboarding';

  overlay.innerHTML = `
    <div class="ob-box">
      <h1>NOTOPOLIS</h1>
      <p class="subtitle">仓库管理 · 每一座 Obsidian 仓库都是一座城邦</p>
      <ul class="vault-list" id="vault-list"></ul>
      <div class="add-form">
        <input id="ob-path" type="text" placeholder="仓库绝对路径，例如 /Users/you/Notes" />
        <input id="ob-name" type="text" placeholder="城邦名称" />
        <select id="ob-theme">
          <option value="plains">平原王城</option>
          <option value="mountain">山地雄关</option>
          <option value="harbor">海港商邦</option>
          <option value="snow">雪原孤城</option>
        </select>
        <button class="add-btn" id="ob-add-btn">＋ 添加仓库</button>
      </div>
      <div class="ob-error" id="ob-error"></div>
      <button class="found-btn" id="ob-found-btn" disabled>⚑ 进入世界</button>
    </div>
  `;

  parent.appendChild(overlay);

  const vaultList = overlay.querySelector<HTMLUListElement>('#vault-list')!;
  const pathInput = overlay.querySelector<HTMLInputElement>('#ob-path')!;
  const nameInput = overlay.querySelector<HTMLInputElement>('#ob-name')!;
  const themeSelect = overlay.querySelector<HTMLSelectElement>('#ob-theme')!;
  const addBtn = overlay.querySelector<HTMLButtonElement>('#ob-add-btn')!;
  const errorDiv = overlay.querySelector<HTMLDivElement>('#ob-error')!;
  const foundBtn = overlay.querySelector<HTMLButtonElement>('#ob-found-btn')!;

  function renderVaults(vaults: WorldVault[]): void {
    vaultList.innerHTML = '';
    for (const vault of vaults) {
      const li = document.createElement('li');
      li.className = 'vault-item';

      // 状态徽标
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
        <button class="del-btn" data-id="${escHtml(vault.id)}">✕</button>
      `;
      vaultList.appendChild(li);
    }
    foundBtn.disabled = vaults.length === 0;
  }

  async function reload(): Promise<void> {
    const { vaults } = await fetchWorld();
    renderVaults(vaults);
  }

  // Initial load
  reload().catch(() => {
    errorDiv.textContent = '无法加载仓库列表';
  });

  // Delete vault
  vaultList.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.del-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    try {
      await removeVault(id);
      await reload();
    } catch {
      errorDiv.textContent = '删除仓库失败';
    }
  });

  // Add vault
  addBtn.addEventListener('click', async () => {
    const path = pathInput.value.trim();
    const name = nameInput.value.trim();
    const theme = themeSelect.value;
    errorDiv.textContent = '';
    if (!path || !name) {
      errorDiv.textContent = '请填写仓库路径和城邦名称';
      return;
    }
    try {
      await addVault(name, path, theme);
      pathInput.value = '';
      nameInput.value = '';
      await reload();
    } catch (err) {
      errorDiv.textContent = err instanceof Error ? err.message : '添加仓库失败';
    }
  });

  // Enter world
  foundBtn.addEventListener('click', () => {
    overlay.remove();
    onEnter();
  });
}

// 向后兼容别名
export function showOnboarding(parent: HTMLElement, onDone: () => void): void {
  showHome(parent, onDone);
}

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
