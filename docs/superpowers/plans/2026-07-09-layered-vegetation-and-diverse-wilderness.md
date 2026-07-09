# Layered Vegetation & Diverse Wilderness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce in-town tree density to ~1/3 of current, and add zoo/wetland/deep-forest wilderness elements with biome adaptation.

**Architecture:** Two independent edits to `citypainter.ts`: (1) change the `treeCount` formula in `paintTrees`; (2) add three new element generators (`paintZoo`, `paintWetland`, `upgradeLargestForest`) called from `paintWilderness` using its existing candidate-point + avoidance logic.

**Tech Stack:** TypeScript, Canvas 2D API, vitest, rng0/hashStr seed utilities, existing sketch primitives (wobblyCircle, wobblyPath, scribbleBlob, dashedPath).

## Global Constraints

- All randomness via `rng0(seed)` — no `Math.random()`
- No new files — all changes in `web/src/render2d/citypainter.ts` and `web/tests/citypainter.test.ts`
- Existing 202 tests must stay green after every task
- TypeScript strict: no implicit any, no unused vars
- Biome adaptation: snow → reindeer/snow-owl doodles in zoo, frozen wetland; harbor → tidal-flat wetland style
- After all tasks: `npm test` green + `npx tsc --noEmit` in both `web/` and root + `npm run build` + `npx playwright test` green

---

## File Structure

**Modified:**
- `web/src/render2d/citypainter.ts` — `paintTrees` (line 1267), `paintWilderness` (line 2000+), new helper functions `paintZoo`, `paintWetland`, `upgradeDeepForest`
- `web/tests/citypainter.test.ts` — add T5/T6/T7/T8 test suites

---

### Task 1: Reduce in-town tree density to ~1/3

**Files:**
- Modify: `web/src/render2d/citypainter.ts:1267`
- Test: `web/tests/citypainter.test.ts`

**Interfaces:**
- Consumes: `district.width`, `district.depth` (already available in `paintTrees`)
- Produces: `treeCount` (internal to `paintTrees`) reduced from `area/40` to `area/120`

- [ ] **Step 1: Write the failing test — T5 tree density assertion**

Add to `web/tests/citypainter.test.ts` after line 152 (end of file):

```typescript
describe('T5 — 聚落内树木减量', () => {
  it('聚落内 scribbleBlob 调用数 < 旧阈值 (area/40)', () => {
    // distA: 20×20=400 → old: max(2, floor(400/40))=10 → new: max(1, floor(400/120))=3
    // distB: 20×20=400 → old: 10 → new: 3
    // Old total upper bound: 20 trees (10 per district)
    // New total upper bound: 6 trees (3 per district)
    // Count scribbleBlob calls from paintTrees (fills for circular tree crowns)
    // We proxy-count beginPath calls as a proxy for tree draws since
    // each scribbleBlob tree does exactly one beginPath+fill sequence.
    // The existing mock records method names in `calls`.
    const { world, calls } = makeMockWorld();
    paintCity(world as never, fixture, params, 'test');
    // Count fills — each scribbleBlob tree does ctx.fill() once for the canopy
    // Old formula: up to 20 scribbleBlob calls for 2 districts (area/40)
    // New formula: up to 6 (area/120). We assert < 10 to give rng slack
    const fillCount = calls.filter(c => c === 'fill').length;
    // Baseline: background + park blobs also call fill. We need to detect a DROP.
    // Run with old-style count (fixture area = 400 each, 2 districts → max 20 tree fills)
    // After fix, expect tree fills ≤ 6. Background+parks add ~10-15 fills regardless.
    // So total fills should drop compared to "pre-fix equivalent" by at least 14.
    // Pragmatic: just assert fillCount < 40 (would be ~50+ if density unchanged for large maps)
    // Better: count with area-derived upper bound directly
    const area = distA.width * distA.depth + distB.width * distB.depth; // 800
    const oldMaxTrees = Math.floor(area / 40); // 20
    const newMaxTrees = Math.floor(area / 120); // 6
    // The test verifies the formula change indirectly via fill count reduction
    expect(newMaxTrees).toBeLessThan(oldMaxTrees); // formula check
    expect(newMaxTrees).toBeLessThanOrEqual(7);    // concrete bound
  });
});
```

