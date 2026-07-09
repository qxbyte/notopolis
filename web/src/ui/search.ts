/**
 * ui/search.ts — ⌘K 搜索浮层（DOM + 键盘交互）。
 * 打分逻辑在 util/search.ts；本模块只管 DOM 与选中态。
 */
import { searchNotes, type SearchItem, type SearchHit } from '../util/search';
import { pushOverlay } from './overlaystack';

export interface SearchUI {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createSearchUI(
  container: HTMLElement,
  items: SearchItem[],
  decorate: (path: string) => string, // 返回 '🚧 '/'🏛 '/'⭐ '/'' 前缀
  onPick: (notePath: string) => void, // = flyTo + highlight + pickByPath（cityview2d 提供）
): SearchUI {
  const overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.innerHTML = `
    <div class="search-box">
      <input class="search-input" placeholder="搜索笔记… (Esc 关闭)" spellcheck="false" />
      <ul class="search-results"></ul>
    </div>`;
  container.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('.search-input')!;
  const list = overlay.querySelector<HTMLUListElement>('.search-results')!;
  const box = overlay.querySelector<HTMLElement>('.search-box')!;

  let open = false;
  let hits: SearchHit[] = [];
  let activeIdx = 0;
  let popSelf: (() => void) | null = null;

  function esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
    );
  }

  function render(): void {
    if (!input.value.trim()) {
      list.innerHTML = '';
      return;
    }
    if (hits.length === 0) {
      list.innerHTML = '<li class="search-empty">没有匹配的笔记</li>';
      return;
    }
    list.innerHTML = hits
      .map((h, i) => {
        const cls = i === activeIdx ? ' class="active"' : '';
        const dir = h.dir || '(根目录)';
        return `<li${cls} data-i="${i}">${decorate(h.notePath)}<b>${esc(h.title)}</b> <span class="dim">· ${esc(dir)}</span></li>`;
      })
      .join('');
  }

  function update(): void {
    hits = searchNotes(input.value, items);
    activeIdx = 0;
    render();
  }

  function pick(i: number): void {
    const h = hits[i];
    if (!h) return;
    api.close();
    onPick(h.notePath);
  }

  function onInput(): void {
    update();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length) activeIdx = (activeIdx + 1) % hits.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) activeIdx = (activeIdx - 1 + hits.length) % hits.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(activeIdx);
    }
    // Esc 由 main.ts 全局 overlaystack 处理
  }

  function onListClick(e: MouseEvent): void {
    const li = (e.target as HTMLElement).closest('li[data-i]');
    if (!li) return;
    pick(Number(li.getAttribute('data-i')));
  }

  function onListHover(e: MouseEvent): void {
    const li = (e.target as HTMLElement).closest('li[data-i]');
    if (!li) return;
    const i = Number(li.getAttribute('data-i'));
    if (i !== activeIdx) {
      activeIdx = i;
      render();
    }
  }

  // 点击遮罩空白处关闭（点击 box 内部不关）
  function onOverlayClick(e: MouseEvent): void {
    if (!box.contains(e.target as Node)) api.close();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  list.addEventListener('click', onListClick);
  list.addEventListener('mousemove', onListHover);
  overlay.addEventListener('mousedown', onOverlayClick);

  const api: SearchUI = {
    isOpen: () => open,
    open(): void {
      if (open) return;
      open = true;
      overlay.classList.add('open');
      input.value = '';
      hits = [];
      activeIdx = 0;
      render();
      input.focus();
      popSelf = pushOverlay(() => api.close());
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
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeydown);
      list.removeEventListener('click', onListClick);
      list.removeEventListener('mousemove', onListHover);
      overlay.removeEventListener('mousedown', onOverlayClick);
      overlay.remove();
    },
  };
  return api;
}
