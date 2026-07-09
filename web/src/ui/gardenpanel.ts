/**
 * ui/gardenpanel.ts — 园丁清单侧栏（F5），目录树形式。
 * 语义：口径是「最久未修改」（数据只有 mtime）。
 */
import { createSidePanel } from './panel';
import { buildTree, renderTree } from '../util/tree';
import { ICON } from './icons';

export interface GardenItem {
  notePath: string;
  title: string;
  dir: string;
  daysSince: number; // (generatedAt - mtimeMs) 折算天数，确定性
}

export interface GardenPanel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(items: GardenItem[]): void;
  onClose?: () => void;
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function createGardenPanel(
  container: HTMLElement,
  opts: {
    onLocate: (notePath: string) => void;
    obsidianHref: (notePath: string) => string;
  },
): GardenPanel {
  const panel = createSidePanel(container, '园丁 · 该浇水了');
  const body = panel.body;

  function onBodyClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    const fhead = el.closest<HTMLElement>('.tree-folder-head');
    if (fhead) {
      fhead.parentElement?.classList.toggle('collapsed');
      return;
    }
    const row = el.closest<HTMLElement>('.panel-item');
    if (notePathOf(row) && el.classList.contains('act-locate')) opts.onLocate(notePathOf(row)!);
  }
  function notePathOf(row: HTMLElement | null): string | null {
    return row?.getAttribute('data-path') ?? null;
  }
  body.addEventListener('click', onBodyClick);

  function refresh(items: GardenItem[]): void {
    if (items.length === 0) {
      body.innerHTML = '<div class="panel-empty">城中还没有建筑。</div>';
      return;
    }
    const tree = buildTree(items.map((it) => ({ notePath: it.notePath, data: it })));
    body.innerHTML = renderTree(tree, (leaf, depth) => {
      const it = leaf.data;
      const pad = (depth + 1) * 14 + 12;
      return (
        `<div class="panel-item tree-leaf" data-path="${esc(it.notePath)}" title="${esc(it.notePath)}" style="padding-left:${pad}px">` +
        `<span class="grow"><span class="pi-icon">${ICON.sprout}</span>${esc(leaf.name)} · ${it.daysSince} 天前</span>` +
        `<span class="act act-locate">定位</span>` +
        `<a class="act act-obsidian" href="${esc(opts.obsidianHref(it.notePath))}">↗</a>` +
        `</div>`
      );
    });
  }

  return {
    open: panel.open,
    close: panel.close,
    toggle: panel.toggle,
    isOpen: panel.isOpen,
    refresh,
    set onClose(fn: (() => void) | undefined) {
      panel.onClose = fn;
    },
    get onClose(): (() => void) | undefined {
      return panel.onClose;
    },
    dispose(): void {
      body.removeEventListener('click', onBodyClick);
      panel.dispose();
    },
  };
}
