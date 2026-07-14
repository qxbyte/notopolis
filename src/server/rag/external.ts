/**
 * rag/external.ts — 对外知识库 API（固定接入模板，供 AgentX 等外部系统检索本库）。
 * 三端点契约：
 *   GET  /api/external-kb/heartbeat            存活探测
 *   GET  /api/external-kb/info?vault=<id>      库信息（vault 列表 + embedding 模型/维度，展示用）
 *   POST /api/external-kb/search               {vault, query, topK?, threshold?} → {hits}
 *
 * 契约刻意最小化：调用方只发**自然语言查询文本**，本库用**自己的** embedding 模型把它
 * 向量化、在**自己的**向量索引里做相似检索、返回候选片段。检索的"质量层"——多轮改写、
 * 多查询扩展、跨查询 RRF 融合、重排——全由调用方（AgentX）掌控，本接口既不承担、也
 * 不要求接入方实现混合检索：任何有「向量库 + embedding 模型」的系统都能几十行实现本契约，
 * 调用方的检索质量不因接入库是否"聪明"而波动。
 *
 * vault 必选：不同 Obsidian 仓库内容非同类，混检互相污染。
 * 松耦合铁律：只读现有向量库；任何故障仅影响本组端点，绝不拖垮主服务。
 */
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.js';
import { embedTexts, type FetchFn } from './embed.js';
import { activeEmbedding, resolveRagConfig } from './ragconfig.js';
import { openStore } from './store.js';

const SERVICE = 'notopolis';
const TEMPLATE_VERSION = 2; // v2：查询载荷由「向量」改为「文本」，本库自行向量化（解耦调用方 embedding 模型）

interface SearchBody {
  vault?: string;
  query?: string;
  topK?: number;
  threshold?: number;
}

interface ExternalKbOpts {
  /** 注入 fetch（供离线测试用假嵌入服务）；缺省用全局 fetch。 */
  fetchFn?: FetchFn;
}

export async function registerExternalKbRoutes(
  app: FastifyInstance,
  opts: ExternalKbOpts = {},
): Promise<void> {
  const fetchFn = opts.fetchFn;

  app.get('/api/external-kb/heartbeat', async () => ({
    ok: true,
    service: SERVICE,
    templateVersion: TEMPLATE_VERSION,
  }));

  app.get('/api/external-kb/info', async (req, reply) => {
    const { vault } = req.query as { vault?: string };
    const cfg = await loadConfig();

    const infoOf = async (v: { id: string; name: string }) => {
      const meta = (await openStore(v.id)).meta();
      return {
        vaultId: v.id,
        name: v.name,
        docCount: meta.docCount,
        chunkCount: meta.chunkCount,
        embedding: { model: meta.model, dims: meta.dims },
      };
    };

    if (!vault) {
      // 不指定 vault：列出全部可接入的仓库，调用方据此选定 vaultId
      return { service: SERVICE, vaults: await Promise.all(cfg.vaults.map(infoOf)) };
    }
    const target = cfg.vaults.find((v) => v.id === vault);
    if (!target) {
      return reply.code(404).send({ error: `未知 vault: ${vault}` });
    }
    return infoOf(target);
  });

  app.post('/api/external-kb/search', async (req, reply) => {
    const body = (req.body ?? {}) as SearchBody;
    if (!body.vault) {
      return reply.code(400).send({ error: '必须指定 vault（不同仓库内容非同类，混检互相污染）' });
    }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return reply.code(400).send({ error: '必须提供查询文本 query（本库负责向量化）' });
    }
    const cfg = await loadConfig();
    if (!cfg.vaults.some((v) => v.id === body.vault)) {
      return reply.code(404).send({ error: `未知 vault: ${body.vault}` });
    }

    const store = await openStore(body.vault);
    const meta = store.meta();
    if (meta.chunkCount === 0) {
      return { hits: [], indexed: false, message: '该仓库尚未建立向量索引' };
    }

    const ep = activeEmbedding(resolveRagConfig(cfg.rag));
    // 内部一致性自保：索引所用模型与当前 embedding 配置不一致 → 查询向量与索引不在同一
    // 空间，检索无意义。这是本库对自身正确性的保护（调用方无从、也无需知道本库用什么模型）。
    if (meta.model && meta.model !== ep.model) {
      return reply.code(409).send({
        error: `本库索引由 ${meta.model} 建立，当前 embedding 配置为 ${ep.model}，请先重新入库再检索`,
      });
    }

    let qv: number[];
    try {
      // embedTexts 输出已归一化，可直接喂给向量检索（与站内检索同一路径）
      qv = (await embedTexts([query], ep, fetchFn))[0];
    } catch (e) {
      return reply.code(502).send({ error: `查询向量化失败：${(e as Error).message}` });
    }

    const topK = Math.min(Math.max(body.topK ?? 5, 1), 50);
    const threshold = body.threshold ?? 0;
    const hits = store
      .search(qv, topK)
      .filter((h) => h.score >= threshold)
      .map((h) => ({
        text: h.chunk.text,
        score: h.score,
        title: h.chunk.title,
        path: h.chunk.docPath,
        // 定位字段（可选约定）：章节链 + 原文行号区间，供调用方展示来源位置
        headings: h.chunk.headings,
        startLine: h.chunk.startLine,
        endLine: h.chunk.endLine,
      }));
    return { hits, indexed: true, embedding: { model: meta.model, dims: meta.dims } };
  });
}
