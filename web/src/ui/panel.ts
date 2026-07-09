/**
 * ui/panel.ts — 右侧滑入的纸片侧栏抽屉。
 * F2 工地面板、F5 园丁清单共用；打开时注册进 overlaystack（Esc 可关）。
 */
import { pushOverlay } from './overlaystack';

export interface SidePanel {
  /** 内容挂载点（滚动区） */
  body: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** 面板被关闭（含 Esc）时的回调，F2/F5 用它还原透镜 */
  onClose?: () => void;
  dispose(): void;
}

export function createSidePanel(container: HTMLElement, title: string): SidePanel {
  const root = document.createElement('div');
  root.className = 'panel';
  root.innerHTML = `
    <div class="panel-head">
      <h3></h3>
      <button class="panel-close" aria-label="关闭">✕</button>
    </div>
    <div class="panel-body"></div>`;
  root.querySelector<HTMLElement>('.panel-head h3')!.textContent = title;
  container.appendChild(root);

  const body = root.querySelector<HTMLElement>('.panel-body')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('.panel-close')!;

  let open = false;
  let popSelf: (() => void) | null = null;

  const api: SidePanel = {
    body,
    isOpen: () => open,
    open(): void {
      if (open) return;
      open = true;
      root.classList.add('open');
      popSelf = pushOverlay(() => api.close());
    },
    close(): void {
      if (!open) return;
      open = false;
      root.classList.remove('open');
      popSelf?.();
      popSelf = null;
      api.onClose?.();
    },
    toggle(): void {
      open ? api.close() : api.open();
    },
    dispose(): void {
      popSelf?.();
      popSelf = null;
      closeBtn.removeEventListener('click', onCloseClick);
      root.remove();
    },
  };

  function onCloseClick(): void {
    api.close();
  }
  closeBtn.addEventListener('click', onCloseClick);

  return api;
}
