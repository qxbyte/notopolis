/**
 * ui/confirm.ts — 通用确认弹窗（Promise 化，防误操作）。
 * 用于清空/重建/移除等变更动作的二次确认；danger 时确认按钮为危险色。
 * Esc/点遮罩/取消 → false；确认 → true。Esc 用捕获阶段拦截，避免连带关闭下层弹窗。
 */

export interface ConfirmOpts {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML =
      `<div class="confirm-box">` +
      `<h4>${esc(opts.title)}</h4>` +
      (opts.message ? `<p>${esc(opts.message)}</p>` : '') +
      `<div class="confirm-acts">` +
      `<button type="button" class="confirm-cancel">取消</button>` +
      `<button type="button" class="confirm-ok${opts.danger ? ' danger' : ''}">${esc(opts.confirmText ?? '确认')}</button>` +
      `</div></div>`;
    document.body.appendChild(overlay);

    const done = (v: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 只关确认层，不透传给全局 overlaystack
        done(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.confirm-cancel')!.addEventListener('click', () => done(false));
    overlay.querySelector('.confirm-ok')!.addEventListener('click', () => done(true));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) done(false);
    });
  });
}
