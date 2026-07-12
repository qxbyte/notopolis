import './ui/style.css';
import { initTheme } from './ui/theme';
import { fetchWorld, fetchCity, fetchVisitSummary, connectWS } from './api';
import type { WorldVault } from './api';
import { createSettingsHub } from './ui/settingshub';
import { showWorldMap2D } from './views/worldmap2d';
import { showCity2D } from './views/cityview2d';
import type { CityViewHandle } from './views/cityview2d';
import { closeTopOverlay, clearOverlays } from './ui/overlaystack';
import { summarize, showBanner } from './ui/banner';
import type { CityDiff } from '@shared/types';

initTheme(); // 恢复上次选择的主题（须在任何 UI 创建前）

const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0;overflow:hidden;';
document.body.appendChild(container);

let current: { dispose(): void } | null = null;
let currentVaultId: string | null = null;
let navigating = false;
let currentBanner: { dispose(): void } | null = null;
let lastDiff: CityDiff | null = null;

// 全局常驻设置中心弹窗：左侧菜单（配置仓库/配置模型），右侧内容
const settingsHub = createSettingsHub(container);
// 仓库增删后世界地图就地刷新（不关弹窗、不清浮层）
settingsHub.onVaultsChanged = () => void refreshWorldMap();

// 调试对象（在每次视图切换时更新）
const __notopolis: {
  view: 'worldmap' | 'city';
  pickables: number;
  enterCity: (vaultId: string) => void;
  pickBuilding: (index: number) => void;
  perf: () => Record<string, number>;
  centerOn: (x: number, z: number, zoomPx: number) => void;
  pois: { x: number; z: number; r: number; kind: string }[];
} = {
  view: 'worldmap',
  pickables: 0,
  enterCity,
  pickBuilding: (_index: number) => { /* 初始化前无操作 */ },
  perf: () => ({}),
  centerOn: () => { /* 城市视图外无操作 */ },
  pois: [],
};
(window as any).__notopolis = __notopolis;

function clearCurrent(): void {
  current?.dispose();
  current = null;
  currentVaultId = null;
  currentBanner?.dispose();
  currentBanner = null;
  clearOverlays();
}

async function enterCity(vaultId: string): Promise<void> {
  const { vaults } = await fetchWorld();
  const vault = vaults.find((v) => v.id === vaultId);
  if (vault) await goCity(vault, false, true);
}

/** 入城后异步拉取变化摘要并展示横幅（不阻塞渲染；首访或无变化不展示） */
async function showVisitSummary(vaultId: string, handle: CityViewHandle): Promise<void> {
  try {
    const diff = await fetchVisitSummary(vaultId);
    lastDiff = diff;
    // 视图可能已切走
    if (currentVaultId !== vaultId || current !== handle) return;
    const text = summarize(diff);
    if (!text) return;
    const items = [
      ...diff.created.map((c) => ({ ...c, tag: '🏗 新建' })),
      ...diff.updated.map((c) => ({ ...c, tag: '✎ 翻修' })),
    ].map((c) => ({ path: c.path, title: c.title, tag: c.tag }));
    currentBanner?.dispose();
    currentBanner = showBanner(
      container,
      text,
      items.length ? { items, onPick: (p) => handle.locate(p) } : null,
    );
  } catch {
    // 摘要失败静默——不影响入城
  }
}

function mountWorldMap(vaults: WorldVault[]): { dispose(): void } {
  return showWorldMap2D(container, vaults, (v) => goCity(v, false, true), () => settingsHub.open());
}

async function goWorldMap(): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    const { vaults } = await fetchWorld();
    current = mountWorldMap(vaults);
    __notopolis.view = 'worldmap';
    __notopolis.pickables = 0;
    __notopolis.pickBuilding = (_index: number) => { /* worldmap 视图无建筑拾取 */ };
    // 世界还没有任何城邦：直接弹出设置中心的「配置仓库」引导添加
    if (vaults.length === 0) settingsHub.open('vaults');
  } finally {
    navigating = false;
  }
}

/** 仓库增删后的就地刷新：只重建地图画布，保留打开中的弹窗/浮层 */
async function refreshWorldMap(): Promise<void> {
  if (navigating || __notopolis.view !== 'worldmap') return;
  const { vaults } = await fetchWorld();
  if (__notopolis.view !== 'worldmap') return; // 拉取期间可能已进城
  current?.dispose();
  current = mountWorldMap(vaults);
}

