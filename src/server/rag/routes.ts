/**
 * rag/routes.ts — RAG 全部 REST 端点（Fastify 插件）。
 * 松耦合铁律:未启用/未配置时相关端点返回 400 + 中文原因；
 * 任何 RAG 故障只影响自身端点，绝不拖垮主服务。
 */
import type { FastifyInstance } from 'fastify';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { RagChunkInfo, RagConfig, RagHit, RagStats } from '../../shared/types.js';
import { loadConfig, saveConfig } from '../config.js';
import { scanVault } from '../scanner.js';
import { ragAnswer } from './answer.js';
import { embedTexts, testChat, testEmbedding, type FetchFn } from './embed.js';
import { docStatuses, jobProgress, startIndexJob } from './indexer.js';
import { keywordIndexFor } from './keyword.js';
import {
  activeChat,
  activeEmbedding,
  maskRagConfig,
  resolveRagConfig,
  unmaskRagConfig,
} from './ragconfig.js';
import { retrieve, toHit, type RetrieveMode } from './retriever.js';
import { openStore, ragDir } from './store.js';
import { appendFeedback, exportDownToEval, feedbackStats, type FeedbackKind } from './feedback.js';
import { loadEvalSet, runEval } from './evaluate.js';

export interface RagRouteOpts {
  /** 测试注入：替代真实网络请求 */
  fetchFn?: FetchFn;
}

async function currentRagConfig(): Promise<RagConfig> {
  return resolveRagConfig((await loadConfig()).rag);
}

