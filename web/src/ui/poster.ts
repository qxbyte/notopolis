/**
 * ui/poster.ts — 城市海报导出（F8）。高分辨率整城 PNG + 底部标题栏。
 * 绕开 worldcanvas 分块，直接新建 canvas 全图渲染一次。
 */
import type { CityPainter } from '../render2d/citypainter';
import { PAPER } from '../render2d/sketch';
import { TIER } from './hud';

export interface PosterBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
export interface PosterMeta {
  name: string;
  tier: string;
  noteCount: number;
  activeCount7d: number;
  date: string; // YYYY-MM-DD，由调用方传入（事件处理器里取 new Date）
}

const FOOTER = 140;
const DISPLAY_FONT = `'Marker Felt', 'Bradley Hand', 'Hannotate SC', 'Chalkboard SE', cursive`;

/** 渲染海报为 PNG Blob；图像过大导致 toBlob 返回 null 时返回 null（调用方提示失败） */
export async function exportPoster(
  painter: CityPainter,
  bounds: PosterBounds,
  meta: PosterMeta,
): Promise<Blob | null> {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxZ - bounds.minZ;
  const ppu = Math.min(8, 8192 / Math.max(worldW, worldH));
  const W = Math.max(1, Math.ceil(worldW * ppu));
  const H = Math.max(1, Math.ceil(worldH * ppu));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H + FOOTER;
  const ctx = canvas.getContext('2d')!;

  // 纸底
  ctx.fillStyle = PAPER.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 城市（世界坐标 → 像素）
  ctx.save();
  ctx.setTransform(ppu, 0, 0, ppu, -bounds.minX * ppu, -bounds.minZ * ppu);
  painter.drawStatic(ctx);
  ctx.restore();

  drawFooter(ctx, W, H, meta);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function drawFooter(ctx: CanvasRenderingContext2D, W: number, H: number, meta: PosterMeta): void {
  // 背景 + 顶线
  ctx.fillStyle = '#fbf7ea';
  ctx.fillRect(0, H, W, FOOTER);
  ctx.strokeStyle = 'rgba(58,52,40,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H + 1);
  ctx.lineTo(W, H + 1);
  ctx.stroke();

  // 左：城名 + 副行
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3a3428';
  ctx.font = `64px ${DISPLAY_FONT}`;
  ctx.fillText(meta.name, 40, H + 74);
  ctx.fillStyle = '#8a8070';
  ctx.font = `26px ${DISPLAY_FONT}`;
  const tierLabel = TIER[meta.tier] ?? meta.tier;
  ctx.fillText(`${tierLabel} · ${meta.noteCount} 栋 · 近7天活跃 ${meta.activeCount7d}`, 42, H + 110);

  // 右：日期
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a8070';
  ctx.font = `26px ${DISPLAY_FONT}`;
  ctx.fillText(meta.date, W - 160, H + 110);

  // 右下：印章红方印
  const S = 72;
  const cx = W - 40 - S / 2;
  const cy = H + FOOTER / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-6 * Math.PI) / 180);
  ctx.fillStyle = '#c0453a';
  ctx.fillRect(-S / 2, -S / 2, S, S);
  ctx.fillStyle = '#fff';
  ctx.font = `44px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('城', 0, 2);
  ctx.restore();
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 文件名：notopolis-<name>-<date>.png（name 内空格/斜杠替换为 -） */
export function posterFilename(name: string, date: string): string {
  const safe = name.replace(/[\s/\\]+/g, '-');
  return `notopolis-${safe}-${date}.png`;
}
