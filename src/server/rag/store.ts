/**
 * rag/store.ts — 向量存储层。
 * 选型结论（见设计文档 §3.1）：自研嵌入式文件存储 + 内存精确检索。
 * 单 vault 万级片段 × 1024 维 ≈ 40MB，暴力点积 <50ms，精确检索召回率恒 100%。
 * VectorStore 为接口，未来可替换为 Qdrant/LanceDB 适配器，上层不感知。
 *
 * 布局：<configDir>/rag/<vaultId>/
 *   index.json  — 模型/维度、文档登记表、片段元数据（不含向量）
 *   vectors.bin — Float32 行矩阵，行序与 chunks 严格对齐（嵌入时已归一化）
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDir } from '../config.js';
import type { Chunk } from './chunker.js';

/** 文档登记（版本管理）：hash/模型未变即跳过重嵌入 */
export interface DocRecord {
  docPath: string;
  docHash: string;
  mtimeMs: number;
  chunkCount: number;
  indexedAt: number;
  model: string;
  dims: number;
}

export interface StoreMeta {
  model: string | null;
  dims: number;
  docCount: number;
  chunkCount: number;
}

export interface VectorStore {
  meta(): StoreMeta;
  docs(): DocRecord[];
  chunks(): Chunk[];
  getDoc(docPath: string): DocRecord | undefined;
  upsertDoc(doc: DocRecord, chunks: Chunk[], vectors: number[][]): Promise<void>;
  /** 仅刷新登记表 mtime（内容未变的跳过场景，如重克隆后 mtime 全变），不动向量 */
  touchDoc(docPath: string, mtimeMs: number): Promise<void>;
  removeDoc(docPath: string): Promise<void>;
  /** 归一化查询向量 → [{chunk, score}] 按余弦降序 */
  search(vector: number[], topN: number): { chunk: Chunk; score: number }[];
  /** 数据版本号：每次写入自增，关键词索引缓存失效用 */
  version(): number;
}

interface IndexFile {
  version: 1;
  model: string | null;
  dims: number;
  docs: DocRecord[];
  chunks: Chunk[];
}

const EMPTY: IndexFile = { version: 1, model: null, dims: 0, docs: [], chunks: [] };

export function ragDir(vaultId: string): string {
  return path.join(configDir(), 'rag', vaultId);
}

export class FileVectorStore implements VectorStore {
  private data: IndexFile = { ...EMPTY, docs: [], chunks: [] };
  private vectors = new Float32Array(0);
  private ver = 0;

  constructor(private dir: string) {}

  async load(): Promise<void> {
    try {
      const [idxRaw, binRaw] = await Promise.all([
        readFile(path.join(this.dir, 'index.json'), 'utf8'),
        readFile(path.join(this.dir, 'vectors.bin')),
      ]);
      const parsed = JSON.parse(idxRaw) as IndexFile;
      const vecs = new Float32Array(binRaw.buffer, binRaw.byteOffset, binRaw.byteLength / 4);
      // 一致性校验：向量行数必须与片段数对齐，否则视作空库（损坏不崩服务）
      if (parsed.dims > 0 && vecs.length !== parsed.chunks.length * parsed.dims) {
        this.data = { ...EMPTY, docs: [], chunks: [] };
        this.vectors = new Float32Array(0);
        return;
      }
      this.data = parsed;
      this.vectors = vecs.slice(); // 脱离 Buffer 底层，避免复用
    } catch {
      this.data = { ...EMPTY, docs: [], chunks: [] };
      this.vectors = new Float32Array(0);
    }
  }

  meta(): StoreMeta {
    return {
      model: this.data.model,
      dims: this.data.dims,
      docCount: this.data.docs.length,
      chunkCount: this.data.chunks.length,
    };
  }

  docs(): DocRecord[] {
    return this.data.docs;
  }

  chunks(): Chunk[] {
    return this.data.chunks;
  }

  getDoc(docPath: string): DocRecord | undefined {
    return this.data.docs.find((d) => d.docPath === docPath);
  }

  version(): number {
    return this.ver;
  }

