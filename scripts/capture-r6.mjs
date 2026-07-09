/**
 * scripts/capture-r6.mjs
 * R6 验收截图脚本
 *
 * 用法：
 *   node scripts/capture-r6.mjs
 *
 * 前提：后端已启动 NOTOPOLIS_PORT=4787 node --import tsx src/server/index.ts
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ARTIFACTS = path.join(ROOT, '.superpowers/e2e-artifacts');
const PORT = 4787;
const BASE_URL = `http://localhost:${PORT}`;

fs.mkdirSync(ARTIFACTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

page.on('console', msg => {
  if (msg.type() === 'error') console.error('[browser]', msg.text());
});

try {
  // 1. 检查后端
  const worldResp = await page.request.get(`${BASE_URL}/api/world`);
  if (!worldResp.ok()) throw new Error('后端不可达，请先启动服务器');
  const world = await worldResp.json();
  console.log('vaults:', world.vaults.map(v => `${v.name}(${v.noteCount})`).join(', '));

  // 找 noteCount 最大的 ok vault
  const target = world.vaults
    .filter(v => v.ok)
    .sort((a, b) => (b.noteCount ?? 0) - (a.noteCount ?? 0))[0];
  if (!target) throw new Error('没有可用的城市');
  console.log(`目标城市: ${target.name} (id=${target.id}, noteCount=${target.noteCount})`);

  // 2. 打开页面
  await page.goto(BASE_URL, { waitUntil: 'load' });

  // 等待 worldmap 视图
  await page.waitForFunction(
    () => (window).__notopolis?.view === 'worldmap',
    { timeout: 20000 },
  );
  console.log('worldmap 视图已就绪');

  // 3. 世界地图截图
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACTS, 'worldmap.png'), fullPage: false });
  console.log('✓ worldmap.png');

  // 4. 进入城市
  await page.evaluate((id) => {
    (window).__notopolis.enterCity(id);
  }, target.id);

  await page.waitForFunction(
    () =>
      (window).__notopolis?.view === 'city' &&
      (window).__notopolis?.pickables > 0,
    { timeout: 30000 },
  );
  console.log('城市视图已就绪');

  // 5. city-notes.png（初始视角全景）
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(ARTIFACTS, 'city-notes.png'), fullPage: false });
  console.log('✓ city-notes.png');

  // 6. 滚轮放大 3 档
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -300);  // deltaY < 0 = 放大
    await page.waitForTimeout(150);
  }

  // 7. city-zoom.png（放大 3 档后）
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ARTIFACTS, 'city-zoom.png'), fullPage: false });
  console.log('✓ city-zoom.png');

  console.log('');
  console.log('截图完成：');
  console.log(`  ${path.join(ARTIFACTS, 'worldmap.png')}`);
  console.log(`  ${path.join(ARTIFACTS, 'city-notes.png')}`);
  console.log(`  ${path.join(ARTIFACTS, 'city-zoom.png')}`);
} finally {
  await browser.close();
}
