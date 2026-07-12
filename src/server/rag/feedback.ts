/**
 * rag/feedback.ts — 线上反馈沉淀（闭环的最后一公里）。
 * 事件追加式 JSONL（保序、易导出）；统计供设置页展示；
 * 差评问题可一键导入评估集为 draft case（人工补标注后转正）——反哺评估/检索/提示词。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ragDir } from './store.js';
import { loadEvalSet, saveEvalSet } from './evaluate.js';

export type FeedbackKind = 'up' | 'down' | 'followup' | 'rewrite';

export interface FeedbackEvent {
  ts: number;
  kind: FeedbackKind;
  question: string;
  answer?: string;
  citations?: string[];
  comment?: string;
}

export interface FeedbackStats {
  total: number;
  byKind: Record<FeedbackKind, number>;
  /** 最近差评问题（去重、新→旧、最多 20 条） */
  recentDown: { ts: number; question: string }[];
}

function feedbackPath(vaultId: string): string {
  return path.join(ragDir(vaultId), 'feedback.jsonl');
}

export async function appendFeedback(vaultId: string, ev: FeedbackEvent): Promise<void> {
  const dir = ragDir(vaultId);
  await mkdir(dir, { recursive: true });
  await appendFile(feedbackPath(vaultId), JSON.stringify(ev) + '\n', 'utf8');
}

export async function readFeedback(vaultId: string): Promise<FeedbackEvent[]> {
  try {
    const raw = await readFile(feedbackPath(vaultId), 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as FeedbackEvent;
        } catch {
          return null;
        }
      })
      .filter((x): x is FeedbackEvent => x !== null);
  } catch {
    return [];
  }
}

export async function feedbackStats(vaultId: string): Promise<FeedbackStats> {
  const events = await readFeedback(vaultId);
  const byKind: Record<FeedbackKind, number> = { up: 0, down: 0, followup: 0, rewrite: 0 };
  for (const e of events) if (e.kind in byKind) byKind[e.kind]++;
  const seen = new Set<string>();
  const recentDown: { ts: number; question: string }[] = [];
  for (const e of [...events].reverse()) {
    if (e.kind !== 'down' || seen.has(e.question)) continue;
    seen.add(e.question);
    recentDown.push({ ts: e.ts, question: e.question });
    if (recentDown.length >= 20) break;
  }
  return { total: events.length, byKind, recentDown };
}

/** 差评问题导入评估集（draft，relevantDocs 待人工标注）；返回新增数 */
export async function exportDownToEval(vaultId: string): Promise<number> {
  const stats = await feedbackStats(vaultId);
  const evalSet = await loadEvalSet(vaultId);
  const existing = new Set(evalSet.cases.map((c) => c.question));
  let added = 0;
  for (const d of stats.recentDown) {
    if (existing.has(d.question)) continue;
    evalSet.cases.push({
      id: `fb-${d.ts}`,
      question: d.question,
      relevantDocs: [],
      draft: true,
    });
    added++;
  }
  if (added > 0) await saveEvalSet(vaultId, evalSet);
  return added;
}
