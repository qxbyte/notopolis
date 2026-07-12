// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  currentTheme,
  initTheme,
  setTheme,
  THEMES,
  tokensOf,
} from '../src/ui/theme';
import { createThemePane } from '../src/ui/themepane';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.cssText = '';
  document.body.innerHTML = '';
});

describe('theme（单一数据源主题系统）', () => {
  it('六套主题注册齐全，荧光绿为默认（列表首位）', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['lime', 'matcha', 'indigo', 'amber', 'mono', 'dark']);
  });

  it('每套主题合并后令牌完整（完整性校验，防漏配）', () => {
    const keys = Object.keys(tokensOf('lime'));
    expect(keys.length).toBe(15);
    for (const t of THEMES) {
      const merged = tokensOf(t.id) as unknown as Record<string, string>;
      for (const k of keys) expect(merged[k], `${t.id}.${k}`).toBeTruthy();
    }
  });

  it('亮色主色配深字：lime 的 onPrimary 是黑，matcha 的是白', () => {
    expect(tokensOf('lime').onPrimary).toBe('#141414');
    expect(tokensOf('lime').accentText).toBe('#16181A'); // 黑色作强调文字
    expect(tokensOf('matcha').onPrimary).toBe('#FFFFFF');
  });

  it('applyTheme：批量写 CSS 变量（含 camelCase→kebab 转换）并设置 data-theme', () => {
    applyTheme('dark');
    const style = document.documentElement.style;
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(style.getPropertyValue('--bg')).toBe('#161616');
    expect(style.getPropertyValue('--primary-dark')).toBe('#A5CC86');
    expect(style.getPropertyValue('--on-primary')).toBe('#141414');
    expect(style.getPropertyValue('--accent-text')).toBe('#A5CC86');
    expect(style.getPropertyValue('--shadow-sm')).toContain('rgba(0, 0, 0');
  });

  it('切回默认主题：未覆盖项回落基础令牌值', () => {
    applyTheme('dark');
    applyTheme('lime');
    const style = document.documentElement.style;
    expect(currentTheme()).toBe('lime');
    expect(style.getPropertyValue('--bg')).toBe('#F2F3F6');
    expect(style.getPropertyValue('--primary')).toBe('#DCF231');
    expect(style.getPropertyValue('--accent2')).toBe('#C9D5F8'); // 浅蓝点缀
    expect(style.getPropertyValue('--danger')).toBe('#D25C4E'); // dark 覆盖过，须还原
  });

  it('setTheme 持久化，initTheme 恢复', () => {
    setTheme('indigo');
    expect(localStorage.getItem('notopolis-theme')).toBe('indigo');
    delete document.documentElement.dataset.theme;
    initTheme();
    expect(currentTheme()).toBe('indigo');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#5B6EE8');
  });

  it('initTheme 遇到非法存量值回落默认', () => {
    localStorage.setItem('notopolis-theme', 'weird');
    initTheme();
    expect(currentTheme()).toBe('lime');
  });
});

describe('createThemePane（主题面板）', () => {
  it('渲染六张主题卡，当前主题带选中态，预览色取自合并令牌', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    initTheme();
    const pane = createThemePane(mount);
    pane.refresh();
    const cards = mount.querySelectorAll('.theme-card');
    expect(cards).toHaveLength(6);
    expect(mount.querySelector('.theme-card.selected')!.getAttribute('data-id')).toBe('lime');
    // mono 卡预览用的是合并令牌里的 bg（无独立 swatches 数据源）
    const mono = mount.querySelector<HTMLElement>('.theme-card[data-id="mono"] .theme-preview')!;
    expect(mono.getAttribute('style')).toContain('#F7F7F8');
    pane.dispose();
  });

  it('点击暗夜卡片：即时换肤 + 持久化 + 选中态迁移', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const pane = createThemePane(mount);
    pane.refresh();
    mount
      .querySelector<HTMLElement>('.theme-card[data-id="dark"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#1F1F1F');
    expect(localStorage.getItem('notopolis-theme')).toBe('dark');
    expect(mount.querySelector('.theme-card.selected')!.getAttribute('data-id')).toBe('dark');
    pane.dispose();
  });
});
