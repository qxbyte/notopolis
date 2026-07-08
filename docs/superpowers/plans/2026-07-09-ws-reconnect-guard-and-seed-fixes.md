# WS Reconnect Guard + World-Seed Prefix + Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix WS reconnect storm (double-timer on error+close), unify world-seed `wsPrefix` to `'world:' + vault.path`, remove unused `startLoop`, and deduplicate `__notopolis.enterCity` closure in main.ts.

**Architecture:** Four targeted, mostly independent surgical edits across `api.ts`, `cityview.ts`, `setup.ts`, and `main.ts`. The WS fix adds a guard at the top of `scheduleReconnect`; the seed fix introduces one constant in cityview; dead-code and dedup are pure deletes/extractions. A new unit test for M1 is added to the existing `web/tests/api.test.ts`.

**Tech Stack:** TypeScript, Vitest (unit tests), Playwright (e2e), Vite build, `npx tsc -p web/tsconfig.json` for type-check.

## Global Constraints

- TypeScript strict mode — zero new `any`, zero `@ts-ignore`
- No new runtime dependencies
- All tests in existing files — no new test files
- Run from repo root `/Users/xueqiang/Git/notopolis`
- `npm test` = Vitest unit tests; `npm run build` = Vite; `npx tsc -p web/tsconfig.json` = type-check; `npx playwright test` = e2e

---

### Task 1: M1 — WS Reconnect Storm Guard

**Files:**
- Modify: `web/src/api.ts:89-99` — add `reconnectTimer` guard to `scheduleReconnect`
- Modify: `web/tests/api.test.ts:307` — add new test case after the last existing WS test

**Interfaces:**
- Consumes: existing `connectWS` from `web/src/api.ts`
- Produces: `connectWS` now safe against double-invocation from simultaneous error+close events

