/**
 * ui/dropdown.ts — 通用自定义下拉框（替代原生 select）。
 * 原生 select 的选项弹层由操作系统渲染（盖在控件上、样式不可控），
 * 本组件保证：展开时选项面板固定出现在框体正下方，样式走主题令牌。
 * 交互：点击开合 · 点选项选中并关闭 · 点组件外关闭 · 选中项带 ✓。
 */

export interface DropdownOption {
  value: string;
  label: string;
}

export interface Dropdown {
  /** 重设选项；selected 缺省时保持现值（失效则取第一项） */
  setOptions(options: DropdownOption[], selected?: string): void;
  value(): string;
  onChange?: (value: string) => void;
  dispose(): void;
}

const CHEVRON =
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function createDropdown(mount: HTMLElement): Dropdown {
  mount.classList.add('dd');
  mount.innerHTML =
    `<button type="button" class="dd-btn">` +
    `<span class="dd-label">—</span><span class="dd-chevron">${CHEVRON}</span>` +
    `</button><div class="dd-menu" style="display:none"></div>`;

  const btn = mount.querySelector<HTMLButtonElement>('.dd-btn')!;
  const labelEl = mount.querySelector<HTMLElement>('.dd-label')!;
  const menu = mount.querySelector<HTMLElement>('.dd-menu')!;

  let options: DropdownOption[] = [];
  let value = '';
  let open = false;

  function renderLabel(): void {
    labelEl.textContent = options.find((o) => o.value === value)?.label ?? '—';
  }

  function renderMenu(): void {
    menu.innerHTML = options
      .map(
        (o) =>
          `<button type="button" class="dd-item${o.value === value ? ' selected' : ''}" data-v="${esc(o.value)}">` +
          `<span class="dd-check">${o.value === value ? '✓' : ''}</span>${esc(o.label)}</button>`,
      )
      .join('');
  }

  const onDocDown = (e: MouseEvent): void => {
    if (!mount.contains(e.target as Node)) close();
  };

  function openMenu(): void {
    if (open) return;
    open = true;
    renderMenu();
    menu.style.display = 'block';
    mount.classList.add('open');
    document.addEventListener('mousedown', onDocDown);
  }

  function close(): void {
    if (!open) return;
    open = false;
    menu.style.display = 'none';
    mount.classList.remove('open');
    document.removeEventListener('mousedown', onDocDown);
  }

  const onBtnClick = (): void => {
    open ? close() : openMenu();
  };
  const onMenuClick = (e: MouseEvent): void => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.dd-item');
    if (!item?.dataset.v && item?.dataset.v !== '') return;
    const next = item!.dataset.v!;
    close();
    if (next !== value) {
      value = next;
      renderLabel();
      api.onChange?.(value);
    }
  };
  btn.addEventListener('click', onBtnClick);
  menu.addEventListener('click', onMenuClick);

  const api: Dropdown = {
    setOptions(next: DropdownOption[], selected?: string): void {
      options = next;
      const candidate = selected !== undefined ? selected : value;
      value = options.some((o) => o.value === candidate) ? candidate : (options[0]?.value ?? '');
      renderLabel();
      if (open) renderMenu();
    },
    value: () => value,
    dispose(): void {
      close();
      btn.removeEventListener('click', onBtnClick);
      menu.removeEventListener('click', onMenuClick);
      mount.innerHTML = '';
      mount.classList.remove('dd', 'open');
    },
  };
  return api;
}
