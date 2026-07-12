// 配色方案对比截图：把候选背景色系注入 CSS 变量，截「设置弹窗(配置模型)」画面。
// 用法：先在 4787 起服务，再 node scripts/palette-shots.mjs
import { chromium } from '@playwright/test';

const PALETTES = [
  {
    name: 'A-notion-warmgray',
    label: '中性暖灰 Notion 风',
    css: `:root{--bg:#F7F7F5;--surface:#FFFFFF;--text:#37352F;--muted:#787774;--border:#E9E9E6;--primary-soft:#EEF3E8;}`,
  },
  {
    name: 'B-slate-cool',
    label: '冷调石板灰 Slate',
    css: `:root{--bg:#F4F6F8;--surface:#FFFFFF;--text:#1F2937;--muted:#64748B;--border:#E2E8F0;--primary-soft:#ECF3E6;}`,
  },
  {
    name: 'C-cream',
    label: '奶油米白 Cream',
    css: `:root{--bg:#FAF7F0;--surface:#FFFDF8;--text:#3D3A33;--muted:#8A857A;--border:#ECE7DC;--primary-soft:#EFF3E4;}`,
  },
  {
    name: 'D-dark',
    label: '墨绿深色 Dark',
    css: `:root{--bg:#23271F;--surface:#2C3127;--text:#ECEFE6;--muted:#9AA391;--border:#3A4033;--primary:#8FBC6E;--primary-dark:#7CA85F;--primary-soft:#37422C;--shadow:0 8px 24px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.3);--shadow-sm:0 2px 8px rgba(0,0,0,.35);}`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

for (const p of PALETTES) {
  await page.goto('http://localhost:4787/');
  await page.waitForFunction(() => window.__notopolis?.view === 'worldmap', { timeout: 15000 });
  await page.addStyleTag({ content: p.css });
  // 打开设置中心 → 配置模型（组件最全：菜单/开关/单选/输入/按钮/下拉）
  await page.click('#settings-btn');
  await page.click('#hub-menu-models');
  await page.waitForSelector('.st-save', { state: 'visible' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `.superpowers/e2e-artifacts/palette-${p.name}.png` });
  console.log(`✓ ${p.label} → palette-${p.name}.png`);
}

await browser.close();
