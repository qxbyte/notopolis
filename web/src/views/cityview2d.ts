/**
 * views/cityview2d.ts
 * 2D 城市视图 — 使用 render2d 层取代 Three.js。
 */

import { worldParams } from '../world/params';
import { createWorldCanvas } from '../render2d/worldcanvas';
import { paintCity, buildCityPainter } from '../render2d/citypainter';
import type { CityPainter, CityPOI } from '../render2d/citypainter';
import { createDynamicLayer } from '../render2d/dynamic';
import { createCamera2D } from '../render2d/camera2d';
import { hitTest } from '../render2d/hit';
import type { HitItem } from '../render2d/hit';
import { createHUD, TIER } from '../ui/hud';
import { createCards } from '../ui/cards';
import { PAPER, setSketchScale } from '../render2d/sketch';
import type { WorldVault } from '../api';
import type { CityModel, District } from '@shared/types';

/** 基础 ppu（8px/世界单位）× 1.15：超过此缩放比例时启用高清矢量重绘 */
const HI_THRESHOLD = 8 * 1.15;

export interface CityViewHandle {
  dispose(): void;
  /** 可拾取对象数量（供调试钩子读取） */
  pickableCount: number;
  /** 对 pickables[index] 触发等价于鼠标点击的卡片显示 */
  triggerPick(index: number): void;
  /** 性能探针：帧时间统计（供调试钩子读取） */
  perf(): Record<string, number>;
  /** 编程式定位镜头（调试/截图用） */
  centerOn(x: number, z: number, zoomPx: number): void;
  /** 兴趣点坐标（park/zoo/wetland 等，调试/截图用） */
  pois: { x: number; z: number; r: number; kind: string }[];
  /** 第 i 列火车当前车头位置（调试用） */
  debugTrainPos(i: number): { x: number; z: number } | null;
  /** 飞机当前位置（调试用） */
  debugPlanePos(): { x: number; z: number; airborne: boolean } | null;
}

