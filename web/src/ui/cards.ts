/**
 * ui/cards.ts
 * 建筑/街区信息卡弹窗。HTML 逻辑集中在此文件，不散落到其他模块。
 */

import type { Building, District } from '@shared/types';
import { obsidianUri } from './obsidian';

/**
 * HTML 转义（4 字符：& < > "），同时导出供外部使用。
 */
export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => (
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]
  ));
}

export interface CardLink {
  path: string;
  title: string;
}
export interface CardLinks {
  inFrom: CardLink[];
  outTo: CardLink[];
  onNavigate(path: string): void;
}

export interface CardsHandle {
  showBuilding(b: Building, dir: string, vaultAbsPath: string, links?: CardLinks): void;
  showDistrict(d: District, now: number): void;
  hide(): void;
}

export function createCards(parent: HTMLElement): CardsHandle {
  const card = document.createElement('div');
  card.id = 'card';
  parent.appendChild(card);

  const DAY = 86400000;

  // 记录当前卡片的链接跳转回调（onNavigate），供 data-nav 行点击调用
  let navHandler: ((path: string) => void) | null = null;
  function onCardClick(e: MouseEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.card-link[data-nav]');
    if (!row || !navHandler) return;
    const p = row.getAttribute('data-nav');
    if (p) navHandler(p);
  }
  card.addEventListener('click', onCardClick);

  function linkSection(links: CardLinks): string {
    const { inFrom, outTo } = links;
    if (inFrom.length === 0 && outTo.length === 0) {
      return '<div class="card-links empty">🏝 这是一座孤岛——还没有任何链接</div>';
    }
    const rows = (arr: CardLink[]) =>
      arr
        .slice(0, 8)
        .map((l) => `<div class="card-link" data-nav="${esc(l.path)}">· ${esc(l.title)}</div>`)
        .join('');
    let html = '<div class="card-links">';
    if (inFrom.length) html += `<div class="card-link-head">← 入链 (${inFrom.length})</div>${rows(inFrom)}`;
    if (outTo.length) html += `<div class="card-link-head">→ 出链 (${outTo.length})</div>${rows(outTo)}`;
    html += '</div>';
    return html;
  }

  return {
    showBuilding(b: Building, dir: string, vaultAbsPath: string, links?: CardLinks): void {
      const date = new Date(b.mtimeMs).toLocaleDateString('zh-CN');
      const uri = obsidianUri(vaultAbsPath, b.notePath);
      const prefix = b.isCivic ? '🏛 ' : b.landmark ? '⭐ ' : '';
      navHandler = links?.onNavigate ?? null;
      card.innerHTML = `
        <button class="close" onclick="this.parentElement.style.display='none'">✕</button>
        <h3>${prefix}${esc(b.title)}</h3>
        <div class="meta">📁 ${esc(dir || '(根目录)')} · ${b.wordCount} 字 · 被引 ${b.inlinks} · 待办 ${b.openTasks}<br>🕐 最后编辑 ${date}</div>
        <div class="excerpt">${esc(b.excerpt || '（无摘要）')}</div>
        ${links ? linkSection(links) : ''}
        <div class="actions"><a href="${uri}">在 Obsidian 打开</a></div>`;
      card.style.display = 'block';
    },

    showDistrict(d: District, now: number): void {
      const words = d.buildings.reduce((s, b) => s + b.wordCount, 0);
      const act = d.buildings.filter((b) => now - b.mtimeMs < 7 * DAY).length;
      const cons = d.buildings.filter((b) => b.construction).length;
      card.innerHTML = `
        <button class="close" onclick="this.parentElement.style.display='none'">✕</button>
        <h3>🏘 ${esc(d.dir || '(根目录)')} 区</h3>
        <div class="meta">${d.buildings.length} 栋建筑 · 共 ${words} 字<br>近 7 天活跃 ${act} · 施工位 ${cons}</div>`;
      card.style.display = 'block';
    },

    hide(): void {
      card.style.display = 'none';
    },
  };
}
