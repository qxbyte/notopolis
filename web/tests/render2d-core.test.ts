// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCamera2D } from '../src/render2d/camera2d';
import { createWorldCanvas } from '../src/render2d/worldcanvas';
import { hitTest, HitItem } from '../src/render2d/hit';

/* ----------------------------------------------------------------
   Mock helpers
   ---------------------------------------------------------------- */

/**
 * jsdom 中 canvas.getContext('2d') 返回 null（未安装 canvas 包）。
 * 在所有 WorldCanvas 测试中，通过 mock HTMLCanvasElement.prototype.getContext
 * 返回一个记录调用的 mock ctx，使 worldcanvas.ts 能正常运行。
 */
function makeMockCtx2d() {
  const setTransformCalls: { a: number; b: number; c: number; d: number; e: number; f: number }[] = [];
  return {
    _setTransformCalls: setTransformCalls,
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      setTransformCalls.push({ a, b, c, d, e, f });
    },
    drawImage(..._args: unknown[]) {},
    clearRect(..._args: unknown[]) {},
    fillRect(..._args: unknown[]) {},
    beginPath() {},
    stroke() {},
    fill() {},
  } as unknown as CanvasRenderingContext2D & {
    _setTransformCalls: typeof setTransformCalls;
  };
}

function setupCanvasMock() {
  // jsdom 不支持 getContext('2d')，mock 它使 worldcanvas.ts 能正常工作
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (_contextId: string) => makeMockCtx2d() as unknown as RenderingContext
  );
  return spy;
}

function makeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

type SetTransformCall = { a: number; b: number; c: number; d: number; e: number; f: number };

function makeMockCtx() {
  const setTransformCalls: SetTransformCall[] = [];
  const drawImageCalls: unknown[][] = [];

  const ctx = {
    setTransformCalls,
    drawImageCalls,
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      setTransformCalls.push({ a, b, c, d, e, f });
    },
    drawImage(...args: unknown[]) {
      drawImageCalls.push(args);
    },
  } as unknown as CanvasRenderingContext2D & {
    setTransformCalls: SetTransformCall[];
    drawImageCalls: unknown[][];
  };

  return ctx;
}

/* ----------------------------------------------------------------
   Camera2D tests
   ---------------------------------------------------------------- */

describe('Camera2D — worldToScreen / screenToWorld 互逆', () => {
  it('3 个世界点往返误差 < 0.001', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
    const cam = createCamera2D(canvas, bounds);

    const pts: [number, number][] = [
      [0, 0],
      [50, -30],
      [-80, 75],
    ];

    for (const [wx, wz] of pts) {
      const [sx, sy] = cam.worldToScreen(wx, wz);
      const [rx, rz] = cam.screenToWorld(sx, sy);
      expect(Math.abs(rx - wx)).toBeLessThan(0.001);
      expect(Math.abs(rz - wz)).toBeLessThan(0.001);
    }
  });
});

describe('Camera2D — fit 初始 zoom', () => {
  it('初始 zoom = fit，且不低于 cover 下限（地图铺满窗口，不露界外纸面）', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: 0, minZ: 0, maxX: 200, maxZ: 100 };
    const cam = createCamera2D(canvas, bounds);

    const fit = Math.min(800 / 200, 600 / 100); // 4（contain）
    const cover = Math.max(800 / 200, 600 / 100); // 6（cover 下限）
    const expectedZoom = Math.max(fit, cover); // 6

    expect(cam.zoom).toBeCloseTo(expectedZoom, 5);
  });
});

describe('Camera2D — 锚点缩放', () => {
  it('wheel 事件后锚点世界坐标不变（误差 < 0.01）', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: -200, minZ: -200, maxX: 200, maxZ: 200 };
    const cam = createCamera2D(canvas, bounds);

    // 锚点：canvas 中的某个屏幕坐标
    const anchorSx = 300;
    const anchorSy = 200;

    const [wx0, wz0] = cam.screenToWorld(anchorSx, anchorSy);

    // 模拟向上滚轮（放大）
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -1,
      clientX: anchorSx,
      clientY: anchorSy,
      bubbles: true,
    });
    // offsetX/offsetY 通过 Object.defineProperty 注入（jsdom 的 WheelEvent 不支持直接设置 offset）
    Object.defineProperty(wheelEvent, 'offsetX', { value: anchorSx, configurable: true });
    Object.defineProperty(wheelEvent, 'offsetY', { value: anchorSy, configurable: true });

    canvas.dispatchEvent(wheelEvent);

    const [wx1, wz1] = cam.screenToWorld(anchorSx, anchorSy);
    expect(Math.abs(wx1 - wx0)).toBeLessThan(0.01);
    expect(Math.abs(wz1 - wz0)).toBeLessThan(0.01);
  });
});

