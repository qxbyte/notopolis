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

test('onboarding → worldmap → city smoke test', async ({ page }) => {
  const vaultPath = path.join(process.cwd(), 'tests/fixtures/vault-a');

  // ---- 首启流程（onboarding）----
  await page.goto('/');

  // 等待「欢迎，执政官」文本
  await expect(page.getByText('欢迎，执政官')).toBeVisible({ timeout: 15000 });

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

  // 点击「奠基建城」按钮
  await page.click('#ob-found-btn');

  // 等待 __notopolis.view === 'worldmap'
  await page.waitForFunction(
    () => (window as any).__notopolis?.view === 'worldmap',
    { timeout: 30000 }
  );

  // ---- 进城流程 ----
  // 从后端获取 vaultId
  const apiResp = await page.request.get('http://localhost:4777/api/world', { timeout: 10000 });
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

  // 触发建筑拾取
  await page.evaluate(() => {
    (window as any).__notopolis.pickBuilding(0);
  });

  // 等待 #card 可见（或含「在 Obsidian 打开」文本的弹窗）
  await expect(
    page.locator('#card').or(page.getByText('在 Obsidian 打开'))
  ).toBeVisible({ timeout: 10000 });

  // 截图
  await page.screenshot({
    path: path.join(process.cwd(), '.superpowers/e2e-artifacts/city.png'),
  });
});
