/**
 * rag/ragconfig.ts — RAG 配置的缺省值、合并与 apiKey 掩码。
 * 配置存于 config.json 的 rag 字段；任何字段缺失都回落到缺省值，
 * 保证旧配置文件无缝升级。
 */
import type { RagConfig, RagEndpoint } from '../../shared/types.js';

export const MASKED_KEY = '••••••••';

export function defaultRagConfig(): RagConfig {
  return {
    enabled: false,
    embedding: {
      mode: 'local',
      local: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3-embedding:0.6b' },
      remote: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '',
        model: 'text-embedding-v4',
      },
    },
    chat: {
      mode: 'off',
      local: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' },
      remote: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '',
        model: 'qwen-plus',
      },
    },
    retrieval: {
      topK: 8,
      minScore: 0.35,
      perDocLimit: 3,
      maxContextChars: 6000,
      hybrid: true,
    },
  };
}

function mergeEndpoint(base: RagEndpoint, patch?: Partial<RagEndpoint>): RagEndpoint {
  return {
    baseUrl: typeof patch?.baseUrl === 'string' ? patch.baseUrl : base.baseUrl,
    apiKey: typeof patch?.apiKey === 'string' ? patch.apiKey : base.apiKey,
    model: typeof patch?.model === 'string' ? patch.model : base.model,
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** 缺省值 ⊕ 存量配置 ⊕ 补丁，逐字段合并（补丁里的 undefined 不覆盖） */
export function mergeRagConfig(base: RagConfig, patch?: DeepPartial<RagConfig>): RagConfig {
  if (!patch) return base;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    embedding: {
      mode: patch.embedding?.mode === 'remote' || patch.embedding?.mode === 'local'
        ? patch.embedding.mode
        : base.embedding.mode,
      local: mergeEndpoint(base.embedding.local, patch.embedding?.local),
      remote: mergeEndpoint(base.embedding.remote, patch.embedding?.remote),
    },
    chat: {
      mode: patch.chat?.mode === 'off' || patch.chat?.mode === 'local' || patch.chat?.mode === 'remote'
        ? patch.chat.mode
        : base.chat.mode,
      local: mergeEndpoint(base.chat.local, patch.chat?.local),
      remote: mergeEndpoint(base.chat.remote, patch.chat?.remote),
    },
    retrieval: {
      topK: num(patch.retrieval?.topK, base.retrieval.topK),
      minScore: num(patch.retrieval?.minScore, base.retrieval.minScore),
      perDocLimit: num(patch.retrieval?.perDocLimit, base.retrieval.perDocLimit),
      maxContextChars: num(patch.retrieval?.maxContextChars, base.retrieval.maxContextChars),
      hybrid: typeof patch.retrieval?.hybrid === 'boolean' ? patch.retrieval.hybrid : base.retrieval.hybrid,
    },
  };
}

/** 读取时补全缺省值 */
export function resolveRagConfig(raw: unknown): RagConfig {
  return mergeRagConfig(defaultRagConfig(), (raw ?? undefined) as Parameters<typeof mergeRagConfig>[1]);
}

/** 返回给前端的配置：apiKey 替换为掩码（非空时），永不泄露明文 */
export function maskRagConfig(cfg: RagConfig): RagConfig {
  const mask = (ep: RagEndpoint): RagEndpoint => ({
    ...ep,
    apiKey: ep.apiKey ? MASKED_KEY : '',
  });
  return {
    ...cfg,
    embedding: { ...cfg.embedding, local: mask(cfg.embedding.local), remote: mask(cfg.embedding.remote) },
    chat: { ...cfg.chat, local: mask(cfg.chat.local), remote: mask(cfg.chat.remote) },
  };
}

/** 保存时还原掩码：前端回传掩码值表示「未修改」，沿用存量明文 */
export function unmaskRagConfig(incoming: RagConfig, existing: RagConfig): RagConfig {
  const unmask = (ep: RagEndpoint, prev: RagEndpoint): RagEndpoint => ({
    ...ep,
    apiKey: ep.apiKey === MASKED_KEY ? prev.apiKey : ep.apiKey,
  });
  return {
    ...incoming,
    embedding: {
      ...incoming.embedding,
      local: unmask(incoming.embedding.local, existing.embedding.local),
      remote: unmask(incoming.embedding.remote, existing.embedding.remote),
    },
    chat: {
      ...incoming.chat,
      local: unmask(incoming.chat.local, existing.chat.local),
      remote: unmask(incoming.chat.remote, existing.chat.remote),
    },
  };
}

/** 当前生效的嵌入端点 */
export function activeEmbedding(cfg: RagConfig): RagEndpoint {
  return cfg.embedding.mode === 'remote' ? cfg.embedding.remote : cfg.embedding.local;
}

/** 当前生效的问答端点（off 返回 null） */
export function activeChat(cfg: RagConfig): RagEndpoint | null {
  if (cfg.chat.mode === 'off') return null;
  return cfg.chat.mode === 'remote' ? cfg.chat.remote : cfg.chat.local;
}
