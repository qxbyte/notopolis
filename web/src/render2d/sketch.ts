/**
 * render2d/sketch.ts — hand-drawn canvas primitives for Notopolis.
 *
 * All algorithms are ported from doodle-slam/js/core/sketch.js.
 * Jitter parameters and step sizes are identical to the source so the
 * art style is preserved exactly.
 *
 * API differs from the original in one key way: global mutable state
 * (`ctx`, `INK`, `INK_LIGHT`, `PAPER`) is replaced with explicit
 * dependency injection.  Every function receives:
 *   ctx  — CanvasRenderingContext2D
 *   rng  — seeded RNG, compatible with rng0() from util/seed.ts
 * so that renders are deterministic and testable.
 */

/* ------------------------------------------------------------------ */
/* Notopolis paper palette                                             */
/* ------------------------------------------------------------------ */

export const PAPER = {
  paper:     '#f2f3f6',  /* 冷灰白：与 UI 桌面同源的冷色图纸（演进：#f6f1e3 → #f8f6f0 → 现值） */
  ink:       '#3a3428',
  inkFaded:  '#b8b0a0',
  water:     '#7ab8d4',
  waterEdge: '#4a90b8',
  grass:     '#dfe8c8',
  park:      '#c8dfa0',
  roadFill:  '#efe6cf',
  roadEdge:  '#8a7f68',
  pastels:   ['#f2c4b8', '#c4d8f2', '#c8e8c4', '#f2e2b0', '#e0c8f0', '#f2d4e4'],
  mountain:  '#9a8f7c',
  snow:      '#ffffff',
} as const;

/* ------------------------------------------------------------------ */
/* Internal helpers (mirrored from sketch.js)                          */
/* ------------------------------------------------------------------ */

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map a [0,1) rng value to [lo, hi) */
function rand(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/**
 * 全局手感比例：doodle-slam 原语的默认参数（wobble 1.4、gap 6、grow 0.3…）
 * 是按"像素画布"调校的。Notopolis 在"世界坐标"里作画（1 单位 ≈ 8px），
 * 直接沿用会得到 10 倍粗的墨线。绘制前调用 setSketchScale(≈0.15) 统一换算，
 * 默认 1 保持与原版逐字一致（既有测试不受影响）。
 */
let SCALE = 1;
export function setSketchScale(s: number): void {
  SCALE = s;
}
export function getSketchScale(): number {
  return SCALE;
}

/* ------------------------------------------------------------------ */
/* Exported primitives                                                  */
/* ------------------------------------------------------------------ */

/**
 * wobblyPath — a jittery polyline through the given points.
 *
 * Each segment is subdivided into segs = max(2, floor(length/26)) pieces.
 * Every vertex is offset by rand(rng, -wobble, wobble) on both axes.
 * wobble default: 1.4 (unchanged from source).
 */
export function wobblyPath(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  pts: ReadonlyArray<readonly [number, number]>,
  wobble = 1.4,
): void {
  const wb = wobble * SCALE;
  ctx.beginPath();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const segs = Math.max(2, Math.floor(dist(x1, y1, x2, y2) / (26 * SCALE)));
    if (i === 0) {
      ctx.moveTo(x1 + rand(rng, -wb, wb), y1 + rand(rng, -wb, wb));
    }
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      ctx.lineTo(
        lerp(x1, x2, t) + rand(rng, -wb, wb),
        lerp(y1, y2, t) + rand(rng, -wb, wb),
      );
    }
  }
}

/**
 * wobblyRect — wobbly outline of an axis-aligned rectangle.
 *
 * Delegates to wobblyPath with 5 corners (closing back to [x, y]).
 */
export function wobblyRect(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  wobble = 1.4,
): void {
  wobblyPath(
    ctx,
    rng,
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
    wobble,
  );
}

/**
 * wobblyCircle — a lumpy closed circle.
 *
 * segs = max(10, floor(r/3)); each sample perturbs the radius by
 * rand(rng, -wobble, wobble) where wobble is a fraction of r.
 * wobble default: 0.05 (unchanged from source).
 */
