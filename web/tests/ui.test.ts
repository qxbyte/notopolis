// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { esc, createCards } from '../src/ui/cards';
import { TIER, createHUD } from '../src/ui/hud';
import type { Building, District } from '@shared/types';

// ---- esc 转义 ----

describe('esc()', () => {
  it('escapes & to &amp;', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });
  it('escapes < to &lt;', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes > to &gt;', () => {
    expect(esc('x > y')).toBe('x &gt; y');
  });
  it('escapes " to &quot;', () => {
    expect(esc('"hello"')).toBe('&quot;hello&quot;');
  });
  it('handles all 4 chars at once', () => {
    expect(esc('& < > "')).toBe('&amp; &lt; &gt; &quot;');
  });
});

// ---- TIER 映射 ----

describe('TIER', () => {
  it('has camp with Chinese value', () => {
    expect(TIER.camp).toBe('拓荒营地');
  });
  it('has village with Chinese value', () => {
    expect(TIER.village).toBe('村镇');
  });
  it('has city with Chinese value', () => {
    expect(TIER.city).toBe('城市');
  });
  it('has capital with Chinese value', () => {
    expect(TIER.capital).toBe('都城');
  });
  it('has exactly 4 keys', () => {
    expect(Object.keys(TIER).length).toBe(4);
  });
});

// ---- createHUD ----

describe('createHUD', () => {
  it('creates #hud element in parent', () => {
    const parent = document.createElement('div');
    const hud = createHUD(parent);
    expect(parent.querySelector('#hud')).not.toBeNull();
    expect(hud.root.id).toBe('hud');
  });

  it('setStats updates #stats textContent', () => {
    const parent = document.createElement('div');
    const hud = createHUD(parent);
    hud.setStats('100 栋建筑');
    const stats = parent.querySelector('#stats');
    expect(stats?.textContent).toBe('100 栋建筑');
  });

  it('setTip updates tip textContent', () => {
    const parent = document.createElement('div');
    const hud = createHUD(parent);
    hud.setTip('自定义提示');
    // The tip div is appended to parent, check via parent
    const tip = parent.querySelector('#tip');
    expect(tip?.textContent).toBe('自定义提示');
  });
});

// ---- createCards ----

const makeBuilding = (overrides: Partial<Building> = {}): Building => ({
  notePath: 'Notes/Test.md',
  title: 'Test Note',
  x: 0,
  z: 0,
  rotY: 0,
  size: 1,
  landmark: false,
  construction: false,
  isCivic: false,
  mainStreet: false,
  mtimeMs: 1700000000000,
  wordCount: 200,
  inlinks: 5,
  openTasks: 0,
  excerpt: 'A short excerpt.',
  outlinks: [],
  ...overrides,
});

const makeDistrict = (overrides: Partial<District> = {}): District => ({
  dir: 'Projects',
  x: 0,
  z: 0,
  width: 10,
  depth: 10,
  polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
  isInbox: false,
  buildings: [makeBuilding(), makeBuilding({ wordCount: 100 })],
  ...overrides,
});

