// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchUI, type RagSearchOpts } from '../src/ui/search';
import type { RagAnswer, RagHit } from '@shared/types';

const ITEMS = [{ notePath: '01-AI/RAG.md', title: 'RAG', dir: '01-AI' }];

const HIT: RagHit = {
  id: '01-AI/RAG.md#0',
  docPath: '01-AI/RAG.md',
  title: 'RAG',
  headings: ['概念'],
  startLine: 3,
  endLine: 9,
  text: '检索增强生成……',
  score: 0.87,
};

function ragStub(over: Partial<RagSearchOpts> = {}): RagSearchOpts {
  return {
    available: () => true,
    askAvailable: () => true,
    search: async () => [HIT],
    ask: async (): Promise<RagAnswer> => ({
      answer: '检索增强生成 [1]。',
      refused: false,
      citations: [1],
      evidence: [HIT],
    }),
    feedback: vi.fn(),
    ...over,
  };
}

async function flush(ms = 350): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('搜索浮层 RAG 模式', () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('未注入 RAG：模式栏不显示，行为与原版一致（松耦合）', () => {
    const ui = createSearchUI(container, ITEMS, () => '', () => undefined);
    ui.open();
    expect(container.querySelector<HTMLElement>('.search-tabs')!.style.display).toBe('none');
    ui.dispose();
  });

  it('RAG 不可用（enabled=false）：模式栏不显示', () => {
    const ui = createSearchUI(container, ITEMS, () => '', () => undefined, ragStub({ available: () => false }));
    ui.open();
    expect(container.querySelector<HTMLElement>('.search-tabs')!.style.display).toBe('none');
    ui.dispose();
  });

  it('RAG 可用但 chat 关闭：显示名称/语义，问答隐藏', () => {
    const ui = createSearchUI(container, ITEMS, () => '', () => undefined, ragStub({ askAvailable: () => false }));
    ui.open();
    expect(container.querySelector<HTMLElement>('.search-tabs')!.style.display).toBe('flex');
    expect(container.querySelector<HTMLElement>('[data-mode="ask"]')!.style.display).toBe('none');
    ui.dispose();
  });

  it('语义模式：防抖后渲染命中片段（标题+摘要+分数），点击定位', async () => {
    const onPick = vi.fn();
    const ui = createSearchUI(container, ITEMS, () => '', onPick, ragStub());
    ui.open();
    container.querySelector<HTMLElement>('[data-mode="sem"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = container.querySelector<HTMLInputElement>('.search-input')!;
    input.value = '增强生成';
    input.dispatchEvent(new Event('input'));
    await flush();
    const li = container.querySelector<HTMLElement>('li.sem-hit')!;
    expect(li.textContent).toContain('RAG');
    expect(li.textContent).toContain('0.87');
    expect(li.querySelector('.sem-snippet')!.textContent).toContain('检索增强生成');
    li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('01-AI/RAG.md');
    ui.dispose();
  });

  it('问答模式：回车生成答案，含引用与反馈按钮；点踩落 feedback', async () => {
    const rag = ragStub();
    const ui = createSearchUI(container, ITEMS, () => '', () => undefined, rag);
    ui.open();
    container.querySelector<HTMLElement>('[data-mode="ask"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = container.querySelector<HTMLInputElement>('.search-input')!;
    input.value = '什么是 RAG？';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(50);
    const ans = container.querySelector<HTMLElement>('.search-answer')!;
    expect(ans.textContent).toContain('检索增强生成');
    expect(ans.querySelector('.ans-cite.cited')).toBeTruthy();
    const downBtn = ans.querySelector<HTMLElement>('.ans-fb[data-kind="down"]')!;
    downBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rag.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'down', question: '什么是 RAG？' }),
    );
    // 按钮进入选中态（不替换为提示文案），两个按钮都还在
    expect(downBtn.classList.contains('selected')).toBe(true);
    expect(ans.querySelectorAll('.ans-fb')).toHaveLength(2);
    // 重复点击同一按钮不重复上报
    downBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rag.feedback).toHaveBeenCalledTimes(1);
    // 改点 👍：选中态切换并再上报一次
    const upBtn = ans.querySelector<HTMLElement>('.ans-fb[data-kind="up"]')!;
    upBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(upBtn.classList.contains('selected')).toBe(true);
    expect(downBtn.classList.contains('selected')).toBe(false);
    expect(rag.feedback).toHaveBeenCalledTimes(2);
    ui.dispose();
  });
});
