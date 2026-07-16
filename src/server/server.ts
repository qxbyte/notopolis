import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDir, loadConfig, makeVault, saveConfig } from './config.js';
import {
  gitCloneDir,
  gitSyncProgress,
  gitVaultId,
  gitVaultPath,
  removeCloneDir,
  startGitSync,
} from './gitvault.js';
import { registerExternalKbRoutes } from './rag/external.js';
import { registerRagRoutes, type RagRouteOpts } from './rag/routes.js';
import { buildGraph } from './graph.js';
import { buildCityModel, tierOf } from './layout/city.js';
import { diffCity, snapshotOf } from './diff.js';
import { loadSnapshot, saveSnapshot } from './snapshots.js';
import { scanVault } from './scanner.js';
import type { VaultConfig } from '../shared/types.js';

type WS = { readyState: number; send(s: string): void; on(ev: string, fn: () => void): void };

const THEMES = ['plains', 'mountain', 'harbor'] as const;

export async function createServer(ragOpts: RagRouteOpts = {}): Promise<{
  app: FastifyInstance;
  broadcast: (msg: unknown) => void;
}> {
  const app = Fastify();
  await app.register(websocket);
  await registerRagRoutes(app, ragOpts);
  await registerExternalKbRoutes(app, { fetchFn: ragOpts.fetchFn });
  const sockets = new Set<WS>();

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket as unknown as WS);
    (socket as unknown as WS).on('close', () => sockets.delete(socket as unknown as WS));
  });

  app.get('/api/world', async () => {
    const cfg = await loadConfig();
    const vaults = [];
    for (const v of cfg.vaults) {
      const scan = await scanVault(v.path);
      const ok = scan.notes.length > 0 || scan.errors.length === 0;
      vaults.push({
        ...v,
        noteCount: scan.notes.length,
        tier: tierOf(scan.notes.length),
        ok,
        reason: ok ? undefined : scan.errors[0]?.reason,
      });
    }
    return { vaults, hasGitToken: !!cfg.git?.token };
  });

  app.get('/api/city/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const scan = await scanVault(vault.path);
    return buildCityModel(vault, scan, buildGraph(scan.notes), Date.now());
  });

  // 入城变化摘要：对比上次快照并推进基线（有副作用，故用 POST）
  app.post('/api/city/:vaultId/visit', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const scan = await scanVault(vault.path);
    const city = buildCityModel(vault, scan, buildGraph(scan.notes), Date.now());
    const prev = await loadSnapshot(vaultId);
    const diff = diffCity(prev, city);
    await saveSnapshot(vaultId, snapshotOf(city, Date.now()));
    return diff;
  });

  app.post('/api/vaults', async (req, reply) => {
    const body = req.body as { name?: string; path?: string; theme?: string };
    if (!body?.name || !body?.path) return reply.code(400).send({ error: 'name/path required' });
    const cfg = await loadConfig();
    const theme = THEMES.includes(body.theme as never) ? (body.theme as VaultConfig['theme']) : 'plains';
    const vault = makeVault(body.name, body.path, theme);
    if (!cfg.vaults.some((v) => v.id === vault.id)) cfg.vaults.push(vault);
    await saveConfig(cfg);
    return vault;
  });

  // Git 库：克隆远端仓库到服务器本地并注册（异步，进度经轮询端点获取）
  app.post('/api/vaults/git', async (req, reply) => {
    const body = req.body as {
      url?: string;
      subdir?: string;
      name?: string;
      theme?: string;
      token?: string;
    };
    const url = body?.url?.trim();
    const name = body?.name?.trim();
    const subdir = body?.subdir?.trim() ?? '';
    if (!url || !name) return reply.code(400).send({ error: '请填写仓库地址和城邦名称' });
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) {
      return reply.code(400).send({ error: '仓库地址需为 https:// 或 git@ 形式' });
    }
    const id = gitVaultId(url, subdir);
    const cloneDir = gitCloneDir(configDir(), id);
    const vpath = gitVaultPath(cloneDir, subdir);
    if (!vpath) return reply.code(400).send({ error: '子目录非法' });

    const cfg = await loadConfig();
    const theme = THEMES.includes(body.theme as never) ? (body.theme as VaultConfig['theme']) : 'plains';
    // token 需在克隆前就绪：非空则存入全局配置（供后续同步复用），空则沿用旧值
    if (body.token) {
      cfg.git = { ...cfg.git, token: body.token };
      await saveConfig(cfg);
    }
    const token = body.token || cfg.git?.token;

    startGitSync({
      id,
      url,
      cloneDir,
      token,
      onDone: async () => {
        // 克隆成功：校验 subdir 确有笔记，再注册/更新 vault
        const scan = await scanVault(vpath);
        if (scan.notes.length === 0 && scan.errors.length > 0) {
          throw new Error(`子目录无法读取：${scan.errors[0]?.reason ?? '未知'}`);
        }
        const latest = await loadConfig();
        const vault: VaultConfig = { id, name, path: vpath, theme, git: { url, subdir: subdir || undefined } };
        latest.vaults = latest.vaults.some((v) => v.id === id)
          ? latest.vaults.map((v) => (v.id === id ? vault : v))
          : [...latest.vaults, vault];
        await saveConfig(latest);
        broadcast({ type: 'city-updated', vaultId: id });
      },
    });
    return { started: true, id };
  });

  // Git 库：对已注册的 Git 库执行拉取更新（异步）
  app.post('/api/vaults/:vaultId/sync', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault?.git) return reply.code(400).send({ error: '该仓库不是 Git 库' });
    const cloneDir = gitCloneDir(configDir(), vaultId);
    startGitSync({
      id: vaultId,
      url: vault.git.url,
      cloneDir,
      token: cfg.git?.token,
      onDone: async () => {
        broadcast({ type: 'city-updated', vaultId });
      },
    });
    return { started: true };
  });

  // Git 库同步进度（前端轮询画进度条）
  app.get('/api/vaults/:vaultId/sync/progress', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    return gitSyncProgress(vaultId);
  });

  app.delete('/api/vaults/:vaultId', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    cfg.vaults = cfg.vaults.filter((v) => v.id !== vaultId);
    await saveConfig(cfg);
    // Git 库连带清理克隆目录，避免磁盘泄漏
    if (vault?.git) await removeCloneDir(gitCloneDir(configDir(), vaultId));
    return { ok: true };
  });

  app.get('/api/note/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rel = (req.query as { path?: string }).path;
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault || !rel) return reply.code(404).send({ error: 'not found' });
    const rootAbs = path.resolve(vault.path);
    const abs = path.resolve(vault.path, rel);
    if (!abs.startsWith(rootAbs + path.sep)) return reply.code(400).send({ error: 'invalid path' });
    try {
      return { markdown: await readFile(abs, 'utf8') };
    } catch {
      return reply.code(404).send({ error: 'note not found' });
    }
  });

  // 保存笔记原文（仅覆盖 vault 内已存在的 .md，路径穿越防护同 GET）
  app.put('/api/note/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rel = (req.query as { path?: string }).path;
    const body = req.body as { markdown?: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault || !rel) return reply.code(404).send({ error: 'not found' });
    if (typeof body?.markdown !== 'string') return reply.code(400).send({ error: 'markdown required' });
    if (!rel.endsWith('.md')) return reply.code(400).send({ error: 'only .md allowed' });
    const rootAbs = path.resolve(vault.path);
    const abs = path.resolve(vault.path, rel);
    if (!abs.startsWith(rootAbs + path.sep)) return reply.code(400).send({ error: 'invalid path' });
    try {
      const s = await stat(abs);
      if (!s.isFile()) return reply.code(400).send({ error: 'not a file' });
    } catch {
      return reply.code(404).send({ error: 'note not found' }); // 只允许改已存在的笔记
    }
    try {
      await writeFile(abs, body.markdown, 'utf8');
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ error: String(e) });
    }
  });

  const broadcast = (msg: unknown): void => {
    const s = JSON.stringify(msg);
    for (const sock of sockets) if (sock.readyState === 1) sock.send(s);
  };

  return { app, broadcast };
}