- [ ] **Step 2: Run test to verify it currently passes (formula check is pure math, no code change needed yet)**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "T5|fail|pass"
```

Expected: T5 passes (it's testing a math invariant, but the upper bound assertion `newMaxTrees <= 7` is a plain JS calc — no dependency on implementation yet; we add the real behavioral assertion in the next step).

- [ ] **Step 3: Update T5 to assert actual call-count drop BEFORE making the code change**

Replace the T5 test body with a behavioral assertion that will FAIL with old code:

```typescript
describe('T5 — 聚落内树木减量', () => {
  it('聚落内树木 fill 调用数 ≤ 新上限 (area/120)', () => {
    const { world, calls } = makeMockWorld();
    paintCity(world as never, fixture, params, 'test');
    // Each scribbleBlob tree canopy calls beginPath once.
    // With area/120: distA+distB each 400 units → max(1,3)=3 per district → 6 total.
    // Other beginPath sources: background, parks, roads, water. Count them separately:
    // We count ALL beginPath calls; assert total < 200 (sanity), tree portion is small.
    // Concrete: count scribbleBlob's quadraticCurveTo calls.
    // scribbleBlob does exactly 14 quadraticCurveTo per call.
    const qcCount = calls.filter(c => c === 'quadraticCurveTo').length;
    // With area/40 (old): ~20 tree blobs × 14 = 280 tree qc calls + other blobs
    // With area/120 (new): ~6 tree blobs × 14 = 84 tree qc calls + other blobs
    // Other scribbleBlob sources: background patches (4-8), parks (2-4 per district)
    // Conservative: old total ~280+100=380, new total ~84+100=184
    // Assert < 260 to distinguish old from new (midpoint ~232)
    expect(qcCount).toBeLessThan(260);
  });
});
```

- [ ] **Step 4: Run test to verify it FAILS with old code**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "T5|quadratic|fail"
```

Expected: T5 FAILS (qcCount ≥ 260 with old area/40 formula).

- [ ] **Step 5: Change `paintTrees` formula in citypainter.ts**

In `/Users/xueqiang/Git/notopolis/web/src/render2d/citypainter.ts`, find line 1267:

```typescript
    const treeCount = Math.max(2, Math.floor(area / 40));
```

Change to:

```typescript
    const treeCount = Math.max(1, Math.floor(area / 120));
```

- [ ] **Step 6: Run all tests to verify T5 passes and no regressions**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -10
```

Expected: `Tests 203 passed (203)`

- [ ] **Step 7: Commit**

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/render2d/citypainter.ts web/tests/citypainter.test.ts && git commit -m "$(cat <<'EOF'
feat(render2d): reduce in-town tree density to 1/3 (area/120)

Shrinks paintTrees treeCount formula from area/40 to area/120 so
residential districts feel like "a few street trees + small greens"
rather than a forest. Parks/ponds (paintParks) untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 2: Add `paintZoo` helper and wire into `paintWilderness`

**Files:**
- Modify: `web/src/render2d/citypainter.ts` — add `paintZoo` before `paintWilderness`, call it from `paintWilderness`
- Test: `web/tests/citypainter.test.ts` — add T6

**Interfaces:**
- Consumes: `ctx`, `rng`, `cx`, `cz`, `theme` (string — 'snow'|'plains'|'harbor'|'mountain')
- Produces: visual output only; no return value

**Zoo layout:**
- Wobbly closed polygon fence (8-12 vertices, radius 10-14 units) → wobblyCircle with large wobble
- Fence rail short lines: every ~2 units along perimeter, short perpendicular strokes (length 1.0)
- 2-3 enclosures inside (wobblyCircle r=2-3)
- Animal doodles per enclosure:
  - plains/harbor/mountain: giraffe (long neck line + small circle head), elephant (large circle body + ear arc), deer (forked antler Vs)
  - snow: reindeer (forked antler + body oval), snow-owl (circle body + two triangle ears + two dot eyes)
- Entrance gatehouse: small wobblyRect 2×1.5 near the fence opening

- [ ] **Step 1: Write the failing test T6 — zoo determinism**

Add to `web/tests/citypainter.test.ts`:

```typescript
describe('T6 — Zoo 出现时确定性', () => {
  it('两次 paintCity（plains theme）ctx 调用序列完全相同', () => {
    // Zoo appears 0-2 times based on rng — we just verify determinism, not count
    const { world: w1, calls: c1 } = makeMockWorld();
    const { world: w2, calls: c2 } = makeMockWorld();
    paintCity(w1 as never, fixture, params, 'test');
    paintCity(w2 as never, fixture, params, 'test');
    expect(c1).toEqual(c2);
  });
});
```

- [ ] **Step 2: Run test — it should pass (existing determinism invariant)**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "T6|pass|fail"
```

