/**
 * rag/external.ts — 对外知识库 API（固定接入模板，供 AgentX 等外部系统检索本库）。
 * 三端点契约：
 *   GET  /api/external-kb/heartbeat            存活探测
 *   GET  /api/external-kb/info?vault=<id>      库信息 + embedding 模型/维度（供调用方做一致性校验）
 *   POST /api/external-kb/search               {vault, vector, topK?, threshold?} → {hits}
 * 检索接收**外部已向量化的查询**（调用方用与本库一致的 embedding 模型），vault 必选——
 * 不同 Obsidian 仓库内容非同类，混检互相污染。
 * 松耦合铁律：只读现有向量库；任何故障仅影响本组端点，绝不拖垮主服务。
 */
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.js';
import { openStore } from './store.js';

const SERVICE = 'notopolis';
const TEMPLATE_VERSION = 1;

interface SearchBody {
  vault?: string;
  vector?: number[];
  topK?: number;
  threshold?: number;
}

/** 查询向量归一化（库内向量嵌入时已归一化，点积即余弦；容忍调用方未归一化） */
function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum);
  if (!Number.isFinite(len) || len === 0) return v;
  return v.map((x) => x / len);
}

export async function registerExternalKbRoutes(app: FastifyInstance): Promise<void> {
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
    if (!Array.isArray(body.vector) || body.vector.length === 0) {
      return reply.code(400).send({ error: '必须提供查询向量 vector（调用方负责向量化）' });
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
    if (body.vector.length !== meta.dims) {
      return reply.code(400).send({
        error: `向量维度不匹配：收到 ${body.vector.length}，本库为 ${meta.dims}（模型 ${meta.model ?? '未知'}）。请确认调用方 embedding 模型与本库一致`,
      });
    }

    const topK = Math.min(Math.max(body.topK ?? 5, 1), 50);
    const threshold = body.threshold ?? 0;
    const hits = store
      .search(normalize(body.vector), topK)
      .filter((h) => h.score >= threshold)
      .map((h) => ({
        text: h.chunk.text,
        score: h.score,
        title: h.chunk.title,
        path: h.chunk.docPath,
      }));
    return { hits, indexed: true, embedding: { model: meta.model, dims: meta.dims } };
  });
}
