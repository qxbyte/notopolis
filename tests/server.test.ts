import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server/server.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

beforeEach(async () => {
  process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
});

async function addFixtureVault(app: Awaited<ReturnType<typeof createServer>>['app']) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vaults',
    payload: { name: '测试城', path: FIXTURE, theme: 'plains' },
  });
  return res.json() as { id: string };
}

describe('REST API', () => {
  it('vault 增删与 world 摘要', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);

    const world = (await app.inject('/api/world')).json();
    expect(world.vaults).toHaveLength(1);
    expect(world.vaults[0]).toMatchObject({ id: v.id, noteCount: 5, tier: 'camp', ok: true });

    await app.inject({ method: 'DELETE', url: `/api/vaults/${v.id}` });
    expect((await app.inject('/api/world')).json().vaults).toHaveLength(0);
  });

  it('失效路径的 vault 标记迷雾（ok:false）', async () => {
    const { app } = await createServer();
    await app.inject({
      method: 'POST',
      url: '/api/vaults',
      payload: { name: '迷雾城', path: '/nonexistent/xyz', theme: 'snow' },
    });
    const world = (await app.inject('/api/world')).json();
    expect(world.vaults[0].ok).toBe(false);
    expect(world.vaults[0].reason).toBeTruthy();
  });

  it('返回城市模型', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);
    const city = (await app.inject(`/api/city/${v.id}`)).json();
    expect(city.noteCount).toBe(5);
    expect(city.districts).toHaveLength(3);
    expect((await app.inject('/api/city/nope')).statusCode).toBe(404);
  });

  it('读笔记原文并阻止路径穿越', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);
    const ok = await app.inject(`/api/note/${v.id}?path=${encodeURIComponent('01-AI/RAG.md')}`);
    expect(ok.json().markdown).toContain('检索增强生成');
    const evil = await app.inject(`/api/note/${v.id}?path=${encodeURIComponent('../../etc/passwd')}`);
    expect(evil.statusCode).toBe(400);
  });

  it('非法 theme 回落到 plains', async () => {
    const { app } = await createServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/vaults',
      payload: { name: '非法主题', path: FIXTURE, theme: 'hacker' },
    });
    const vault = res.json() as { theme: string };
    expect(vault.theme).toBe('plains');
  });
});