describe('createCards + showBuilding', () => {
  let parent: HTMLElement;
  let cards: ReturnType<typeof createCards>;

  beforeEach(() => {
    // Clean up any stale elements
    const stale = document.getElementById('card');
    if (stale) stale.remove();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    cards = createCards(parent);
  });

  it('shows card with escaped title (no XSS)', () => {
    const b = makeBuilding({ title: '<XSS> & "test"' });
    cards.showBuilding(b, 'dir', '/vault');
    const card = document.getElementById('card')!;
    const h3 = card.querySelector('h3');
    // textContent should be the unescaped title (XSS not executed as element)
    expect(h3?.textContent).toContain('<XSS> & "test"');
    // The h3 should NOT contain a script/child element from the injected title
    expect(h3?.querySelector('script')).toBeNull();
    // innerHTML must have < and & escaped (preventing injection)
    expect(h3?.innerHTML).toContain('&lt;XSS&gt;');
    expect(h3?.innerHTML).toContain('&amp;');
  });

  it('shows wordCount in .meta', () => {
    const b = makeBuilding({ wordCount: 999 });
    cards.showBuilding(b, 'Notes', '/vault');
    const card = document.getElementById('card')!;
    const meta = card.querySelector('.meta');
    expect(meta?.textContent).toContain('999');
  });

  it('obsidian href contains encodeURIComponent of path', () => {
    const b = makeBuilding({ notePath: 'My Notes/Test File.md' });
    const vaultPath = '/Users/me/My Vault';
    cards.showBuilding(b, 'dir', vaultPath);
    const card = document.getElementById('card')!;
    const link = card.querySelector('a') as HTMLAnchorElement;
    const expected = encodeURIComponent(vaultPath + '/' + b.notePath);
    expect(link?.getAttribute('href')).toContain(expected);
  });

  it('shows isCivic prefix in title', () => {
    const b = makeBuilding({ isCivic: true });
    cards.showBuilding(b, 'dir', '/vault');
    const card = document.getElementById('card')!;
    const h3 = card.querySelector('h3');
    expect(h3?.textContent).toContain('🏛');
  });

  it('shows landmark prefix in title', () => {
    const b = makeBuilding({ landmark: true, isCivic: false });
    cards.showBuilding(b, 'dir', '/vault');
    const card = document.getElementById('card')!;
    const h3 = card.querySelector('h3');
    expect(h3?.textContent).toContain('⭐');
  });

  it('onLocateList 传入时显示「定位」并触发回调；未传入不显示', () => {
    const b = makeBuilding({});
    const onLocateList = vi.fn();
    cards.showBuilding(b, 'dir', '/vault', undefined, undefined, onLocateList);
    const card = document.getElementById('card')!;
    const locateBtn = card.querySelector<HTMLElement>('.card-locate')!;
    expect(locateBtn.textContent).toContain('定位');
    expect(locateBtn.querySelector('svg')).toBeTruthy(); // 准星图标
    locateBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLocateList).toHaveBeenCalledOnce();
    // 不带回调重新渲染 → 按钮消失
    cards.showBuilding(b, 'dir', '/vault');
    expect(card.querySelector('.card-locate')).toBeNull();
  });
});

describe('createCards + showDistrict', () => {
  let parent: HTMLElement;
  let cards: ReturnType<typeof createCards>;

  beforeEach(() => {
    const stale = document.getElementById('card');
    if (stale) stale.remove();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    cards = createCards(parent);
  });

  it('shows building count in .meta', () => {
    const d = makeDistrict({ buildings: [makeBuilding(), makeBuilding(), makeBuilding()] });
    cards.showDistrict(d, Date.now());
    const card = document.getElementById('card')!;
    const meta = card.querySelector('.meta');
    expect(meta?.textContent).toContain('3');
  });

  it('shows total word count in .meta', () => {
    const d = makeDistrict({
      buildings: [makeBuilding({ wordCount: 150 }), makeBuilding({ wordCount: 250 })],
    });
    cards.showDistrict(d, Date.now());
    const card = document.getElementById('card')!;
    const meta = card.querySelector('.meta');
    expect(meta?.textContent).toContain('400');
  });

  it('shows escaped district dir', () => {
    const d = makeDistrict({ dir: '<dir> & "name"' });
    cards.showDistrict(d, Date.now());
    const card = document.getElementById('card')!;
    const h3 = card.querySelector('h3');
    // textContent renders the original text safely
    expect(h3?.textContent).toContain('<dir> & "name"');
    // innerHTML must have < and & escaped
    expect(h3?.innerHTML).toContain('&lt;dir&gt;');
    expect(h3?.innerHTML).toContain('&amp;');
    // No child elements injected (XSS prevention)
    expect(h3?.querySelector('script')).toBeNull();
  });
});

describe('createCards + hide', () => {
  it('sets card display to none', () => {
    const stale = document.getElementById('card');
    if (stale) stale.remove();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const cards = createCards(parent);
    // Show something first
    cards.showBuilding(makeBuilding(), 'dir', '/vault');
    const card = document.getElementById('card')!;
    expect(card.style.display).toBe('block');
    // Now hide
    cards.hide();
    expect(card.style.display).toBe('none');
  });
});
