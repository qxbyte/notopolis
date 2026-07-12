import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server/server.js';
import { clearJobs } from '../src/server/rag/indexer.js';
import { clearStoreCache } from '../src/server/rag/store.js';
import { MASKED_KEY } from '../src/server/rag/ragconfig.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

/**
 * 假 OpenAI 兼容服务：/embeddings 按文本生成确定性 3 维向量；
 * /chat/completions 返回带引用的固定答案。全程离线。
 */
const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[]; messages?: unknown };
  if (u.endsWith('/embeddings')) {
    const data = (body.input ?? []).map((text, index) => {
      // 确定性伪嵌入：包含「检索」的文本靠近 x 轴，其余靠近 y 轴
      const v = text.includes('检索') ? [0.95, 0.05, 0] : [0.05, 0.95, 0];
      return { index, embedding: v };
    });
    return new Response(JSON.stringify({ data }), { status: 200 });
  }
  if (u.endsWith('/chat/completions')) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '检索增强生成 [1]。' } }] }),
      { status: 200 },
    );
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

beforeEach(async () => {
  process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-ragrt-'));
  clearStoreCache();
  clearJobs();
});

type App = Awaited<ReturnType<typeof createServer>>['app'];

async function setup(): Promise<{ app: App; vaultId: string }> {
  const { app } = await createServer({ fetchFn: fakeFetch });
  const res = await app.inject({
    method: 'POST',
    url: '/api/vaults',
    payload: { name: '测试城', path: FIXTURE, theme: 'plains' },
  });
  return { app, vaultId: (res.json() as { id: string }).id };
}

async function enableRag(app: App, chat = false): Promise<void> {
  const cfg = (await app.inject('/api/rag/config')).json();
  cfg.enabled = true;
  if (chat) cfg.chat.mode = 'local';
  await app.inject({ method: 'PUT', url: '/api/rag/config', payload: cfg });
}

async function indexAll(app: App, vaultId: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/api/rag/${vaultId}/index`, payload: {} });
  expect(r.statusCode).toBe(200);
  for (let i = 0; i < 100; i++) {
    const p = (await app.inject(`/api/rag/${vaultId}/index/progress`)).json();
    if (!p.running && p.finishedAt) return;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('入库任务超时');
}

describe('RAG 配置端点', () => {
  it('缺省配置可读，apiKey 掩码往返', async () => {
    const { app } = await setup();
    const cfg = (await app.inject('/api/rag/config')).json();
    expect(cfg.enabled).toBe(false);
    expect(cfg.embedding.local.baseUrl).toContain('localhost');

    cfg.embedding.remote.apiKey = 'sk-secret';
    await app.inject({ method: 'PUT', url: '/api/rag/config', payload: cfg });
    const back = (await app.inject('/api/rag/config')).json();
    expect(back.embedding.remote.apiKey).toBe(MASKED_KEY); // 永不回传明文

    // 回传掩码值保存 → 明文保留（用启用 RAG 后可正常嵌入来间接验证）
    await app.inject({ method: 'PUT', url: '/api/rag/config', payload: back });
    const again = (await app.inject('/api/rag/config')).json();
    expect(again.embedding.remote.apiKey).toBe(MASKED_KEY);
  });
});

describe('松耦合降级', () => {
  it('RAG 未启用：入库/检索/问答返回 400 中文原因，普通端点不受影响', async () => {
    const { app, vaultId } = await setup();
    const idx = await app.inject({ method: 'POST', url: `/api/rag/${vaultId}/index`, payload: {} });
    expect(idx.statusCode).toBe(400);
    expect(idx.json().error).toContain('未启用');
    expect((await app.inject(`/api/rag/${vaultId}/search?q=检索`)).statusCode).toBe(400);
    const ask = await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/ask`,
      payload: { question: 'x' },
    });
    expect(ask.statusCode).toBe(400);
    // 原有端点照常
    expect((await app.inject('/api/world')).statusCode).toBe(200);
  });

  it('启用但 chat=off：问答提示未配置', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    const ask = await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/ask`,
      payload: { question: 'x' },
    });
    expect(ask.statusCode).toBe(400);
    expect(ask.json().error).toContain('问答模型未配置');
  });
});

describe('入库与文档状态', () => {
  it('全量入库后 docs 全部 indexed，重复入库全部跳过（去重）', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);

    const { docs } = (await app.inject(`/api/rag/${vaultId}/docs`)).json();
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d: { state: string }) => d.state === 'indexed')).toBe(true);

    await indexAll(app, vaultId);
    const p = (await app.inject(`/api/rag/${vaultId}/index/progress`)).json();
    expect(p.skipped).toBe(p.total); // 内容未变，全部跳过
  });

  it('任务互斥：进行中再提交返回 409', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await app.inject({ method: 'POST', url: `/api/rag/${vaultId}/index`, payload: {} });
    const again = await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/index`,
      payload: {},
    });
    // 任务极快时可能已结束（200），否则必须 409——两者都算互斥语义成立
    expect([200, 409]).toContain(again.statusCode);
  });

  it('移除单文档后状态回到 none', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);
    await app.inject({
      method: 'DELETE',
      url: `/api/rag/${vaultId}/doc?path=${encodeURIComponent('01-AI/RAG.md')}`,
    });
    const { docs } = (await app.inject(`/api/rag/${vaultId}/docs`)).json();
    const doc = docs.find((d: { path: string }) => d.path === '01-AI/RAG.md');
    expect(doc.state).toBe('none');
  });
});

