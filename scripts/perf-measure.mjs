/**
 * scripts/perf-measure.mjs
 * 2D 渲染器性能实测脚本
 *
 * 用法：
 *   node scripts/perf-measure.mjs [--vault <path>] [--port <port>]
 *
 * 依赖：
 *   - 需先启动后端：NOTOPOLIS_PORT=4787 node --import tsx src/server/index.ts
 *   - 或者让本脚本自动启动（无参数时使用默认路径和端口）
 *
 * 测量字段（来自 2D cityview2d 的 perf() 探针）：
 *   avgMs   - 平均帧时间（毫秒）
 *   p95Ms   - p95 帧时间（毫秒）
 *   fps     - 估算帧率
 *   paintMs - 静态城市绘制耗时（一次性）
 *   hitItems - 可命中对象总数
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- 参数解析 ----
const args = process.argv.slice(2);
let vaultPath = null;
let port = 4787;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vault' && args[i + 1]) vaultPath = args[++i];
  if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
}

// 默认 vault：真实笔记库
if (!vaultPath) {
  const candidates = [
    path.join(process.env.HOME, 'Documents/Obsidian/Notes'),
    path.join(ROOT, 'tests/fixtures/vault-a'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { vaultPath = c; break; }
  }
}

const BASE_URL = `http://localhost:${port}`;

console.log(`[perf-measure] vault: ${vaultPath}`);
console.log(`[perf-measure] server: ${BASE_URL}`);
console.log('');

// ---- 启动 Playwright ----
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

// 收集控制台日志
page.on('console', msg => {
  if (msg.type() === 'error') {
    console.error('[browser error]', msg.text());
  }
});

try {
  // 1. 检查后端是否可达
  const worldResp = await page.request.get(`${BASE_URL}/api/world`);
  if (!worldResp.ok()) {
    console.error(`[perf-measure] 后端不可达：${BASE_URL}，请先启动服务器`);
    process.exit(1);
  }
  const world = await worldResp.json();
  console.log(`[perf-measure] 当前 vaults: ${world.vaults.map(v => `${v.name}(${v.noteCount}篇)`).join(', ') || '（空）'}`);

  // 2. 若没有 vault，先注册
  let vaultId = world.vaults[0]?.id;
  if (!vaultId) {
    console.log('[perf-measure] 注册新 vault...');
    const addResp = await page.request.post(`${BASE_URL}/api/vaults`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ name: 'perf-vault', path: vaultPath, theme: 'plains' }),
    });
    const newVault = await addResp.json();
    vaultId = newVault.id;
    console.log(`[perf-measure] 注册完成 id=${vaultId}`);
  }

  // 3. 打开页面，进入城市视图
  await page.goto(BASE_URL, { waitUntil: 'load' });

  // 等待 worldmap 视图加载（可能已有 vault，直接进入 worldmap）
  try {
    await page.waitForFunction(
      () => (window).__notopolis?.view === 'worldmap',
      { timeout: 15000 }
    );
  } catch {
    // 如果卡在 onboarding，说明 vault 注册未生效——重新走
    console.log('[perf-measure] 页面未检测到 worldmap，尝试 reload...');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => (window).__notopolis?.view === 'worldmap',
      { timeout: 15000 }
    );
  }

  // 4. 进入城市
  console.log(`[perf-measure] enterCity(${vaultId})...`);
  const t0 = Date.now();
  await page.evaluate((id) => {
    (window).__notopolis.enterCity(id);
  }, vaultId);

  await page.waitForFunction(
    () =>
      (window).__notopolis?.view === 'city' &&
      (window).__notopolis?.pickables > 0,
    { timeout: 30000 }
  );
  const enterMs = Date.now() - t0;
  console.log(`[perf-measure] enterCity 完成，耗时 ${enterMs}ms`);

  // 5. 等待帧积累（约 3s = 180 帧 @60fps，无头约 60+ 帧）
  console.log('[perf-measure] 等待帧积累（3s）...');
  await page.waitForTimeout(3000);

  // 6. 读取 perf 探针
  const perf = await page.evaluate(() => {
    return (window).__notopolis?.perf?.() ?? {};
  });

  const pickables = await page.evaluate(() => (window).__notopolis?.pickables ?? 0);

  console.log('');
  console.log('========================================');
  console.log('  2D 渲染器性能实测结果');
  console.log('========================================');
  console.log(`  vault        : ${vaultPath}`);
  console.log(`  pickables    : ${pickables} 栋建筑`);
  console.log(`  hitItems     : ${perf.hitItems ?? 'N/A'} 可命中对象`);
  console.log(`  paintMs      : ${perf.paintMs ?? 'N/A'} ms（静态城市绘制，一次性）`);
  console.log(`  avgMs        : ${perf.avgMs ?? 'N/A'} ms（平均帧时间）`);
  console.log(`  p95Ms        : ${perf.p95Ms ?? 'N/A'} ms（p95 帧时间）`);
  console.log(`  fps          : ${perf.fps ?? 'N/A'} fps（估算）`);
  console.log('----------------------------------------');
  console.log('  3D 基线对比（历史无头实测）:');
  console.log('  avgMs(3D)    : ~5444 ms（无头 Three.js 渲染器）');
  console.log('  speedup      : ' + (perf.avgMs ? `${(5444 / perf.avgMs).toFixed(1)}x 加速` : 'N/A'));
  console.log('========================================');
  console.log('');

  // 7. 写入 JSON 结果（供 CI 读取）
  const resultPath = path.join(ROOT, '.superpowers/e2e-artifacts/perf-result.json');
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    vault: vaultPath,
    renderer: '2d',
    ...perf,
    pickables,
    enterMs,
    baseline3d: { avgMs: 5444 },
    speedup: perf.avgMs ? +(5444 / perf.avgMs).toFixed(1) : null,
  }, null, 2));
  console.log(`[perf-measure] 结果写入 ${resultPath}`);

} finally {
  await browser.close();
}
