import './ui/style.css';
import { fetchWorld, fetchCity, fetchVisitSummary, connectWS } from './api';
import type { WorldVault } from './api';
import { showHome, showOnboarding } from './ui/onboarding';
import { showWorldMap2D } from './views/worldmap2d';
import { showCity2D } from './views/cityview2d';
import type { CityViewHandle } from './views/cityview2d';
import { closeTopOverlay, clearOverlays } from './ui/overlaystack';
import { summarize, showBanner } from './ui/banner';
import type { CityDiff } from '@shared/types';

// 保留 showOnboarding 引用避免 tree-shake 删掉（向后兼容）
void showOnboarding;

const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0;overflow:hidden;';
document.body.appendChild(container);

let current: { dispose(): void } | null = null;
let currentVaultId: string | null = null;
let navigating = false;
let currentBanner: { dispose(): void } | null = null;
let lastDiff: CityDiff | null = null;

// 调试对象（在每次视图切换时更新）
const __notopolis: {
  view: 'onboarding' | 'worldmap' | 'city';
  pickables: number;
  enterCity: (vaultId: string) => void;
  pickBuilding: (index: number) => void;
  perf: () => Record<string, number>;
  centerOn: (x: number, z: number, zoomPx: number) => void;
  pois: { x: number; z: number; r: number; kind: string }[];
} = {
  view: 'onboarding',
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

function goHome(): void {
  clearCurrent();
  __notopolis.view = 'onboarding';
  current = showHome(container, {
    onEnter: goWorldMap,
  });
}

async function goWorldMap(): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    const { vaults } = await fetchWorld();
    current = showWorldMap2D(container, vaults, (v) => goCity(v, false, true), goHome);
    __notopolis.view = 'worldmap';
    __notopolis.pickables = 0;
    __notopolis.pickBuilding = (_index: number) => { /* worldmap 视图无建筑拾取 */ };
  } finally {
    navigating = false;
  }
}

async function goCity(vault: WorldVault, restoreTaskPanel = false, summary = false): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    currentVaultId = vault.id;
    const city = await fetchCity(vault.id);
    const cityHandle: CityViewHandle = showCity2D(container, vault, city, goWorldMap);
    current = cityHandle;
    if (restoreTaskPanel) cityHandle.openTaskPanel();
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
    dbg.locate = (p: string) => cityHandle.locate(p);
    dbg.visitSummary = () => lastDiff;
  } finally {
    navigating = false;
  }
}

async function init(): Promise<void> {
  // 首页固定为仓库管理页，不再判断 vaults.length
  goHome();
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
    // 整城重建前记录工地面板开关，重建后恢复（勾任务后面板不该消失）
    const h = current as unknown as { taskPanelOpen?: () => boolean } | null;
    const wasTaskPanelOpen = h?.taskPanelOpen?.() === true;
    const { vaults } = await fetchWorld();
    const vault = vaults.find((v) => v.id === vaultId);
    if (vault) await goCity(vault, wasTaskPanelOpen);
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