**Root cause detail:**  
When a WebSocket connection fails, browsers typically fire `onerror` first, then `onclose`. Both handlers call `scheduleReconnect`. The first call sets `reconnectTimer`; the second call overwrites it with a new timer — the first timer handle is lost and never cleared (leaked timer). The new timer fires and creates a second reconnect attempt; meanwhile the leaked timer may also fire later (it won't because its reference is gone, but the `delay` accumulation is doubled: both calls to `scheduleReconnect` each run `delay = Math.min(delay * 2, WS_MAX_DELAY_MS)`, corrupting the backoff sequence).

**Fix:** at the top of `scheduleReconnect`, add `if (reconnectTimer !== null) return;` — the second invocation (from `onclose` when `onerror` already ran) is a no-op.

**Note on `onopen`:** The current `onopen` does NOT clear `reconnectTimer`. This is correct — by the time `onopen` fires, the timer has already fired (it called `connect()` which produced this socket), so `reconnectTimer` is already `null` (line 92 sets it to `null` inside the timeout callback before calling `connect()`). No change needed to `onopen`.

- [ ] **Step 1: Write the failing test**

Open `web/tests/api.test.ts`. Add the following test at the very end of the `describe('connectWS', ...)` block, just before the closing `});` of that describe (after line 307):

```typescript
  it('creates exactly ONE new instance when simulateError() + simulateClose() fire back-to-back', () => {
    const onCityUpdated = vi.fn();
    const dispose = connectWS(onCityUpdated);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    // Simulate browser firing onerror then onclose in sequence (no timer advancement yet)
    ws.simulateError();
    ws.simulateClose();

    // Before any timer fires: still only the original instance
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Advance 1000ms — exactly ONE reconnect should happen (not two)
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    dispose();
  });
```

- [ ] **Step 2: Run the test to confirm it FAILS**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: the new test fails. Without the guard, both `simulateError()` and `simulateClose()` each call `scheduleReconnect`, which runs `delay = Math.min(delay * 2, WS_MAX_DELAY_MS)` twice — after 1000ms two timers have fired and `FakeWebSocket.instances` has length 3 (original + 2 reconnects), not 2.

Actually the behavior is: the second `setTimeout` overwrites `reconnectTimer` (previous timer handle lost). After 1000ms the second timer fires → one reconnect → length 2. The first timer also fires at 1000ms (same delay) → another reconnect → length 3. The test expects 2, so it fails with "expected 3 to equal 2" (or similar).

- [ ] **Step 3: Apply the fix to `web/src/api.ts`**

Change lines 89-96 in `web/src/api.ts`:

Current code:
```typescript
    const scheduleReconnect = () => {
      if (closed) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
      delay = Math.min(delay * 2, WS_MAX_DELAY_MS);
    };
```

New code (add `if (reconnectTimer !== null) return;` as second guard):
```typescript
    const scheduleReconnect = () => {
      if (closed) return;
      if (reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
      delay = Math.min(delay * 2, WS_MAX_DELAY_MS);
    };
```

- [ ] **Step 4: Run unit tests — confirm all WS tests pass (including the new one)**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -40
```

Expected: all tests PASS, including:
- `creates exactly ONE new instance when simulateError() + simulateClose() fire back-to-back`
- all previously passing WS tests still pass

- [ ] **Step 5: Commit**

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/api.ts web/tests/api.test.ts
```

(Do NOT commit yet — this task's changes will be bundled in the single final commit per requirements.)

---

### Task 2: M2 — wsPrefix World-Seed Prefix Fidelity

**Files:**
- Modify: `web/src/views/cityview.ts:81-109` — add `WS` constant and replace bare `vault.path` with `'world:' + vault.path` in all four callsites

**Interfaces:**
- Consumes: `buildWilds(scene, p, wsPrefix: string)`, `buildClouds(scene, p, wsPrefix: string)`, `buildDistricts(scene, city, cx, cz, wsPrefix: string)`, `spawnCitizens(scene, { wsPrefix: string, ... })`
- Produces: all decoration/citizen seeds consistently prefixed with `'world:'` — same namespace as `worldParams()` terrain seeds

**Root cause detail:**  
`worldParams()` in `params.ts` seeds its RNG with `'world:' + vaultPath` (line 59). But the downstream decoration systems (`buildWilds`, `buildClouds`, `buildDistricts`, `spawnCitizens`) receive bare `vault.path` as their seed prefix. The audit requires consistency: all seeds for a given vault should share the `'world:'` namespace prefix, making the seed space of terrain and decorations part of the same logical domain.

**The four callsites in cityview.ts that need updating:**
- Line 81: `buildDistricts(sceneProxy, city, cx, cz, vault.path)` → use `WS`
- Line 95: `buildWilds(sceneProxy, p, vault.path)` → use `WS`
- Line 96: `buildClouds(sceneProxy, p, vault.path)` → use `WS`
- Line 103: `wsPrefix: vault.path,` → use `wsPrefix: WS,`

- [ ] **Step 1: Add the `WS` constant and update callsites in `web/src/views/cityview.ts`**

After line 72 (`const p = worldParams(vault.path, cityHalfW, cityHalfD, worldR, T);`), insert one line:

```typescript
  const WS = 'world:' + vault.path;
```

Then update the four callsites:

Line 81 — change:
```typescript
  const { plates, idleSpots } = buildDistricts(sceneProxy, city, cx, cz, vault.path);
```
to:
```typescript
  const { plates, idleSpots } = buildDistricts(sceneProxy, city, cx, cz, WS);
```

Line 95 — change:
```typescript
  buildWilds(sceneProxy, p, vault.path);
```
to:
```typescript
  buildWilds(sceneProxy, p, WS);
```

Line 96 — change:
```typescript
  const clouds = buildClouds(sceneProxy, p, vault.path);
```
to:
```typescript
  const clouds = buildClouds(sceneProxy, p, WS);
```

Line 103 — change:
```typescript
    wsPrefix: vault.path,
```
to:
```typescript
    wsPrefix: WS,
```

- [ ] **Step 2: Typecheck to confirm no errors**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Run unit tests — all pass**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS (agent tests in `web/tests/agents.test.ts` use their own fixed `wsPrefix` strings, independent of this change).

---

### Task 3: Dead Code — Remove `startLoop` from `setup.ts`

**Files:**
- Modify: `web/src/scene/setup.ts` — remove `startLoop` function body and from return type + return value
- Verify: `web/src/main.ts` already destructures only `{ scene, renderer }` from `createScene` (confirmed: line 11 `const { scene, renderer } = createScene(container);`)

**Interfaces:**
- Consumes: `createScene` return value
- Produces: `createScene` returns `{ scene, renderer }` only — no `startLoop`

**Verification of zero references:**  
`grep -rn "startLoop" /Users/xueqiang/Git/notopolis/` returns only 3 hits, all within `setup.ts` itself (definition, return type, return value). No callers exist. Safe to delete.

- [ ] **Step 1: Remove `startLoop` from `web/src/scene/setup.ts`**

Current file content (entire file shown for reference):

```typescript
import * as THREE from 'three'
export { SoftBox } from './softbox'

export function createScene(container: HTMLElement): {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  startLoop: (cb: (t: number) => void) => void
} {
  // ... setup code ...

  function startLoop(cb: (t: number) => void): void {
    function animate(t: number) {
      requestAnimationFrame(animate)
      cb(t)
    }
    requestAnimationFrame(animate)
  }

  return { scene, renderer, startLoop }
}
```

Change the return type annotation — remove `startLoop: (cb: (t: number) => void) => void` line:

```typescript
export function createScene(container: HTMLElement): {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
} {
```

Remove the `startLoop` function body entirely (lines 34-40 currently):
```typescript
  function startLoop(cb: (t: number) => void): void {
    function animate(t: number) {
      requestAnimationFrame(animate)
      cb(t)
    }
    requestAnimationFrame(animate)
  }
```

Change the return statement from:
```typescript
  return { scene, renderer, startLoop }
```
to:
```typescript
  return { scene, renderer }
```

The final file should look like:

```typescript
import * as THREE from 'three'
export { SoftBox } from './softbox'

export function createScene(container: HTMLElement): {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
} {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8ecbf2)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x5a8a3f, 0.5)
  scene.add(hemi)

  const dirLight = new THREE.DirectionalLight(0xfff0d4, 1.18)
  dirLight.castShadow = true
  dirLight.shadow.bias = -0.0005
  dirLight.position.set(60, 80, 30)
  scene.add(dirLight)

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight)
  })

  return { scene, renderer }
}
```

- [ ] **Step 2: Typecheck to confirm no errors**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json 2>&1
```

Expected: zero errors. (`main.ts` already destructures only `{ scene, renderer }`, so removing `startLoop` from the return type causes no downstream break.)

- [ ] **Step 3: Run unit tests — all pass**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

---

### Task 4: Dedup — Consolidate `__notopolis.enterCity` into one top-level function

**Files:**
- Modify: `web/src/main.ts` — extract shared logic into `enterCity` function, remove the two in-line reassignments

**Interfaces:**
- Consumes: `fetchWorld`, `goCity` (already defined in scope)
- Produces: `__notopolis.enterCity` points to a stable top-level `async function enterCity(vaultId: string)` assigned once, never re-assigned per navigation

**Root cause detail:**  
`goWorldMap` (lines 47-51) and `goCity` (lines 69-73) each reassign `__notopolis.enterCity` to an identical async closure — both call `fetchWorld()`, find the vault, and call `goCity(v)`. Only the local variable names differ (`vault` vs `v`). The assignment in `goCity` is especially misleading: it overwrites the closure just set by `goWorldMap` with an identical one, making the city-view's debug object inconsistent mid-navigation.

**Fix:** extract as a named top-level `async function` and assign once at initialization; remove both in-scope reassignments.

- [ ] **Step 1: Refactor `web/src/main.ts`**

Add a top-level async function `enterCity` after the `clearCurrent` function (after line 35, before `goWorldMap`):

```typescript
async function enterCity(vaultId: string): Promise<void> {
  const { vaults } = await fetchWorld();
  const vault = vaults.find((v) => v.id === vaultId);
  if (vault) await goCity(vault);
}
```

Assign it once in the `__notopolis` initializer object (change `enterCity: (_vaultId: string) => { /* 初始化前无操作 */ },` at line 26 to `enterCity,`):

```typescript
const __notopolis: {
  view: 'onboarding' | 'worldmap' | 'city';
  pickables: number;
  enterCity: (vaultId: string) => void;
  pickBuilding: (index: number) => void;
} = {
  view: 'onboarding',
  pickables: 0,
  enterCity,
  pickBuilding: (_index: number) => { /* 初始化前无操作 */ },
};
```

Remove the `__notopolis.enterCity = async (vaultId: string) => { ... };` block from `goWorldMap` (lines 47-51 in current file).

Remove the `__notopolis.enterCity = async (vaultId: string) => { ... };` block from `goCity` (lines 69-73 in current file).

The final `goWorldMap` function should look like:

```typescript
async function goWorldMap(): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    const { vaults } = await fetchWorld();
    current = showWorldMap({ scene, renderer, container }, vaults, goCity);
    __notopolis.view = 'worldmap';
    __notopolis.pickables = 0;
    __notopolis.pickBuilding = (_index: number) => { /* worldmap 视图无建筑拾取 */ };
  } finally {
    navigating = false;
  }
}
```

The final `goCity` function should look like:

```typescript
async function goCity(vault: WorldVault): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    clearCurrent();
    currentVaultId = vault.id;
    const city = await fetchCity(vault.id);
    const cityHandle: CityViewHandle = showCity({ scene, renderer, container }, vault, city, goWorldMap);
    current = cityHandle;
    __notopolis.view = 'city';
    __notopolis.pickables = cityHandle.pickableCount;
    __notopolis.pickBuilding = (index: number) => cityHandle.triggerPick(index);
  } finally {
    navigating = false;
  }
}
```

**TypeScript ordering note:** `enterCity` calls `goCity`, which is defined after `enterCity`. TypeScript handles this correctly because `goCity` is a named `async function` declaration (hoisted), not a `const` arrow — **only if we declare it with `function goCity`**. Check: current `goCity` is declared as `async function goCity(vault: WorldVault)` (line 57) — this is a function declaration, so hoisting applies. `enterCity` can safely reference it before the textual position of `goCity`.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Run unit tests — all pass**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

---

### Task 5: Final Verification + Single Commit

**Files:**
- No code changes — run all four verification gates then commit

- [ ] **Step 1: Run full unit test suite**

```bash
cd /Users/xueqiang/Git/notopolis && npm test 2>&1
```

Expected: all tests pass, zero failures. The new test `creates exactly ONE new instance when simulateError() + simulateClose() fire back-to-back` must appear in the output as PASS.

- [ ] **Step 2: TypeScript type-check**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 3: Build**

```bash
cd /Users/xueqiang/Git/notopolis && npm run build 2>&1 | tail -20
```

Expected: build completes successfully, no errors.

- [ ] **Step 4: Playwright e2e**

```bash
cd /Users/xueqiang/Git/notopolis && npx playwright test 2>&1 | tail -20
```

Expected: all e2e tests pass.

- [ ] **Step 5: Create single commit with HEREDOC double Co-Authored-By**

Stage only the four changed files:

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/api.ts web/tests/api.test.ts web/src/views/cityview.ts web/src/scene/setup.ts web/src/main.ts
```

