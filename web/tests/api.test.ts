import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorldVault } from '../src/api';
import {
  fetchWorld,
  fetchCity,
  fetchNote,
  addVault,
  removeVault,
  connectWS,
} from '../src/api';

// ---------------------------------------------------------------------------
// FakeWebSocket — minimal implementation to drive WS tests
// ---------------------------------------------------------------------------
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0; // CONNECTING

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  _closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // simulate async open in real code; we'll trigger manually
  }

  /** Test helper: simulate successful connection */
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  /** Test helper: simulate receiving a message */
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper: simulate close from server */
  simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  /** Test helper: simulate error */
  simulateError() {
    this.onerror?.();
  }

  close() {
    this._closed = true;
    this.readyState = 3;
  }
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------
function makeFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchWorld', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses the vaults array from /api/world', async () => {
    const mockVaults: WorldVault[] = [
      { id: 'v1', name: 'Vault One', path: '/tmp/v1', theme: 'plains', noteCount: 5, tier: 'village', ok: true },
    ];
    vi.stubGlobal('fetch', makeFetchMock(200, { vaults: mockVaults }));

    const result = await fetchWorld();

    expect(result.vaults).toHaveLength(1);
    expect(result.vaults[0].id).toBe('v1');
    expect(result.vaults[0].noteCount).toBe(5);
    expect(result.vaults[0].tier).toBe('village');
  });
});

describe('fetchCity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns CityModel on 200', async () => {
    const city = { vaultId: 'v1', name: 'Vault One', theme: 'plains', tier: 'city', districts: [], roads: [], noteCount: 10, activeCount7d: 2, generatedAt: 1000 };
    vi.stubGlobal('fetch', makeFetchMock(200, city));

    const result = await fetchCity('v1');

    expect(result.vaultId).toBe('v1');
    expect(result.tier).toBe('city');
  });

  it('throws an error containing the status code on 404', async () => {
    vi.stubGlobal('fetch', makeFetchMock(404, { error: 'vault not found' }));

    await expect(fetchCity('nonexistent')).rejects.toThrow('404');
  });

  it('throws an error containing the status code on non-2xx', async () => {
    vi.stubGlobal('fetch', makeFetchMock(500, { error: 'internal server error' }));

    await expect(fetchCity('v1')).rejects.toThrow('500');
  });
});

describe('fetchNote', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the markdown string from the response', async () => {
    vi.stubGlobal('fetch', makeFetchMock(200, { markdown: '# Hello\nworld' }));

    const result = await fetchNote('v1', 'notes/hello.md');

    expect(result).toBe('# Hello\nworld');
  });
});

describe('addVault', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends POST /api/vaults with correct method, headers and body', async () => {
    const mockFetch = makeFetchMock(200, { id: 'v2', name: 'New Vault', path: '/tmp/v2', theme: 'mountain' });
    vi.stubGlobal('fetch', mockFetch);

    await addVault('New Vault', '/tmp/v2', 'mountain');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/vaults');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ name: 'New Vault', path: '/tmp/v2', theme: 'mountain' });
  });

  it('returns VaultConfig on success', async () => {
    vi.stubGlobal('fetch', makeFetchMock(200, { id: 'v2', name: 'New Vault', path: '/tmp/v2', theme: 'mountain' }));

    const result = await addVault('New Vault', '/tmp/v2', 'mountain');

    expect(result.id).toBe('v2');
    expect(result.name).toBe('New Vault');
  });
});

describe('removeVault', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends DELETE /api/vaults/:id', async () => {
    const mockFetch = makeFetchMock(200, { ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await removeVault('v1');

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/vaults/v1');
    expect(options.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// WebSocket tests
// ---------------------------------------------------------------------------

describe('connectWS', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('location', { host: 'localhost:4777' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    FakeWebSocket.instances = [];
  });

  it('calls onCityUpdated when receiving a city-updated message', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ type: 'city-updated', vaultId: 'v1' });

    expect(onCityUpdated).toHaveBeenCalledOnce();
    expect(onCityUpdated).toHaveBeenCalledWith('v1');

    dispose();
  });

  it('does NOT call onCityUpdated for messages with a different type', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ type: 'other-event', vaultId: 'v1' });

    expect(onCityUpdated).not.toHaveBeenCalled();

    dispose();
  });

  it('reconnects after onclose with 1s initial delay', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateClose();

    // Before timer fires, no new instance
    expect(FakeWebSocket.instances).toHaveLength(1);

    // After 1000ms, reconnect should happen
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    dispose();
  });

  it('does NOT reconnect after dispose is called', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();

    // Dispose before close
    dispose();

    // Now simulate close (socket may still emit close after dispose)
    ws.simulateClose();

    vi.advanceTimersByTime(5000);
    // Should still only have the original instance
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('backs off exponentially on repeated disconnects (1s → 2s → 4s)', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    // First connection
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateClose();

    // After 1s: second connection
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].simulateClose();

    // After 2s more: third connection
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.instances[2].simulateClose();

    // After 4s more: fourth connection
    vi.advanceTimersByTime(4000);
    expect(FakeWebSocket.instances).toHaveLength(4);

    dispose();
  });

  it('resets backoff delay after a successful connection', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    // First close → 1s delay → reconnect
    FakeWebSocket.instances[0].simulateClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second close → 2s delay → reconnect
    FakeWebSocket.instances[1].simulateClose();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(3);

    // This one opens successfully → backoff resets
    FakeWebSocket.instances[2].simulateOpen();

    // Next close → should use 1s again (reset)
    FakeWebSocket.instances[2].simulateClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);

    dispose();
  });

  it('creates exactly ONE new instance when simulateError() + simulateClose() fire back-to-back', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    // Simulate browser firing onerror then onclose in sequence (no timer advancement yet).
    // onerror fires scheduleReconnect: sets timer1 at delay=1000ms, delay advances to 2000.
    // onclose fires scheduleReconnect: sets timer2 at delay=2000ms, delay advances to 4000.
    // Without the guard, timer1 handle is overwritten and leaked — both fire eventually.
    ws.simulateError();
    ws.simulateClose();

    // Before any timer fires: still only the original instance
    expect(FakeWebSocket.instances).toHaveLength(1);

    // After 1000ms: timer1 fires → one reconnect (instance 2)
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // After another 1000ms (total 2000ms): without guard, leaked timer2 fires → spurious
    // third instance. With the guard, timer2 was never scheduled, so no new instance.
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    dispose();
  });
});
