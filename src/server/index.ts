import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { watchVaults } from './watcher.js';

const PORT = Number(process.env.NOTOPOLIS_PORT ?? 4777);

const { app, broadcast } = await createServer();
const cfg = await loadConfig();
watchVaults(cfg.vaults, (vaultId) => broadcast({ type: 'city-updated', vaultId }));

// 静态托管前端构建产物（若存在）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../web/dist');

if (existsSync(distDir)) {
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    // wildcard: true 让 @fastify/static 内置处理 SPA 回退（未匹配路径返回 index.html）
    wildcard: true,
    index: 'index.html',
  });
}

await app.listen({ port: PORT });
console.log(`Notopolis server: http://localhost:${PORT}`);
console.log(`已加载 ${cfg.vaults.length} 个 vault（新增 vault 后需重启以生效监听）`);
