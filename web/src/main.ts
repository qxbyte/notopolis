import './ui/style.css';
import { fetchWorld, fetchCity, connectWS } from './api';
import type { WorldVault } from './api';
import { createScene } from './scene/setup';
import { showOnboarding } from './ui/onboarding';
import { showWorldMap } from './views/worldmap';
import { showCity } from './views/cityview';

const container = document.getElementById('app') as HTMLElement;
const { scene, renderer } = createScene(container);

let current: { dispose(): void } | null = null;
let currentVaultId: string | null = null;
let navigating = false;

function clearCurrent(): void {
  current?.dispose();
  current = null;
  currentVaultId = null;
}

async function goWorldMap(): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    const { vaults } = await fetchWorld();
    current = showWorldMap({ scene, renderer, container }, vaults, goCity);
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
    current = showCity({ scene, renderer, container }, vault, city, goWorldMap);
  } finally {
    navigating = false;
  }
}

async function init(): Promise<void> {
  const { vaults } = await fetchWorld();
  if (vaults.length === 0) {
    showOnboarding(container, goWorldMap);
  } else {
    await goWorldMap();
  }
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