export function wobblyCircle(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cy: number,
  r: number,
  wobble = 0.05,
): void {
  ctx.beginPath();
  const segs = Math.max(10, Math.floor(r / 3));
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const rr = r * (1 + rand(rng, -wobble, wobble));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * hatchRect — diagonal pencil hatching clipped to a rectangle.
 *
 * Lines run at 45°, spaced by `gap` pixels.  Each endpoint is jittered
 * by rand(rng, -1, 1).  Stroke color and lineWidth are injected via
 * `inkFaded` and are applied inside this function (callers need not set
 * them beforehand).
 *
 * gap default: 6 (unchanged from source).
 * inkFaded defaults to PAPER.inkFaded.
 */
export function hatchRect(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  gap = 6,
  inkFaded: string = PAPER.inkFaded,
): void {
  const g = Math.max(1e-6, gap * SCALE);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w; d += g) {
    ctx.moveTo(x + d + rand(rng, -SCALE, SCALE), y + h);
    ctx.lineTo(x + d + h + rand(rng, -SCALE, SCALE), y);
  }
  (ctx as CanvasRenderingContext2D & { strokeStyle: string }).strokeStyle = inkFaded;
  (ctx as CanvasRenderingContext2D & { lineWidth: number }).lineWidth = 0.8 * SCALE;
  ctx.stroke();
  ctx.restore();
}

/**
 * scribbleBlob — loose organic scribble for tree canopies, smudges, etc.
 *
 * 14 quadraticCurveTo segments.  Starting angle and per-step arc are
 * randomised from rng (identical to source).
 */
export function scribbleBlob(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  let a = rand(rng, 0, Math.PI * 2);
  ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  for (let i = 0; i < 14; i++) {
    a += rand(rng, 0.5, 1.4);
    const rr = r * rand(rng, 0.4, 1.05);
    ctx.quadraticCurveTo(
      cx + Math.cos(a - 0.4) * rr * 1.3,
      cy + Math.sin(a - 0.4) * rr * 1.3,
      cx + Math.cos(a) * rr,
      cy + Math.sin(a) * rr,
    );
  }
}

/**
 * withInkSilhouette — run fn with ctx locked to a single ink color.
 *
 * Differs from the doodle-slam original: the ink color is passed
 * explicitly rather than read from a module-level global.
 *
 * For stub/mock contexts (test environments) that lack real property
 * descriptors on the prototype chain, the function falls back to a
 * simple direct-assignment approach (mirrors the original guard).
 *
 * grow default: 0.3 (unchanged from source).
 */
export function withInkSilhouette(
  ctx: CanvasRenderingContext2D,
  ink: string,
  fn: () => void,
  grow = 0.3,
): void {
  const proto = Object.getPrototypeOf(ctx) as object;
  const desc = (p: string): PropertyDescriptor | null => {
    for (let o: object | null = proto; o; o = Object.getPrototypeOf(o) as object | null) {
      const d = Object.getOwnPropertyDescriptor(o, p);
      if (d) return d;
    }
    return null;
  };

  const dFill   = desc('fillStyle');
  const dStroke = desc('strokeStyle');
  const dLW     = desc('lineWidth');

  // Stub context (tests): just call fn directly
  if (!dFill || !dFill.set || !dLW || !dLW.get) {
    fn();
    return;
  }

  dFill.set.call(ctx, ink);
  dStroke!.set!.call(ctx, ink);
  Object.defineProperty(ctx, 'fillStyle',   { configurable: true, get: () => ink, set: () => {} });
  Object.defineProperty(ctx, 'strokeStyle', { configurable: true, get: () => ink, set: () => {} });
  Object.defineProperty(ctx, 'lineWidth', {
    configurable: true,
    get: () => dLW.get!.call(ctx) - grow,
    set: (v: number) => dLW.set!.call(ctx, v + grow),
  });

  try {
    fn();
  } finally {
    const c = ctx as unknown as Record<string, unknown>;
    delete c.fillStyle;
    delete c.strokeStyle;
    delete c.lineWidth;
  }
}

/**
 * dashedPath — draw a multi-segment path with Canvas setLineDash.
 *
 * Wraps Canvas setLineDash so callers do not need to remember to reset
 * it.  The dash pattern is applied before any path commands and the
 * line dash is restored to solid ([]) after stroke.
 */
export function dashedPath(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<readonly [number, number]>,
  dash: number[],
): void {
  ctx.setLineDash(dash.map((d) => d * SCALE));
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