async function goCity(
  vault: WorldVault,
  restoreTaskPanel = false,
  summary = false,
  restoreNote: string | null = null,
): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    currentVaultId = vault.id;
    const city = await fetchCity(vault.id);
    const cityHandle: CityViewHandle = showCity2D(container, vault, city, goWorldMap);
    current = cityHandle;
    if (restoreTaskPanel) cityHandle.openTaskPanel();
    if (restoreNote) cityHandle.openNote(restoreNote);
    if (summary) void showVisitSummary(vault.id, cityHandle);
    __notopolis.view = 'city';
    __notopolis.pickables = cityHandle.pickableCount;
    __notopolis.pickBuilding = (index: number) => cityHandle.triggerPick(index);
    __notopolis.perf = () => cityHandle.perf();
    __notopolis.centerOn = (x, z, zoomPx) => cityHandle.centerOn(x, z, zoomPx);
    __notopolis.pois = cityHandle.pois;
    const dbg = __notopolis as Record<string, unknown>;
    dbg.debugTrainPos = (i: number) => cityHandle.debugTrainPos(i);
    dbg.debugPlanePos = () => cityHandle.debugPlanePos();
    dbg.flyTo = (x: number, z: number, zoomPx: number, durMs?: number) => cityHandle.flyTo(x, z, zoomPx, durMs);
    dbg.pickByPath = (p: string) => cityHandle.pickByPath(p);
    dbg.openSearch = () => cityHandle.openSearch();
    dbg.search = (q: string) => cityHandle.search(q);
    dbg.openTaskPanel = () => cityHandle.openTaskPanel();
    dbg.closeTaskPanel = () => cityHandle.closeTaskPanel();
    dbg.taskPanelOpen = () => cityHandle.taskPanelOpen();
    dbg.toggleDocPanel = () => cityHandle.toggleDocPanel();
    dbg.docPanelOpen = () => cityHandle.docPanelOpen();
    dbg.vectorMarkCount = () => cityHandle.vectorMarkCount();
    dbg.locate = (p: string) => cityHandle.locate(p);
    dbg.visitSummary = () => lastDiff;
    dbg.setLens = (id: string) => cityHandle.setLens(id as never);
    dbg.lensHits = () => cityHandle.lensHits();
    dbg.openGardenPanel = () => cityHandle.openGardenPanel();
    dbg.navigateLink = (p: string) => cityHandle.navigateLink(p);
    dbg.randomWalk = () => cityHandle.randomWalk();
    dbg.exportPoster = () => cityHandle.exportPoster();
    dbg.openNote = (p: string) => cityHandle.openNote(p);
  } finally {
    navigating = false;
  }
}

async function init(): Promise<void> {
  // 世界地图即首页；无仓库时 goWorldMap 内部会自动弹出仓库管理
  await goWorldMap();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (closeTopOverlay()) return; // 先关最上层浮层（搜索/面板）
    if (current) goWorldMap();
    return;
  }
  // ⌘K / Ctrl+K：城市视图下打开搜索
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && __notopolis.view === 'city') {
    e.preventDefault();
    const open = (__notopolis as Record<string, unknown>).openSearch;
    if (typeof open === 'function') (open as () => void)();
  }
});

connectWS(async (vaultId: string) => {
  if (currentVaultId === vaultId) {
    // 整城重建前记录面板/弹窗状态，重建后恢复（保存笔记触发重建时不该丢弹窗）
    const h = current as unknown as {
      taskPanelOpen?: () => boolean;
      noteModalPath?: () => string | null;
    } | null;
    const wasTaskPanelOpen = h?.taskPanelOpen?.() === true;
    const openNote = h?.noteModalPath?.() ?? null;
    const { vaults } = await fetchWorld();
    const vault = vaults.find((v) => v.id === vaultId);
    if (vault) await goCity(vault, wasTaskPanelOpen, false, openNote);
  }
});

init().catch((err: unknown) => {
  const msg = document.createElement('div');
  msg.id = 'init-error';
  msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1e1a2e;color:#e06060;font-size:1.1rem;font-family:sans-serif;flex-direction:column;gap:1rem;';
  const warningDiv = document.createElement('div');
  warningDiv.textContent = '⚠ 无法连接到 Notopolis 后端';
  const errDiv = document.createElement('div');
  errDiv.style.color = '#706a88';
  errDiv.style.fontSize = '0.85rem';
  errDiv.textContent = String(err);
  const btn = document.createElement('button');
  btn.textContent = '重试';
  btn.onclick = () => location.reload();
  btn.style.cssText = 'background:#3a3060;border:1px solid #6a5080;color:#c0a8e0;border-radius:6px;padding:0.5rem 1.5rem;cursor:pointer;font-size:0.9rem;';
  msg.appendChild(warningDiv);
  msg.appendChild(errDiv);
  msg.appendChild(btn);
  document.body.appendChild(msg);
});
