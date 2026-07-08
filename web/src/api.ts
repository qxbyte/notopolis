import type { CityModel, VaultConfig } from '@shared/types';

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

export async function fetchNote(id: string, relPath: string): Promise<string> {
  const res = await apiFetch(`/api/note/${id}?path=${encodeURIComponent(relPath)}`);
  const data = (await res.json()) as { markdown: string };
  return data.markdown;
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

    socket = new WebSocket(`ws://${location.host}/ws`);

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
