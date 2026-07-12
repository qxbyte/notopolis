/**
 * rag/embed.ts — OpenAI 兼容协议客户端（嵌入 + 问答生成）。
 * 本地 Ollama 与云端 DashScope compatible-mode 走同一实现，仅 baseUrl/apiKey/model 不同。
 * fetchFn 可注入，测试离线可跑。
 */
import type { RagEndpoint } from '../../shared/types.js';

export type FetchFn = typeof globalThis.fetch;

const EMBED_BATCH = 10; // DashScope text-embedding-v4 单请求批量上限

function headers(ep: RagEndpoint): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ep.apiKey) h.Authorization = `Bearer ${ep.apiKey}`;
  return h;
}

async function readError(res: Response): Promise<string> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    /* 忽略响应体读取失败 */
  }
  return `HTTP ${res.status}${body ? `: ${body}` : ''}`;
}

function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

async function embedBatch(texts: string[], ep: RagEndpoint, fetchFn: FetchFn): Promise<number[][]> {
  const url = `${ep.baseUrl.replace(/\/$/, '')}/embeddings`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: headers(ep),
    body: JSON.stringify({ model: ep.model, input: texts }),
  });
  if (!res.ok) throw new Error(`嵌入请求失败 ${await readError(res)}`);
  const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
  if (!Array.isArray(data.data) || data.data.length !== texts.length) {
    throw new Error(`嵌入响应格式异常：期望 ${texts.length} 条向量，实得 ${data.data?.length ?? 0}`);
  }
  const rows = [...data.data].sort((a, b) => a.index - b.index);
  return rows.map((r) => normalize(r.embedding));
}

/** 批量嵌入（每批 10 条，失败重试 1 次）；返回 L2 归一化向量 */
export async function embedTexts(
  texts: string[],
  ep: RagEndpoint,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      out.push(...(await embedBatch(batch, ep, fetchFn)));
    } catch (e) {
      // 单次重试：临时网络抖动/限流兜底
      await new Promise((r) => setTimeout(r, 800));
      try {
        out.push(...(await embedBatch(batch, ep, fetchFn)));
      } catch {
        throw e;
      }
    }
  }
  return out;
}

/** 连通性测试：嵌一条短文本，返回维度 */
export async function testEmbedding(
  ep: RagEndpoint,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ ok: boolean; dims?: number; error?: string }> {
  try {
    const [v] = await embedBatch(['连通性测试'], ep, fetchFn);
    return { ok: true, dims: v.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 问答生成（非流式） */
export async function chatComplete(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ep: RagEndpoint,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<string> {
  const url = `${ep.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: headers(ep),
    body: JSON.stringify({ model: ep.model, messages, temperature: 0.2, stream: false }),
  });
  if (!res.ok) throw new Error(`生成请求失败 ${await readError(res)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('生成响应格式异常：缺少 choices[0].message.content');
  return content;
}

/** 问答连通性测试 */
export async function testChat(
  ep: RagEndpoint,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const reply = await chatComplete([{ role: 'user', content: '回复「在」一个字' }], ep, fetchFn);
    return { ok: true, reply: reply.slice(0, 50) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