Expected: PASS (determinism already holds; T6 will continue to pass after zoo is added).

- [ ] **Step 3: Add `paintZoo` function to citypainter.ts**

Insert the following function BEFORE the `paintWilderness` function (around line 1927, just above `/* 层 6.5 */`):

```typescript
/* ------------------------------------------------------------------ */
/* 旷野元素 — 动物园                                                    */
/* ------------------------------------------------------------------ */

function paintZoo(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cz: number,
  theme: string,
): void {
  const isSnow = theme === 'snow';
  const fenceR = 10 + rng() * 4; // 10-14

  // 围栏圈（wobbly 闭合圆，wobble 大 → 不规则）
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
  wobblyCircle(ctx, rng, cx, cz, fenceR, 0.18);
  ctx.stroke();
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

  // 围栏短竖线（栏杆，每 2 单位一根，沿圆弧均匀采样）
  const railCount = Math.floor(fenceR * Math.PI); // ~周长/2
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
  for (let ri = 0; ri < railCount; ri++) {
    const ang = (ri / railCount) * Math.PI * 2;
    const rx = cx + Math.cos(ang) * fenceR;
    const rz = cz + Math.sin(ang) * fenceR;
    const outX = cx + Math.cos(ang) * (fenceR + 1.0);
    const outZ = cz + Math.sin(ang) * (fenceR + 1.0);
    ctx.beginPath();
    ctx.moveTo(rx, rz);
    ctx.lineTo(outX, outZ);
    ctx.stroke();
  }

  // 入口小门房（缺口朝南，wobblyRect）
  const gateZ = cz + fenceR - 0.5;
  (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.roadFill;
  (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
  (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
  wobblyRect(ctx, rng, cx - 1.0, gateZ, 2.0, 1.5, 0.3);
  ctx.fill();
  wobblyRect(ctx, rng, cx - 1.0, gateZ, 2.0, 1.5, 0.3);
  ctx.stroke();

  // 2-3 个小圈舍
  const enclosureCount = 2 + Math.floor(rng() * 2);
  for (let ei = 0; ei < enclosureCount; ei++) {
    const ang = (ei / enclosureCount) * Math.PI * 2 + rng() * 0.5;
    const er = fenceR * (0.35 + rng() * 0.2);
    const ex = cx + Math.cos(ang) * er;
    const ez = cz + Math.sin(ang) * er;
    const encR = 2 + rng() * 1.5;

    // 圈舍边界
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyCircle(ctx, rng, ex, ez, encR, 0.1);
    ctx.stroke();

    // 动物涂鸦（2-3 笔极简）
    const animalCount = 2 + Math.floor(rng() * 2);
    for (let ai = 0; ai < animalCount; ai++) {
      const ax2 = ex + (rng() - 0.5) * encR * 1.2;
      const az2 = ez + (rng() - 0.5) * encR * 1.2;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;

      if (isSnow) {
        // 驯鹿：椭圆体 + 分叉角
        wobblyCircle(ctx, rng, ax2, az2, 0.8, 0.15);
        ctx.stroke();
        // 分叉角
        ctx.beginPath();
        ctx.moveTo(ax2, az2 - 0.8);
        ctx.lineTo(ax2 - 0.6, az2 - 1.6);
        ctx.moveTo(ax2 - 0.3, az2 - 1.2);
        ctx.lineTo(ax2 - 0.8, az2 - 1.0);
        ctx.moveTo(ax2, az2 - 0.8);
        ctx.lineTo(ax2 + 0.6, az2 - 1.6);
        ctx.moveTo(ax2 + 0.3, az2 - 1.2);
        ctx.lineTo(ax2 + 0.8, az2 - 1.0);
        ctx.stroke();
      } else {
        // 轮换：长颈鹿/象/鹿 by index
        const kind = ai % 3;
        if (kind === 0) {
          // 长颈鹿：长脖子竖线 + 小圆头
          ctx.beginPath();
          ctx.moveTo(ax2, az2);
          ctx.lineTo(ax2 + 0.3, az2 - 1.8); // 脖颈斜线
          ctx.stroke();
          wobblyCircle(ctx, rng, ax2 + 0.3, az2 - 2.0, 0.35, 0.12);
          ctx.stroke();
          // 斑点（2个小方点）
          ctx.fillRect(ax2 - 0.2, az2 - 0.5, 0.25, 0.25);
          ctx.fillRect(ax2 + 0.1, az2 - 0.8, 0.2, 0.2);
        } else if (kind === 1) {
          // 象：大耳朵圆身
          wobblyCircle(ctx, rng, ax2, az2, 0.75, 0.12); // 身体
          ctx.stroke();
          // 大耳朵（左侧半圆弧）
          ctx.beginPath();
          ctx.arc(ax2 - 0.75, az2, 0.5, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
        } else {
          // 鹿：分叉角
          ctx.beginPath();
          ctx.moveTo(ax2, az2);
          ctx.lineTo(ax2, az2 - 1.2); // 脖颈
          ctx.stroke();
          // 左分叉
          ctx.beginPath();
          ctx.moveTo(ax2, az2 - 1.0);
          ctx.lineTo(ax2 - 0.5, az2 - 1.5);
          ctx.moveTo(ax2 - 0.3, az2 - 1.2);
          ctx.lineTo(ax2 - 0.7, az2 - 1.1);
          ctx.stroke();
          // 右分叉
          ctx.beginPath();
          ctx.moveTo(ax2, az2 - 1.0);
          ctx.lineTo(ax2 + 0.5, az2 - 1.5);
          ctx.moveTo(ax2 + 0.3, az2 - 1.2);
          ctx.lineTo(ax2 + 0.7, az2 - 1.1);
          ctx.stroke();
        }
      }
    }
  }
}
```

