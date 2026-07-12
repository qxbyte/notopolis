/**
 * render2d/vectormarks.ts — 「藏书阁」屋顶饰：已向量化建筑的地图可视化。
 * 已入库（含过期待更新）的笔记，其建筑屋顶上方画一本摊开的小书——
 * 城市俯瞰即可看出知识库的向量化覆盖程度。
 * collectVectorMarks 为纯函数（可单测）；绘制走 cityview2d 每帧覆盖层，
 * 不改静态地图管线（RAG 未启用时集合为空，地图与原版完全一致）。
 */
import type { CityModel } from '@shared/types';
import { footprintR } from './citypainter';

export interface VectorMark {
  x: number;
  z: number;
}

/** 收集已向量化建筑的标记位置（屋顶上方） */
export function collectVectorMarks(city: CityModel, indexedPaths: Set<string>): VectorMark[] {
  const out: VectorMark[] = [];
  if (indexedPaths.size === 0) return out;
  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (indexedPaths.has(b.notePath)) {
        out.push({ x: b.x, z: b.z - footprintR(b) - 0.9 });
      }
    }
  }
  return out;
}

/** 手绘风摊开小书（世界坐标，约 1.6×0.7 单位；与地图墨色/纸色同源） */
export function drawBookMark(ctx: CanvasRenderingContext2D, x: number, z: number): void {
  ctx.save();
  ctx.lineWidth = 0.14;
  ctx.strokeStyle = '#3a3428';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#fdf8ee';
  // 左页
  ctx.beginPath();
  ctx.moveTo(x, z - 0.18);
  ctx.quadraticCurveTo(x - 0.45, z - 0.42, x - 0.8, z - 0.3);
  ctx.lineTo(x - 0.8, z + 0.1);
  ctx.quadraticCurveTo(x - 0.45, z - 0.02, x, z + 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 右页（镜像）
  ctx.beginPath();
  ctx.moveTo(x, z - 0.18);
  ctx.quadraticCurveTo(x + 0.45, z - 0.42, x + 0.8, z - 0.3);
  ctx.lineTo(x + 0.8, z + 0.1);
  ctx.quadraticCurveTo(x + 0.45, z - 0.02, x, z + 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 书脊
  ctx.beginPath();
  ctx.moveTo(x, z - 0.18);
  ctx.lineTo(x, z + 0.22);
  ctx.stroke();
  ctx.restore();
}
