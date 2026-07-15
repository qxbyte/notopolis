/**
 * gitvault.ts — Git 仓库作为「第二种加库方式」：把远端仓库克隆到服务器本地，
 * 其中的子目录（如 Notes/）作为真正的 Obsidian 笔记库。
 *
 * 设计要点：
 * - 克隆落盘在 <configDir>/repos/<vaultId>/，vault.path 指向其下的 subdir；
 * - id 由 url+subdir 稳定哈希，重复「同步」指向同一克隆目录；
 * - Token 仅在执行 git 命令时经 https URL 临时注入，不写进 .git/config、不打日志；
 * - exec 依赖注入（execFn），离线可单测；
 * - 克隆/拉取解析 git --progress 的百分比，经 jobs 表供前端轮询画进度条。
 */
import { spawn } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GitSyncProgress } from '../shared/types.js';
import { hashSeed } from './layout/rng.js';

/** 注入式命令执行：可选 onStderr 实时回传 stderr 块（进度解析用），绝不抛 */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; onStderr?: (chunk: string) => void },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

/** Git 库的稳定 id（url + subdir 决定，重复添加/同步指向同一目录） */
export function gitVaultId(url: string, subdir = ''): string {
  return hashSeed(`git:${url.trim()}#${subdir.trim()}`).toString(36);
}

/** 克隆目录：<configDir>/repos/<id> */
export function gitCloneDir(configDir: string, id: string): string {
  return path.join(configDir, 'repos', id);
}

/**
 * vault 根路径 = 克隆目录下的 subdir，并做越界防护（subdir 不得逃出克隆目录）。
 * 返回 null 表示 subdir 非法。
 */
