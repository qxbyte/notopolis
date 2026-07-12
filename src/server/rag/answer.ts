/**
 * rag/answer.ts — 生成约束层：让答案可验证。
 * 约束：只依据编号证据回答 · 结论必须带引用 [n] · 证据不足强制拒答。
 * 后置校验兜底：解析引用、剔除越界、拒答检测、无引用告警。
 */
import type { RagAnswer, RagEndpoint, RagHit } from '../../shared/types.js';
import { chatComplete, type FetchFn } from './embed.js';

export const REFUSAL = '根据知识库中的现有资料，无法回答这个问题。';

export function buildAnswerPrompt(
  question: string,
  evidence: RagHit[],
): { system: string; user: string } {
  const system = [
    '你是一个知识库问答助手。严格遵守以下规则：',
    '1. 只能依据下方编号证据回答，禁止使用证据之外的任何知识补充或猜测；',
    '2. 每个结论句末必须标注证据引用，格式为 [n]，可以多引如 [1][3]；',
    `3. 如果证据不足以回答问题，必须整句回复：「${REFUSAL}」，不得部分作答；`,
    '4. 用中文回答，简洁、直接、忠于证据原文。',
  ].join('\n');

  const blocks = evidence
    .map((h, i) => {
      const loc = h.headings.length ? ` · ${h.headings.join(' > ')}` : '';
      return `[${i + 1}] 《${h.title}》${loc}（${h.docPath} L${h.startLine}-${h.endLine}）\n${h.text}`;
    })
    .join('\n\n---\n\n');

  const user = `证据：\n\n${blocks}\n\n问题：${question}`;
  return { system, user };
}

/** 解析答案中的引用序号（1-based，去重保序） */
export function parseCitations(answer: string): number[] {
  const out: number[] = [];
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

export function isRefusal(answer: string): boolean {
  return answer.includes('无法回答');
}

/** 后置校验：越界引用剔除；非拒答但无引用 → 警告 */
export function validateAnswer(
  answer: string,
  evidenceCount: number,
): { citations: number[]; refused: boolean; warning?: string } {
  const refused = isRefusal(answer);
  const citations = parseCitations(answer).filter((n) => n <= evidenceCount);
  if (!refused && citations.length === 0) {
    return { citations, refused, warning: '答案未附引用，可信度存疑' };
  }
  return { citations, refused };
}

export async function ragAnswer(
  question: string,
  evidence: RagHit[],
  chatEp: RagEndpoint,
  fetchFn?: FetchFn,
): Promise<RagAnswer> {
  // 检索为空：不烧生成 token，行为确定地拒答
  if (evidence.length === 0) {
    return { answer: REFUSAL, refused: true, citations: [], evidence: [] };
  }
  const { system, user } = buildAnswerPrompt(question, evidence);
  const answer = await chatComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    chatEp,
    fetchFn,
  );
  const { citations, refused, warning } = validateAnswer(answer, evidence.length);
  return { answer, refused, citations, evidence, warning };
}
