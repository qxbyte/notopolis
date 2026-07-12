import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEvalSet } from '../src/server/rag/evaluate.js';
import {
  appendFeedback,
  exportDownToEval,
  feedbackStats,
  readFeedback,
} from '../src/server/rag/feedback.js';

beforeEach(async () => {
  process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-fb-'));
});

describe('feedback', () => {
  it('追加与读取往返', async () => {
    await appendFeedback('v1', { ts: 1, kind: 'up', question: 'q1' });
    await appendFeedback('v1', { ts: 2, kind: 'down', question: 'q2', comment: '答非所问' });
    const events = await readFeedback('v1');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: 'down', comment: '答非所问' });
  });

  it('统计各类计数与最近差评（去重、新→旧）', async () => {
    await appendFeedback('v1', { ts: 1, kind: 'down', question: 'q1' });
    await appendFeedback('v1', { ts: 2, kind: 'down', question: 'q1' }); // 重复问题
    await appendFeedback('v1', { ts: 3, kind: 'down', question: 'q2' });
    await appendFeedback('v1', { ts: 4, kind: 'up', question: 'q3' });
    const stats = await feedbackStats('v1');
    expect(stats.total).toBe(4);
    expect(stats.byKind.down).toBe(3);
    expect(stats.recentDown.map((d) => d.question)).toEqual(['q2', 'q1']);
  });

  it('无反馈文件时安全返回空', async () => {
    expect(await readFeedback('v-none')).toEqual([]);
    expect((await feedbackStats('v-none')).total).toBe(0);
  });

  it('差评导入评估集为 draft，重复导入不加重', async () => {
    await appendFeedback('v1', { ts: 1, kind: 'down', question: 'q1' });
    expect(await exportDownToEval('v1')).toBe(1);
    expect(await exportDownToEval('v1')).toBe(0); // 已存在，去重
    const set = await loadEvalSet('v1');
    expect(set.cases).toHaveLength(1);
    expect(set.cases[0]).toMatchObject({ question: 'q1', draft: true, relevantDocs: [] });
  });
});
