/**
 * rag/indexer.ts — 入库流水线（数据治理层）+ 单 vault 互斥的异步任务。
 * 逐文档：读取（路径穿越防护）→ 清洗 → 全文 hash 与登记表比对（未变即跳过：
 * 去重 + 版本管理）→ 切片 → 片段 hash 去重 → 批量嵌入 → 原子落库。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RagDocStatus, RagEndpoint, RagIndexProgress } from '../../shared/types.js';
import type { NoteMeta } from '../../shared/types.js';
import { chunkMarkdown, cleanMarkdown, contentHash, embedInput } from './chunker.js';
import { embedTexts, type FetchFn } from './embed.js';
import type { DocRecord, VectorStore } from './store.js';

export interface IndexDeps {
  store: VectorStore;
  endpoint: RagEndpoint;
  fetchFn?: FetchFn;
}

/** 单文档入库；返回 'indexed' | 'skipped'（内容与模型均未变） */
export async function indexOneDoc(
  vaultRoot: string,
  docPath: string,
  deps: IndexDeps,
): Promise<'indexed' | 'skipped'> {
  const rootAbs = path.resolve(vaultRoot);
  const abs = path.resolve(vaultRoot, docPath);
  if (!abs.startsWith(rootAbs + path.sep)) throw new Error('非法路径');
  const [raw, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);

  const { content } = cleanMarkdown(raw);
  const docHash = contentHash(content);
  const existing = deps.store.getDoc(docPath);
  if (existing && existing.docHash === docHash && existing.model === deps.endpoint.model) {
    return 'skipped'; // 去重：内容与模型均未变
  }

  const title = docPath.split('/').pop()!.replace(/\.md$/, '');
  let chunks = chunkMarkdown(raw, docPath, title);
  // 文档内片段级去重
  const seen = new Set<string>();
  chunks = chunks.filter((c) => (seen.has(c.hash) ? false : (seen.add(c.hash), true)));

  if (chunks.length === 0) {
    // 空文档：只登记版本，不产生向量
    await deps.store.upsertDoc(
      {
        docPath,
        docHash,
        mtimeMs: st.mtimeMs,
        chunkCount: 0,
        indexedAt: Date.now(),
        model: deps.endpoint.model,
        dims: deps.store.meta().dims,
      },
      [],
      [],
    );
    return 'indexed';
  }

  const vectors = await embedTexts(chunks.map(embedInput), deps.endpoint, deps.fetchFn);
  const doc: DocRecord = {
    docPath,
    docHash,
    mtimeMs: st.mtimeMs,
    chunkCount: chunks.length,
    indexedAt: Date.now(),
    model: deps.endpoint.model,
    dims: vectors[0]?.length ?? 0,
  };
  await deps.store.upsertDoc(doc, chunks, vectors);
  return 'indexed';
}

/** 文档索引状态：mtime 或模型与登记不符 → stale（提示重建） */
export function docStatuses(
  notes: NoteMeta[],
  store: VectorStore,
  activeModel: string,
): RagDocStatus[] {
  return notes.map((n) => {
    const rec = store.getDoc(n.path);
    let state: RagDocStatus['state'] = 'none';
    if (rec) {
      state = rec.mtimeMs !== n.mtimeMs || rec.model !== activeModel ? 'stale' : 'indexed';
    }
    return {
      path: n.path,
      title: n.title,
      state,
      chunkCount: rec?.chunkCount ?? 0,
      indexedAt: rec?.indexedAt ?? null,
      model: rec?.model ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// 异步入库任务：每 vault 同时至多一个（互斥），进度可轮询
// ---------------------------------------------------------------------------

const jobs = new Map<string, RagIndexProgress>();

export function jobProgress(vaultId: string): RagIndexProgress {
  return (
    jobs.get(vaultId) ?? {
      running: false,
      total: 0,
      done: 0,
      skipped: 0,
      current: null,
      errors: [],
      startedAt: null,
      finishedAt: null,
    }
  );
}

export function startIndexJob(
  vaultId: string,
  vaultRoot: string,
  paths: string[],
  deps: IndexDeps,
): { started: boolean; reason?: string } {
  const cur = jobs.get(vaultId);
  if (cur?.running) return { started: false, reason: '已有入库任务进行中' };

  const progress: RagIndexProgress = {
    running: true,
    total: paths.length,
    done: 0,
    skipped: 0,
    current: null,
    errors: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(vaultId, progress);

  void (async () => {
    for (const p of paths) {
      progress.current = p;
      try {
        const r = await indexOneDoc(vaultRoot, p, deps);
        if (r === 'skipped') progress.skipped++;
      } catch (e) {
        progress.errors.push({ path: p, reason: (e as Error).message });
      }
      progress.done++;
    }
    progress.running = false;
    progress.current = null;
    progress.finishedAt = Date.now();
  })();

  return { started: true };
}

/** 测试用：清空任务表 */
export function clearJobs(): void {
  jobs.clear();
}
