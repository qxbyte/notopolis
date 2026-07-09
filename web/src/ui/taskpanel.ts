/**
 * ui/taskpanel.ts — 工地清单侧栏（F2）。按区分组展示含未完成任务的建筑。
 */
import { createSidePanel } from './panel';
import type { TaskGroup } from '../util/tasks';

export interface TaskPanel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** 用最新分组数据重绘（WS 整城重建后调用） */
  refresh(groups: TaskGroup[]): void;
  onClose?: () => void;
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function createTaskPanel(
  container: HTMLElement,
  opts: {
    onLocate: (notePath: string) => void;
    obsidianHref: (notePath: string) => string;
  },
): TaskPanel {
  const panel = createSidePanel(container, '工地清单');
  const body = panel.body;

  function onBodyClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('.panel-item');
    if (!row) return;
    const notePath = row.getAttribute('data-path');
    if (!notePath) return;
    if (el.classList.contains('act-locate')) {
      opts.onLocate(notePath);
    }
    // act-obsidian 是 <a href>，浏览器原生处理，无需拦截
  }
  body.addEventListener('click', onBodyClick);

  function refresh(groups: TaskGroup[]): void {
    if (groups.length === 0) {
      body.innerHTML = '<div class="panel-empty">城中无施工工地。<br>去写点带 <b>- [ ]</b> 的计划，这里就会热闹起来。</div>';
      return;
    }
    const parts: string[] = [];
    for (const g of groups) {
      parts.push(`<div class="panel-group-head">${esc(g.dir || '(根目录)')} · ${g.total}</div>`);
      for (const it of g.items) {
        parts.push(
          `<div class="panel-item" data-path="${esc(it.notePath)}">` +
            `<span class="grow">🚧 ${esc(it.title)} · ${it.openTasks} 项</span>` +
            `<span class="act act-locate">定位</span>` +
            `<a class="act act-obsidian" href="${esc(opts.obsidianHref(it.notePath))}">↗</a>` +
            `</div>`,
        );
      }
    }
    body.innerHTML = parts.join('');
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
