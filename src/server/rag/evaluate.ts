/**
 * rag/evaluate.ts — 评估体系：四层指标，让检索/生成质量可诊断。
 * 召回层 recall@k（正确文档有没有回来）· 重排层 MRR（关键证据是否靠前）·
 * 生成层 answerOk（关键断言命中，需 chat）· 引用层 citation precision（来源匹配）。
 * 指标为纯函数，可单测；评估集存 <ragDir>/eval.json。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RagAnswer, RagHit } from '../../shared/types.js';
import { ragDir } from './store.js';

export interface EvalCase {
  id: string;
  question: string;
  /** 正确答案应来自的文档路径集合 */
  relevantDocs: string[];
  /** 生成层断言：答案必须包含的子串 */
  mustContain?: string[];
  /** 来自反馈导入、尚未人工标注 relevantDocs 的草稿（不参与计算） */
  draft?: boolean;
}

export interface EvalSet {
  cases: EvalCase[];
}

export interface EvalCaseResult {
  id: string;
  question: string;
  recallHit: boolean;
  mrr: number;
  answerOk: boolean | null; // null = 未启用生成评估
  citationPrecision: number | null;
  retrievedDocs: string[];
}

export interface EvalReport {
  ranAt: number;
  caseCount: number;
  draftCount: number;
  recallAtK: number;
  mrr: number;
  answerOkRate: number | null;
  citationPrecision: number | null;
  cases: EvalCaseResult[];
}

// ---- 纯指标函数 ----

/** 召回：检出文档（保序去重）中是否命中任一相关文档 */
export function recallHit(retrievedDocs: string[], relevant: string[]): boolean {
  const rel = new Set(relevant);
  return retrievedDocs.some((d) => rel.has(d));
}

/** MRR 分量：首个相关文档的排名倒数（未命中为 0） */
export function reciprocalRank(retrievedDocs: string[], relevant: string[]): number {
  const rel = new Set(relevant);
  const idx = retrievedDocs.findIndex((d) => rel.has(d));
  return idx < 0 ? 0 : 1 / (idx + 1);
}

/** 引用精度：答案引用的文档 ∩ 相关文档 / 引用文档总数（无引用为 0） */
export function citationPrecision(citedDocs: string[], relevant: string[]): number {
  if (citedDocs.length === 0) return 0;
  const rel = new Set(relevant);
  const hit = citedDocs.filter((d) => rel.has(d)).length;
  return hit / citedDocs.length;
}

/** 生成断言：全部 mustContain 子串命中 */
export function answerOk(answer: string, mustContain: string[]): boolean {
  return mustContain.every((s) => answer.includes(s));
}

// ---- 评估集存取 ----

function evalPath(vaultId: string): string {
  return path.join(ragDir(vaultId), 'eval.json');
}

export async function loadEvalSet(vaultId: string): Promise<EvalSet> {
  try {
    const raw = await readFile(evalPath(vaultId), 'utf8');
    const parsed = JSON.parse(raw) as EvalSet;
    return { cases: Array.isArray(parsed.cases) ? parsed.cases : [] };
  } catch {
    return { cases: [] };
  }
}

export async function saveEvalSet(vaultId: string, set: EvalSet): Promise<void> {
  const dir = ragDir(vaultId);
  await mkdir(dir, { recursive: true });
  const tmp = evalPath(vaultId) + '.tmp';
  await writeFile(tmp, JSON.stringify(set, null, 2));
  await rename(tmp, evalPath(vaultId));
}

// ---- 运行器（检索/生成通过依赖注入，评估逻辑与线上链路共用同一实现） ----

export interface EvalDeps {
  retrieve: (question: string) => Promise<RagHit[]>;
  /** 未配置 chat 时传 null → 生成层/引用层跳过 */
  ask: ((question: string, evidence: RagHit[]) => Promise<RagAnswer>) | null;
}

/** 检出文档保序去重（片段 → 文档层聚合） */
export function docsOf(hits: RagHit[]): string[] {
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.docPath)) out.push(h.docPath);
  return out;
}

export async function runEval(set: EvalSet, deps: EvalDeps): Promise<EvalReport> {
  const active = set.cases.filter((c) => !c.draft && c.relevantDocs.length > 0);
  const results: EvalCaseResult[] = [];

  for (const c of active) {
    const hits = await deps.retrieve(c.question);
    const retrievedDocs = docsOf(hits);
    let ok: boolean | null = null;
    let cp: number | null = null;
    if (deps.ask) {
      try {
        const ans = await deps.ask(c.question, hits);
        ok = c.mustContain?.length ? answerOk(ans.answer, c.mustContain) : null;
        const citedDocs = docsOf(ans.citations.map((n) => ans.evidence[n - 1]).filter(Boolean));
        cp = citationPrecision(citedDocs, c.relevantDocs);
      } catch {
        ok = false;
        cp = 0;
      }
    }
    results.push({
      id: c.id,
      question: c.question,
      recallHit: recallHit(retrievedDocs, c.relevantDocs),
      mrr: reciprocalRank(retrievedDocs, c.relevantDocs),
      answerOk: ok,
      citationPrecision: cp,
      retrievedDocs,
    });
  }

  const avg = (xs: number[]): number =>
    xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 1000) / 1000 : 0;
  const okCases = results.filter((r) => r.answerOk !== null);
  const cpCases = results.filter((r) => r.citationPrecision !== null);

  return {
    ranAt: Date.now(),
    caseCount: results.length,
    draftCount: set.cases.length - active.length,
    recallAtK: avg(results.map((r) => (r.recallHit ? 1 : 0))),
    mrr: avg(results.map((r) => r.mrr)),
    answerOkRate: okCases.length ? avg(okCases.map((r) => (r.answerOk ? 1 : 0))) : null,
    citationPrecision: cpCases.length
      ? avg(cpCases.map((r) => r.citationPrecision as number))
      : null,
    cases: results,
  };
}
