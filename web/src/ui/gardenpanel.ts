/**
 * ui/gardenpanel.ts — 园丁清单侧栏（F5）。列出最久未打理的建筑，引导回访。
 * 语义：数据只有 mtime，口径是「最久未修改」（不是「未访问」）。
 */
import { createSidePanel } from './panel';

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
    const row = el.closest<HTMLElement>('.panel-item');
    if (!row) return;
    const notePath = row.getAttribute('data-path');
    if (notePath && el.classList.contains('act-locate')) opts.onLocate(notePath);
  }
  body.addEventListener('click', onBodyClick);

  function refresh(items: GardenItem[]): void {
    if (items.length === 0) {
      body.innerHTML = '<div class="panel-empty">城中还没有建筑。</div>';
      return;
    }
    body.innerHTML = items
      .map(
        (it) =>
          `<div class="panel-item" data-path="${esc(it.notePath)}">` +
          `<span class="grow">🌱 ${esc(it.title)} · ${it.daysSince} 天前 · ${esc(it.dir || '(根目录)')}</span>` +
          `<span class="act act-locate">定位</span>` +
          `<a class="act act-obsidian" href="${esc(opts.obsidianHref(it.notePath))}">↗</a>` +
          `</div>`,
      )
      .join('');
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
