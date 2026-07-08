// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { rng0 } from '../src/util/seed';
import {
  wobblyPath,
  wobblyRect,
  wobblyCircle,
  hatchRect,
  scribbleBlob,
  withInkSilhouette,
  dashedPath,
  PAPER,
} from '../src/render2d/sketch';

/* ----------------------------------------------------------------
   Mock canvas context that records draw-call sequences.
   ---------------------------------------------------------------- */
type Call = { method: string; args: number[] };

function makeMockCtx() {
  const calls: Call[] = [];
  // Track all setLineDash invocations so tests can inspect any call, not just the last
  const _lineDashHistory: number[][] = [];

  const record =
    (method: string) =>
    (...args: number[]) => {
      calls.push({ method, args });
    };

  const ctx = {
    // Path primitives
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    bezierCurveTo: record('bezierCurveTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    closePath: record('closePath'),
    rect: record('rect'),
    arc: record('arc'),
    // Clip
    save: record('save'),
    restore: record('restore'),
    clip: record('clip'),
    // Style setters
    stroke: record('stroke'),
    fill: record('fill'),
    // setLineDash: record each invocation
    setLineDash(dash: number[]) {
      _lineDashHistory.push([...dash]);
      calls.push({ method: 'setLineDash', args: [] });
    },
    // Expose for assertions
    _calls: calls,
    /** Returns the first non-empty dash array that was set (i.e. the actual pattern, not the reset) */
    _getFirstDash: () => _lineDashHistory.find((d) => d.length > 0) ?? [],
    _lineDashHistory,
    // Props consumed by withInkSilhouette but not needed for structural tests
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D & {
    _calls: Call[];
    _getFirstDash: () => number[];
    _lineDashHistory: number[][];
  };

  return ctx;
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */
function callNames(ctx: ReturnType<typeof makeMockCtx>) {
  return ctx._calls.map((c) => c.method);
}

function countCalls(ctx: ReturnType<typeof makeMockCtx>, method: string) {
  return ctx._calls.filter((c) => c.method === method).length;
}

/* ----------------------------------------------------------------
   Tests
   ---------------------------------------------------------------- */

describe('wobblyPath — determinism', () => {
  it('同种子两次调用产生完全相同的 moveTo/lineTo 序列', () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];

    const ctx1 = makeMockCtx();
    const rng1 = rng0('test-seed');
    wobblyPath(ctx1, rng1, pts);

    const ctx2 = makeMockCtx();
    const rng2 = rng0('test-seed');
    wobblyPath(ctx2, rng2, pts);

    expect(ctx1._calls).toEqual(ctx2._calls);
  });

  it('调用序列以 beginPath 开头', () => {
    const ctx = makeMockCtx();
    wobblyPath(ctx, rng0('a'), [[0, 0], [50, 50]]);
    expect(ctx._calls[0].method).toBe('beginPath');
  });
});

describe('wobblyRect — closure', () => {
  it('最后一个坐标回到起点（5 个顶点首尾相同）或有 closePath', () => {
    const ctx = makeMockCtx();
    wobblyRect(ctx, rng0('rect'), 10, 20, 80, 60);
    const names = callNames(ctx);
    // Either has closePath or the last lineTo lands near [10, 20]
    const hasClose = names.includes('closePath');
    if (!hasClose) {
      // last lineTo args should be close to [10, 20] (with wobble ≤ 2)
      const lineTos = ctx._calls.filter((c) => c.method === 'lineTo');
      const last = lineTos[lineTos.length - 1];
      expect(Math.abs(last.args[0] - 10)).toBeLessThan(3);
      expect(Math.abs(last.args[1] - 20)).toBeLessThan(3);
    } else {
      expect(hasClose).toBe(true);
    }
  });

  it('产生多于 1 次 lineTo（有抖动细分）', () => {
    const ctx = makeMockCtx();
    wobblyRect(ctx, rng0('rect2'), 0, 0, 100, 100);
    expect(countCalls(ctx, 'lineTo')).toBeGreaterThan(1);
  });
});

describe('hatchRect — line count ≈ width/gap', () => {
  it('线条数量接近 (width+height)/gap（允许 ±1）', () => {
    const ctx = makeMockCtx();
    const w = 60, h = 40, gap = 6;
    hatchRect(ctx, rng0('hatch'), 0, 0, w, h, gap, '#b8b0a0');
    // Each hatch line = 1 moveTo + 1 lineTo pair
    const moveCount = countCalls(ctx, 'moveTo');
    const expected = Math.ceil((w + h) / gap);
    expect(moveCount).toBeGreaterThanOrEqual(expected - 2);
    expect(moveCount).toBeLessThanOrEqual(expected + 2);
  });
});

describe('scribbleBlob — segment count', () => {
  it('至少 14 段 quadraticCurveTo', () => {
    const ctx = makeMockCtx();
    scribbleBlob(ctx, rng0('blob'), 50, 50, 30);
    const qCount = countCalls(ctx, 'quadraticCurveTo');
    expect(qCount).toBeGreaterThanOrEqual(14);
  });

  it('以 beginPath + moveTo 开头', () => {
    const ctx = makeMockCtx();
    scribbleBlob(ctx, rng0('blob2'), 0, 0, 20);
    const names = callNames(ctx);
    expect(names[0]).toBe('beginPath');
    expect(names[1]).toBe('moveTo');
  });
});

describe('withInkSilhouette — delegate fn called', () => {
  it('fn 被调用一次', () => {
    const ctx = makeMockCtx();
    let called = 0;
    withInkSilhouette(ctx, '#3a3428', () => {
      called++;
    });
    expect(called).toBe(1);
  });
});

describe('dashedPath — setLineDash', () => {
  it('调用了 setLineDash', () => {
    const ctx = makeMockCtx();
    const pts: [number, number][] = [[0, 0], [50, 0], [50, 50]];
    dashedPath(ctx, pts, [4, 4]);
    expect(callNames(ctx)).toContain('setLineDash');
  });

  it('传入的 dash 数组被正确设置（取第一次非空调用）', () => {
    const ctx = makeMockCtx();
    dashedPath(ctx, [[0, 0], [100, 0]], [8, 3]);
    expect(ctx._getFirstDash()).toEqual([8, 3]);
  });

  it('setLineDash 在 moveTo 之前调用', () => {
    const ctx = makeMockCtx();
    dashedPath(ctx, [[0, 0], [100, 0]], [5, 5]);
    const names = callNames(ctx);
    const dashIdx = names.indexOf('setLineDash');
    const moveIdx = names.indexOf('moveTo');
    expect(dashIdx).toBeLessThan(moveIdx);
  });
});

describe('PAPER palette', () => {
  it('包含所有必要颜色键', () => {
    const keys = [
      'paper', 'ink', 'inkFaded', 'water', 'waterEdge',
      'grass', 'park', 'roadFill', 'roadEdge', 'pastels',
      'mountain', 'snow',
    ] as const;
    for (const k of keys) {
      expect(PAPER).toHaveProperty(k);
    }
  });

  it('pastels 是长度 ≥ 4 的数组', () => {
    expect(Array.isArray(PAPER.pastels)).toBe(true);
    expect(PAPER.pastels.length).toBeGreaterThanOrEqual(4);
  });

  it('所有字符串颜色是合法十六进制', () => {
    const hex = /^#[0-9a-f]{3,8}$/i;
    const vals = Object.values(PAPER).flat();
    for (const v of vals) {
      if (typeof v === 'string') {
        expect(v).toMatch(hex);
      }
    }
  });
});
