// 城市图纸冷色系底色预览：对真实城市截图做近似色像素替换，四档冷度对比。
// 用法：先生成 .superpowers/e2e-artifacts/citybase2.png，再 node scripts/citycool-preview.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const img = readFileSync('.superpowers/e2e-artifacts/citybase2.png').toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#E9EAEE; font-family:-apple-system,'PingFang SC',sans-serif; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; padding:24px; }
  .cell { background:#F2F3F6; border-radius:16px; padding:12px 12px 8px; }
  .cell h4 { margin:0 0 3px; font-size:14px; color:#16181A; }
  .cell p { margin:0 0 8px; font-size:11px; color:#84898F; }
  canvas { display:block; border-radius:12px; }
</style></head><body><div class="grid" id="grid"></div>
<script>
const SRC = 'data:image/png;base64,${img}';
const PAPER = [0xf8, 0xf6, 0xf0]; // 当前暖白纸

const RECOLORS = [
  { name:'A · 现状 · 暖白纸 #F8F6F0', desc:'当前效果（微暖）', to:null },
  { name:'B · 冷灰白 #F2F3F6', desc:'与 UI 桌面同源：图纸与工具壳融为一体', to:[0xF2,0xF3,0xF6] },
  { name:'C · 雾蓝 #EEF3F8', desc:'清晰的冷蓝倾向：清爽、最「冷」，与河流呼应', to:[0xEE,0xF3,0xF8] },
  { name:'D · 青瓷 #EFF4F0', desc:'冷中带绿：与树木/草地同族，最耐看', to:[0xEF,0xF4,0xF0] },
];

const grid = document.getElementById('grid');
const image = new Image();
image.onload = () => {
  const W = 560, H = Math.round(560 * image.height / image.width);
  for (const rc of RECOLORS) {
    const cell = document.createElement('div'); cell.className = 'cell';
    cell.innerHTML = '<h4>'+rc.name+'</h4><p>'+rc.desc+'</p>';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(image, 0, 0, W, H);
    if (rc.to) {
      const d = ctx.getImageData(0, 0, W, H);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const dr = px[i]-PAPER[0], dg = px[i+1]-PAPER[1], db = px[i+2]-PAPER[2];
        const dist = dr*dr + dg*dg + db*db;
        if (dist < 700) {
          const t = 1 - dist / 700;
          px[i]   += (rc.to[0]-PAPER[0]) * t;
          px[i+1] += (rc.to[1]-PAPER[1]) * t;
          px[i+2] += (rc.to[2]-PAPER[2]) * t;
        }
      }
      ctx.putImageData(d, 0, 0);
    }
    cell.appendChild(cv); grid.appendChild(cell);
  }
  document.title = 'ready';
};
image.src = SRC;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1000 } });
await page.setContent(html);
await page.waitForFunction(() => document.title === 'ready', { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: '.superpowers/e2e-artifacts/citycool-preview.png', fullPage: true });
await browser.close();
console.log('✓ citycool-preview.png');