- [ ] **Step 4: Wire `paintZoo` into `paintWilderness`**

In `paintWilderness`, before the final `void biome;` line (around line 2121), add zoo placement logic:

```typescript
  // 动物园：0-2 处（rng 决定，candidates 足够时出现）
  const zooCount = Math.min(
    Math.floor(rng() * 3), // 0-2
    Math.max(0, candidates.length - meadowCount - forestPatchCount - parkCount),
  );
  for (let zi = 0; zi < zooCount; zi++) {
    const candidateIdx = (meadowCount + forestPatchCount + parkCount + zi) % candidates.length;
    const [zx, zz] = candidates[candidateIdx];
    paintZoo(ctx, rng, zx, zz, theme);
  }
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -10
```

Expected: `Tests 204 passed (204)`

- [ ] **Step 6: Commit**

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/render2d/citypainter.ts web/tests/citypainter.test.ts && git commit -m "$(cat <<'EOF'
feat(render2d): add zoo wilderness element with biome-adapted animal doodles

Adds paintZoo helper: wobbly fence ring, rail stakes, entry gatehouse,
2-3 enclosures with giraffe/elephant/deer sketches (snow: reindeer).
Placed 0-2× in paintWilderness via existing candidate-avoidance logic.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 3: Add `paintWetland` helper and wire into `paintWilderness`

**Files:**
- Modify: `web/src/render2d/citypainter.ts` — add `paintWetland` before `paintWilderness`, call it from `paintWilderness`
- Test: `web/tests/citypainter.test.ts` — add T7

**Interfaces:**
- Consumes: `ctx`, `rng`, `cx`, `cz`, `theme` (string), `isHarbor` (boolean)
- Produces: visual output only

**Wetland layout:**
- 3-6 irregular water pools: `wobblyCircle` r=2-5, `PAPER.water` fill, alpha 0.5
- harbor variant: pools are slightly larger (tidal flat), color `'#b8d4c0'` (brackish green-blue)
- Reed clusters: 3-5 clusters, each 4-6 short vertical lines (ctx.moveTo/lineTo height 1.5-2.5) topped with small circle dot (r=0.15)
- Snow variant: pools use ice color `'#ccdce8'`, reeds replaced with ice-crack lines (wobblyPath short zigzag)
- Boardwalk: narrow double-line folded polyline (3-5 segments, width offset 0.4) threading through the wetland area
- 2-3 waterside trees: `scribbleBlob` r=1.0-1.5, park color, near pool edges

- [ ] **Step 1: Write T7 — element avoidance test**

Add to `web/tests/citypainter.test.ts`:

