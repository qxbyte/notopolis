/**
 * ui/search.ts — ⌘K 搜索浮层（DOM + 键盘交互）。
 * 三模式：名称（原标题/路径模糊匹配，打分在 util/search.ts）·
 * 语义（RAG 混合检索，命中片段带摘要）· 问答（RAG 约束生成，答案带引用与 👍👎）。
 * 松耦合：未启用 RAG 时不渲染模式栏，行为与原版完全一致。
 */
import { searchNotes, type SearchItem, type SearchHit } from '../util/search';
import { renderMarkdown } from '../util/markdown';
import type { RagAnswer, RagHit } from '@shared/types';
import { ICON } from './icons';
import { pushOverlay } from './overlaystack';

export interface SearchUI {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

/** RAG 能力注入（cityview2d 提供；不传或 available()=false 时为纯名称搜索） */
export interface RagSearchOpts {
  available(): boolean;
  askAvailable(): boolean;
  search(q: string): Promise<RagHit[]>;
  ask(q: string): Promise<RagAnswer>;
  feedback(ev: {
    kind: 'up' | 'down' | 'followup';
    question: string;
    answer?: string;
    citations?: string[];
  }): void;
}

type Mode = 'name' | 'sem' | 'ask';

export function createSearchUI(
  container: HTMLElement,
  items: SearchItem[],
  decorate: (path: string) => string, // 返回 '🚧 '/'🏛 '/'⭐ '/'' 前缀
  onPick: (notePath: string) => void, // = flyTo + highlight + pickByPath（cityview2d 提供）
  rag?: RagSearchOpts,
): SearchUI {
  const overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.innerHTML = `
    <div class="search-box">
      <div class="search-tabs" style="display:none">
        <button class="search-tab active" data-mode="name">名称</button>
        <button class="search-tab" data-mode="sem">语义</button>
        <button class="search-tab" data-mode="ask">问答</button>
      </div>
      <input class="search-input" placeholder="搜索笔记… (Esc 关闭)" spellcheck="false" />
      <ul class="search-results"></ul>
      <div class="search-answer" style="display:none"></div>
    </div>`;
  container.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('.search-input')!;
  const list = overlay.querySelector<HTMLUListElement>('.search-results')!;
  const box = overlay.querySelector<HTMLElement>('.search-box')!;
  const tabs = overlay.querySelector<HTMLElement>('.search-tabs')!;
  const answerEl = overlay.querySelector<HTMLElement>('.search-answer')!;

  let open = false;
  let mode: Mode = 'name';
  let hits: SearchHit[] = [];
  let semHits: RagHit[] = [];
  let activeIdx = 0;
  let popSelf: (() => void) | null = null;
  let semTimer: ReturnType<typeof setTimeout> | null = null;
  let semSeq = 0; // 防乱序回包
  let lastQuestion: string | null = null; // 追问检测
  let curAnswer: RagAnswer | null = null;

  function esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
    );
  }

  const PLACEHOLDER: Record<Mode, string> = {
    name: '搜索笔记… (Esc 关闭)',
    sem: '语义搜索笔记内容…',
    ask: '向知识库提问，回车发送…',
  };

  function setMode(m: Mode): void {
    mode = m;
    for (const t of tabs.querySelectorAll('.search-tab')) {
      t.classList.toggle('active', (t as HTMLElement).dataset.mode === m);
    }
    input.placeholder = PLACEHOLDER[m];
    answerEl.style.display = m === 'ask' && answerEl.innerHTML ? 'block' : 'none';
    list.style.display = m === 'ask' ? 'none' : 'block';
    if (m === 'ask') list.innerHTML = '';
    else update();
    input.focus();
  }

  function renderName(): void {
    if (!input.value.trim()) {
      list.innerHTML = '';
      return;
    }
    if (hits.length === 0) {
      list.innerHTML = '<li class="search-empty">没有匹配的笔记</li>';
      return;
    }
    list.innerHTML = hits
      .map((h, i) => {
        const cls = i === activeIdx ? ' class="active"' : '';
        const dir = h.dir || '(根目录)';
        return `<li${cls} data-i="${i}">${decorate(h.notePath)}<b>${esc(h.title)}</b> <span class="dim">· ${esc(dir)}</span></li>`;
      })
      .join('');
  }

  function renderSem(): void {
    if (!input.value.trim()) {
      list.innerHTML = '';
      return;
    }
    if (semHits.length === 0) {
      list.innerHTML = '<li class="search-empty">没有语义相关的片段（可尝试先入库或换个说法）</li>';
      return;
    }
    list.innerHTML = semHits
      .map((h, i) => {
        const cls = i === activeIdx ? ' class="active sem-hit"' : ' class="sem-hit"';
        const trail = h.headings.length ? ` › ${esc(h.headings.join(' › '))}` : '';
        return (
          `<li${cls} data-i="${i}">` +
          `<div><b>${esc(h.title)}</b><span class="dim">${trail} · ${esc(h.docPath)}</span>` +
          `<span class="sem-score">${h.score.toFixed(2)}</span></div>` +
          `<div class="sem-snippet">${esc(h.text.slice(0, 120))}…</div>` +
          `</li>`
        );
      })
      .join('');
  }

  function render(): void {
    if (mode === 'name') renderName();
    else if (mode === 'sem') renderSem();
  }

  function update(): void {
    if (mode === 'name') {
      hits = searchNotes(input.value, items);
      activeIdx = 0;
      render();
    } else if (mode === 'sem') {
      if (semTimer !== null) clearTimeout(semTimer);
      const q = input.value.trim();
      if (!q) {
        semHits = [];
        render();
        return;
      }
      list.innerHTML = '<li class="search-empty">检索中…</li>';
      semTimer = setTimeout(() => {
        const seq = ++semSeq;
        rag!
          .search(q)
          .then((r) => {
            if (seq !== semSeq || mode !== 'sem') return;
            semHits = r;
            activeIdx = 0;
            render();
          })
          .catch((e: Error) => {
            if (seq !== semSeq || mode !== 'sem') return;
            list.innerHTML = `<li class="search-empty">语义检索失败：${esc(e.message)}<br>可切回「名称」模式继续搜索。</li>`;
          });
      }, 300);
    }
  }

  function pick(i: number): void {
    const path = mode === 'sem' ? semHits[i]?.docPath : hits[i]?.notePath;
    if (!path) return;
    api.close();
    onPick(path);
  }

  // ---- 问答 ----

  function renderAnswer(ans: RagAnswer, question: string): void {
    curAnswer = ans;
    const cites = ans.evidence
      .map((h, i) => {
        const n = i + 1;
        const cited = ans.citations.includes(n);
        const trail = h.headings.length ? ` · ${esc(h.headings.join(' › '))}` : '';
        return (
          `<div class="ans-cite${cited ? ' cited' : ''}" data-path="${esc(h.docPath)}">` +
          `<span class="cite-n">[${n}]</span> ${esc(h.title)}${trail}` +
          `<span class="dim"> · ${esc(h.docPath)} L${h.startLine}-${h.endLine}</span></div>`
        );
      })
      .join('');
    answerEl.innerHTML =
      (ans.warning ? `<div class="ans-warning">⚠ ${esc(ans.warning)}</div>` : '') +
      `<div class="ans-body md-body${ans.refused ? ' refused' : ''}">${renderMarkdown(ans.answer)}</div>` +
      (ans.evidence.length ? `<div class="ans-cites-head">证据来源（点击定位）</div>${cites}` : '') +
      `<div class="ans-fbrow" data-q="${esc(question)}">` +
      `<button class="ans-fb" data-kind="up">${ICON.thumbUp} 有帮助</button>` +
      `<button class="ans-fb" data-kind="down">${ICON.thumbDown} 不准确</button>` +
      `</div>`;
    answerEl.style.display = 'block';
  }

  function submitAsk(): void {
    const q = input.value.trim();
    if (!q || !rag) return;
    // 追问沉淀：同一会话内的第二个及后续问题记 followup 事件
    if (lastQuestion && lastQuestion !== q) {
      rag.feedback({ kind: 'followup', question: q });
    }
    lastQuestion = q;
    answerEl.style.display = 'block';
    answerEl.innerHTML = '<div class="ans-loading">检索证据并生成中…</div>';
    rag
      .ask(q)
      .then((ans) => {
        if (mode === 'ask') renderAnswer(ans, q);
      })
      .catch((e: Error) => {
        if (mode === 'ask') answerEl.innerHTML = `<div class="ans-warning">✗ ${esc(e.message)}</div>`;
      });
  }

  // ---- 事件 ----

  function onInput(): void {
    update();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (mode === 'ask') {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitAsk();
      }
      return;
    }
    const n = mode === 'sem' ? semHits.length : hits.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) activeIdx = (activeIdx + 1) % n;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) activeIdx = (activeIdx - 1 + n) % n;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(activeIdx);
    } else if (e.key === 'Tab' && tabs.style.display !== 'none') {
      // Tab 在模式间循环
      e.preventDefault();
      const modes: Mode[] = rag?.askAvailable() ? ['name', 'sem', 'ask'] : ['name', 'sem'];
      setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);
    }
    // Esc 由 main.ts 全局 overlaystack 处理
  }

  function onListClick(e: MouseEvent): void {
    const li = (e.target as HTMLElement).closest('li[data-i]');
    if (!li) return;
    pick(Number(li.getAttribute('data-i')));
  }

  function onListHover(e: MouseEvent): void {
    const li = (e.target as HTMLElement).closest('li[data-i]');
    if (!li) return;
    const i = Number(li.getAttribute('data-i'));
    if (i !== activeIdx) {
      activeIdx = i;
      render();
    }
  }

  function onTabClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.search-tab');
    if (btn) setMode(btn.dataset.mode as Mode);
  }

  function onAnswerClick(e: MouseEvent): void {
    const cite = (e.target as HTMLElement).closest<HTMLElement>('.ans-cite');
    if (cite) {
      const p = cite.dataset.path;
      if (p) {
        api.close();
        onPick(p);
      }
      return;
    }
    const fb = (e.target as HTMLElement).closest<HTMLElement>('.ans-fb');
    if (fb && rag && curAnswer) {
      if (fb.classList.contains('selected')) return; // 重复点击同一态不重复上报
      const row = fb.closest<HTMLElement>('.ans-fbrow')!;
      for (const b of row.querySelectorAll('.ans-fb')) b.classList.remove('selected');
      fb.classList.add('selected');
      rag.feedback({
        kind: fb.dataset.kind as 'up' | 'down',
        question: row.dataset.q ?? '',
        answer: curAnswer.answer,
        citations: [...new Set(curAnswer.citations.map((n) => curAnswer!.evidence[n - 1]?.docPath).filter(Boolean))] as string[],
      });
    }
  }

  // 点击遮罩空白处关闭（点击 box 内部不关）
  function onOverlayClick(e: MouseEvent): void {
    if (!box.contains(e.target as Node)) api.close();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  list.addEventListener('click', onListClick);
  list.addEventListener('mousemove', onListHover);
  tabs.addEventListener('click', onTabClick);
  answerEl.addEventListener('click', onAnswerClick);
  overlay.addEventListener('mousedown', onOverlayClick);

  const api: SearchUI = {
    isOpen: () => open,
    open(): void {
      if (open) return;
      open = true;
      overlay.classList.add('open');
      // 每次打开按当前配置刷新模式栏（设置可能刚改过）
      const ragOn = rag?.available() === true;
      tabs.style.display = ragOn ? 'flex' : 'none';
      tabs.querySelector<HTMLElement>('[data-mode="ask"]')!.style.display =
        ragOn && rag!.askAvailable() ? 'inline-block' : 'none';
      if (!ragOn) mode = 'name';
      setMode(mode);
      input.value = '';
      hits = [];
      semHits = [];
      activeIdx = 0;
      answerEl.innerHTML = '';
      answerEl.style.display = 'none';
      curAnswer = null;
      lastQuestion = null;
      render();
      input.focus();
      popSelf = pushOverlay(() => api.close());
    },
    close(): void {
      if (!open) return;
      open = false;
      overlay.classList.remove('open');
      popSelf?.();
      popSelf = null;
    },
    dispose(): void {
      popSelf?.();
      popSelf = null;
      if (semTimer !== null) clearTimeout(semTimer);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeydown);
      list.removeEventListener('click', onListClick);
      list.removeEventListener('mousemove', onListHover);
      tabs.removeEventListener('click', onTabClick);
      answerEl.removeEventListener('click', onAnswerClick);
      overlay.removeEventListener('mousedown', onOverlayClick);
      overlay.remove();
    },
  };
  return api;
}
