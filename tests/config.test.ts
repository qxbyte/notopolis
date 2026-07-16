import { mkdtemp, writeFile } from 'node:fs/promises';
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
    expect(v.id).toBe(makeVault('别名', '/tmp/vault-x', 'harbor').id);
    await saveConfig({ vaults: [v] });
    expect((await loadConfig()).vaults).toEqual([v]);
  });

  it('旧配置遗留的已删除主题（snow）加载时归一为 plains', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'noto-'));
    process.env.NOTOPOLIS_CONFIG_DIR = dir;
    const legacy = { vaults: [{ id: 'x1', name: '雪城', path: '/tmp/vault-s', theme: 'snow' }] };
    await writeFile(path.join(dir, 'config.json'), JSON.stringify(legacy));
    expect((await loadConfig()).vaults[0].theme).toBe('plains');
  });
});