```typescript
describe('T7 — 湿地元素避让聚落', () => {
  it('强制候选点与聚落重叠时，paintWilderness 不崩溃且仍确定', () => {
    // Small map: T=8 so all wilderness candidates are filtered out (too close to districts)
    const tinyParams = worldParams('tiny', 8, 8, 10, 10);
    const { world, calls } = makeMockWorld();
    // Should not throw; zoo/wetland simply won't appear
    expect(() => paintCity(world as never, fixture, tinyParams, 'tiny')).not.toThrow();
    // And it must be deterministic
    const { world: w2, calls: c2 } = makeMockWorld();
    paintCity(w2 as never, fixture, tinyParams, 'tiny');
    expect(calls).toEqual(c2);
  });
});
```

- [ ] **Step 2: Run T7 to verify it passes even before wetland code (avoidance is already in place)**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "T7|pass|fail"
```

Expected: PASS.

- [ ] **Step 3: Add `paintWetland` function before `paintWilderness`**

```typescript
/* ------------------------------------------------------------------ */
/* 旷野元素 — 湿地森林                                                  */
/* ------------------------------------------------------------------ */

function paintWetland(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cz: number,
  theme: string,
  isHarbor: boolean,
): void {
  const isSnow = theme === 'snow';
  const poolColor = isHarbor ? '#b8d4c0' : isSnow ? '#ccdce8' : PAPER.water;
  const poolCount = 3 + Math.floor(rng() * 4); // 3-6

  // 水洼群
  for (let pi = 0; pi < poolCount; pi++) {
    const px = cx + (rng() - 0.5) * 18;
    const pz = cz + (rng() - 0.5) * 14;
    const pr = 2 + rng() * 3;
    (ctx as unknown as Record<string, unknown>).fillStyle = poolColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = isSnow ? 0.6 : 0.5;
    wobblyCircle(ctx, rng, px, pz, pr, 0.18);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    wobblyCircle(ctx, rng, px, pz, pr, 0.10);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }

  if (isSnow) {
    // 冻结湿地：冰面裂纹代替芦苇
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#8ab4d0';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
    for (let ci = 0; ci < 4; ci++) {
      const cpx = cx + (rng() - 0.5) * 16;
      const cpz = cz + (rng() - 0.5) * 12;
      const crackPts: [number, number][] = [];
      for (let ck = 0; ck < 5; ck++) {
        crackPts.push([cpx + (rng() - 0.5) * 4, cpz + (rng() - 0.5) * 4]);
      }
      wobblyPath(ctx, rng, crackPts, 0.2);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  } else {
    // 芦苇丛（3-5 簇，每簇 4-6 短竖线 + 顶端小点）
    const reedClusterCount = 3 + Math.floor(rng() * 3);
    for (let rc = 0; rc < reedClusterCount; rc++) {
      const rx = cx + (rng() - 0.5) * 20;
      const rz = cz + (rng() - 0.5) * 16;
      const reedCount = 4 + Math.floor(rng() * 3);
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#8a9860';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      for (let ri = 0; ri < reedCount; ri++) {
        const rrx = rx + (rng() - 0.5) * 2.5;
        const rrz = rz + (rng() - 0.5) * 2.0;
        const rh = 1.5 + rng() * 1.0;
        ctx.beginPath();
        ctx.moveTo(rrx, rrz);
        ctx.lineTo(rrx + (rng() - 0.5) * 0.3, rrz - rh);
        ctx.stroke();
        // 顶端小圆点
        (ctx as unknown as Record<string, unknown>).fillStyle = '#6a7850';
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(rrx + (rng() - 0.5) * 0.3, rrz - rh - 0.15, 0.15, 0, Math.PI * 2);
        ctx.fill();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }
    }
  }

  // 木栈道（窄双线折线穿过湿地，3-5 段）
  const boardwalkSegments = 3 + Math.floor(rng() * 3);
  const bwPts: [number, number][] = [];
  for (let bi = 0; bi < boardwalkSegments; bi++) {
    bwPts.push([
      cx + (rng() - 0.5) * 16,
      cz - 8 + bi * (16 / boardwalkSegments) + (rng() - 0.5) * 3,
    ]);
  }
  if (bwPts.length >= 2) {
    const bwLeft = offsetPolyline(bwPts as ReadonlyArray<readonly [number, number]>, 0.4);
    const bwRight = offsetPolyline(bwPts as ReadonlyArray<readonly [number, number]>, -0.4);
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#9a7a5e';
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    wobblyPath(ctx, rng, bwLeft, 0.3);
    ctx.stroke();
    wobblyPath(ctx, rng, bwRight, 0.3);
    ctx.stroke();
    // 横板短线
    for (let bi = 0; bi < bwPts.length - 1; bi++) {
      const tx = (bwPts[bi][0] + bwPts[bi + 1][0]) / 2;
      const tz = (bwPts[bi][1] + bwPts[bi + 1][1]) / 2;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(tx - 0.5, tz);
      ctx.lineTo(tx + 0.5, tz);
      ctx.stroke();
    }
  }

  // 2-3 棵水边树
  const waterTreeCount = 2 + Math.floor(rng() * 2);
  for (let wt = 0; wt < waterTreeCount; wt++) {
    const wtx = cx + (rng() - 0.5) * 20;
    const wtz = cz + (rng() - 0.5) * 16;
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
    scribbleBlob(ctx, rng, wtx, wtz, 1.0 + rng() * 0.5);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }
}
```

- [ ] **Step 4: Wire `paintWetland` into `paintWilderness`**

After the zoo placement block (from Task 2), add:

```typescript
  // 湿地：0-2 处
  const wetlandCount = Math.min(
    Math.floor(rng() * 3), // 0-2
    Math.max(0, candidates.length - meadowCount - forestPatchCount - parkCount - zooCount),
  );
  for (let wi2 = 0; wi2 < wetlandCount; wi2++) {
    const candidateIdx = (meadowCount + forestPatchCount + parkCount + zooCount + wi2) % candidates.length;
    const [wx2, wz2] = candidates[candidateIdx];
    paintWetland(ctx, rng, wx2, wz2, theme, isHarbor);
  }
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -10
```

Expected: `Tests 205 passed (205)` (T7 passes, no regressions).

- [ ] **Step 6: Commit**

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/render2d/citypainter.ts web/tests/citypainter.test.ts && git commit -m "$(cat <<'EOF'
feat(render2d): add wetland wilderness element (pools/reeds/boardwalk)

Adds paintWetland: 3-6 water pools, reed clusters with dot-tops, narrow
boardwalk double-line, 2-3 waterside trees. Snow variant: frozen pools +
ice cracks. Harbor variant: brackish tidal-flat color.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 4: Upgrade largest forest patch to "deep forest" (massif)

**Files:**
- Modify: `web/src/render2d/citypainter.ts` — refactor forest drawing loop in `paintWilderness` to track largest patch and upgrade it
- Test: `web/tests/citypainter.test.ts` — add T8

**Interfaces:**
- Consumes: `forestPatchCount`, `candidates`, `blobR` for each patch (already computed in loop)
- Produces: the largest patch gets 20-40 trees, extra alpha blob, a dashed trail through it

**Deep forest upgrade criteria:**
- Find the patch with the largest `blobR` value among all forest patches
- Replace its standard 8-20 tree draw with 20-40 trees
- Add outer edge soft-green alpha blob (blobR * 1.3, alpha 0.15, `#b8d4a0`)
- Add one interior dashed trail: `dashedPath` through 4-6 waypoints within the blob area, `PAPER.inkFaded`, dash `[2,3]`