describe('Camera2D — 拖拽平移方向', () => {
  it('mousedown + mousemove(+50px, 0) → center.x 减少', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: -200, minZ: -200, maxX: 200, maxZ: 200 };
    const cam = createCamera2D(canvas, bounds);

    // cover 语义下初始 zoom 时 viewport 宽 == 世界宽，center 被锁定；放大后才可平移
    cam.zoom = 8;
    const centerXBefore = cam.center.x;

    // mousedown
    const mousedown = new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 300, bubbles: true });
    canvas.dispatchEvent(mousedown);

    // mousemove +50px
    const mousemove = new MouseEvent('mousemove', { button: 0, clientX: 150, clientY: 300, bubbles: true });
    canvas.dispatchEvent(mousemove);

    expect(cam.center.x).toBeLessThan(centerXBefore);
  });
});

describe('Camera2D — center 钳制', () => {
  it('center.x 不超过 maxX', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const cam = createCamera2D(canvas, bounds);

    // 强制设置 center 到 maxX 附近，然后触发 wheel（放大后 center 不应超出 maxX）
    cam.center.x = 90;
    cam.center.z = 50;

    // 大量向上 wheel 事件使 zoom 极大（center 可能被拉动），然后 mousemove 右移
    const mousedown = new MouseEvent('mousedown', { button: 0, clientX: 400, clientY: 300, bubbles: true });
    canvas.dispatchEvent(mousedown);

    // 拖拽到很远右边
    const mousemove = new MouseEvent('mousemove', { button: 0, clientX: -5000, clientY: 300, bubbles: true });
    canvas.dispatchEvent(mousemove);

    expect(cam.center.x).toBeLessThanOrEqual(bounds.maxX);
    expect(cam.center.x).toBeGreaterThanOrEqual(bounds.minX);
  });
});

describe('Camera2D — consumeDragMoved 阈值', () => {
  it('< 4px 移动返回 false', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
    const cam = createCamera2D(canvas, bounds);

    const mousedown = new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mousedown);

    const mousemove = new MouseEvent('mousemove', { button: 0, clientX: 102, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mousemove);

    const mouseup = new MouseEvent('mouseup', { button: 0, clientX: 102, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mouseup);

    expect(cam.consumeDragMoved()).toBe(false);
  });

  it('> 4px 移动返回 true', () => {
    const canvas = makeCanvas(800, 600);
    const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
    const cam = createCamera2D(canvas, bounds);

    const mousedown = new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mousedown);

    const mousemove = new MouseEvent('mousemove', { button: 0, clientX: 110, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mousemove);

    const mouseup = new MouseEvent('mouseup', { button: 0, clientX: 110, clientY: 100, bubbles: true });
    canvas.dispatchEvent(mouseup);

    expect(cam.consumeDragMoved()).toBe(true);
    // 消费后重置
    expect(cam.consumeDragMoved()).toBe(false);
  });
});

/* ----------------------------------------------------------------
   WorldCanvas tests
   ---------------------------------------------------------------- */

describe('WorldCanvas — tile 数量（小世界）', () => {
  beforeEach(() => { setupCanvasMock(); });

  it('100×100 单位 × 8px = 800px: 1 tile', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const wc = createWorldCanvas(bounds, 8);
    expect(wc.tiles().count).toBe(1);
  });
});

describe('WorldCanvas — tile 数量（大世界）', () => {
  beforeEach(() => { setupCanvasMock(); });

  it('1000×1000 单位 × 8px = 8000px: 4×4 = 16 tiles', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 };
    const wc = createWorldCanvas(bounds, 8);
    expect(wc.tiles().count).toBe(16);
  });
});

describe('WorldCanvas — paint 回调调用次数', () => {
  beforeEach(() => { setupCanvasMock(); });

  it('paint fn 被调用次数 = tile 数量', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const wc = createWorldCanvas(bounds, 8);

    let callCount = 0;
    wc.paint(() => { callCount++; });

    expect(callCount).toBe(wc.tiles().count);
  });

  it('大世界 paint fn 被调用 16 次', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 };
    const wc = createWorldCanvas(bounds, 8);

    let callCount = 0;
    wc.paint(() => { callCount++; });

    expect(callCount).toBe(16);
  });
});

