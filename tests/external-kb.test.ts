import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeVault, saveConfig } from '../src/server/config.js';
import { clearStoreCache, openStore } from '../src/server/rag/store.js';
import { createServer } from '../src/server/server.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

/** 默认配置生效的 embedding 模型（缺省 embedding.mode=local）——灌库时须与之一致，否则命 409。 */
const ACTIVE_MODEL = 'qwen3-embedding:0.6b';

/**
 * 假 OpenAI 兼容嵌入服务：/embeddings 按文本内容给确定性 3 维向量。
 * 含「检索」的文本靠 x 轴，其余靠 y 轴——用于验证语义相近者排前。全程离线。
 */
const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith('/embeddings')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[] };
    const data = (body.input ?? []).map((text, index) => ({
      index,
      embedding: text.includes('检索') ? [0.95, 0.05, 0] : [0.05, 0.95, 0],
    }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

/** 灌两个片段：检索片（x 轴向）/ 布局片（y 轴向），模型可指定以测一致性校验。 */
async function seedTwoChunks(vaultId: string, model = ACTIVE_MODEL): Promise<void> {
  const store = await openStore(vaultId);
  await store.upsertDoc(
    { docPath: 'a.md', docHash: 'h1', mtimeMs: 1, chunkCount: 2, indexedAt: 1, model, dims: 3 },
    [
      {
        id: 'a.md#0', docPath: 'a.md', title: '检索', text: '向量检索原理',
        headings: ['架构', '检索层'], startLine: 12, endLine: 30,
      } as never,
      {
        id: 'a.md#1', docPath: 'a.md', title: '布局', text: '城市布局算法',
        headings: ['架构'], startLine: 31, endLine: 58,
      } as never,
    ],
    [[1, 0, 0], [0, 1, 0]],
  );
}

/** 对外知识库 API（AgentX 等外部系统接入的固定模板，v2 文本契约）。 */
describe('external-kb 对外接入 API', () => {
  let vaultId: string;

  beforeEach(async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-extkb-'));
    clearStoreCache();
    const vault = makeVault('库A', FIXTURE, 'plains');
    vaultId = vault.id;
    await saveConfig({ vaults: [vault] });
  });

  it('heartbeat 返回存活信息与模板版本 2', async () => {
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({ method: 'GET', url: '/api/external-kb/heartbeat' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: 'notopolis', templateVersion: 2 });
  });

  it('info 不带 vault 列出全部仓库；未知 vault 404', async () => {
    const { app } = await createServer({ fetchFn: fakeFetch });
    const all = await app.inject({ method: 'GET', url: '/api/external-kb/info' });
    expect(all.json().vaults).toHaveLength(1);
    expect(all.json().vaults[0]).toMatchObject({ vaultId, name: '库A' });

    const miss = await app.inject({ method: 'GET', url: '/api/external-kb/info?vault=nope' });
    expect(miss.statusCode).toBe(404);
  });

  it('search 必须指定 vault（防多仓库内容互相污染）', async () => {
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { query: '向量检索' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('vault');
  });

  it('search 必须提供查询文本 query', async () => {
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, query: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('query');
  });

  it('未建索引时返回空命中而非报错（fail-open）', async () => {
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, query: '向量检索' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hits: [], indexed: false });
  });

  it('索引模型与当前配置不一致时返回 409（本库自我保护）', async () => {
    await seedTwoChunks(vaultId, 'some-other-model');
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, query: '向量检索' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('重新入库');
  });

  it('文本查询：本库自向量化后按语义相近降序命中，带定位字段', async () => {
    await seedTwoChunks(vaultId);
    const { app } = await createServer({ fetchFn: fakeFetch });
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, query: '向量检索原理是什么', topK: 2 },
    });
    expect(res.statusCode).toBe(200);
    const { hits, indexed, embedding } = res.json();
    expect(indexed).toBe(true);
    expect(embedding).toMatchObject({ model: ACTIVE_MODEL, dims: 3 });
    // 含「检索」的查询语义上更靠检索片，应排第一，并带章节链 + 行号
    expect(hits[0]).toMatchObject({
      title: '检索', path: 'a.md',
      headings: ['架构', '检索层'], startLine: 12, endLine: 30,
    });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});
