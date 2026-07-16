import { mkdtemp, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { docStatuses, indexOneDoc, type IndexDeps } from '../src/server/rag/indexer.js';
import { FileVectorStore } from '../src/server/rag/store.js';
import type { NoteMeta, RagEndpoint } from '../src/shared/types.js';

let vaultDir: string;
let storeDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(tmpdir(), 'noto-vault-'));
  storeDir = await mkdtemp(path.join(tmpdir(), 'noto-rag-'));
});

const endpoint: RagEndpoint = { baseUrl: 'http://fake', model: 'm1', apiKey: '' };

/** 离线 fetch stub：每段文本返回固定 3 维向量 */
const fakeFetch = (async (_url: string, init?: { body?: string }) => {
  const n = (JSON.parse(init?.body ?? '{}').input as string[]).length;
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
  };
}) as unknown as IndexDeps['fetchFn'];

async function makeDeps(): Promise<IndexDeps> {
  const store = new FileVectorStore(storeDir);
  await store.load();
  return { store, endpoint, fetchFn: fakeFetch };
}

function noteOf(p: string, mtimeMs: number): NoteMeta {
  return { path: p, title: path.basename(p, '.md'), mtimeMs } as NoteMeta;
}

describe('indexOneDoc × docStatuses 状态一致性', () => {
  it('内容未变但 mtime 变化（重新克隆场景）：跳过后印章应为 indexed 而非 stale', async () => {
    const docPath = 'a.md';
    const abs = path.join(vaultDir, docPath);
    await writeFile(abs, '# A\n\n正文内容');
    const deps = await makeDeps();

    expect(await indexOneDoc(vaultDir, docPath, deps)).toBe('indexed');

    // 模拟删库重克隆：内容一致、mtime 改变
    const newTime = new Date(Date.now() + 60_000);
    await utimes(abs, newTime, newTime);
    expect(await indexOneDoc(vaultDir, docPath, deps)).toBe('skipped');

    // 印章对比的 mtime 与真实链路一致：都来自 stat()（避免 Date 整数与 fs 浮点精度差）
    const { mtimeMs } = await stat(abs);
    const statuses = docStatuses([noteOf(docPath, mtimeMs)], deps.store, 'm1');
    expect(statuses[0].state).toBe('indexed'); // 修复前：stale（登记表 mtime 未随跳过刷新）
  });

  it('内容变化：重新入库且印章 indexed', async () => {
    const docPath = 'b.md';
    const abs = path.join(vaultDir, docPath);
    await writeFile(abs, '# B\n\n第一版');
    const deps = await makeDeps();
    await indexOneDoc(vaultDir, docPath, deps);

    await writeFile(abs, '# B\n\n第二版内容不同');
    expect(await indexOneDoc(vaultDir, docPath, deps)).toBe('indexed');
    const { mtimeMs } = deps.store.getDoc(docPath)!;
    expect(docStatuses([noteOf(docPath, mtimeMs)], deps.store, 'm1')[0].state).toBe('indexed');
  });
});