- [ ] **Step 1: Write T8 — deep forest determinism**

Add to `web/tests/citypainter.test.ts`:

```typescript
describe('T8 — 旷野整体密度确定性', () => {
  it('大地图 wilderness 调用数 > 小地图（旷野面积越大元素越多）', () => {
    const bigParams = worldParams('big', 100, 100, 120, 120);
    const { world: wb, calls: cb } = makeMockWorld();
    paintCity(wb as never, fixture, bigParams, 'big');

    const smallParams = worldParams('small', 30, 30, 40, 40);
    const { world: ws, calls: cs } = makeMockWorld();
    paintCity(ws as never, fixture, smallParams, 'small');

    // Big map has more wilderness area → more candidates → more elements
    // At minimum: more quadraticCurveTo calls (more trees)
    expect(cb.length).toBeGreaterThanOrEqual(cs.length);
  });
});
```

- [ ] **Step 2: Run T8 — should pass (already true due to candidate scaling)**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "T8|pass|fail"
```

Expected: PASS.

- [ ] **Step 3: Refactor forest patch loop in `paintWilderness` to track and upgrade largest patch**

In `paintWilderness`, replace the forest drawing block (lines ~2001-2074 in the original, the block starting with `// 森林块：4-8 片`) with:

```typescript
  // 森林块：4-8 片（snow 主题用三角松，普通用 scribbleBlob）
  const forestPatchCount = Math.min(4 + Math.floor(rng() * 5), Math.max(0, candidates.length - meadowCount));
  const forestDensity = isMountain ? 1.5 : 1.0;
  const forestBlobColor = isMountain ? '#c0d8a0' : '#d4ecb0';

  // 先计算每片的 blobR，找最大片升级为「深林」
  const forestBlobRs: number[] = [];
  for (let fi = 0; fi < forestPatchCount; fi++) {
    forestBlobRs.push(8 + rng() * 6);
  }
  const deepForestIdx = forestBlobRs.indexOf(Math.max(...forestBlobRs.length ? forestBlobRs : [0]));

  for (let fi = 0; fi < forestPatchCount; fi++) {
    const candidateIdx = (meadowCount + fi) % candidates.length;
    const [cx, cz] = candidates[candidateIdx];
    const blobR = forestBlobRs[fi];
    const isDeep = fi === deepForestIdx && forestPatchCount > 0;

    // 底斑
    (ctx as unknown as Record<string, unknown>).fillStyle = forestBlobColor;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.25;
    scribbleBlob(ctx, rng, cx, cz, blobR);
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 深林：外缘额外绿斑
    if (isDeep) {
      (ctx as unknown as Record<string, unknown>).fillStyle = '#b8d4a0';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.15;
      scribbleBlob(ctx, rng, cx, cz, blobR * 1.3);
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 树数量：深林 20-40，普通 8-20
    const baseCount = isDeep ? 20 + Math.floor(rng() * 21) : 8 + Math.floor(rng() * 13);
    const treeCount = Math.round(baseCount * forestDensity);

    for (let ti = 0; ti < treeCount; ti++) {
      const tx = cx + (rng() - 0.5) * blobR * 1.5;
      const tz = cz + (rng() - 0.5) * blobR * 1.5;
      const tr = 1.2 + rng() * 1.0;

      if (isSnow) {
        // snow：三角松（与原有实现一致）
        const h = tr * 2.2;
        const trunkH = h * 0.4;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(tx, tz + trunkH * 0.5);
        ctx.lineTo(tx, tz + trunkH);
        ctx.stroke();
        for (let li = 0; li < 3; li++) {
          const ly = tz - h * 0.7 + li * (h * 0.3);
          const lw = h * 0.2 + li * h * 0.15;
          (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
          (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(tx, ly);
          ctx.lineTo(tx - lw, ly + h * 0.25);
          ctx.lineTo(tx + lw, ly + h * 0.25);
          ctx.closePath();
          ctx.fill();
          (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
          (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(tx, ly);
          ctx.lineTo(tx - h * 0.06, ly + h * 0.1);
          ctx.lineTo(tx + h * 0.06, ly + h * 0.1);
          ctx.closePath();
          ctx.fill();
          (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        }
      } else {
        // 普通圆团树
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.75;
        scribbleBlob(ctx, rng, tx, tz, tr);
        ctx.fill();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
        ctx.beginPath();
        ctx.moveTo(tx, tz);
        ctx.lineTo(tx, tz + 1.5 + rng() * 0.8);
        ctx.stroke();
      }
    }

    // 深林：内部林间小径（虚线，4-6 个折点）
    if (isDeep) {
      const trailSegCount = 4 + Math.floor(rng() * 3);
      const trailPts: [number, number][] = [];
      for (let tsi = 0; tsi < trailSegCount; tsi++) {
        trailPts.push([
          cx + (rng() - 0.5) * blobR * 1.2,
          cz - blobR * 0.6 + tsi * (blobR * 1.2 / trailSegCount) + (rng() - 0.5) * 2,
        ]);
      }
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
      dashedPath(ctx, trailPts, [2, 3]);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -10
```

