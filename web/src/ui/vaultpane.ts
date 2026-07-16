/**
 * ui/vaultpane.ts — 「配置仓库」面板（嵌入设置中心弹窗 ui/settingshub.ts）。
 * 两种加库方式：本地仓库（绝对路径）与 Git 仓库（克隆远端到服务器本地）。
 * Git 库克隆/同步带进度条（轮询后端进度）；增删成功触发 onChanged（世界地图就地刷新）。
 */
import {
  addGitVault,
  addVault,
  fetchWorld,
  gitSyncProgress,
  removeVault,
  syncGitVault,
} from '../api';
import type { WorldVault } from '../api';
import { createDropdown } from './dropdown';

const THEME_LABELS: Record<string, string> = {
  plains: '平原王城',
  mountain: '山地雄关',
  harbor: '海港商邦',
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
    <div class="vault-add">
      <div class="vault-tabs">
        <button class="vault-tab active" data-mode="local">本地仓库</button>
        <button class="vault-tab" data-mode="git">Git 仓库</button>
      </div>
      <div class="vault-tab-card">
        <div class="add-form" id="form-local">
          <input id="ob-path" type="text" placeholder="仓库绝对路径，例如 /Users/you/Notes" />
          <input id="ob-name" type="text" placeholder="城邦名称" />
          <div id="ob-theme"></div>
          <button class="add-btn" id="ob-add-btn">＋ 添加仓库</button>
        </div>
        <div class="add-form" id="form-git" hidden>
          <input id="git-url" type="text" placeholder="Git 仓库地址，例如 https://github.com/you/vault.git" />
          <input id="git-subdir" type="text" placeholder="笔记子目录，例如 Notes（仓库根留空）" />
          <input id="git-token" type="password" placeholder="GitHub Token（私有库需要）" />
          <input id="git-name" type="text" placeholder="城邦名称" />
          <div id="git-theme"></div>
          <button class="add-btn" id="git-add-btn">＋ 克隆并添加</button>
        </div>
        <div class="git-progress" id="git-progress" hidden>
          <div class="git-progress-bar"><div class="git-progress-fill" id="git-progress-fill"></div></div>
          <div class="git-progress-label" id="git-progress-label"></div>
        </div>
        <div class="ob-error" id="ob-error"></div>
      </div>
    </div>`;

  const vaultList = mount.querySelector<HTMLUListElement>('#vault-list')!;
  const pathInput = mount.querySelector<HTMLInputElement>('#ob-path')!;
  const nameInput = mount.querySelector<HTMLInputElement>('#ob-name')!;
  const themeDd = createDropdown(mount.querySelector<HTMLElement>('#ob-theme')!);
  const gitUrl = mount.querySelector<HTMLInputElement>('#git-url')!;
  const gitSubdir = mount.querySelector<HTMLInputElement>('#git-subdir')!;
  const gitToken = mount.querySelector<HTMLInputElement>('#git-token')!;
  const gitName = mount.querySelector<HTMLInputElement>('#git-name')!;
  const gitThemeDd = createDropdown(mount.querySelector<HTMLElement>('#git-theme')!);
  const themeOptions = Object.entries(THEME_LABELS).map(([value, label]) => ({ value, label }));
  themeDd.setOptions(themeOptions, 'plains');
  gitThemeDd.setOptions(themeOptions, 'plains');

  const addBtn = mount.querySelector<HTMLButtonElement>('#ob-add-btn')!;
  const gitAddBtn = mount.querySelector<HTMLButtonElement>('#git-add-btn')!;
  const errorDiv = mount.querySelector<HTMLDivElement>('#ob-error')!;
  const formLocal = mount.querySelector<HTMLDivElement>('#form-local')!;
  const formGit = mount.querySelector<HTMLDivElement>('#form-git')!;
  const tabs = mount.querySelectorAll<HTMLButtonElement>('.vault-tab');
  const progressBox = mount.querySelector<HTMLDivElement>('#git-progress')!;
  const progressFill = mount.querySelector<HTMLDivElement>('#git-progress-fill')!;
  const progressLabel = mount.querySelector<HTMLDivElement>('#git-progress-label')!;

  let stopPoll: (() => void) | null = null;

  function switchMode(mode: string): void {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    formLocal.hidden = mode !== 'local';
    formGit.hidden = mode !== 'git';
    errorDiv.textContent = '';
  }

  function showProgress(pct: number, phase: string): void {
    progressBox.hidden = false;
    progressFill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
    progressLabel.textContent = `${phase} · ${pct}%`;
  }
  function hideProgress(): void {
    progressBox.hidden = true;
    progressFill.style.width = '0%';
    progressLabel.textContent = '';
  }

  /** 轮询同步进度；完成/失败时回调 onDone(error|null) */
  function pollProgress(id: string, onDone: (error: string | null) => void): void {
    stopPoll?.();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    stopPoll = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const p = await gitSyncProgress(id);
        showProgress(p.pct, p.phase);
        if (!p.running) {
          stopped = true;
          onDone(p.error ?? null);
          return;
        }
      } catch {
        /* 轮询抖动忽略，下次再试 */
      }
      timer = setTimeout(() => void tick(), 500);
    };
    void tick();
  }

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
      const gitBadge = vault.git ? `<span class="vault-git" title="${escHtml(vault.git.url)}">git</span>` : '';
      const syncBtn = vault.git
        ? `<button class="sync-btn" data-id="${escHtml(vault.id)}" title="拉取更新">⟳ 同步</button>`
        : '';
      li.innerHTML = `
        <span class="vault-name">${escHtml(vault.name)}${gitBadge}</span>
        <span class="vault-path">${escHtml(vault.path)}</span>
        <span class="vault-theme">${escHtml(themeLabel)}</span>
        ${badge}
        ${syncBtn}
        <button class="del-btn" data-id="${escHtml(vault.id)}" title="移除仓库">✕</button>
      `;
      vaultList.appendChild(li);
    }
  }

  async function reload(): Promise<void> {
    try {
      const { vaults, hasGitToken } = await fetchWorld();
      renderVaults(vaults);
      gitToken.placeholder = hasGitToken
        ? 'GitHub Token（已保存，留空沿用）'
        : 'GitHub Token（私有库需要）';
    } catch {
      errorDiv.textContent = '无法加载仓库列表';
    }
  }

  async function onListClick(e: MouseEvent): Promise<void> {
    const syncBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sync-btn');
    if (syncBtn?.dataset.id) {
      const id = syncBtn.dataset.id;
      errorDiv.textContent = '';
      syncBtn.disabled = true;
      try {
        await syncGitVault(id);
        showProgress(1, '拉取中');
        pollProgress(id, (error) => {
          syncBtn.disabled = false;
          if (error) {
            errorDiv.textContent = `同步失败：${error}`;
            hideProgress();
          } else {
            void reload().then(() => api.onChanged?.());
            setTimeout(hideProgress, 800);
          }
        });
      } catch (err) {
        syncBtn.disabled = false;
        errorDiv.textContent = err instanceof Error ? err.message : '同步失败';
      }
      return;
    }
    const delBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.del-btn');
    if (!delBtn?.dataset.id) return;
    try {
      await removeVault(delBtn.dataset.id);
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

  async function onGitAdd(): Promise<void> {
    const url = gitUrl.value.trim();
    const name = gitName.value.trim();
    errorDiv.textContent = '';
    if (!url || !name) {
      errorDiv.textContent = '请填写 Git 仓库地址和城邦名称';
      return;
    }
    gitAddBtn.disabled = true;
    try {
      const { id } = await addGitVault({
        url,
        subdir: gitSubdir.value.trim(),
        name,
        theme: gitThemeDd.value(),
        token: gitToken.value.trim() || undefined,
      });
      showProgress(1, '克隆中');
      pollProgress(id, (error) => {
        gitAddBtn.disabled = false;
        if (error) {
          errorDiv.textContent = `克隆失败：${error}`;
          hideProgress();
        } else {
          gitUrl.value = '';
          gitName.value = '';
          gitSubdir.value = '';
          gitToken.value = '';
          void reload().then(() => api.onChanged?.());
          setTimeout(hideProgress, 800);
        }
      });
    } catch (err) {
      gitAddBtn.disabled = false;
      errorDiv.textContent = err instanceof Error ? err.message : '克隆仓库失败';
    }
  }

  const onListClickBound = (e: MouseEvent): void => void onListClick(e);
  const onAddBound = (): void => void onAdd();
  const onGitAddBound = (): void => void onGitAdd();
  const onTabClick = (e: MouseEvent): void => {
    const mode = (e.currentTarget as HTMLButtonElement).dataset.mode;
    if (mode) switchMode(mode);
  };
  vaultList.addEventListener('click', onListClickBound);
  addBtn.addEventListener('click', onAddBound);
  gitAddBtn.addEventListener('click', onGitAddBound);
  tabs.forEach((t) => t.addEventListener('click', onTabClick));

  const api: VaultPane = {
    reload(): void {
      errorDiv.textContent = '';
      void reload();
    },
    dispose(): void {
      stopPoll?.();
      vaultList.removeEventListener('click', onListClickBound);
      addBtn.removeEventListener('click', onAddBound);
      gitAddBtn.removeEventListener('click', onGitAddBound);
      tabs.forEach((t) => t.removeEventListener('click', onTabClick));
      themeDd.dispose();
      gitThemeDd.dispose();
      mount.innerHTML = '';
    },
  };
  return api;
}
