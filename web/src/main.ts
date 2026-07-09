import './ui/style.css';
import { fetchWorld, fetchCity, connectWS } from './api';
import type { WorldVault } from './api';
import { showHome, showOnboarding } from './ui/onboarding';
import { showWorldMap2D } from './views/worldmap2d';
import { showCity2D } from './views/cityview2d';
import type { CityViewHandle } from './views/cityview2d';

// 保留 showOnboarding 引用避免 tree-shake 删掉（向后兼容）
void showOnboarding;

const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0;overflow:hidden;';
document.body.appendChild(container);

let current: { dispose(): void } | null = null;
let currentVaultId: string | null = null;
let navigating = false;

// 调试对象（在每次视图切换时更新）
const __notopolis: {
  view: 'onboarding' | 'worldmap' | 'city';
  pickables: number;
  enterCity: (vaultId: string) => void;
  pickBuilding: (index: number) => void;
  perf: () => Record<string, number>;
} = {
  view: 'onboarding',
  pickables: 0,
  enterCity,
  pickBuilding: (_index: number) => { /* 初始化前无操作 */ },
  perf: () => ({}),
};
(window as any).__notopolis = __notopolis;

function clearCurrent(): void {
  current?.dispose();
  current = null;
  currentVaultId = null;
}

async function enterCity(vaultId: string): Promise<void> {
  const { vaults } = await fetchWorld();
  const vault = vaults.find((v) => v.id === vaultId);
  if (vault) await goCity(vault);
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
    current = showWorldMap2D(container, vaults, goCity, goHome);
    __notopolis.view = 'worldmap';
    __notopolis.pickables = 0;
    __notopolis.pickBuilding = (_index: number) => { /* worldmap 视图无建筑拾取 */ };
  } finally {
    navigating = false;
  }
}

async function goCity(vault: WorldVault): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    currentVaultId = vault.id;
    const city = await fetchCity(vault.id);
    const cityHandle: CityViewHandle = showCity2D(container, vault, city, goWorldMap);
    current = cityHandle;
    __notopolis.view = 'city';
    __notopolis.pickables = cityHandle.pickableCount;
    __notopolis.pickBuilding = (index: number) => cityHandle.triggerPick(index);
    __notopolis.perf = () => cityHandle.perf();
  } finally {
    navigating = false;
  }
}

async function init(): Promise<void> {
  // 首页固定为仓库管理页，不再判断 vaults.length
  goHome();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && current) goWorldMap();
});

connectWS(async (vaultId: string) => {
  if (currentVaultId === vaultId) {
    const { vaults } = await fetchWorld();
    const vault = vaults.find((v) => v.id === vaultId);
    if (vault) await goCity(vault);
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