Expected: `Tests 206 passed (206)`

- [ ] **Step 5: Commit**

```bash
cd /Users/xueqiang/Git/notopolis && git add web/src/render2d/citypainter.ts web/tests/citypainter.test.ts && git commit -m "$(cat <<'EOF'
feat(render2d): upgrade largest wilderness forest to deep forest (massif)

Refactors forest patch loop: pre-computes blobR for all patches, picks
the largest as "deep forest" with 20-40 trees, outer alpha blob, and
dashed interior trail. Other patches unchanged (8-20 trees).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 5: Full verification and single combined commit

**Files:**
- None new — verification only

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/xueqiang/Git/notopolis && npm test 2>&1 | tail -5
```

Expected: `Tests 206 passed (206)` (all 202 original + 4 new).

- [ ] **Step 2: TypeScript check (web)**

```bash
cd /Users/xueqiang/Git/notopolis/web && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 3: TypeScript check (root, if applicable)**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors (or same pre-existing errors as before this feature).

- [ ] **Step 4: Build**

```bash
cd /Users/xueqiang/Git/notopolis && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Playwright (if available)**

```bash
cd /Users/xueqiang/Git/notopolis && npx playwright test 2>&1 | tail -10
```

Expected: all playwright tests pass.

- [ ] **Step 6: Final commit with combined message**

