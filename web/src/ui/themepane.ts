/**
 * ui/themepane.ts — 「主题」面板（嵌入设置中心弹窗）。
 * 主题卡片：色板预览 + 名称说明，点击即切换（即时生效 + localStorage 持久化）。
 */
import { currentTheme, setTheme, THEMES, tokensOf, type ThemeId } from './theme';

export interface ThemePane {
  refresh(): void;
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function createThemePane(mount: HTMLElement): ThemePane {
  function render(): void {
    const cur = currentTheme();
    mount.innerHTML =
      `<p class="vm-subtitle">选择界面主题，即点即换（地图画布不受影响）</p>` +
      `<div class="theme-grid">` +
      THEMES.map((t) => {
        // 预览色直接从合并令牌派生（单一数据源，无独立 swatches）
        const s = tokensOf(t.id);
        return (
          `<div class="theme-card${t.id === cur ? ' selected' : ''}" data-id="${t.id}">` +
          `<div class="theme-preview" style="background:${s.bg}">` +
          `<div class="tp-surface" style="background:${s.surface}">` +
          `<span class="tp-text" style="background:${s.text}"></span>` +
          `<span class="tp-text short" style="background:${s.text}"></span>` +
          `<span class="tp-btn" style="background:${s.primary}"></span>` +
          `</div></div>` +
          `<div class="theme-meta">` +
          `<div class="theme-name">${esc(t.label)}<span class="theme-check">✓</span></div>` +
          `<div class="theme-desc">${esc(t.desc)}</div>` +
          `</div></div>`
        );
      }).join('') +
      `</div>`;
  }

  function onClick(e: MouseEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.theme-card');
    if (!card?.dataset.id) return;
    setTheme(card.dataset.id as ThemeId);
    render(); // 刷新选中态
  }
  mount.addEventListener('click', onClick);

  return {
    refresh: render,
    dispose(): void {
      mount.removeEventListener('click', onClick);
      mount.innerHTML = '';
    },
  };
}
