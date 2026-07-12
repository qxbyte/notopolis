// 世界地图背景设计方向预览：6 种处理并排渲染成一张对比图。
// 用法：node scripts/mapbg-preview.mjs → .superpowers/e2e-artifacts/mapbg-preview.png
import { chromium } from '@playwright/test';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#E9EAEE; font-family:-apple-system,'PingFang SC',sans-serif; }
  .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:22px; padding:26px; }
  .cell { background:#F2F3F6; border-radius:16px; padding:14px 14px 10px; }
  .cell h4 { margin:0 0 4px; font-size:14px; color:#16181A; }
  .cell p { margin:0 0 10px; font-size:11px; color:#84898F; }
  canvas { display:block; border-radius:14px; }
</style></head><body><div class="grid" id="grid"></div>
<script>
const W = 430, H = 280;
const DESIGNS = [
  { key:'dots',     name:'A · 点阵网格（现状）', desc:'Figma/白板工具质感，克制中性' },
  { key:'grid',     name:'B · 细线方格',        desc:'蓝图/坐标纸感，理性工程气质' },
  { key:'contour',  name:'C · 等高线地形',      desc:'呼应「世界地图」语义，最有叙事感' },
  { key:'aurora',   name:'D · 柔光渐晕',        desc:'主色+浅蓝大模糊光斑，现代 hero 风' },
  { key:'graticule',name:'E · 经纬网',          desc:'地球仪投影弧线，制图学隐喻' },
  { key:'minimal',  name:'F · 纯净留白',        desc:'无纹理，内容优先，最安静' },
];

function board(ctx){ // 白板底
  ctx.fillStyle='#F2F3F6'; ctx.fillRect(0,0,W,H);
  ctx.save();
  ctx.shadowColor='rgba(22,24,26,.10)'; ctx.shadowBlur=18; ctx.shadowOffsetY=5;
  ctx.beginPath(); ctx.roundRect(12,12,W-24,H-24,14);
  ctx.fillStyle='#FFFFFF'; ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.roundRect(12,12,W-24,H-24,14);
  ctx.strokeStyle='#E5E7EB'; ctx.lineWidth=1; ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.roundRect(12,12,W-24,H-24,14); ctx.clip();
}

function stamps(ctx){ // 两枚手绘风城邦印章 + 虚线 + 标签
  ctx.restore(); // 退出 clip
  const pts=[[W*0.38,H*0.36],[W*0.62,H*0.66]];
  ctx.strokeStyle='#84898F'; ctx.globalAlpha=.5; ctx.setLineDash([5,5]); ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); ctx.lineTo(pts[1][0],pts[1][1]); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha=1;
  for(const [x,y] of pts){
    ctx.fillStyle='#D4A76A'; ctx.strokeStyle='#3a3428'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.rect(x-8,y-6,13,12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-10,y-6); ctx.lineTo(x+6,y-6); ctx.lineTo(x-2,y-15);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x+9,y-3,5,0,7); ctx.fillStyle='#A9C48C'; ctx.fill();
    ctx.lineWidth=1; ctx.stroke();
  }
  ctx.font='600 12px -apple-system, PingFang SC'; ctx.textAlign='center'; ctx.fillStyle='#16181A';
  ctx.fillText('knowledge-base', pts[0][0], pts[0][1]+26);
  ctx.fillText('Notes', pts[1][0], pts[1][1]+26);
}

const PATTERNS = {
  dots(ctx){ ctx.fillStyle='#E5E7EB';
    for(let x=28;x<W-20;x+=20) for(let y=28;y<H-20;y+=20){ ctx.beginPath(); ctx.arc(x,y,1.1,0,7); ctx.fill(); } },
  grid(ctx){ ctx.strokeStyle='rgba(22,24,26,.055)'; ctx.lineWidth=1;
    for(let x=32;x<W-12;x+=24){ ctx.beginPath(); ctx.moveTo(x,12); ctx.lineTo(x,H-12); ctx.stroke(); }
    for(let y=32;y<H-12;y+=24){ ctx.beginPath(); ctx.moveTo(12,y); ctx.lineTo(W-12,y); ctx.stroke(); } },
  contour(ctx){ ctx.strokeStyle='rgba(22,24,26,.07)'; ctx.lineWidth=1.1;
    const blobs=[[W*.3,H*.4,5],[W*.72,H*.6,4],[W*.55,H*.15,3]];
    for(const [cx,cy,n] of blobs) for(let k=1;k<=n;k++){
      ctx.beginPath();
      for(let a=0;a<=64;a++){ const t=a/64*Math.PI*2;
        const r=k*17+Math.sin(t*3+cx)*6+Math.cos(t*5+cy)*4;
        const px=cx+Math.cos(t)*r*1.25, py=cy+Math.sin(t)*r*0.85;
        a?ctx.lineTo(px,py):ctx.moveTo(px,py); }
      ctx.closePath(); ctx.stroke(); } },
  aurora(ctx){
    const g1=ctx.createRadialGradient(W*.28,H*.3,0,W*.28,H*.3,190);
    g1.addColorStop(0,'rgba(220,242,49,.32)'); g1.addColorStop(1,'rgba(220,242,49,0)');
    ctx.fillStyle=g1; ctx.fillRect(12,12,W-24,H-24);
    const g2=ctx.createRadialGradient(W*.75,H*.72,0,W*.75,H*.72,200);
    g2.addColorStop(0,'rgba(201,213,248,.5)'); g2.addColorStop(1,'rgba(201,213,248,0)');
    ctx.fillStyle=g2; ctx.fillRect(12,12,W-24,H-24); },
  graticule(ctx){ ctx.strokeStyle='rgba(22,24,26,.06)'; ctx.lineWidth=1;
    const cx=W/2, cy=H/2;
    for(let r=40;r<W;r+=44){ ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.stroke(); }
    for(let k=-3;k<=3;k++){ ctx.beginPath(); ctx.ellipse(cx,cy,Math.abs(k)*38+14,H*0.42,0,0,7); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(12,cy); ctx.lineTo(W-12,cy); ctx.stroke(); },
  minimal(){ /* 留白 */ },
};

const grid=document.getElementById('grid');
for(const d of DESIGNS){
  const cell=document.createElement('div'); cell.className='cell';
  cell.innerHTML='<h4>'+d.name+'</h4><p>'+d.desc+'</p>';
  const cv=document.createElement('canvas');
  cv.width=W*2; cv.height=H*2; cv.style.width=W+'px'; cv.style.height=H+'px';
  const ctx=cv.getContext('2d'); ctx.scale(2,2);
  board(ctx); PATTERNS[d.key](ctx); stamps(ctx);
  cell.appendChild(cv); grid.appendChild(cell);
}
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1450, height: 720 } });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: '.superpowers/e2e-artifacts/mapbg-preview.png', fullPage: true });
await browser.close();
console.log('✓ mapbg-preview.png');
