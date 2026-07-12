/**
 * ui/taskpanel.ts — 工地清单侧栏（F2），目录树形式，可展开/收起。
 */
import { createSidePanel } from './panel';
import { buildTree, renderTree } from '../util/tree';
import { ICON } from './icons';
import type { TaskItem } from '../util/tasks';

export interface TaskPanel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** 用最新任务列表重绘（WS 整城重建后调用） */
  refresh(items: TaskItem[]): void;
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
  },
): TaskPanel {
  const panel = createSidePanel(container, '工地清单');
  const body = panel.body;

  function onBodyClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    // 目录展开/收起
    const fhead = el.closest<HTMLElement>('.tree-folder-head');
    if (fhead) {
      fhead.parentElement?.classList.toggle('collapsed');
      return;
    }
    // 点击文档行即定位（无独立按钮）
    const notePath = el.closest<HTMLElement>('.panel-item')?.getAttribute('data-path');
    if (notePath) opts.onLocate(notePath);
  }
  body.addEventListener('click', onBodyClick);

  function refresh(items: TaskItem[]): void {
    if (items.length === 0) {
      body.innerHTML =
        '<div class="panel-empty">城中无施工工地。<br>去写点带 <b>- [ ]</b> 的计划，这里就会热闹起来。</div>';
      return;
    }
    const tree = buildTree(items.map((it) => ({ notePath: it.notePath, data: it })));
    body.innerHTML = renderTree(tree, (leaf, depth) => {
      const it = leaf.data;
      const pad = (depth + 1) * 14 + 12;
      return (
        `<div class="panel-item tree-leaf" data-path="${esc(it.notePath)}" title="${esc(it.notePath)}" style="padding-left:${pad}px">` +
        `<span class="grow"><span class="pi-icon">${ICON.tasks}</span>${esc(leaf.name)} · ${it.openTasks} 项</span>` +
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
