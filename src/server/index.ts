import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { watchVaults } from './watcher.js';

const PORT = Number(process.env.NOTOPOLIS_PORT ?? 4777);

const { app, broadcast } = await createServer();
const cfg = await loadConfig();
watchVaults(cfg.vaults, (vaultId) => broadcast({ type: 'city-updated', vaultId }));

await app.listen({ port: PORT });
console.log(`Notopolis server: http://localhost:${PORT}`);
console.log(`已加载 ${cfg.vaults.length} 个 vault（新增 vault 后需重启以生效监听）`);
