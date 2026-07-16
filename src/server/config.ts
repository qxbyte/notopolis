import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AppConfig, VaultConfig } from '../shared/types.js';
import { hashSeed } from './layout/rng.js';

export function configDir(): string {
  return process.env.NOTOPOLIS_CONFIG_DIR ?? path.join(homedir(), '.notopolis');
}

const VALID_THEMES: ReadonlyArray<VaultConfig['theme']> = ['plains', 'mountain', 'harbor'];

export async function loadConfig(): Promise<AppConfig> {
  try {
    const cfg: AppConfig = JSON.parse(
      await readFile(path.join(configDir(), 'config.json'), 'utf8'),
    );
    // 已删除/未知主题（如旧版 snow）归一为 plains，旧 config.json 无缝升级
    for (const v of cfg.vaults ?? []) {
      if (!VALID_THEMES.includes(v.theme)) v.theme = 'plains';
    }
    return cfg;
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
