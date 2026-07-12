/**
 * ui/settingshub.ts — 设置中心弹窗：左侧菜单（配置仓库/配置模型），右侧内容面板。
 * 世界地图右上「⚙ 设置」打开；菜单可扩展（新增面板 = 菜单项 + pane 工厂）。
 */
import { pushOverlay } from './overlaystack';
import { createVaultPane, type VaultPane } from './vaultpane';
import { createModelPane, type ModelPane } from './settings';
import { createThemePane, type ThemePane } from './themepane';
import { createVectorPane, type VectorPane } from './vectorpane';

export type HubSection = 'vaults' | 'models' | 'vector' | 'theme';

export interface SettingsHub {
  open(section?: HubSection): void;
  close(): void;
  isOpen(): boolean;
  /** 仓库增删后触发（世界地图就地刷新用） */
  onVaultsChanged?: () => void;
  dispose(): void;
}

export function createSettingsHub(container: HTMLElement): SettingsHub {
  const overlay = document.createElement('div');
  overlay.className = 'note-overlay hub-overlay';
  overlay.innerHTML = `
    <div class="note-modal hub-modal">
      <div class="note-head">
        <h3 class="note-title">设置</h3>
        <div class="note-actions">
          <button class="note-close" aria-label="关闭">✕</button>
        </div>
      </div>
      <div class="hub-body">
        <nav class="hub-menu">
          <button class="hub-menu-item" id="hub-menu-vaults" data-section="vaults">配置仓库</button>
          <button class="hub-menu-item" id="hub-menu-models" data-section="models">配置模型</button>
          <button class="hub-menu-item" id="hub-menu-vector" data-section="vector">向量库</button>
          <button class="hub-menu-item" id="hub-menu-theme" data-section="theme">主题</button>
        </nav>
        <div class="hub-content">
          <div class="hub-pane" data-pane="vaults"></div>
          <div class="hub-pane" data-pane="models" style="display:none"></div>
          <div class="hub-pane" data-pane="vector" style="display:none"></div>
          <div class="hub-pane" data-pane="theme" style="display:none"></div>
        </div>
      </div>
    </div>`;
  container.appendChild(overlay);

  const modal = overlay.querySelector<HTMLElement>('.hub-modal')!;
  const vaultPane: VaultPane = createVaultPane(
    overlay.querySelector<HTMLElement>('[data-pane="vaults"]')!,
  );
  const modelPane: ModelPane = createModelPane(
    overlay.querySelector<HTMLElement>('[data-pane="models"]')!,
  );
  const vectorPane: VectorPane = createVectorPane(
    overlay.querySelector<HTMLElement>('[data-pane="vector"]')!,
  );
  const themePane: ThemePane = createThemePane(
    overlay.querySelector<HTMLElement>('[data-pane="theme"]')!,
  );

  let open = false;
  let section: HubSection = 'vaults';
  let popSelf: (() => void) | null = null;

  vaultPane.onChanged = () => api.onVaultsChanged?.();

  function switchTo(next: HubSection): void {
    section = next;
    for (const item of overlay.querySelectorAll<HTMLElement>('.hub-menu-item')) {
      item.classList.toggle('active', item.dataset.section === next);
    }
    for (const pane of overlay.querySelectorAll<HTMLElement>('.hub-pane')) {
      pane.style.display = pane.dataset.pane === next ? 'block' : 'none';
    }
    if (next === 'vaults') vaultPane.reload();
    else if (next === 'models') modelPane.refresh();
    else if (next === 'vector') vectorPane.refresh();
    else themePane.refresh();
  }

  const onMenuClick = (e: MouseEvent): void => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.hub-menu-item');
    if (item?.dataset.section) switchTo(item.dataset.section as HubSection);
  };
  const onCloseClick = (): void => api.close();
  const onOverlayDown = (e: MouseEvent): void => {
    if (!modal.contains(e.target as Node)) api.close();
  };

  const menuEl = overlay.querySelector<HTMLElement>('.hub-menu')!;
  menuEl.addEventListener('click', onMenuClick);
  overlay.querySelector<HTMLElement>('.note-close')!.addEventListener('click', onCloseClick);
  overlay.addEventListener('mousedown', onOverlayDown);

  const api: SettingsHub = {
    isOpen: () => open,
    open(sec?: HubSection): void {
      if (!open) {
        open = true;
        overlay.classList.add('open');
        popSelf = pushOverlay(() => api.close());
      }
      switchTo(sec ?? section);
    },
    close(): void {
      if (!open) return;
      open = false;
      overlay.classList.remove('open');
      popSelf?.();
      popSelf = null;
    },
    dispose(): void {
      popSelf?.();
      popSelf = null;
      menuEl.removeEventListener('click', onMenuClick);
      overlay.removeEventListener('mousedown', onOverlayDown);
      vaultPane.dispose();
      modelPane.dispose();
      vectorPane.dispose();
      themePane.dispose();
      overlay.remove();
    },
  };
  return api;
}
