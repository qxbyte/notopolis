import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchVaults } from '../src/server/watcher.js';

describe('watchVaults', () => {
  it('md 变更触发防抖回调', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'noto-watch-'));
    const events: string[] = [];
    const watchers = watchVaults([{ id: 'v1', path: dir }], (id) => events.push(id), 100);
    await new Promise((r) => setTimeout(r, 300)); // 等 watcher 就绪
    await writeFile(path.join(dir, 'a.md'), '# 新笔记');
    await writeFile(path.join(dir, 'b.txt'), '非 md 不触发');
    await new Promise((r) => setTimeout(r, 800));
    expect(events).toEqual(['v1']);
    await Promise.all(watchers.map((w) => w.close()));
  }, 10_000);
});
