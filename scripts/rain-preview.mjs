// 首页雨云小剧场三阶段实拍：平时（白云悬顶）→ 下雨（淋雨发抖）→ 放晴（望日蹦跳）。
// 用法：先起 4787 服务，再 node scripts/rain-preview.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4787/');
await page.waitForFunction(() => window.__notopolis?.view === 'worldmap', { timeout: 15000 });
await page.waitForTimeout(1400); // 等小生物入场动画结束

// 截白板左侧整列（高空云 → 地面小生物聚落），三阶段对比更清晰
const clip = { x: 150, y: 60, width: 500, height: 710 };

await page.screenshot({ path: '.superpowers/e2e-artifacts/rain-1-idle.png', clip });

await page.evaluate(() => window.__notopolis.worldRain());
await page.waitForTimeout(1600); // 雨中段：雨幕铺满、发抖闭眼
await page.screenshot({ path: '.superpowers/e2e-artifacts/rain-2-rain.png', clip });

await page.waitForTimeout(2100); // 3000ms 雨相位结束 + 700ms：太阳已出场
await page.screenshot({ path: '.superpowers/e2e-artifacts/rain-3-sun.png', clip });

await page.waitForTimeout(1900); // 5000ms 后复原
await page.screenshot({ path: '.superpowers/e2e-artifacts/rain-4-restore.png', clip });

await browser.close();
console.log('✓ rain-1-idle / rain-2-rain / rain-3-sun / rain-4-restore');
