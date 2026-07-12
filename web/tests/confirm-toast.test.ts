// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDialog } from '../src/ui/confirm';
import { toast } from '../src/ui/toast';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('confirmDialog（确认弹窗）', () => {
  it('确认返回 true 并移除弹窗；danger 时确认键带危险色', async () => {
    const p = confirmDialog({ title: '清空？', message: '不可恢复', danger: true, confirmText: '清空' });
    const overlay = document.querySelector('.confirm-overlay')!;
    expect(overlay.textContent).toContain('清空？');
    expect(overlay.textContent).toContain('不可恢复');
    const ok = overlay.querySelector<HTMLElement>('.confirm-ok')!;
    expect(ok.classList.contains('danger')).toBe(true);
    expect(ok.textContent).toBe('清空');
    ok.click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });

  it('取消 / Esc / 点遮罩返回 false', async () => {
    let p = confirmDialog({ title: 't' });
    document.querySelector<HTMLElement>('.confirm-cancel')!.click();
    await expect(p).resolves.toBe(false);

    p = confirmDialog({ title: 't' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe(false);

    p = confirmDialog({ title: 't' });
    const overlay = document.querySelector<HTMLElement>('.confirm-overlay')!;
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await expect(p).resolves.toBe(false);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });
});

describe('toast（顶部消息提示条）', () => {
  it('显示消息并按类型着色，超时自动消退', () => {
    vi.useFakeTimers();
    toast('入库完成：3 篇更新', 'ok');
    toast('清空失败：网络错误', 'err');
    const items = document.querySelectorAll('#toast-root .toast');
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains('toast-ok')).toBe(true);
    expect(items[1].classList.contains('toast-err')).toBe(true);
    vi.advanceTimersByTime(3200 + 300 + 10);
    expect(document.querySelectorAll('#toast-root .toast-ok')).toHaveLength(0);
    expect(document.querySelectorAll('#toast-root .toast-err')).toHaveLength(1); // err 留 5s
    vi.advanceTimersByTime(5000);
    expect(document.querySelectorAll('#toast-root .toast')).toHaveLength(0);
    vi.useRealTimers();
  });
});
