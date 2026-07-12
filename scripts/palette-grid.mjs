// 生成四套背景配色的并排对比图（2×2 宫格，每格含色板条 + 组件小样）。
// 用法：node scripts/palette-grid.mjs
import { chromium } from '@playwright/test';

const PALETTES = [
  { key: 'A', label: 'A · 中性暖灰（Notion 风）', bg: '#F7F7F5', surface: '#FFFFFF', text: '#37352F', muted: '#787774', border: '#E9E9E6', soft: '#EEF3E8', primary: '#7CA85F', primaryDark: '#5F8A45' },
  { key: 'B', label: 'B · 冷调石板灰（Slate）', bg: '#F4F6F8', surface: '#FFFFFF', text: '#1F2937', muted: '#64748B', border: '#E2E8F0', soft: '#ECF3E6', primary: '#7CA85F', primaryDark: '#5F8A45' },
  { key: 'C', label: 'C · 奶油米白（Cream）', bg: '#FAF7F0', surface: '#FFFDF8', text: '#3D3A33', muted: '#8A857A', border: '#ECE7DC', soft: '#EFF3E4', primary: '#7CA85F', primaryDark: '#5F8A45' },
  { key: 'D', label: 'D · 墨绿深色（Dark）', bg: '#23271F', surface: '#2C3127', text: '#ECEFE6', muted: '#9AA391', border: '#3A4033', soft: '#37422C', primary: '#8FBC6E', primaryDark: '#7CA85F' },
];

const cell = (p) => `
<div class="cell" style="background:${p.bg};color:${p.text}">
  <div class="title" style="color:${p.text}">${p.label}</div>
  <div class="swatches">
    ${['bg', 'surface', 'border', 'soft', 'primary'].map((k) => {
      const v = { bg: p.bg, surface: p.surface, border: p.border, soft: p.soft, primary: p.primary }[k];
      return `<div class="sw"><div class="chip" style="background:${v};border:1px solid ${p.border}"></div><span style="color:${p.muted}">${k}<br>${v}</span></div>`;
    }).join('')}
  </div>
  <div class="card" style="background:${p.surface};border:1px solid ${p.border}">
    <div style="font-weight:600;font-size:15px">RAG 检索设计.md</div>
    <div style="color:${p.muted};font-size:12px;margin:6px 0 10px">01-AI · 3 片已入库 · 更新于 07-12</div>
    <div style="font-size:13px;line-height:1.7">混合检索：关键词精确召回 + 向量语义召回，RRF 融合重排后按相似度阈值过滤。</div>
    <input value="http://localhost:11434/v1" style="width:100%;box-sizing:border-box;margin:12px 0;background:${p.bg};border:1px solid ${p.border};border-radius:10px;color:${p.text};padding:8px 10px;font-size:12px" />
    <div class="row" style="background:${p.soft};color:${p.primaryDark};border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600">✓ 选中的列表项 / 菜单项</div>
    <div class="row" style="color:${p.text};padding:8px 12px;font-size:13px">普通列表项 <span style="color:${p.muted}">· 次要说明文字</span></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button style="background:${p.surface};border:1px solid ${p.border};color:${p.text};border-radius:10px;padding:7px 16px;font-size:13px">次要按钮</button>
      <button style="background:${p.primary};border:none;color:#fff;border-radius:10px;padding:7px 16px;font-size:13px;font-weight:600">保存</button>
    </div>
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; font-family:-apple-system,'PingFang SC',sans-serif; background:#888; }
  .grid { display:grid; grid-template-columns:1fr 1fr; }
  .cell { padding:26px 30px 30px; min-height:480px; box-sizing:border-box; }
  .title { font-size:16px; font-weight:700; margin-bottom:14px; }
  .swatches { display:flex; gap:14px; margin-bottom:16px; }
  .sw { font-size:10px; line-height:1.5; }
  .chip { width:44px; height:30px; border-radius:8px; margin-bottom:4px; }
  .card { border-radius:14px; padding:18px 20px; box-shadow:0 8px 24px rgba(0,0,0,.10); }
</style></head><body><div class="grid">${PALETTES.map(cell).join('')}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1020 } });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: '.superpowers/e2e-artifacts/palette-grid.png', fullPage: true });
await browser.close();
console.log('✓ palette-grid.png');
