import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDir } from './config.js';
import type { CitySnapshot } from '../shared/types.js';

function snapPath(vaultId: string): string {
  // vaultId 是 hashSeed(path).toString(36)，纯字母数字，无路径穿越风险
  return path.join(configDir(), 'snapshots', `${vaultId}.json`);
}

/** 读快照；不存在/损坏/TCC 一律返回 null（当作首访），绝不抛 */
export async function loadSnapshot(vaultId: string): Promise<CitySnapshot | null> {
  try {
    const raw = await readFile(snapPath(vaultId), 'utf8');
    const parsed = JSON.parse(raw) as CitySnapshot;
    if (typeof parsed?.visitedAt !== 'number' || typeof parsed?.notes !== 'object' || parsed.notes === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 写快照；失败静默降级（TCC/EPERM），绝不抛 */
export async function saveSnapshot(vaultId: string, snap: CitySnapshot): Promise<void> {
  try {
    await mkdir(path.dirname(snapPath(vaultId)), { recursive: true });
    await writeFile(snapPath(vaultId), JSON.stringify(snap), 'utf8');
  } catch (e) {
    console.warn('[snapshots] save failed:', e);
  }
}