export async function registerRagRoutes(app: FastifyInstance, opts: RagRouteOpts = {}): Promise<void> {
  const fetchFn = opts.fetchFn;

  /** vault 解析（404 处理留给调用处） */
  async function vaultOf(vaultId: string) {
    const cfg = await loadConfig();
    return cfg.vaults.find((v) => v.id === vaultId) ?? null;
  }

  /** 检索链路组装（search / ask / eval 共用同一实现，评估的就是线上链路） */
  async function makeRetriever(vaultId: string, rag: RagConfig) {
    const store = await openStore(vaultId);
    const meta = store.meta();
    const ep = activeEmbedding(rag);
    if (meta.chunkCount > 0 && meta.model && meta.model !== ep.model) {
      throw new Error(`嵌入模型已从 ${meta.model} 变更为 ${ep.model}，请在文档面板重新入库`);
    }
    const kwIndex = keywordIndexFor(vaultId, store.version(), store.chunks());
    const embedQuery = async (q: string): Promise<number[]> =>
      (await embedTexts([q], ep, fetchFn))[0];
    return { store, kwIndex, embedQuery };
  }

  // ---- 配置 ----

  app.get('/api/rag/config', async () => maskRagConfig(await currentRagConfig()));

  app.put('/api/rag/config', async (req, reply) => {
    const body = req.body as RagConfig | undefined;
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: '配置体缺失' });
    const cfg = await loadConfig();
    const existing = resolveRagConfig(cfg.rag);
    const incoming = resolveRagConfig(body); // 补全缺省 + 字段校验
    cfg.rag = unmaskRagConfig(incoming, existing);
    await saveConfig(cfg);
    return maskRagConfig(cfg.rag);
  });

  app.post('/api/rag/test', async (req, reply) => {
    const { target } = (req.body ?? {}) as { target?: string };
    const rag = await currentRagConfig();
    if (target === 'embedding') return testEmbedding(activeEmbedding(rag), fetchFn);
    if (target === 'chat') {
      const ep = activeChat(rag);
      if (!ep) return reply.code(400).send({ error: '问答模型未启用' });
      return testChat(ep, fetchFn);
    }
    return reply.code(400).send({ error: 'target 须为 embedding 或 chat' });
  });

  // ---- 文档状态 / 入库 ----

  app.get('/api/rag/:vaultId/docs', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const vault = await vaultOf(vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const rag = await currentRagConfig();
    const scan = await scanVault(vault.path);
    const store = await openStore(vaultId);
    return { docs: docStatuses(scan.notes, store, activeEmbedding(rag).model) };
  });

  app.post('/api/rag/:vaultId/index', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const vault = await vaultOf(vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const rag = await currentRagConfig();
    if (!rag.enabled) return reply.code(400).send({ error: '向量检索未启用，请先到设置中开启' });

    const body = (req.body ?? {}) as { paths?: string[] };
    const scan = await scanVault(vault.path);
    const all = scan.notes.map((n) => n.path);
    let paths: string[];
    if (Array.isArray(body.paths) && body.paths.length > 0) {
      const valid = new Set(all);
      paths = body.paths.filter((p) => valid.has(p)); // 只接受 vault 内真实存在的 md
    } else {
      paths = all;
    }
    if (paths.length === 0) return reply.code(400).send({ error: '没有可入库的文档' });

    const store = await openStore(vaultId);
    const r = startIndexJob(vaultId, vault.path, paths, {
      store,
      endpoint: activeEmbedding(rag),
      fetchFn,
    });
    if (!r.started) return reply.code(409).send({ error: r.reason });
    return { started: true, total: paths.length };
  });

  app.get('/api/rag/:vaultId/index/progress', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    return jobProgress(vaultId);
  });

  app.delete('/api/rag/:vaultId/doc', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rel = (req.query as { path?: string }).path;
    if (!rel) return reply.code(400).send({ error: 'path required' });
    const store = await openStore(vaultId);
    await store.removeDoc(rel);
    return { ok: true };
  });

  // ---- 向量库管理 ----

  app.get('/api/rag/:vaultId/stats', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const vault = await vaultOf(vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const rag = await currentRagConfig();
    const scan = await scanVault(vault.path);
    const store = await openStore(vaultId);
    const meta = store.meta();
    const statuses = docStatuses(scan.notes, store, activeEmbedding(rag).model);
    const fileSize = async (name: string): Promise<number> => {
      try {
        return (await stat(path.join(ragDir(vaultId), name))).size;
      } catch {
        return 0;
      }
    };
    const lastIndexedAt = store.docs().reduce<number | null>(
      (max, d) => (max === null || d.indexedAt > max ? d.indexedAt : max),
      null,
    );
    const stats: RagStats = {
      docTotal: statuses.length,
      indexed: statuses.filter((s) => s.state === 'indexed').length,
      stale: statuses.filter((s) => s.state === 'stale').length,
      none: statuses.filter((s) => s.state === 'none').length,
      chunkCount: meta.chunkCount,
      dims: meta.dims,
      model: meta.model,
      bytes: (await fileSize('index.json')) + (await fileSize('vectors.bin')),
      lastIndexedAt,
      modelMismatch: meta.model !== null && meta.model !== activeEmbedding(rag).model,
    };
    return stats;
  });

  app.get('/api/rag/:vaultId/doc/chunks', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rel = (req.query as { path?: string }).path;
    if (!rel) return reply.code(400).send({ error: 'path required' });
    const store = await openStore(vaultId);
    const chunks: RagChunkInfo[] = store
      .chunks()
      .filter((c) => c.docPath === rel)
      .map((c) => ({
        index: c.index,
        headings: c.headings,
        startLine: c.startLine,
        endLine: c.endLine,
        chars: c.text.length,
        hash: c.hash,
        text: c.text,
      }));
    return { chunks };
  });

  app.delete('/api/rag/:vaultId/store', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    const store = await openStore(vaultId);
    await store.clear();
    return { ok: true };
  });

  // ---- 检索 / 问答 ----

  app.get('/api/rag/:vaultId/search', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const { q, mode } = req.query as { q?: string; mode?: string };
    if (!q?.trim()) return { hits: [] };
    const rag = await currentRagConfig();
    if (!rag.enabled) return reply.code(400).send({ error: '向量检索未启用' });
    try {
      const deps = await makeRetriever(vaultId, rag);
      const m: RetrieveMode = mode === 'vector' || mode === 'keyword' ? mode : 'hybrid';
      const hits = await retrieve(q, deps, rag.retrieval, m);
      return { hits: hits.map(toHit) };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.post('/api/rag/:vaultId/ask', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const { question } = (req.body ?? {}) as { question?: string };
    if (!question?.trim()) return reply.code(400).send({ error: 'question required' });
    const rag = await currentRagConfig();
    if (!rag.enabled) return reply.code(400).send({ error: '向量检索未启用' });
    const chatEp = activeChat(rag);
    if (!chatEp) return reply.code(400).send({ error: '问答模型未配置，请到设置中开启' });
    try {
      const deps = await makeRetriever(vaultId, rag);
      const hits = await retrieve(question, deps, rag.retrieval, 'hybrid');
      return await ragAnswer(question, hits.map(toHit), chatEp, fetchFn);
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // ---- 反馈 ----

  app.post('/api/rag/:vaultId/feedback', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const body = (req.body ?? {}) as {
      kind?: string;
      question?: string;
      answer?: string;
      citations?: string[];
      comment?: string;
    };
    const kinds: FeedbackKind[] = ['up', 'down', 'followup', 'rewrite'];
    if (!kinds.includes(body.kind as FeedbackKind) || !body.question) {
      return reply.code(400).send({ error: 'kind(up|down|followup|rewrite) 与 question 必填' });
    }
    await appendFeedback(vaultId, {
      ts: Date.now(),
      kind: body.kind as FeedbackKind,
      question: body.question,
      answer: body.answer,
      citations: body.citations,
      comment: body.comment,
    });
    return { ok: true };
  });

  app.get('/api/rag/:vaultId/feedback/stats', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    return feedbackStats(vaultId);
  });

  // ---- 评估 ----

  app.get('/api/rag/:vaultId/eval', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    return loadEvalSet(vaultId);
  });

  app.post('/api/rag/:vaultId/eval/from-feedback', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    const added = await exportDownToEval(vaultId);
    return { added };
  });

  app.post('/api/rag/:vaultId/eval/run', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rag = await currentRagConfig();
    if (!rag.enabled) return reply.code(400).send({ error: '向量检索未启用' });
    try {
      const set = await loadEvalSet(vaultId);
      if (set.cases.length === 0) {
        return reply.code(400).send({ error: '评估集为空——可先「差评导入评估集」或手工编辑 eval.json' });
      }
      const deps = await makeRetriever(vaultId, rag);
      const chatEp = activeChat(rag);
      const doRetrieve = async (q: string): Promise<RagHit[]> =>
        (await retrieve(q, deps, rag.retrieval, 'hybrid')).map(toHit);
      return await runEval(set, {
        retrieve: doRetrieve,
        ask: chatEp ? (q, ev) => ragAnswer(q, ev, chatEp, fetchFn) : null,
      });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });
}