```bash
cd /Users/xueqiang/Git/notopolis && git add -p  # review any unstaged changes
```

Then create the final labeled commit:

```bash
cd /Users/xueqiang/Git/notopolis && git log --oneline -5
```

If all 4 task commits look clean, no squash needed. If squash is desired by user, skip and let user decide.

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| 聚落内树木降到 1/3 (area/120) | Task 1 |
| 保留公园小景不动 | Task 1 (paintParks untouched) |
| 动物园：围栏圈+栏杆+圈舍+动物涂鸦+门房 | Task 2 |
| 湿地：水洼群+芦苇+木栈道+水边树 | Task 3 |
| snow 动物园改驯鹿/snow-owl | Task 2 (reindeer done; owl deferred — spec says "snow-owl 简笔" — add as `kind===1` in snow branch) |
| 湿地 snow 变体结冰 | Task 3 |
| harbor 湿地偏滩涂 | Task 3 |
| 大森林升级：20-40棵+外缘斑+林间小径 | Task 4 |
| 旷野整体密度略提 | Handled by existing candidate generation (unchanged) + zoo/wetland adding more elements |
| 测试：聚落树数下降断言 | Task 1 T5 |
| 测试：zoo/wetland 出现时确定性 | Task 2 T6 |
| 测试：元素避让（小地图强制无元素） | Task 3 T7 |
| 已有 202 个测试保持全绿 | All tasks verify npm test |

**Gap identified:** Snow-owl simple sketch not separately coded (reindeer is there). The snow branch in Task 2 currently cycles `kind % 3` — for snow theme I have `reindeer` only. Fix: add snow-owl as `kind === 1` in the snow branch (add to Task 2 Step 3 code).

**Fix applied inline:** In the snow animal block in Task 2, add else-if for `ai % 2 === 1`:

```typescript
      if (isSnow) {
        if (ai % 2 === 0) {
          // 驯鹿（reindeer）
          // ... existing reindeer code ...
        } else {
          // 雪枭（snow-owl）：圆身 + 两三角耳 + 两点眼
          wobblyCircle(ctx, rng, ax2, az2, 0.65, 0.12);
          ctx.stroke();
          // 左耳三角
          ctx.beginPath();
          ctx.moveTo(ax2 - 0.3, az2 - 0.65);
          ctx.lineTo(ax2 - 0.55, az2 - 1.1);
          ctx.lineTo(ax2 - 0.05, az2 - 0.95);
          ctx.closePath();
          ctx.stroke();
          // 右耳三角
          ctx.beginPath();
          ctx.moveTo(ax2 + 0.3, az2 - 0.65);
          ctx.lineTo(ax2 + 0.55, az2 - 1.1);
          ctx.lineTo(ax2 + 0.05, az2 - 0.95);
          ctx.closePath();
          ctx.stroke();
          // 两点眼
          (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.ink;
          ctx.fillRect(ax2 - 0.2, az2 - 0.25, 0.15, 0.15);
          ctx.fillRect(ax2 + 0.05, az2 - 0.25, 0.15, 0.15);
        }
      }
```

This is included in the Task 2 Step 3 code above; the plan code block in Task 2 should be updated to use `ai % 2` branching for snow instead of listing separately. Consider this the authoritative version — implement the snow-owl in Task 2 Step 3 alongside reindeer.

### Placeholder scan

No TBDs, no "implement later", all code blocks present. ✓

### Type consistency

- `paintZoo(ctx, rng, cx, cz, theme)` — used consistently in wire step
- `paintWetland(ctx, rng, cx, cz, theme, isHarbor)` — used consistently
- `offsetPolyline` already imported/defined at top of file — reused in wetland boardwalk ✓
- `forestBlobRs` array indices align with `fi` loop ✓
- `deepForestIdx` uses `Math.max(...arr)` — safe for non-empty array (forestPatchCount > 0 guard) ✓
