import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, makeVault, saveConfig } from '../src/server/config.js';

afterEach(() => {
  delete process.env.NOTOPOLIS_CONFIG_DIR;
});

describe('config store', () => {
  it('无配置文件时返回空配置', async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
    expect(await loadConfig()).toEqual({ vaults: [] });
  });

  it('保存后可读回；vault id 由路径确定', async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
    const v = makeVault('主城', '/tmp/vault-x', 'plains');
    expect(v.id).toBe(makeVault('别名', '/tmp/vault-x', 'snow').id);
    await saveConfig({ vaults: [v] });
    expect((await loadConfig()).vaults).toEqual([v]);
  });
});
