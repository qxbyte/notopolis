/**
 * ui/notemodal.ts — 笔记查看/编辑弹窗。
 * 查看模式渲染 Markdown；编辑模式为 textarea；保存写回 vault（PUT /api/note）。
 */
import { renderMarkdown } from '../util/markdown';
import { pushOverlay } from './overlaystack';

export interface NoteModal {
  open(vaultId: string, notePath: string, title: string): void;
  close(): void;
  isOpen(): boolean;
  /** 当前打开的笔记路径（未打开返回 null）——WS 重建后恢复用 */
  currentPath(): string | null;
  dispose(): void;
}

export function createNoteModal(
  container: HTMLElement,
  opts: {
    fetchMarkdown: (vaultId: string, notePath: string) => Promise<string>;
    saveMarkdown: (vaultId: string, notePath: string, md: string) => Promise<void>;
  },
): NoteModal {
  const overlay = document.createElement('div');
  overlay.className = 'note-overlay';
  overlay.innerHTML = `
    <div class="note-modal">
      <div class="note-head">
        <h3 class="note-title"></h3>
        <div class="note-actions">
          <button class="note-edit">编辑</button>
          <button class="note-save" style="display:none">保存</button>
          <button class="note-cancel" style="display:none">取消</button>
          <button class="note-close" aria-label="关闭">✕</button>
        </div>
      </div>
      <div class="note-status"></div>
      <div class="note-view md-body"></div>
      <textarea class="note-edit-area" spellcheck="false" style="display:none"></textarea>
    </div>`;
  container.appendChild(overlay);

  const modal = overlay.querySelector<HTMLElement>('.note-modal')!;
  const titleEl = overlay.querySelector<HTMLElement>('.note-title')!;
  const viewEl = overlay.querySelector<HTMLElement>('.note-view')!;
  const editArea = overlay.querySelector<HTMLTextAreaElement>('.note-edit-area')!;
  const statusEl = overlay.querySelector<HTMLElement>('.note-status')!;
  const editBtn = overlay.querySelector<HTMLButtonElement>('.note-edit')!;
  const saveBtn = overlay.querySelector<HTMLButtonElement>('.note-save')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('.note-cancel')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.note-close')!;

  let open = false;
  let editing = false;
  let curVault = '';
  let curPath = '';
  let curSource = ''; // 当前已加载/已保存的原文
  let popSelf: (() => void) | null = null;

  function setMode(edit: boolean): void {
    editing = edit;
    viewEl.style.display = edit ? 'none' : 'block';
    editArea.style.display = edit ? 'block' : 'none';
    editBtn.style.display = edit ? 'none' : 'inline-block';
    saveBtn.style.display = edit ? 'inline-block' : 'none';
    cancelBtn.style.display = edit ? 'inline-block' : 'none';
    if (edit) {
      editArea.value = curSource;
      editArea.focus();
    }
  }

  function renderView(): void {
    viewEl.innerHTML = renderMarkdown(curSource);
  }

  async function load(): Promise<void> {
    statusEl.textContent = '加载中…';
    statusEl.className = 'note-status loading';
    try {
      curSource = await opts.fetchMarkdown(curVault, curPath);
      renderView();
      statusEl.textContent = '';
    } catch {
      viewEl.innerHTML = '';
      statusEl.textContent = '加载失败';
      statusEl.className = 'note-status err';
    }
  }

  async function doSave(): Promise<void> {
    saveBtn.disabled = true;
    statusEl.textContent = '保存中…';
    statusEl.className = 'note-status loading';
    try {
      const md = editArea.value;
      await opts.saveMarkdown(curVault, curPath, md);
      curSource = md;
      renderView();
      setMode(false);
      statusEl.textContent = '已保存 ✓';
      statusEl.className = 'note-status ok';
    } catch {
      statusEl.textContent = '保存失败';
      statusEl.className = 'note-status err';
    } finally {
      saveBtn.disabled = false;
    }
  }

  editBtn.addEventListener('click', () => setMode(true));
  saveBtn.addEventListener('click', () => void doSave());
  cancelBtn.addEventListener('click', () => {
    setMode(false);
    statusEl.textContent = '';
  });
  closeBtn.addEventListener('click', () => api.close());
  overlay.addEventListener('mousedown', (e) => {
    if (!modal.contains(e.target as Node)) api.close();
  });

  const api: NoteModal = {
    isOpen: () => open,
    currentPath: () => (open ? curPath : null),
    open(vaultId: string, notePath: string, title: string): void {
      curVault = vaultId;
      curPath = notePath;
      titleEl.textContent = title;
      statusEl.textContent = '';
      setMode(false);
      viewEl.innerHTML = '';
      if (!open) {
        open = true;
        overlay.classList.add('open');
        popSelf = pushOverlay(() => api.close());
      }
      void load();
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
      overlay.remove();
    },
  };
  return api;
}
