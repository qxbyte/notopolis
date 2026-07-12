import { describe, expect, it } from 'vitest';
import type { RagHit } from '../src/shared/types.js';
import {
  buildAnswerPrompt,
  isRefusal,
  parseCitations,
  ragAnswer,
  REFUSAL,
  validateAnswer,
} from '../src/server/rag/answer.js';

const hit = (docPath: string, text: string): RagHit => ({
  id: `${docPath}#0`,
  docPath,
  title: docPath.replace('.md', ''),
  headings: ['架构'],
  startLine: 3,
  endLine: 9,
  text,
  score: 0.8,
});

describe('buildAnswerPrompt', () => {
  it('证据带编号、来源路径与行号区间；system 含拒答语', () => {
    const { system, user } = buildAnswerPrompt('k 取多少？', [hit('rag.md', 'k 取 60。')]);
    expect(system).toContain(REFUSAL);
    expect(system).toContain('[n]');
    expect(user).toContain('[1] 《rag》 · 架构（rag.md L3-9）');
    expect(user).toContain('k 取 60。');
    expect(user).toContain('问题：k 取多少？');
  });
});

describe('parseCitations / validateAnswer', () => {
  it('解析引用序号，去重保序', () => {
    expect(parseCitations('结论甲 [1]，结论乙 [3][1]。')).toEqual([1, 3]);
  });
  it('越界引用剔除', () => {
    expect(validateAnswer('结论 [1][9]。', 2).citations).toEqual([1]);
  });
  it('拒答检测', () => {
    expect(isRefusal(REFUSAL)).toBe(true);
    const v = validateAnswer(REFUSAL, 3);
    expect(v.refused).toBe(true);
    expect(v.warning).toBeUndefined();
  });
  it('非拒答且无引用 → 警告', () => {
    const v = validateAnswer('我觉得是 60。', 3);
    expect(v.refused).toBe(false);
    expect(v.warning).toContain('未附引用');
  });
});

describe('ragAnswer', () => {
  const ep = { baseUrl: 'http://fake/v1', model: 'qwen-plus' };

  function fakeFetch(reply: string): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: reply } }] }),
        { status: 200 },
      )) as typeof fetch;
  }

  it('证据为空时不调用生成，直接拒答', async () => {
    const called = { n: 0 };
    const spyFetch = (async () => {
      called.n++;
      return new Response('{}');
    }) as typeof fetch;
    const ans = await ragAnswer('问题？', [], ep, spyFetch);
    expect(ans.refused).toBe(true);
    expect(ans.answer).toBe(REFUSAL);
    expect(called.n).toBe(0);
  });

  it('正常回答携带引用与证据', async () => {
    const ans = await ragAnswer('k？', [hit('rag.md', 'k 取 60。')], ep, fakeFetch('k 取 60 [1]。'));
    expect(ans.refused).toBe(false);
    expect(ans.citations).toEqual([1]);
    expect(ans.evidence).toHaveLength(1);
    expect(ans.warning).toBeUndefined();
  });

  it('模型不带引用时标警告', async () => {
    const ans = await ragAnswer('k？', [hit('rag.md', 'k 取 60。')], ep, fakeFetch('k 取 60。'));
    expect(ans.warning).toContain('未附引用');
  });
});