Get git identity:

```bash
GIT_NAME=$(git config --get user.name) && GIT_EMAIL=$(git config --get user.email) && echo "Name: $GIT_NAME, Email: $GIT_EMAIL"
```

Commit:

```bash
cd /Users/xueqiang/Git/notopolis && GIT_NAME=$(git config --get user.name) && GIT_EMAIL=$(git config --get user.email) && git commit -m "$(cat <<'EOF'
fix(web): WS reconnect guard, world-seed prefix fidelity, dead code cleanup

- api.ts: add reconnectTimer !== null guard in scheduleReconnect to prevent
  double-timer storm when browser fires onerror then onclose in sequence
- api.test.ts: add unit test asserting simulateError()+simulateClose() produces
  exactly one reconnect instance after advanceTimersByTime(1000)
- cityview.ts: introduce WS constant ('world:' + vault.path) and pass to all
  four decoration/citizen callsites for consistent world-seed namespace
- setup.ts: remove unreferenced startLoop dead code (zero callers in codebase)
- main.ts: extract enterCity as single top-level function, eliminate two
  identical in-scope reassignments of __notopolis.enterCity

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)
Co-Authored-By: $GIT_NAME <$GIT_EMAIL>"
```

- [ ] **Step 6: Verify commit succeeded**

```bash
cd /Users/xueqiang/Git/notopolis && git log --oneline -3
```

