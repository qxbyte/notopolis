// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDropdown } from '../src/ui/dropdown';

const OPTS = [
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙' },
];

describe('createDropdown（自定义下拉框）', () => {
  let mount: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('setOptions 设置选项与选中值，标签显示选中项', () => {
    const dd = createDropdown(mount);
    dd.setOptions(OPTS, 'b');
    expect(dd.value()).toBe('b');
    expect(mount.querySelector('.dd-label')!.textContent).toBe('乙');
    // selected 失效时回落第一项
    dd.setOptions(OPTS, 'weird');
    expect(dd.value()).toBe('a');
    dd.dispose();
  });

  it('点击开合：选项面板在框体下方（.dd-menu 位于组件内部），选中项带 ✓', () => {
    const dd = createDropdown(mount);
    dd.setOptions(OPTS, 'a');
    const btn = mount.querySelector<HTMLElement>('.dd-btn')!;
    const menu = mount.querySelector<HTMLElement>('.dd-menu')!;
    expect(menu.style.display).toBe('none');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.style.display).toBe('block');
    expect(mount.classList.contains('open')).toBe(true);
    const items = menu.querySelectorAll('.dd-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.dd-check')!.textContent).toBe('✓');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.style.display).toBe('none');
    dd.dispose();
  });

  it('点选项：选中、关闭、触发 onChange；点已选项不触发', () => {
    const dd = createDropdown(mount);
    const onChange = vi.fn();
    dd.onChange = onChange;
    dd.setOptions(OPTS, 'a');
    mount.querySelector<HTMLElement>('.dd-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    mount.querySelector<HTMLElement>('.dd-item[data-v="b"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dd.value()).toBe('b');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(mount.querySelector<HTMLElement>('.dd-menu')!.style.display).toBe('none');
    // 再点当前选中项：不重复触发
    mount.querySelector<HTMLElement>('.dd-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    mount.querySelector<HTMLElement>('.dd-item[data-v="b"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    dd.dispose();
  });

  it('点击组件外部收起面板', () => {
    const dd = createDropdown(mount);
    dd.setOptions(OPTS, 'a');
    mount.querySelector<HTMLElement>('.dd-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(mount.querySelector<HTMLElement>('.dd-menu')!.style.display).toBe('none');
    dd.dispose();
  });
});