export function showCity2D(
  container: HTMLElement,
  vault: WorldVault,
  city: CityModel,
  onBack: () => void,
): CityViewHandle {
  // 手绘原语按世界单位作画（1 单位 ≈ 8px 离屏像素），像素调校的默认手感需统一换算
  setSketchScale(0.15);

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

  // 城市 bbox（含 12% 余量——入城第一眼能看到周边地貌：海岸/山脉/雪原），用于初始镜头 fit
  const cityPadX = (cityMaxX - cityMinX) * 0.12;
  const cityPadZ = (cityMaxZ - cityMinZ) * 0.12;
  const cityFitBounds = {
    minX: cityMinX - cityPadX,
    maxX: cityMaxX + cityPadX,
    minZ: cityMinZ - cityPadZ,
    maxZ: cityMaxZ + cityPadZ,
  };
  const cityHalfW = (maxX - minX) / 2;
  const cityHalfD = (maxZ - minZ) / 2;
  const worldR = Math.max(cityHalfW, cityHalfD) + 14;
  // T 收缩到 2×worldR：城区（含区间荒野）占满全境地图，只留窄荒野边环
  const T = Math.max(320, worldR * 2);

  // ---- 2. 扩展地图边界（含世界背景区域）----
  const expand = Math.max(80, worldR * 0.55);
  const expandedBounds = {
    minX: minX - expand,
    minZ: minZ - expand,
    maxX: maxX + expand,
    maxZ: maxZ + expand,
  };

  // ---- 3. 世界参数 ----
  const wsPrefix = 'world:' + vault.path;
  // 将各 district 的 bbox 中心+半径传入，供运河避让聚落使用
  const districtSettlements = city.districts.map((d: District) => {
    const cx = d.x + d.width / 2;
    const cz = d.z + d.depth / 2;
    const r = Math.max(d.width, d.depth) / 2;
    return { x: cx, z: cz, r };
  });
  const params = worldParams(vault.path, cityHalfW, cityHalfD, worldR, T, city.theme, districtSettlements);

  // ---- 4. 离屏世界画布（8 ppu）----
  const world = createWorldCanvas(expandedBounds, 8);

  // ---- 5. 构建城市 painter 并绘制到低分辨率 worldcanvas ----
  const paintStart = performance.now();
  const painter: CityPainter = buildCityPainter(city, params, wsPrefix);
  const hitItems: HitItem[] = painter.hitItems;
  // 低分辨率离屏 blit（8ppu 质量，交互流畅用）
  world.paint((ctx) => painter.drawStatic(ctx));
  const paintMs = Math.round((performance.now() - paintStart) * 10) / 10;

  // ---- 6. 公园列表（供动态层）——从 painter.pois 获取（精确坐标）----
  // 注意：painter.pois 在 world.paint（第一次 drawStatic）后已填充

  // ---- 7. 动态层 ----
  const dynLayer = createDynamicLayer(city, params, wsPrefix, painter.pois);

  // ---- 8. 全屏 canvas ----
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  // ---- 8b. 高清矢量层 canvas（与主 canvas 同尺寸）----
  // 当 camera.zoom > HI_THRESHOLD（8×1.15 device-px/世界单位）时，
  // 镜头静止后用原生分辨率矢量重绘，避免 blit 拉伸模糊。
  let hiCanvas = document.createElement('canvas');
  hiCanvas.width = canvas.width;
  hiCanvas.height = canvas.height;
  let hiCtx = hiCanvas.getContext('2d')!;
  let hiValid = false;   // true = hiCanvas 内容有效，可直接 blit
  let hiMs = 0;          // 最近一次 settle 渲染耗时（ms）
  let hiSettleTimer: ReturnType<typeof setTimeout> | null = null;

  /** 执行一次 settle 渲染：清空 hiCanvas → setTransform → drawStatic */
  function doSettleRender(): void {
    const t0 = performance.now();
    hiCtx.setTransform(1, 0, 0, 1, 0, 0);
    hiCtx.clearRect(0, 0, hiCanvas.width, hiCanvas.height);
    // 应用与主画布相机一致的世界坐标变换
    camera.apply(hiCtx);
    painter.drawStatic(hiCtx);
    hiMs = Math.round((performance.now() - t0) * 10) / 10;
    hiValid = true;
  }

  /** 每次相机变化：失效 hiCanvas，防抖 160ms 后执行 settle 渲染 */
  function scheduleSettle(): void {
    hiValid = false;
    if (hiSettleTimer !== null) clearTimeout(hiSettleTimer);
    hiSettleTimer = setTimeout(() => {
      hiSettleTimer = null;
      if (camera.zoom > HI_THRESHOLD) {
        doSettleRender();
      }
    }, 160);
  }

  // ---- 9. 相机（初始 fit 城市 bbox，平移钳制用大世界 bounds）----
  const camera = createCamera2D(canvas, expandedBounds, cityFitBounds);

  // 注册相机变化监听
  camera.onChange(scheduleSettle);

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

    if (hiValid && camera.zoom > HI_THRESHOLD) {
      // 高清矢量层有效：直接 blit hiCanvas（像素对像素，无缩放）
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(hiCanvas, 0, 0);
      // 动态层仍在相机变换下以世界坐标绘制
      camera.apply(ctx);
    } else {
      // 低分辨率 blit（交互中或 zoom 未超阈值）
      // blit 内部会调用 camera.apply，绘制完毕后 camera transform 保持激活
      world.blit(ctx, camera);
    }

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
    // 重建 hiCanvas 以匹配新的 viewport 尺寸
    hiCanvas = document.createElement('canvas');
    hiCanvas.width  = canvas.width;
    hiCanvas.height = canvas.height;
    hiCtx = hiCanvas.getContext('2d')!;
    hiValid = false;
    scheduleSettle();
  }
  window.addEventListener('resize', onResize);

  return {
    pickableCount: hitItems.filter((i) => i.kind === 'building').length,

    centerOn(x: number, z: number, zoomPx: number): void {
      camera.setView(x, z, zoomPx);
    },

    pois: painter.pois,

    debugPlanePos(): { x: number; z: number; airborne: boolean } | null {
      return dynLayer.debugPlanePos();
    },
    debugTrainPos(i: number): { x: number; z: number } | null {
      return dynLayer.debugTrainPos(i);
    },

    perf(): Record<string, number> {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
      return {
        avgMs: Math.round(avg * 10) / 10,
        p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
        fps: avg ? Math.round(1000 / avg) : 0,
        paintMs,
        hitItems: hitItems.length,
        hiMs,   // 最近一次 settle 渲染耗时（ms），0 表示尚未触发
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
      if (hiSettleTimer !== null) {
        clearTimeout(hiSettleTimer);
        hiSettleTimer = null;
      }
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