describe('WorldCanvas — paint setTransform 参数', () => {
  beforeEach(() => { setupCanvasMock(); });

  it('minX=minZ=0 时第一个 tile 的 setTransform(pxPerUnit, 0, 0, pxPerUnit, 0, 0)', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const pxPerUnit = 8;
    const wc = createWorldCanvas(bounds, pxPerUnit);

    // paint 回调收到的 ctx 就是 tile 内部的 mock ctx
    // worldcanvas 在调用 fn 之前已对 ctx 调用了 setTransform
    // 通过 _setTransformCalls 验证参数是否正确
    let firstSetTransformCall: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
    wc.paint((ctx) => {
      if (firstSetTransformCall === null) {
        const calls = (ctx as unknown as { _setTransformCalls: typeof firstSetTransformCall[] })._setTransformCalls;
        if (calls && calls.length > 0) {
          firstSetTransformCall = calls[calls.length - 1];
        }
      }
    });

    expect(firstSetTransformCall).not.toBeNull();
    expect(firstSetTransformCall!.a).toBe(pxPerUnit);            // 8
    expect(firstSetTransformCall!.b).toBe(0);
    expect(firstSetTransformCall!.c).toBe(0);
    expect(firstSetTransformCall!.d).toBe(pxPerUnit);            // 8
    expect(firstSetTransformCall!.e).toBeCloseTo(0, 10);         // -minX * pxPerUnit = 0
    expect(firstSetTransformCall!.f).toBeCloseTo(0, 10);         // -minZ * pxPerUnit = 0
  });
});

/* ----------------------------------------------------------------
   Hit tests
   ---------------------------------------------------------------- */

describe('hitTest — circle', () => {
  it('点在圆内 → 返回该 item', () => {
    const item: HitItem = {
      kind: 'building',
      shape: { type: 'circle', x: 10, z: 10, r: 5 },
      data: { id: 1 },
    };
    const result = hitTest(12, 11, [item]);
    expect(result).toBe(item);
  });

  it('点在圆外 → null', () => {
    const item: HitItem = {
      kind: 'building',
      shape: { type: 'circle', x: 10, z: 10, r: 5 },
      data: { id: 1 },
    };
    const result = hitTest(20, 20, [item]);
    expect(result).toBeNull();
  });

  it('点恰好在圆边上 → 命中', () => {
    const item: HitItem = {
      kind: 'building',
      shape: { type: 'circle', x: 0, z: 0, r: 5 },
      data: {},
    };
    const result = hitTest(5, 0, [item]);
    expect(result).toBe(item);
  });
});

describe('hitTest — rect', () => {
  it('点在矩形内 → 返回该 item', () => {
    const item: HitItem = {
      kind: 'road',
      shape: { type: 'rect', x: 0, z: 0, w: 20, h: 10 },
      data: {},
    };
    expect(hitTest(10, 5, [item])).toBe(item);
  });

  it('点在矩形外 → null', () => {
    const item: HitItem = {
      kind: 'road',
      shape: { type: 'rect', x: 0, z: 0, w: 20, h: 10 },
      data: {},
    };
    expect(hitTest(25, 5, [item])).toBeNull();
  });

  it('点在矩形边界上 → 命中', () => {
    const item: HitItem = {
      kind: 'road',
      shape: { type: 'rect', x: 0, z: 0, w: 20, h: 10 },
      data: {},
    };
    expect(hitTest(0, 0, [item])).toBe(item);
    expect(hitTest(20, 10, [item])).toBe(item);
  });
});

describe('hitTest — polygon', () => {
  it('点在三角形内 → 返回该 item', () => {
    // 三角形：(0,0), (10,0), (5,10)
    const item: HitItem = {
      kind: 'zone',
      shape: {
        type: 'polygon',
        pts: [[0, 0], [10, 0], [5, 10]],
      },
      data: {},
    };
    expect(hitTest(5, 5, [item])).toBe(item);
  });

  it('点在三角形外 → null', () => {
    const item: HitItem = {
      kind: 'zone',
      shape: {
        type: 'polygon',
        pts: [[0, 0], [10, 0], [5, 10]],
      },
      data: {},
    };
    expect(hitTest(0, 10, [item])).toBeNull();
  });
});

describe('hitTest — 倒序优先', () => {
  it('两个重叠 circle，添加顺序 [A, B]，命中 B（最后添加=最上层）', () => {
    const itemA: HitItem = {
      kind: 'a',
      shape: { type: 'circle', x: 0, z: 0, r: 10 },
      data: { name: 'A' },
    };
    const itemB: HitItem = {
      kind: 'b',
      shape: { type: 'circle', x: 0, z: 0, r: 10 },
      data: { name: 'B' },
    };
    const result = hitTest(0, 0, [itemA, itemB]);
    expect(result).toBe(itemB);
  });
});