export function gitVaultPath(cloneDir: string, subdir = ''): string | null {
  const root = path.resolve(cloneDir);
  const abs = path.resolve(cloneDir, subdir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 把 token 拼进 https 仓库地址，用于临时鉴权；无 token / 非 https 原样返回 */
export function authenticatedUrl(url: string, token?: string): string {
  const u = url.trim();
  if (!token || !/^https:\/\//i.test(u)) return u;
  return u.replace(/^https:\/\//i, `https://x-access-token:${token}@`);
}

/** 从任意文本里抹掉 token，避免出现在错误信息/日志里 */
function redact(text: string, token?: string): string {
  return token ? text.split(token).join('•••') : text;
}

/** 清理 git 错误信息：抹 token + 剔除 --progress 进度噪声，只留真正的 fatal/error 行 */
function cleanErr(text: string, token?: string): string {
  return redact(text, token)
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^(remote:\s*)?(Enumerating|Counting|Compressing|Receiving|Resolving|Unpacking|Total)\b/.test(l) &&
        l !== 'remote:',
    )
    .join('\n')
    .trim()
    .slice(-400);
}

/** 解析 git --progress 的百分比与阶段（取 stderr 块里最后一个「标签: N%」） */
export function parseGitProgress(chunk: string): { pct: number; phase: string } | null {
  const re = /(Receiving objects|Resolving deltas|Counting objects|Compressing objects):\s+(\d+)%/g;
  let m: RegExpExecArray | null;
  let last: { pct: number; phase: string } | null = null;
  while ((m = re.exec(chunk)) !== null) {
    const label = m[1];
    const pct = Number(m[2]);
    // 接收对象是耗时主阶段，占进度条 0–90；解析增量占 90–100
    if (label === 'Receiving objects') last = { pct: Math.round(pct * 0.9), phase: '克隆中' };
    else if (label === 'Resolving deltas') last = { pct: 90 + Math.round(pct * 0.1), phase: '克隆中' };
    else last = { pct: Math.min(5, Math.round(pct * 0.05)), phase: '克隆中' };
  }
  return last;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

export interface GitSyncResult {
  ok: boolean;
  action: 'clone' | 'pull';
  message: string;
}

/**
 * 克隆或拉取：克隆目录不存在则浅克隆，已存在则 git pull。
 * Token 只在命令行 URL 里临时出现；克隆后把 remote 重置为不含 token 的原始地址。
 */
export async function syncGitRepo(opts: {
  url: string;
  cloneDir: string;
  token?: string;
  execFn?: ExecFn;
  onProgress?: (pct: number, phase: string) => void;
}): Promise<GitSyncResult> {
  const { url, cloneDir, token, onProgress } = opts;
  const exec = opts.execFn ?? realExec;
  const authUrl = authenticatedUrl(url, token);
  const onStderr = onProgress
    ? (chunk: string): void => {
        const p = parseGitProgress(chunk);
        if (p) onProgress(p.pct, p.phase);
      }
    : undefined;
  const already = await isGitRepo(cloneDir);

  if (!already) {
    onProgress?.(1, '克隆中');
    const r = await exec('git', ['clone', '--depth', '1', '--progress', authUrl, cloneDir], {
      onStderr,
    });
    if (r.code !== 0) {
      return { ok: false, action: 'clone', message: cleanErr(r.stderr || r.stdout, token) };
    }
    await exec('git', ['remote', 'set-url', 'origin', url], { cwd: cloneDir });
    return { ok: true, action: 'clone', message: 'cloned' };
  }

  // 只读镜像库的「同步」：fetch 远端 HEAD 后 hard reset，而不是 pull(merge)——
  // 浅克隆再 pull 会因两段浅历史无共同祖先报 "refusing to merge unrelated histories"。
  onProgress?.(10, '拉取中');
  const setAuth = await exec('git', ['remote', 'set-url', 'origin', authUrl], { cwd: cloneDir });
  if (setAuth.code !== 0) {
    return { ok: false, action: 'pull', message: cleanErr(setAuth.stderr, token) };
  }
  const fetched = await exec('git', ['fetch', '--depth', '1', '--progress', 'origin', 'HEAD'], {
    cwd: cloneDir,
    onStderr,
  });
  await exec('git', ['remote', 'set-url', 'origin', url], { cwd: cloneDir });
  if (fetched.code !== 0) {
    return { ok: false, action: 'pull', message: cleanErr(fetched.stderr || fetched.stdout, token) };
  }
  const reset = await exec('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: cloneDir });
  if (reset.code !== 0) {
    return { ok: false, action: 'pull', message: cleanErr(reset.stderr || reset.stdout, token) };
  }
  return { ok: true, action: 'pull', message: 'pulled' };
}

/** 删除克隆目录（删库时清理，避免磁盘泄漏） */
export async function removeCloneDir(cloneDir: string): Promise<void> {
  await rm(cloneDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 同步任务表（前端轮询进度）——照抄 rag/indexer.ts 的 jobs 模式
// ---------------------------------------------------------------------------

const jobs = new Map<string, GitSyncProgress>();

export function gitSyncProgress(id: string): GitSyncProgress {
  return jobs.get(id) ?? { running: false, phase: '空闲', pct: 0 };
}

/**
 * 启动一次异步同步：立即返回，进度写入 jobs 表；成功后回调 onDone
 * 做「注册 vault + 重扫 + 广播」等服务端善后。同一 id 正在跑则忽略。
 */
export function startGitSync(opts: {
  id: string;
  url: string;
  cloneDir: string;
  token?: string;
  execFn?: ExecFn;
  onDone: (result: GitSyncResult) => Promise<void>;
}): void {
  if (jobs.get(opts.id)?.running) return;
  const prog: GitSyncProgress = { running: true, phase: '准备', pct: 0 };
  jobs.set(opts.id, prog);
  void (async () => {
    try {
      const result = await syncGitRepo({
        url: opts.url,
        cloneDir: opts.cloneDir,
        token: opts.token,
        execFn: opts.execFn,
        onProgress: (pct, phase) => {
          prog.pct = Math.max(prog.pct, pct);
          prog.phase = phase;
        },
      });
      if (!result.ok) {
        Object.assign(prog, { running: false, phase: '失败', error: result.message, finishedAt: Date.now() });
        return;
      }
      prog.phase = '扫描';
      prog.pct = Math.max(prog.pct, 95);
      await opts.onDone(result);
      Object.assign(prog, { running: false, phase: '完成', pct: 100, finishedAt: Date.now() });
    } catch (e) {
      Object.assign(prog, { running: false, phase: '失败', error: String(e), finishedAt: Date.now() });
    }
  })();
}