  async upsertDoc(doc: DocRecord, chunks: Chunk[], vectors: number[][]): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(`片段数(${chunks.length})与向量数(${vectors.length})不一致`);
    }
    const dims = vectors[0]?.length ?? this.data.dims;
    // 模型或维度变更：清空整库重建（避免混合空间检索无意义）
    if (this.data.model !== null && (this.data.model !== doc.model || (this.data.dims && dims && this.data.dims !== dims))) {
      this.data = { ...EMPTY, docs: [], chunks: [] };
      this.vectors = new Float32Array(0);
    }
    this.removeInMemory(doc.docPath);
    this.data.model = doc.model;
    if (dims) this.data.dims = dims;
    this.data.docs.push(doc);
    const old = this.vectors;
    const next = new Float32Array(old.length + chunks.length * this.data.dims);
    next.set(old);
    let off = old.length;
    for (const v of vectors) {
      next.set(v, off);
      off += this.data.dims;
    }
    this.vectors = next;
    this.data.chunks.push(...chunks);
    await this.persist();
  }

  async touchDoc(docPath: string, mtimeMs: number): Promise<void> {
    const rec = this.data.docs.find((d) => d.docPath === docPath);
    if (!rec || rec.mtimeMs === mtimeMs) return;
    rec.mtimeMs = mtimeMs;
    await this.persist();
  }

  async removeDoc(docPath: string): Promise<void> {
    this.removeInMemory(docPath);
    await this.persist();
  }

  /** 清空整库（向量库管理页的危险动作） */
  async clear(): Promise<void> {
    this.data = { ...EMPTY, docs: [], chunks: [] };
    this.vectors = new Float32Array(0);
    await this.persist();
  }

  private removeInMemory(docPath: string): void {
    const keep: number[] = [];
    this.data.chunks.forEach((c, i) => {
      if (c.docPath !== docPath) keep.push(i);
    });
    if (keep.length !== this.data.chunks.length) {
      const dims = this.data.dims;
      const next = new Float32Array(keep.length * dims);
      keep.forEach((srcIdx, dstIdx) => {
        next.set(this.vectors.subarray(srcIdx * dims, (srcIdx + 1) * dims), dstIdx * dims);
      });
      this.vectors = next;
      this.data.chunks = keep.map((i) => this.data.chunks[i]);
    }
    this.data.docs = this.data.docs.filter((d) => d.docPath !== docPath);
  }

  search(vector: number[], topN: number): { chunk: Chunk; score: number }[] {
    const dims = this.data.dims;
    if (!dims || vector.length !== dims) return [];
    const n = this.data.chunks.length;
    const scored: { chunk: Chunk; score: number }[] = [];
    for (let i = 0; i < n; i++) {
      let s = 0;
      const base = i * dims;
      for (let j = 0; j < dims; j++) s += this.vectors[base + j] * vector[j];
      scored.push({ chunk: this.data.chunks[i], score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  private async persist(): Promise<void> {
    this.ver++;
    await mkdir(this.dir, { recursive: true });
    const idxTmp = path.join(this.dir, 'index.json.tmp');
    const binTmp = path.join(this.dir, 'vectors.bin.tmp');
    await writeFile(idxTmp, JSON.stringify(this.data));
    await writeFile(binTmp, Buffer.from(this.vectors.buffer, this.vectors.byteOffset, this.vectors.byteLength));
    await rename(idxTmp, path.join(this.dir, 'index.json'));
    await rename(binTmp, path.join(this.dir, 'vectors.bin'));
  }
}

// 进程内缓存：同一 vault 复用已加载的 store（40MB 级冷加载只发生一次）
const cache = new Map<string, FileVectorStore>();

export async function openStore(vaultId: string): Promise<FileVectorStore> {
  const dir = ragDir(vaultId);
  let store = cache.get(dir);
  if (!store) {
    store = new FileVectorStore(dir);
    await store.load();
    cache.set(dir, store);
  }
  return store;
}

/** 测试用：清空进程内缓存 */
export function clearStoreCache(): void {
  cache.clear();
}
