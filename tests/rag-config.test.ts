import { describe, expect, it } from 'vitest';
import {
  activeChat,
  activeEmbedding,
  defaultRagConfig,
  MASKED_KEY,
  maskRagConfig,
  resolveRagConfig,
  unmaskRagConfig,
} from '../src/server/rag/ragconfig.js';

describe('resolveRagConfig', () => {
  it('空/缺失输入返回缺省值（功能关闭）', () => {
    const cfg = resolveRagConfig(undefined);
    expect(cfg.enabled).toBe(false);
    expect(cfg.embedding.mode).toBe('local');
    expect(cfg.retrieval.topK).toBe(8);
  });

  it('部分字段补齐（旧配置无缝升级）', () => {
    const cfg = resolveRagConfig({ enabled: true, retrieval: { topK: 3 } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.retrieval.topK).toBe(3);
    expect(cfg.retrieval.minScore).toBe(0.35); // 缺省补齐
    expect(cfg.embedding.remote.model).toBe('text-embedding-v4');
  });

  it('非法枚举值回落缺省', () => {
    const cfg = resolveRagConfig({ embedding: { mode: 'weird' }, chat: { mode: 'weird' } });
    expect(cfg.embedding.mode).toBe('local');
    expect(cfg.chat.mode).toBe('off');
  });
});

describe('apiKey 掩码', () => {
  it('mask：有 key 显掩码，无 key 显空', () => {
    const cfg = defaultRagConfig();
    cfg.embedding.remote.apiKey = 'sk-secret';
    const masked = maskRagConfig(cfg);
    expect(masked.embedding.remote.apiKey).toBe(MASKED_KEY);
    expect(masked.embedding.local.apiKey).toBe('');
    expect(cfg.embedding.remote.apiKey).toBe('sk-secret'); // 原对象不动
  });

  it('unmask：掩码值=未修改沿用存量，新值覆盖，空值清除', () => {
    const existing = defaultRagConfig();
    existing.embedding.remote.apiKey = 'sk-old';
    existing.chat.remote.apiKey = 'sk-chat';

    const incoming = maskRagConfig(existing);
    incoming.chat.remote.apiKey = 'sk-new';
    const merged = unmaskRagConfig(incoming, existing);
    expect(merged.embedding.remote.apiKey).toBe('sk-old'); // 掩码 → 沿用
    expect(merged.chat.remote.apiKey).toBe('sk-new'); // 明文 → 覆盖

    incoming.embedding.remote.apiKey = '';
    expect(unmaskRagConfig(incoming, existing).embedding.remote.apiKey).toBe(''); // 清除
  });
});

describe('生效端点', () => {
  it('activeEmbedding 跟随 mode', () => {
    const cfg = defaultRagConfig();
    expect(activeEmbedding(cfg).baseUrl).toContain('localhost');
    cfg.embedding.mode = 'remote';
    expect(activeEmbedding(cfg).baseUrl).toContain('dashscope');
  });
  it('activeChat：off 返回 null', () => {
    const cfg = defaultRagConfig();
    expect(activeChat(cfg)).toBeNull();
    cfg.chat.mode = 'local';
    expect(activeChat(cfg)?.model).toBe('qwen3:8b');
  });
});
