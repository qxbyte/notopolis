import type {
  CityDiff,
  CityModel,
  RagAnswer,
  RagChunkInfo,
  RagConfig,
  RagDocStatus,
  RagHit,
  RagIndexProgress,
  RagStats,
  VaultConfig,
} from '@shared/types';

export type WorldVault = VaultConfig & {
  noteCount: number;
  tier: string;
  ok: boolean;
  reason?: string;
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export async function fetchWorld(): Promise<{ vaults: WorldVault[] }> {
  const res = await apiFetch('/api/world');
  return res.json() as Promise<{ vaults: WorldVault[] }>;
}

export async function fetchCity(id: string): Promise<CityModel> {
  const res = await apiFetch(`/api/city/${id}`);
  return res.json() as Promise<CityModel>;
}

/** 入城变化摘要（POST，有副作用：推进快照基线） */
export async function fetchVisitSummary(id: string): Promise<CityDiff> {
  const res = await apiFetch(`/api/city/${id}/visit`, { method: 'POST' });
  return res.json() as Promise<CityDiff>;
}

export async function fetchNote(id: string, relPath: string): Promise<string> {
  const res = await apiFetch(`/api/note/${id}?path=${encodeURIComponent(relPath)}`);
  const data = (await res.json()) as { markdown: string };
  return data.markdown;
}

/** 保存笔记原文（覆盖已存在的 .md） */
export async function saveNote(id: string, relPath: string, markdown: string): Promise<void> {
  await apiFetch(`/api/note/${id}?path=${encodeURIComponent(relPath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
}

export async function addVault(name: string, path: string, theme: string): Promise<VaultConfig> {
  const res = await apiFetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path, theme }),
  });
  return res.json() as Promise<VaultConfig>;
}

export async function removeVault(id: string): Promise<void> {
  await apiFetch(`/api/vaults/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// RAG（向量检索）API —— 全部端点可降级：未配置时服务端返回 400 中文原因，
// 调用方捕获后按松耦合原则回退（不影响原有功能）。
// ---------------------------------------------------------------------------

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function ragGetConfig(): Promise<RagConfig> {
  return apiJson('/api/rag/config');
}

export function ragSaveConfig(cfg: RagConfig): Promise<RagConfig> {
  return apiJson('/api/rag/config', jsonInit('PUT', cfg));
}

export function ragTest(
  target: 'embedding' | 'chat',
): Promise<{ ok: boolean; dims?: number; reply?: string; error?: string }> {
  return apiJson('/api/rag/test', jsonInit('POST', { target }));
}

export async function ragDocs(vaultId: string): Promise<RagDocStatus[]> {
  const data = await apiJson<{ docs: RagDocStatus[] }>(`/api/rag/${vaultId}/docs`);
  return data.docs;
}

export function ragIndex(vaultId: string, paths?: string[]): Promise<{ started: boolean; total: number }> {
  return apiJson(`/api/rag/${vaultId}/index`, jsonInit('POST', paths?.length ? { paths } : {}));
}

export function ragProgress(vaultId: string): Promise<RagIndexProgress> {
  return apiJson(`/api/rag/${vaultId}/index/progress`);
}

export function ragRemoveDoc(vaultId: string, path: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/rag/${vaultId}/doc?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export function ragStats(vaultId: string): Promise<RagStats> {
  return apiJson(`/api/rag/${vaultId}/stats`);
}

export async function ragDocChunks(vaultId: string, path: string): Promise<RagChunkInfo[]> {
  const data = await apiJson<{ chunks: RagChunkInfo[] }>(
    `/api/rag/${vaultId}/doc/chunks?path=${encodeURIComponent(path)}`,
  );
  return data.chunks;
}

export function ragClearStore(vaultId: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/rag/${vaultId}/store`, { method: 'DELETE' });
}

export async function ragSearch(vaultId: string, q: string): Promise<RagHit[]> {
  const data = await apiJson<{ hits: RagHit[] }>(
    `/api/rag/${vaultId}/search?q=${encodeURIComponent(q)}`,
  );
  return data.hits;
}

export function ragAsk(vaultId: string, question: string): Promise<RagAnswer> {
  return apiJson(`/api/rag/${vaultId}/ask`, jsonInit('POST', { question }));
}

export function ragFeedback(
  vaultId: string,
  ev: { kind: 'up' | 'down' | 'followup' | 'rewrite'; question: string; answer?: string; citations?: string[]; comment?: string },
): Promise<{ ok: boolean }> {
  return apiJson(`/api/rag/${vaultId}/feedback`, jsonInit('POST', ev));
}

export function ragFeedbackStats(vaultId: string): Promise<{
  total: number;
  byKind: Record<'up' | 'down' | 'followup' | 'rewrite', number>;
  recentDown: { ts: number; question: string }[];
}> {
  return apiJson(`/api/rag/${vaultId}/feedback/stats`);
}

export function ragEvalRun(vaultId: string): Promise<{
  caseCount: number;
  draftCount: number;
  recallAtK: number;
  mrr: number;
  answerOkRate: number | null;
  citationPrecision: number | null;
}> {
  return apiJson(`/api/rag/${vaultId}/eval/run`, jsonInit('POST', {}));
}

export function ragEvalFromFeedback(vaultId: string): Promise<{ added: number }> {
  return apiJson(`/api/rag/${vaultId}/eval/from-feedback`, jsonInit('POST', {}));
}

// ---------------------------------------------------------------------------
// WebSocket with exponential back-off reconnect
// ---------------------------------------------------------------------------

const WS_INITIAL_DELAY_MS = 1000;
const WS_MAX_DELAY_MS = 30_000;

export function connectWS(onCityUpdated: (vaultId: string) => void): () => void {
  let closed = false;
  let delay = WS_INITIAL_DELAY_MS;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;

    // 跟随页面协议：https 页面必须用 wss，否则浏览器按 Mixed Content 拦截并抛
    // SecurityError（该异常若在模块顶层 connectWS 处未捕获会中断整个前端初始化）
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${wsProto}//${location.host}/ws`);

    socket.onopen = () => {
      // Successful connection — reset back-off
      delay = WS_INITIAL_DELAY_MS;
    };

    socket.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; vaultId?: string };
        if (msg.type === 'city-updated' && msg.vaultId != null) {
          onCityUpdated(msg.vaultId);
        }
      } catch {
        // ignore malformed messages
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      if (reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
      delay = Math.min(delay * 2, WS_MAX_DELAY_MS);
    };

    socket.onclose = scheduleReconnect;
    socket.onerror = scheduleReconnect;
  }

  connect();

  return function dispose() {
    closed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    socket?.close();
  };
}
