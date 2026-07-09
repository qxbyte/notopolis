import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// beforeAll: 清空 e2e-config 目录保证首启状态
test.beforeAll(() => {
  const configDir = path.join(process.cwd(), '.superpowers/e2e-config');
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
  fs.mkdirSync(configDir, { recursive: true });

  // 确保截图输出目录存在
  const artifactsDir = path.join(process.cwd(), '.superpowers/e2e-artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
});

test('home → add vault → enter world → city smoke test', async ({ page }) => {
  const vaultPath = path.join(process.cwd(), 'tests/fixtures/vault-a');

  // ---- 首页（仓库管理页）----
  await page.goto('/');

  // 等待首页标题「NOTOPOLIS」
  await expect(page.getByText('NOTOPOLIS')).toBeVisible({ timeout: 15000 });

  // 断言「进入世界」按钮存在（初始无 vault，应禁用）
  const foundBtn = page.locator('#ob-found-btn');
  await expect(foundBtn).toBeVisible({ timeout: 5000 });
  await expect(foundBtn).toBeDisabled();

  // 填写 vault 路径
  await page.fill('#ob-path', vaultPath);

  // 填写城邦名
  await page.fill('#ob-name', '测试城');

  // 选择主题 plains
  await page.selectOption('#ob-theme', 'plains');

  // 点击「添加」按钮
  await page.click('#ob-add-btn');

  // 等待列表出现「测试城」
  await expect(page.getByText('测试城')).toBeVisible({ timeout: 10000 });

  // 「进入世界」按钮应变为可用
  await expect(foundBtn).toBeEnabled({ timeout: 5000 });

  // 点击「进入世界」按钮
  await page.click('#ob-found-btn');

  // 等待 __notopolis.view === 'worldmap'
  await page.waitForFunction(
    () => (window as any).__notopolis?.view === 'worldmap',
    { timeout: 30000 }
  );

  // ---- 世界地图截图 ----
  // 等待至少 1 帧渲染完成（canvas 非空）
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(process.cwd(), '.superpowers/e2e-artifacts/worldmap.png'),
  });

  // ---- 进城流程 ----
  // 从后端获取 vaultId（使用 baseURL，避免硬编码端口）
  const apiResp = await page.request.get('/api/world', { timeout: 10000 });
  const world = await apiResp.json() as { vaults: Array<{ id: string }> };
  const vaultId = world.vaults[0]?.id;
  expect(vaultId).toBeTruthy();

  // 调用 enterCity
  await page.evaluate((id: string) => {
    (window as any).__notopolis.enterCity(id);
  }, vaultId);

  // 等待 view === 'city' 且 pickables > 0（timeout 30s）
  await page.waitForFunction(
    () =>
      (window as any).__notopolis?.view === 'city' &&
      (window as any).__notopolis?.pickables > 0,
    { timeout: 30000 }
  );

  // ---- 断言 ----
  // HUD 文本含「测试城」
  const hudText = await page.locator('#hud').textContent();
  expect(hudText).toContain('测试城');

  // HUD 文本含「拓荒营地」（tier = camp，vault-a 只有 5 个 .md 文件）
  expect(hudText).toContain('拓荒营地');

  // ---- city-notes 截图（城全景）----
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(process.cwd(), '.superpowers/e2e-artifacts/city-notes.png'),
  });

  // ---- city-zoom 截图（滚轮放大一档）----
  // 在 canvas 中心滚轮放大
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    // 向上滚动放大（deltaY 负值 = zoom in）
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(400);
  }
  await page.screenshot({
    path: path.join(process.cwd(), '.superpowers/e2e-artifacts/city-zoom.png'),
  });

  // ---- perf 探针（2D 渲染器）----
  // 等待足够多帧积累（约 60 帧 = 1s）
  await page.waitForTimeout(1200);
  const perfData = await page.evaluate(() => {
    return (window as any).__notopolis?.perf?.() ?? {};
  });
  console.log('[perf]', JSON.stringify(perfData));
  // 2D 渲染器目标：avgMs < 25ms（无头环境）
  if (perfData.avgMs !== undefined) {
    expect(perfData.avgMs).toBeLessThan(100); // 宽松阈值，无头 CI 容忍更高延迟
  }
  // hitItems 应 > 0（有建筑被绘制）
  if (perfData.hitItems !== undefined) {
    expect(perfData.hitItems).toBeGreaterThan(0);
  }

  // ---- 触发建筑拾取 ----
  await page.evaluate(() => {
    (window as any).__notopolis.pickBuilding(0);
  });

  // 等待 #card 可见（卡片内含「在 Obsidian 打开」链接）
  await expect(page.locator('#card')).toBeVisible({ timeout: 10000 });
  // 确认卡片内有「在 Obsidian 打开」链接
  await expect(page.locator('#card a').filter({ hasText: '在 Obsidian 打开' })).toBeVisible();

  // 最终截图（含卡片）
  await page.screenshot({
    path: path.join(process.cwd(), '.superpowers/e2e-artifacts/city.png'),
  });
});
