// 城市视图底色设计方向预览：对真实城市截图做「纸色替换」（近似色像素替换）
// 与「桌面装裱」两类处理，输出一张对比图。
// 用法：先生成 .superpowers/e2e-artifacts/citybase.png，再 node scripts/citybg-preview.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const img = readFileSync('.superpowers/e2e-artifacts/citybase.png').toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#E9EAEE; font-family:-apple-system,'PingFang SC',sans-serif; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; padding:24px; }
  .cell { background:#F2F3F6; border-radius:16px; padding:12px 12px 8px; }
  .cell h4 { margin:0 0 3px; font-size:14px; color:#16181A; }
  .cell p { margin:0 0 8px; font-size:11px; color:#84898F; }
  canvas, .deskwrap { display:block; border-radius:12px; }
</style></head><body><div class="grid" id="grid"></div>
<script>
const SRC = 'data:image/png;base64,${img}';
// 原纸色（sketch.ts PAPER.paper）
const PAPER = [0xf6, 0xf1, 0xe3];

const RECOLORS = [
  { name:'A · 现状 · 羊皮纸 #F6F1E3', desc:'暖黄纸感，手绘世界原味', to:null },
  { name:'B · 暖白纸 #F8F6F0', desc:'黄味减半：仍是纸，但与灰调 UI 不打架（推荐）', to:[0xF8,0xF6,0xF0] },
  { name:'C · 主题灰 #F2F3F6', desc:'与 UI 底完全一致：整体感最强，但手绘暖味被抽掉', to:[0xF2,0xF3,0xF6] },
  { name:'D · 冷调纸白 #F5F6F1', desc:'微微发青的纸：介于 B/C 之间', to:[0xF5,0xF6,0xF1] },
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
        if (dist < 900) { // 近似纸色的像素按距离比例过渡到目标色
          const t = 1 - dist / 900;
          px[i]   += (rc.to[0]-PAPER[0]) * t;
          px[i+1] += (rc.to[1]-PAPER[1]) * t;
          px[i+2] += (rc.to[2]-PAPER[2]) * t;
        }
      }
      ctx.putImageData(d, 0, 0);
    }
    cell.appendChild(cv); grid.appendChild(cell);
  }
  // E · 桌面装裱：地图保留原纸色，四周露出主题底 + 圆角与投影（像摊在桌面上的图纸）
  const cell = document.createElement('div'); cell.className = 'cell';
  cell.innerHTML = '<h4>E · 桌面装裱（不改画）</h4><p>地图保留羊皮纸原味，视口四周露出主题灰底+圆角投影：像摊在工作台上的一张图纸</p>';
  const wrap = document.createElement('canvas');
  wrap.width = W; wrap.height = H;
  const wctx = wrap.getContext('2d');
  wctx.fillStyle = '#F2F3F6'; wctx.fillRect(0, 0, W, H);
  const m = 14;
  wctx.save();
  wctx.shadowColor = 'rgba(22,24,26,.18)'; wctx.shadowBlur = 22; wctx.shadowOffsetY = 6;
  wctx.beginPath(); wctx.roundRect(m, m, W-2*m, H-2*m, 14); wctx.fillStyle = '#f6f1e3'; wctx.fill();
  wctx.restore();
  wctx.save();
  wctx.beginPath(); wctx.roundRect(m, m, W-2*m, H-2*m, 14); wctx.clip();
  wctx.drawImage(image, m, m, W-2*m, H-2*m);
  wctx.restore();
  cell.appendChild(wrap); grid.appendChild(cell);
  document.title = 'ready';
};
image.src = SRC;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1300 } });
await page.setContent(html);
await page.waitForFunction(() => document.title === 'ready', { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: '.superpowers/e2e-artifacts/citybg-preview.png', fullPage: true });
await browser.close();
console.log('✓ citybg-preview.png');
