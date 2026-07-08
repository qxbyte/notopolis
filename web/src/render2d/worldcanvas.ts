/**
 * render2d/worldcanvas.ts — 离屏世界图管理（分块 tiled offscreen canvas）。
 *
 * 将世界坐标系对应的画布分割为若干 tile，避免单个 canvas 超过浏览器的
 * 4096px 限制（MAX_PX = 4096，TILE_SIZE = 2048）。
 */

import type { Camera2D } from './camera2d';

const MAX_PX   = 4096;
const TILE_SIZE = 2048;

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** 该 tile 对应的世界宽度（单位）*/
  wWorld: number;
  /** 该 tile 对应的世界高度（单位）*/
  hWorld: number;
}

export interface TileBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WorldCanvas {
  paint(fn: (ctx: CanvasRenderingContext2D, tileBounds: TileBounds) => void): void;
  blit(ctx: CanvasRenderingContext2D, camera: Camera2D): void;
  tiles(): { count: number; pxSize: number };
}

export function createWorldCanvas(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  pxPerUnit = 8,
): WorldCanvas {
  const { minX, minZ, maxX, maxZ } = bounds;

  const totalW = (maxX - minX) * pxPerUnit;
  const totalH = (maxZ - minZ) * pxPerUnit;

  let tilesX: number;
  let tilesZ: number;
  let tileW_px: number;  // 单块 tile 的像素宽度（用于 tiles().pxSize）

  if (totalW <= MAX_PX && totalH <= MAX_PX) {
    tilesX = 1;
    tilesZ = 1;
    tileW_px = totalW;
  } else {
    tilesX = Math.ceil(totalW / TILE_SIZE);
    tilesZ = Math.ceil(totalH / TILE_SIZE);
    tileW_px = TILE_SIZE;
  }

  const tileWorldW = (maxX - minX) / tilesX;  // 每块 tile 的世界宽度
  const tileWorldH = (maxZ - minZ) / tilesZ;  // 每块 tile 的世界高度

  const tileList: Tile[] = [];

  for (let iz = 0; iz < tilesZ; iz++) {
    for (let ix = 0; ix < tilesX; ix++) {
      const tMinX = minX + ix * tileWorldW;
      const tMinZ = minZ + iz * tileWorldH;
      const tMaxX = tMinX + tileWorldW;
      const tMaxZ = tMinZ + tileWorldH;

      const tPxW = Math.round((tMaxX - tMinX) * pxPerUnit);
      const tPxH = Math.round((tMaxZ - tMinZ) * pxPerUnit);

      const canvas = document.createElement('canvas');
      canvas.width  = tPxW;
      canvas.height = tPxH;

      const ctx = canvas.getContext('2d')!;

      tileList.push({
        canvas,
        ctx,
        minX: tMinX,
        minZ: tMinZ,
        maxX: tMaxX,
        maxZ: tMaxZ,
        wWorld: tMaxX - tMinX,
        hWorld: tMaxZ - tMinZ,
      });
    }
  }

  return {
    paint(fn: (ctx: CanvasRenderingContext2D, tileBounds: TileBounds) => void): void {
      for (const tile of tileList) {
        const ctx = tile.ctx;
        // 设置世界坐标变换：世界坐标 → tile 像素坐标
        ctx.setTransform(
          pxPerUnit, 0,
          0, pxPerUnit,
          -tile.minX * pxPerUnit,
          -tile.minZ * pxPerUnit,
        );
        fn(ctx, {
          minX: tile.minX,
          minZ: tile.minZ,
          maxX: tile.maxX,
          maxZ: tile.maxZ,
        });
      }
    },

    blit(ctx: CanvasRenderingContext2D, camera: Camera2D): void {
      camera.apply(ctx);
      for (const tile of tileList) {
        ctx.drawImage(tile.canvas, tile.minX, tile.minZ, tile.wWorld, tile.hWorld);
      }
    },

    tiles(): { count: number; pxSize: number } {
      return {
        count:  tileList.length,
        pxSize: tileW_px,
      };
    },
  };
}
