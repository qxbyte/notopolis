/**
 * views/cityview2d.ts
 * 2D 城市视图 — 使用 render2d 层取代 Three.js。
 */

import { worldParams } from '../world/params';
import { createWorldCanvas } from '../render2d/worldcanvas';
import { paintCity } from '../render2d/citypainter';
import { createDynamicLayer } from '../render2d/dynamic';
import { createCamera2D } from '../render2d/camera2d';
import { hitTest } from '../render2d/hit';
import type { HitItem } from '../render2d/hit';
import { createHUD, TIER } from '../ui/hud';
import { createCards } from '../ui/cards';
import { PAPER } from '../render2d/sketch';
import type { WorldVault } from '../api';
import type { CityModel, District } from '@shared/types';

export interface CityViewHandle {
  dispose(): void;
  /** 可拾取对象数量（供调试钩子读取） */
  pickableCount: number;
  /** 对 pickables[index] 触发等价于鼠标点击的卡片显示 */
  triggerPick(index: number): void;
  /** 性能探针：帧时间统计（供调试钩子读取） */
  perf(): Record<string, number>;
}

export function showCity2D(
  container: HTMLElement,
  vault: WorldVault,
  city: CityModel,
  onBack: () => void,
): CityViewHandle {
  // ---- 1. 计算城市几何尺寸 ----
  const xs = city.districts.flatMap((d) => [d.x, d.x + d.width]);
  const zs = city.districts.flatMap((d) => [d.z, d.z + d.depth]);
  const cityMinX = Math.min(...xs, -10);
  const cityMaxX = Math.max(...xs, 10);
  const cityMinZ = Math.min(...zs, -10);
  const cityMaxZ = Math.max(...zs, 10);
  const minX = cityMinX;
  const maxX = cityMaxX;
  const minZ = cityMinZ;
  const maxZ = cityMaxZ;

  // 城市 bbox（含 10% 余量），用于初始镜头 fit
  const cityPadX = (cityMaxX - cityMinX) * 0.1;
  const cityPadZ = (cityMaxZ - cityMinZ) * 0.1;
  const cityFitBounds = {
    minX: cityMinX - cityPadX,
    maxX: cityMaxX + cityPadX,
    minZ: cityMinZ - cityPadZ,
    maxZ: cityMaxZ + cityPadZ,
  };
  const cityHalfW = (maxX - minX) / 2;
  const cityHalfD = (maxZ - minZ) / 2;
  const worldR = Math.max(cityHalfW, cityHalfD) + 14;
  const T = Math.max(320, worldR * 6);

  // ---- 2. 扩展地图边界（含世界背景区域）----
  const expand = Math.max(120, worldR * 2);
  const expandedBounds = {
    minX: minX - expand,
    minZ: minZ - expand,
    maxX: maxX + expand,
    maxZ: maxZ + expand,
  };

  // ---- 3. 世界参数 ----
  const wsPrefix = 'world:' + vault.path;
  const params = worldParams(vault.path, cityHalfW, cityHalfD, worldR, T);

  // ---- 4. 离屏世界画布（8 ppu）----
  const world = createWorldCanvas(expandedBounds, 8);

  // ---- 5. 绘制静态城市（一次性）----
  const paintStart = performance.now();
  const hitItems: HitItem[] = paintCity(world, city, params, wsPrefix);
  const paintMs = Math.round((performance.now() - paintStart) * 10) / 10;

  // ---- 6. 公园列表（供动态层）----
  const parks = city.districts
    .filter((d: District) => d.isInbox || d.buildings.length < 3)
    .map((d: District) => {
      const poly = d.polygon;
      let bboxMinX = Infinity, bboxMinZ = Infinity, bboxMaxX = -Infinity, bboxMaxZ = -Infinity;
      for (const [px, pz] of poly) {
        bboxMinX = Math.min(bboxMinX, px);
        bboxMinZ = Math.min(bboxMinZ, pz);
        bboxMaxX = Math.max(bboxMaxX, px);
        bboxMaxZ = Math.max(bboxMaxZ, pz);
      }
      const cx = (bboxMinX + bboxMaxX) / 2;
      const cz = (bboxMinZ + bboxMaxZ) / 2;
      const dx = bboxMaxX - bboxMinX;
      const dz = bboxMaxZ - bboxMinZ;
      const r = Math.sqrt(dx * dx + dz * dz) / 2;
      return { x: cx, z: cz, r };
    });

  // ---- 7. 动态层 ----
  const dynLayer = createDynamicLayer(city, params, wsPrefix, parks);

  // ---- 8. 全屏 canvas ----
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  // ---- 9. 相机（初始 fit 城市 bbox，平移钳制用大世界 bounds）----
  const camera = createCamera2D(canvas, expandedBounds, cityFitBounds);

  // ---- 10. HUD + 返回按钮 ----
  const hud = createHUD(container);
  const tierLabel = TIER[city.tier] ?? city.tier;
  hud.setStats(
    `${vault.name} · ${tierLabel} · ${city.noteCount} 栋建筑 · 近7天活跃 ${city.activeCount7d}`,
  );
  hud.setTip('左键拖拽 平移地图 · 滚轮 缩放 · 点击建筑看笔记');

  const backBtn = document.createElement('button');
  backBtn.id = 'back-btn';
  backBtn.textContent = '← 返回世界地图';
  backBtn.addEventListener('click', onBack);
  container.appendChild(backBtn);

  // ---- 11. 标签 ----
  let labelEl = container.querySelector<HTMLElement>('#label');
  if (!labelEl) {
    labelEl = document.createElement('div');
    labelEl.id = 'label';
    labelEl.style.display = 'none';
    container.appendChild(labelEl);
  }

  // ---- 12. 信息卡 ----
  const cards = createCards(container);

  // ---- 13. 帧时间统计 ----
  const frameTimes: number[] = [];
  let lastFrameT = 0;

  // ---- 14. RAF 循环 ----
  let animId: number;

  function loop(t: number): void {
    animId = requestAnimationFrame(loop);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 先以纸底色填满整个 canvas（世界图边界外也是纸面，而不是透明/蓝色）
    ctx.fillStyle = PAPER.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // blit 内部会调用 camera.apply，绘制完毕后 camera transform 保持激活
    world.blit(ctx, camera);

    // 动态层在 camera transform 下以世界坐标绘制
    dynLayer.draw(ctx, t * 0.001);

    ctx.restore();

    if (lastFrameT > 0) {
      frameTimes.push(t - lastFrameT);
      if (frameTimes.length > 240) frameTimes.shift();
    }
    lastFrameT = t;
  }

  animId = requestAnimationFrame(loop);

  // ---- 15. 点击 ----
  function onClick(e: MouseEvent): void {
    if (camera.consumeDragMoved()) return;
    const [wx, wz] = camera.screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    const item = hitTest(wx, wz, hitItems);
    if (!item) {
      cards.hide();
      return;
    }
    if (item.kind === 'building') {
      const d = item.data as { type: 'building'; b: import('@shared/types').Building; dir: string };
      cards.showBuilding(d.b, d.dir, vault.path);
    } else if (item.kind === 'district') {
      const d = item.data as { type: 'district'; district: import('@shared/types').District };
      cards.showDistrict(d.district, Date.now());
    }
  }

  // ---- 16. Hover ----
  function onMouseMove(e: MouseEvent): void {
    const [wx, wz] = camera.screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    const item = hitTest(wx, wz, hitItems);
    if (item && item.kind === 'building') {
      const d = item.data as { type: 'building'; b: import('@shared/types').Building; dir: string };
      if (labelEl) {
        labelEl.textContent = d.b.title;
        labelEl.style.display = 'block';
        labelEl.style.left = e.offsetX + 14 + 'px';
        labelEl.style.top = e.offsetY + 8 + 'px';
      }
    } else {
      if (labelEl) labelEl.style.display = 'none';
    }
  }

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMouseMove);

  // ---- 17. Resize ----
  function onResize(): void {
    canvas.width  = container.clientWidth  * dpr;
    canvas.height = container.clientHeight * dpr;
  }
  window.addEventListener('resize', onResize);

  return {
    pickableCount: hitItems.filter((i) => i.kind === 'building').length,

    perf(): Record<string, number> {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
      return {
        avgMs: Math.round(avg * 10) / 10,
        p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
        fps: avg ? Math.round(1000 / avg) : 0,
        paintMs,
        hitItems: hitItems.length,
      };
    },

    triggerPick(index: number): void {
      const buildings = hitItems.filter((i) => i.kind === 'building');
      if (index < 0 || index >= buildings.length) return;
      const item = buildings[index];
      const d = item.data as { type: 'building'; b: import('@shared/types').Building; dir: string };
      cards.showBuilding(d.b, d.dir, vault.path);
    },

    dispose(): void {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      camera.dispose();
      canvas.remove();
      hud.root.remove();
      const tip = container.querySelector('#tip');
      if (tip) tip.remove();
      const card = container.querySelector('#card');
      if (card) card.remove();
      const label = container.querySelector('#label');
      if (label) label.remove();
      backBtn.remove();
    },
  };
}
