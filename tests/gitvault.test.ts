import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { authenticatedUrl, parseGitProgress, syncGitRepo, type ExecFn } from '../src/server/gitvault.js';

async function repoDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'noto-git-'));
  await mkdir(path.join(dir, '.git')); // 让 isGitRepo 判为「已存在」→ 走同步路径
  return dir;
}

describe('gitvault 同步', () => {
  it('已存在的库同步走 fetch + reset --hard，不用 pull（浅历史 pull 会 merge unrelated histories）', async () => {
    const dir = await repoDir();
    const calls: string[] = [];
    const execFn: ExecFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await syncGitRepo({ url: 'https://github.com/x/y.git', cloneDir: dir, token: 't', execFn });
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.startsWith('git fetch'))).toBe(true);
    expect(calls.some((c) => c.includes('reset --hard FETCH_HEAD'))).toBe(true);
    expect(calls.some((c) => c.includes('git pull'))).toBe(false);
  });

  it('同步失败时错误信息剔除 --progress 进度噪声，只保留 fatal', async () => {
    const dir = await repoDir();
    const execFn: ExecFn = async (_cmd, args) => {
      if (args[0] === 'fetch') {
        return {
          code: 128,
          stdout: '',
          stderr:
            'remote: Counting objects: 50% (1/2)\nremote: Total 0 (delta 0)\nfatal: could not read from remote',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await syncGitRepo({ url: 'https://github.com/x/y.git', cloneDir: dir, execFn });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('fatal: could not read from remote');
    expect(r.message).not.toContain('Counting objects');
    expect(r.message).not.toContain('remote: Total');
  });

  it('token 通过 x-access-token 注入 https，且从错误信息里抹掉', async () => {
    expect(authenticatedUrl('https://github.com/x/y.git', 'SECRET')).toBe(
      'https://x-access-token:SECRET@github.com/x/y.git',
    );
    const dir = await repoDir();
    const execFn: ExecFn = async () => ({ code: 1, stdout: '', stderr: 'auth failed for SECRET token' });
    const r = await syncGitRepo({ url: 'https://github.com/x/y.git', cloneDir: dir, token: 'SECRET', execFn });
    expect(r.message).not.toContain('SECRET');
  });

  it('parseGitProgress 解析百分比与阶段', () => {
    expect(parseGitProgress('Receiving objects:  45% (450/1000)')).toEqual({ pct: 41, phase: '克隆中' });
    expect(parseGitProgress('无进度行')).toBeNull();
  });
});
