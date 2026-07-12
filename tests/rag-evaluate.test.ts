import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RagAnswer, RagHit } from '../src/shared/types.js';
import {
  answerOk,
  citationPrecision,
  docsOf,
  loadEvalSet,
  reciprocalRank,
  recallHit,
  runEval,
  saveEvalSet,
} from '../src/server/rag/evaluate.js';

beforeEach(async () => {
  process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-eval-'));
});

const hit = (docPath: string): RagHit => ({
  id: `${docPath}#0`,
  docPath,
  title: docPath,
  headings: [],
  startLine: 1,
  endLine: 1,
  text: 'k 取 60。',
  score: 0.9,
});

describe('纯指标函数', () => {
  it('recallHit / reciprocalRank', () => {
    expect(recallHit(['a.md', 'b.md'], ['b.md'])).toBe(true);
    expect(recallHit(['a.md'], ['b.md'])).toBe(false);
    expect(reciprocalRank(['a.md', 'b.md'], ['b.md'])).toBe(0.5);
    expect(reciprocalRank(['x.md'], ['b.md'])).toBe(0);
  });
  it('citationPrecision', () => {
    expect(citationPrecision(['a.md', 'b.md'], ['a.md'])).toBe(0.5);
    expect(citationPrecision([], ['a.md'])).toBe(0);
  });
  it('answerOk 全部断言命中', () => {
    expect(answerOk('k 取 60，融合用 RRF', ['60', 'RRF'])).toBe(true);
    expect(answerOk('k 取 60', ['60', 'RRF'])).toBe(false);
  });
  it('docsOf 保序去重', () => {
    expect(docsOf([hit('a.md'), hit('b.md'), hit('a.md')])).toEqual(['a.md', 'b.md']);
  });
});

describe('评估集存取', () => {
  it('保存/读取往返；缺失文件返回空集', async () => {
    expect((await loadEvalSet('v1')).cases).toEqual([]);
    await saveEvalSet('v1', { cases: [{ id: 'c1', question: 'q', relevantDocs: ['a.md'] }] });
    expect((await loadEvalSet('v1')).cases).toHaveLength(1);
  });
});

describe('runEval', () => {
  const SET = {
    cases: [
      { id: 'c1', question: 'k？', relevantDocs: ['rag.md'], mustContain: ['60'] },
      { id: 'c2', question: '天气？', relevantDocs: ['weather.md'] },
      { id: 'draft', question: '草稿', relevantDocs: [], draft: true },
    ],
  };

  const fakeAsk = async (_q: string, ev: RagHit[]): Promise<RagAnswer> => ({
    answer: 'k 取 60 [1]。',
    refused: false,
    citations: [1],
    evidence: ev,
    warning: undefined,
  });

  it('四层指标齐全，draft 不参与计算', async () => {
    const report = await runEval(SET, {
      retrieve: async (q) => (q === 'k？' ? [hit('rag.md')] : [hit('other.md')]),
      ask: fakeAsk,
    });
    expect(report.caseCount).toBe(2);
    expect(report.draftCount).toBe(1);
    expect(report.recallAtK).toBe(0.5); // c1 命中，c2 未命中
    expect(report.mrr).toBe(0.5); // (1 + 0) / 2
    expect(report.answerOkRate).toBe(1); // 仅 c1 有 mustContain 且命中
    expect(report.citationPrecision).toBe(0.5); // c1 引用 rag.md 精确；c2 引用 other.md 0 分
  });

  it('chat 未配置时生成层/引用层为 null', async () => {
    const report = await runEval(SET, {
      retrieve: async () => [hit('rag.md')],
      ask: null,
    });
    expect(report.answerOkRate).toBeNull();
    expect(report.citationPrecision).toBeNull();
  });
});
