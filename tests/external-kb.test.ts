import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeVault, saveConfig } from '../src/server/config.js';
import { clearStoreCache, openStore } from '../src/server/rag/store.js';
import { createServer } from '../src/server/server.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

/** 对外知识库 API（AgentX 等外部系统接入的固定模板）。 */
describe('external-kb 对外接入 API', () => {
  let vaultId: string;

  beforeEach(async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-extkb-'));
    clearStoreCache();
    const vault = makeVault('库A', FIXTURE, 'plains');
    vaultId = vault.id;
    await saveConfig({ vaults: [vault] });
  });

  it('heartbeat 返回存活信息', async () => {
    const { app } = await createServer();
    const res = await app.inject({ method: 'GET', url: '/api/external-kb/heartbeat' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: 'notopolis' });
  });

  it('info 不带 vault 列出全部仓库；未知 vault 404', async () => {
    const { app } = await createServer();
    const all = await app.inject({ method: 'GET', url: '/api/external-kb/info' });
    expect(all.json().vaults).toHaveLength(1);
    expect(all.json().vaults[0]).toMatchObject({ vaultId, name: '库A' });

    const miss = await app.inject({ method: 'GET', url: '/api/external-kb/info?vault=nope' });
    expect(miss.statusCode).toBe(404);
  });

  it('search 必须指定 vault（防多仓库内容互相污染）', async () => {
    const { app } = await createServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vector: [1, 0, 0] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('vault');
  });

  it('未建索引时返回空命中而非报错（fail-open）', async () => {
    const { app } = await createServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, vector: [1, 0, 0] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hits: [], indexed: false });
  });

  it('维度不匹配返回 400 并提示模型一致性；匹配时按余弦降序命中', async () => {
    // 手工灌两个片段：x 轴向 / y 轴向
    const store = await openStore(vaultId);
    await store.upsertDoc(
      {
        docPath: 'a.md', docHash: 'h1', mtimeMs: 1, chunkCount: 2,
        indexedAt: 1, model: 'fake-embed', dims: 3,
      },
      [
        { id: 'a.md#0', docPath: 'a.md', title: '检索', text: '向量检索原理' } as never,
        { id: 'a.md#1', docPath: 'a.md', title: '布局', text: '城市布局算法' } as never,
      ],
      [[1, 0, 0], [0, 1, 0]],
    );

    const { app } = await createServer();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      payload: { vault: vaultId, vector: [1, 0] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('维度不匹配');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/external-kb/search',
      // 未归一化向量也应正确工作（服务端归一化）
      payload: { vault: vaultId, vector: [10, 1, 0], topK: 2 },
    });
    expect(ok.statusCode).toBe(200);
    const { hits, indexed, embedding } = ok.json();
    expect(indexed).toBe(true);
    expect(embedding).toMatchObject({ model: 'fake-embed', dims: 3 });
    expect(hits[0]).toMatchObject({ title: '检索', path: 'a.md' });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});