Expected: the new commit appears at the top with message `fix(web): WS reconnect guard, world-seed prefix fidelity, dead code cleanup`.

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| M1: `reconnectTimer !== null` guard in `scheduleReconnect` | Task 1 Step 3 |
| M1: verify `onopen` path resets `reconnectTimer` to null | Task 1 Step 3 notes (already correct, no change needed) |
| M1: unit test `simulateError() + simulateClose()` → only 1 new instance | Task 1 Step 1 |
| M2: `WS = 'world:' + vault.path` constant in cityview | Task 2 Step 1 |
| M2: pass `WS` to buildWilds, buildClouds, buildDistricts, spawnCitizens | Task 2 Step 1 |
| Delete `startLoop` dead code from setup.ts | Task 3 Step 1 |
| Deduplicate `__notopolis.enterCity` closures in main.ts | Task 4 Step 1 |
| `npm test` all green | Task 5 Step 1 |
| `npx tsc -p web/tsconfig.json` zero errors | Task 5 Step 2 |
| `npm run build` success | Task 5 Step 3 |
| `npx playwright test` all green | Task 5 Step 4 |
| Single commit with specified message + double Co-Authored-By | Task 5 Step 5 |

**Placeholder scan:** No TBDs, no "add appropriate X", all code blocks are complete.

**Type consistency:** `enterCity` is declared `async function enterCity(vaultId: string): Promise<void>` — matches the `__notopolis` type `enterCity: (vaultId: string) => void` (Promise<void> is assignable to void-returning function type in TypeScript). No inconsistencies.

**Ordering issue check for main.ts refactor:** `enterCity` (new top-level function) references `goCity` and `fetchWorld`. Both are available in scope — `fetchWorld` is imported at the top, `goCity` is a `function` declaration (hoisted). No issue.