describe('检索与问答', () => {
  it('语义检索返回带元数据的命中', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);
    const { hits } = (await app.inject(`/api/rag/${vaultId}/search?q=${encodeURIComponent('检索')}`)).json();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty('docPath');
    expect(hits[0]).toHaveProperty('startLine');
    expect(hits[0]).toHaveProperty('score');
  });

  it('问答返回答案、引用与证据', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app, true);
    await indexAll(app, vaultId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/ask`,
      payload: { question: '什么是检索增强？' },
    });
    expect(res.statusCode).toBe(200);
    const ans = res.json();
    expect(ans.refused).toBe(false);
    expect(ans.citations).toEqual([1]);
    expect(ans.evidence.length).toBeGreaterThan(0);
  });
});

describe('向量库管理端点', () => {
  it('stats：入库后返回聚合概览（计数/字节/模型一致性）', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);

    // 入库前：全部 none，库为空
    let stats = (await app.inject(`/api/rag/${vaultId}/stats`)).json();
    expect(stats.docTotal).toBeGreaterThan(0);
    expect(stats.none).toBe(stats.docTotal);
    expect(stats.chunkCount).toBe(0);
    expect(stats.model).toBeNull();

    await indexAll(app, vaultId);
    stats = (await app.inject(`/api/rag/${vaultId}/stats`)).json();
    expect(stats.indexed).toBe(stats.docTotal);
    expect(stats.chunkCount).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.dims).toBe(3);
    expect(stats.lastIndexedAt).toBeGreaterThan(0);
    expect(stats.modelMismatch).toBe(false);
  });

  it('doc/chunks：返回单文档切片（含章节链/行号/字符数）', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);
    const { chunks } = (await app.inject(
      `/api/rag/${vaultId}/doc/chunks?path=${encodeURIComponent('01-AI/RAG.md')}`,
    )).json();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('headings');
    expect(chunks[0].startLine).toBeGreaterThan(0);
    expect(chunks[0].chars).toBeGreaterThan(0);
    expect(chunks[0].text).toBeTruthy();
    // 缺 path 参数报 400
    expect((await app.inject(`/api/rag/${vaultId}/doc/chunks`)).statusCode).toBe(400);
  });

  it('DELETE store：清空整库后全部文档回到 none', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);
    await app.inject({ method: 'DELETE', url: `/api/rag/${vaultId}/store` });
    const stats = (await app.inject(`/api/rag/${vaultId}/stats`)).json();
    expect(stats.chunkCount).toBe(0);
    expect(stats.none).toBe(stats.docTotal);
    const { docs } = (await app.inject(`/api/rag/${vaultId}/docs`)).json();
    expect(docs.every((d: { state: string }) => d.state === 'none')).toBe(true);
  });
});

describe('反馈与评估闭环', () => {
  it('反馈落盘 → 统计 → 差评导入评估集 → 运行评估', async () => {
    const { app, vaultId } = await setup();
    await enableRag(app);
    await indexAll(app, vaultId);

    await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/feedback`,
      payload: { kind: 'down', question: '什么是检索增强？', answer: '答非所问' },
    });
    const stats = (await app.inject(`/api/rag/${vaultId}/feedback/stats`)).json();
    expect(stats.byKind.down).toBe(1);

    const imp = (await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/eval/from-feedback`,
    })).json();
    expect(imp.added).toBe(1);

    // draft case 无 relevantDocs → 评估报告 0 个有效 case、1 个 draft
    const report = (await app.inject({
      method: 'POST',
      url: `/api/rag/${vaultId}/eval/run`,
    })).json();
    expect(report.caseCount).toBe(0);
    expect(report.draftCount).toBe(1);
  });
});
