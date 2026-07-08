import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AppConfig, VaultConfig } from '../shared/types.js';
import { hashSeed } from './layout/rng.js';

export function configDir(): string {
  return process.env.NOTOPOLIS_CONFIG_DIR ?? path.join(homedir(), '.notopolis');
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    return JSON.parse(await readFile(path.join(configDir(), 'config.json'), 'utf8'));
  } catch {
    return { vaults: [] };
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'config.json.tmp');
  await writeFile(tmp, JSON.stringify(cfg, null, 2));
  await rename(tmp, path.join(dir, 'config.json'));
}

export function makeVault(
  name: string,
  vaultPath: string,
  theme: VaultConfig['theme'],
): VaultConfig {
  return { id: hashSeed(vaultPath).toString(36), name, path: vaultPath, theme };
}
