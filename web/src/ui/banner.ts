/**
 * ui/banner.ts — 入城变化摘要横幅（F3）。
 * summarize 为纯函数（单测对象）；showBanner 负责 DOM 与生命周期。
 */
import type { CityDiff } from '@shared/types';

/** diff → 播报文案；无变化返回 null（调用方据此决定不展示） */
export function summarize(diff: CityDiff): string | null {
  if (diff.firstVisit) return null;
  const parts: string[] = [];
  if (diff.created.length) parts.push(`新建 ${diff.created.length} 栋`);
  if (diff.updated.length) parts.push(`翻修 ${diff.updated.length} 栋`);
  if (diff.removed.length) parts.push(`拆除 ${diff.removed.length} 栋`);
  if (diff.tasksDone) parts.push(`完成 ${diff.tasksDone} 项任务`);
  if (diff.tasksAdded) parts.push(`新增 ${diff.tasksAdded} 项任务`);
  if (diff.newLandmarks.length) {
    const names = diff.newLandmarks.slice(0, 2).map((l) => `「${l.title}」`).join('、');
    const rest = diff.newLandmarks.length > 2 ? `等 ${diff.newLandmarks.length} 处` : '';
    parts.push(`${names}${rest}升为地标 🏛`);
  }
  return parts.length ? `自上次到访：${parts.join(' · ')}` : null;
}

export interface BannerDetail {
  items: { path: string; title: string; tag: string }[];
  onPick(path: string): void;
}

export interface Banner {
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/** 展示横幅：8s 后淡出；点 ✕ 立即关；点「查看」展开明细列表并取消自动关闭 */
export function showBanner(container: HTMLElement, text: string, detail: BannerDetail | null): Banner {
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML =
    `<span class="banner-seal"></span>` +
    `<span class="banner-text">${esc(text)}</span>` +
    (detail && detail.items.length ? `<span class="banner-more">查看</span>` : '') +
    `<span class="banner-x">✕</span>`;
  container.appendChild(el);

  let detailEl: HTMLElement | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  function destroy(): void {
    if (fadeTimer) clearTimeout(fadeTimer);
    if (removeTimer) clearTimeout(removeTimer);
    fadeTimer = removeTimer = null;
    el.remove();
    detailEl?.remove();
    detailEl = null;
  }

  function scheduleFade(): void {
    fadeTimer = setTimeout(() => {
      el.style.opacity = '0';
      removeTimer = setTimeout(destroy, 600);
    }, 8000);
  }

  function cancelFade(): void {
    if (fadeTimer) clearTimeout(fadeTimer);
    if (removeTimer) clearTimeout(removeTimer);
    fadeTimer = removeTimer = null;
    el.style.opacity = '1';
  }

  el.querySelector('.banner-x')!.addEventListener('click', destroy);

  const moreBtn = el.querySelector<HTMLElement>('.banner-more');
  if (moreBtn && detail) {
    moreBtn.addEventListener('click', () => {
      if (detailEl) {
        detailEl.remove();
        detailEl = null;
        return;
      }
      cancelFade(); // 展开后不再自动关闭
      detailEl = document.createElement('div');
      detailEl.className = 'banner-detail';
      detailEl.innerHTML = detail.items
        .slice(0, 20)
        .map(
          (it) =>
            `<div class="row" data-path="${esc(it.path)}"><span>${esc(it.tag)}</span><span>${esc(it.title)}</span></div>`,
        )
        .join('');
      detailEl.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
        const p = row?.getAttribute('data-path');
        if (p) detail.onPick(p);
      });
      container.appendChild(detailEl);
    });
  }

  scheduleFade();
  return { dispose: destroy };
}
