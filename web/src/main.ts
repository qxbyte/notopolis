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

function clearCurrent(): void {
  current?.dispose();
  current = null;
  currentVaultId = null;
}

async function goWorldMap(): Promise<void> {
  clearCurrent();
  const { vaults } = await fetchWorld();
  current = showWorldMap({ scene, renderer, container }, vaults, goCity);
}

async function goCity(vault: WorldVault): Promise<void> {
  clearCurrent();
  currentVaultId = vault.id;
  const city = await fetchCity(vault.id);
  current = showCity({ scene, renderer, container }, vault, city, goWorldMap);
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
  if (e.key === 'Escape') goWorldMap();
});

connectWS(async (vaultId: string) => {
  if (currentVaultId === vaultId) {
    const { vaults } = await fetchWorld();
    const vault = vaults.find((v) => v.id === vaultId);
    if (vault) await goCity(vault);
  }
});

init();
