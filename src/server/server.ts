import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, makeVault, saveConfig } from './config.js';
import { buildGraph } from './graph.js';
import { buildCityModel, tierOf } from './layout/city.js';
import { scanVault } from './scanner.js';
import type { VaultConfig } from '../shared/types.js';

type WS = { readyState: number; send(s: string): void; on(ev: string, fn: () => void): void };

const THEMES = ['plains', 'mountain', 'harbor', 'snow'] as const;

export async function createServer(): Promise<{
  app: FastifyInstance;
  broadcast: (msg: unknown) => void;
}> {
  const app = Fastify();
  await app.register(websocket);
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
    return { vaults };
  });

  app.get('/api/city/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const scan = await scanVault(vault.path);
    return buildCityModel(vault, scan, buildGraph(scan.notes), Date.now());
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

  app.delete('/api/vaults/:vaultId', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    cfg.vaults = cfg.vaults.filter((v) => v.id !== vaultId);
    await saveConfig(cfg);
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

  const broadcast = (msg: unknown): void => {
    const s = JSON.stringify(msg);
    for (const sock of sockets) if (sock.readyState === 1) sock.send(s);
  };

  return { app, broadcast };
}
