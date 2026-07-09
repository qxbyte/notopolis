/**
 * views/cityview2d.ts
 * 2D 城市视图 — 使用 render2d 层取代 Three.js。
 */

import { worldParams } from '../world/params';
import { createWorldCanvas } from '../render2d/worldcanvas';
import { paintCity, buildCityPainter, footprintR } from '../render2d/citypainter';
import type { CityPainter, CityPOI } from '../render2d/citypainter';
import { createDynamicLayer } from '../render2d/dynamic';
import { createCamera2D } from '../render2d/camera2d';
import { hitTest } from '../render2d/hit';
import type { HitItem } from '../render2d/hit';
import { createHUD, TIER } from '../ui/hud';
import { createCards } from '../ui/cards';
import { createSearchUI } from '../ui/search';
import { searchNotes, type SearchItem } from '../util/search';
import { createTaskPanel } from '../ui/taskpanel';
import { createGardenPanel } from '../ui/gardenpanel';
import { groupTasks, totalConstruction } from '../util/tasks';
import { obsidianUri } from '../ui/obsidian';
import { LENSES, lensById, gardenSetOf, lensHitBuildings, type LensId } from '../render2d/lenses';
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
  /** 镜头飞行动画（缓动到目标 center/zoom） */
  flyTo(x: number, z: number, zoomPx: number, durMs?: number): void;
  /** 按 notePath 拾取建筑并展示信息卡；命中返回 true */
  pickByPath(notePath: string): boolean;
  /** 定位到建筑：飞行 + 高亮 + 卡片；命中返回 true */
  locate(notePath: string): boolean;
  /** 打开搜索浮层 */
  openSearch(): void;
  /** 搜索命中（调试/测试用） */
  search(query: string): { notePath: string; title: string; dir: string; score: number }[];
  /** 打开/关闭工地面板 */
  openTaskPanel(): void;
  closeTaskPanel(): void;
  taskPanelOpen(): boolean;
  /** 切换透镜图层 */
  setLens(id: LensId): void;
  /** 当前透镜命中的 notePath 列表 */
  lensHits(): string[];
  /** 打开园丁面板（并激活 garden 透镜） */
  openGardenPanel(): void;
  /** 沿链接漫游到目标建筑（飞行 + 高亮 + 卡片刷新） */
  navigateLink(notePath: string): void;
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
  // 世界矩形按窗口纵横比（16:9 等），铺满窗口不露界外纸面；
  // 高度取 max(±T, 城市 bbox+expand)：湖泊/海岸/机场都生成在 ±T 内，必须完整覆盖
  const expand = Math.max(80, worldR * 0.35);
  const aspect = Math.max(1, container.clientWidth / Math.max(1, container.clientHeight));
  const halfZ = Math.max(T, Math.max(-minZ, maxZ) + expand);
  const halfX = Math.max(halfZ * aspect, Math.max(-minX, maxX) + expand);
  const expandedBounds = {
    minX: -halfX,
    minZ: -halfZ,
    maxX: halfX,
    maxZ: halfZ,
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
  const painter: CityPainter = buildCityPainter(city, params, wsPrefix, expandedBounds);
  const hitItems: HitItem[] = painter.hitItems;

  // 建筑扁平索引：notePath → { 建筑, 区名 }（搜索/定位/链接漫游共用）
  const buildingIndex = new Map<string, { b: import('@shared/types').Building; dir: string }>();
  for (const d of city.districts) {
    for (const b of d.buildings) buildingIndex.set(b.notePath, { b, dir: d.dir });
  }

  // 反向链接索引：notePath → 引用它的 notePath[]（F6 链接漫游用）
  const inlinkSources = new Map<string, string[]>();
  for (const { b } of buildingIndex.values()) {
    for (const t of b.outlinks) {
      const arr = inlinkSources.get(t);
      if (arr) arr.push(b.notePath);
      else inlinkSources.set(t, [b.notePath]);
    }
  }
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

  // ---- 9b. 镜头飞行动画 + 建筑高亮环（M0 基础设施）----
  let camAnim: {
    fromX: number; fromZ: number; fromZoom: number;
    toX: number; toZ: number; toZoom: number;
    startT: number; durMs: number;
  } | null = null;

  function flyTo(x: number, z: number, zoomPx: number, durMs = 600): void {
    camAnim = {
      fromX: camera.center.x, fromZ: camera.center.z, fromZoom: camera.zoom,
      toX: x, toZ: z, toZoom: zoomPx, startT: performance.now(), durMs,
    };
  }

  function cancelFly(): void {
    camAnim = null;
  }

  let highlight: { x: number; z: number; r: number; startT: number } | null = null;
  function highlightBuilding(b: import('@shared/types').Building): void {
    highlight = { x: b.x, z: b.z, r: footprintR(b) + 1.5, startT: performance.now() };
  }

  // 用户主动操作（拖拽/缩放）立即取消飞行动画，避免与手动平移打架
  canvas.addEventListener('mousedown', cancelFly);
  canvas.addEventListener('wheel', cancelFly, { passive: true });

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

  // ---- 12b. 搜索（⌘K）----
  const searchItems: SearchItem[] = [];
  for (const { b, dir } of buildingIndex.values()) {
    searchItems.push({ notePath: b.notePath, title: b.title, dir });
  }
  function decorate(path: string): string {
    const hit = buildingIndex.get(path);
    if (!hit) return '';
    if (hit.b.isCivic) return '🏛 ';
    if (hit.b.construction) return '🚧 ';
    if (hit.b.landmark) return '⭐ ';
    return '';
  }
  const searchUI = createSearchUI(container, searchItems, decorate, (notePath) => locate(notePath));

  hud.addButton('🔍 搜索', () => searchUI.open());

  const DAY = 86400000;

  // ---- 12c. 工地面板（F2）+ 园丁面板（F5）----
  const taskPanel = createTaskPanel(container, {
    onLocate: (notePath) => locate(notePath),
    obsidianHref: (notePath) => obsidianUri(vault.path, notePath),
  });
  taskPanel.refresh(groupTasks(city));

  const gardenPanel = createGardenPanel(container, {
    onLocate: (notePath) => locate(notePath),
    obsidianHref: (notePath) => obsidianUri(vault.path, notePath),
  });
  // 园丁清单：非 civic 中 mtimeMs 最旧 5 栋（用 generatedAt 保持确定性，不取 Date.now）
  const gardenList = city.districts
    .flatMap((d) => d.buildings.map((b) => ({ b, dir: d.dir })))
    .filter((x) => !x.b.isCivic)
    .sort((a, z) => a.b.mtimeMs - z.b.mtimeMs || a.b.notePath.localeCompare(z.b.notePath))
    .slice(0, 5)
    .map((x) => ({
      notePath: x.b.notePath,
      title: x.b.title,
      dir: x.dir,
      daysSince: Math.max(0, Math.floor((city.generatedAt - x.b.mtimeMs) / DAY)),
    }));
  gardenPanel.refresh(gardenList);

  const constructionN = totalConstruction(city);
  hud.addButton(constructionN > 0 ? `🚧 工地 ${constructionN}` : '🚧 无工地', () =>
    setLens(lensId === 'tasks' ? 'none' : 'tasks'),
  );
  // 面板经 Esc/✕ 关闭时还原透镜
  taskPanel.onClose = () => {
    if (lensId === 'tasks') setLens('none');
  };
  gardenPanel.onClose = () => {
    if (lensId === 'garden') setLens('none');
  };

  // ---- 12d. 透镜图层（F4/F5）----
  const gardenSet = gardenSetOf(city);
  let lensId: LensId = 'none';
  let lensHitCache: import('@shared/types').Building[] = [];
  const lensBtns = new Map<LensId, HTMLButtonElement>();

  function setLens(id: LensId): void {
    lensId = id;
    lensHitCache = lensHitBuildings(city, id, { gardenSet });
    // 按钮高亮
    for (const [bid, btn] of lensBtns) btn.classList.toggle('active', bid === id);
    // 面板与透镜联动：tasks↔工地面板、garden↔园丁面板
    if (id === 'tasks') taskPanel.open();
    else taskPanel.close();
    if (id === 'garden') gardenPanel.open();
    else gardenPanel.close();
    // HUD 提示
    const def = lensById(id);
    if (id === 'none') {
      hud.setTip('左键拖拽 平移地图 · 滚轮 缩放 · 点击建筑看笔记');
    } else if (lensHitCache.length > 0) {
      hud.setTip(`${def.label}视图 · 命中 ${lensHitCache.length} 栋`);
    } else {
      hud.setTip(def.emptyText || `${def.label}视图 · 无命中`);
    }
  }

  for (const def of LENSES) {
    const btn = document.createElement('button');
    btn.className = 'lens-btn' + (def.id === 'none' ? ' active' : '');
    btn.textContent = `${def.icon} ${def.label}`;
    btn.addEventListener('click', () => setLens(def.id));
    hud.lensBar.appendChild(btn);
    lensBtns.set(def.id, btn);
  }

  // ---- 13. 帧时间统计 ----
  const frameTimes: number[] = [];
  let lastFrameT = 0;

  // ---- 14. RAF 循环 ----
  let animId: number;

  function loop(t: number): void {
    animId = requestAnimationFrame(loop);

    // 推进镜头飞行动画（在任何绘制之前更新相机）
    if (camAnim) {
      const raw = (performance.now() - camAnim.startT) / camAnim.durMs;
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      camera.setView(
        camAnim.fromX + (camAnim.toX - camAnim.fromX) * e,
        camAnim.fromZ + (camAnim.toZ - camAnim.fromZ) * e,
        camAnim.fromZoom + (camAnim.toZoom - camAnim.fromZoom) * e,
      );
      if (p >= 1) camAnim = null;
    }

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

    // 透镜覆盖层（纸色遮罩压暗全图 + 命中建筑红环，静态层不重绘）
    if (lensId !== 'none') {
      const cc = ctx as unknown as Record<string, unknown>;
      cc.fillStyle = PAPER.paper;
      cc.globalAlpha = 0.55;
      ctx.fillRect(
        expandedBounds.minX,
        expandedBounds.minZ,
        expandedBounds.maxX - expandedBounds.minX,
        expandedBounds.maxZ - expandedBounds.minZ,
      );
      cc.globalAlpha = 1;
      const icon = lensById(lensId).icon;
      const drawIcons = lensHitCache.length <= 150;
      cc.strokeStyle = '#c0453a';
      cc.lineWidth = 0.3;
      cc.textAlign = 'center';
      cc.font = '3.5px sans-serif';
      for (const b of lensHitCache) {
        const r = footprintR(b) + 1;
        ctx.beginPath();
        ctx.arc(b.x, b.z, r, 0, Math.PI * 2);
        ctx.stroke();
        if (drawIcons) ctx.fillText(icon, b.x, b.z - r - 0.6);
      }
      cc.textAlign = 'start';
    }

    // 建筑高亮环（每帧覆盖层，印章红双圈脉冲，持续 3 秒）
    if (highlight) {
      const el = (performance.now() - highlight.startT) / 1000;
      if (el > 3) {
        highlight = null;
      } else {
        const a = 1 - el / 3;
        const pulse = 0.8 * Math.sin(el * 4) + 0.9;
        const cc = ctx as unknown as Record<string, unknown>;
        cc.strokeStyle = '#c0453a';
        cc.globalAlpha = a;
        cc.lineWidth = 0.35;
        ctx.beginPath();
        ctx.arc(highlight.x, highlight.z, highlight.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(highlight.x, highlight.z, highlight.r + pulse, 0, Math.PI * 2);
        ctx.stroke();
        cc.globalAlpha = 1;
      }
    }

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
      showBuildingCard(d.b, d.dir);
    } else if (item.kind === 'district') {
      const d = item.data as { type: 'district'; district: import('@shared/types').District };
      cards.showDistrict(d.district, Date.now());
    }
  }

  // 组装某建筑的入/出链数据（供卡片链接漫游）；解析不到标题的条目剔除
  function linksFor(notePath: string): import('../ui/cards').CardLinks {
    const outTo = (buildingIndex.get(notePath)?.b.outlinks ?? [])
      .map((p) => ({ path: p, title: buildingIndex.get(p)?.b.title ?? '' }))
      .filter((l) => l.title);
    const inFrom = (inlinkSources.get(notePath) ?? [])
      .map((p) => ({ path: p, title: buildingIndex.get(p)?.b.title ?? '' }))
      .filter((l) => l.title);
    return { inFrom, outTo, onNavigate: (p) => navigateLink(p) };
  }

  // 展示建筑卡片（带链接段），供点击/搜索/定位/漫游共用
  function showBuildingCard(b: import('@shared/types').Building, dir: string): void {
    cards.showBuilding(b, dir, vault.path, linksFor(b.notePath));
  }

  // 按 notePath 拾取建筑并展示信息卡（不移动镜头）
  function pickByPath(notePath: string): boolean {
    const hit = buildingIndex.get(notePath);
    if (!hit) return false;
    showBuildingCard(hit.b, hit.dir);
    return true;
  }

  /** 定位到某建筑：飞行 + 高亮 + 展示卡片。命中返回 true。搜索/工地定位/漫步/链接漫游共用。 */
  function locate(notePath: string, zoomPx = 14): boolean {
    const hit = buildingIndex.get(notePath);
    if (!hit) return false;
    flyTo(hit.b.x, hit.b.z, zoomPx);
    highlightBuilding(hit.b);
    showBuildingCard(hit.b, hit.dir);
    return true;
  }

  // 链接漫游：飞到目标建筑并就地刷新卡片（连续漫游）
  function navigateLink(notePath: string): void {
    locate(notePath);
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

    flyTo(x: number, z: number, zoomPx: number, durMs?: number): void {
      flyTo(x, z, zoomPx, durMs);
    },

    pickByPath,

    locate(notePath: string): boolean {
      return locate(notePath);
    },

    openSearch(): void {
      searchUI.open();
    },

    search(query: string) {
      return searchNotes(query, searchItems);
    },

    openTaskPanel(): void {
      taskPanel.open();
    },
    closeTaskPanel(): void {
      taskPanel.close();
    },
    taskPanelOpen(): boolean {
      return taskPanel.isOpen();
    },

    setLens(id: LensId): void {
      setLens(id);
    },
    lensHits(): string[] {
      return lensHitCache.map((b) => b.notePath);
    },
    openGardenPanel(): void {
      setLens('garden');
    },
    navigateLink(notePath: string): void {
      navigateLink(notePath);
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
      showBuildingCard(d.b, d.dir);
    },

    dispose(): void {
      cancelAnimationFrame(animId);
      if (hiSettleTimer !== null) {
        clearTimeout(hiSettleTimer);
        hiSettleTimer = null;
      }
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', cancelFly);
      canvas.removeEventListener('wheel', cancelFly);
      window.removeEventListener('resize', onResize);
      camera.dispose();
      canvas.remove();
      searchUI.dispose();
      taskPanel.dispose();
      gardenPanel.dispose();
      hud.dispose();
      const card = container.querySelector('#card');
      if (card) card.remove();
      const label = container.querySelector('#label');
      if (label) label.remove();
      backBtn.remove();
    },
  };
}
