/**
 * ui/toast.ts — 顶部消息提示条（全局单例容器，自动消退）。
 * 变更类操作（入库/清空/移除等）完成后给出明确回执，用户不用猜操作是否生效。
 */

export type ToastKind = 'ok' | 'err' | 'info';

let root: HTMLElement | null = null;

function ensureRoot(): HTMLElement {
  if (!root || !document.body.contains(root)) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  ensureRoot().appendChild(el);
  const ttl = kind === 'err' ? 5000 : 3200; // 错误多留一会儿
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ttl);
}
