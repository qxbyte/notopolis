/**
 * render2d/camera2d.ts — 2D 相机视口管理 for Notopolis.
 *
 * 以 center 为原点，zoom 为像素/世界单位的等比缩放。
 * 支持左键拖拽平移和滚轮缩放（以光标为锚点）。
 */

export interface Camera2D {
  center: { x: number; z: number };
  zoom: number;
  worldToScreen(x: number, z: number): [number, number];
  screenToWorld(sx: number, sy: number): [number, number];
  apply(ctx: CanvasRenderingContext2D): void;
  onChange(cb: () => void): void;
  consumeDragMoved(): boolean;
  /** 编程式定位镜头（调试/定位用）：center 与 zoom 均按边界钳制并触发 onChange */
  setView(cx: number, cz: number, zoomPx: number): void;
  dispose(): void;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createCamera2D(
  canvas: HTMLCanvasElement,
  worldBounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  fitBounds?: { minX: number; minZ: number; maxX: number; maxZ: number },
): Camera2D {
  const { minX, minZ, maxX, maxZ } = worldBounds;

  // fitBounds 用于初始镜头 fit（默认与 worldBounds 相同）
  const fb = fitBounds ?? worldBounds;

  const boundsW = fb.maxX - fb.minX;
  const boundsH = fb.maxZ - fb.minZ;

  const fitX = canvas.width  / boundsW;
  const fitZ = canvas.height / boundsH;
  const fit  = Math.min(fitX, fitZ);

  const zoomMax = fit * 12;

  const worldW = maxX - minX;
  const worldH = maxZ - minZ;

  /** cover 缩放下限：viewport 始终在世界边界内，铺满窗口不露界外纸面（canvas 尺寸变化时动态取值） */
  function zoomMin(): number {
    return Math.max(canvas.width / worldW, canvas.height / worldH);
  }

  let zoom = Math.max(fit, zoomMin());
  const center = {
    x: (fb.minX + fb.maxX) / 2,
    z: (fb.minZ + fb.maxZ) / 2,
  };
  // 初始中心也按半视口钳制（fit 视野贴近世界边缘时不露界外；函数声明有提升，可直接调用）
  clampCenter();

  const listeners: Array<() => void> = [];

  function notify(): void {
    for (const cb of listeners) cb();
  }

  function clampCenter(): void {
    // 按半视口钳制：viewport 边缘不越过世界边界
    const halfW = canvas.width  / 2 / zoom;
    const halfD = canvas.height / 2 / zoom;
    center.x = worldW <= halfW * 2
      ? (minX + maxX) / 2
      : clamp(center.x, minX + halfW, maxX - halfW);
    center.z = worldH <= halfD * 2
      ? (minZ + maxZ) / 2
      : clamp(center.z, minZ + halfD, maxZ - halfD);
  }

  function worldToScreen(x: number, z: number): [number, number] {
    const sx = (x - center.x) * zoom + canvas.width  / 2;
    const sy = (z - center.z) * zoom + canvas.height / 2;
    return [sx, sy];
  }

  function screenToWorld(sx: number, sy: number): [number, number] {
    const x = (sx - canvas.width  / 2) / zoom + center.x;
    const z = (sy - canvas.height / 2) / zoom + center.z;
    return [x, z];
  }

  function apply(ctx: CanvasRenderingContext2D): void {
    const tx = canvas.width  / 2 - center.x * zoom;
    const ty = canvas.height / 2 - center.z * zoom;
    ctx.setTransform(zoom, 0, 0, zoom, tx, ty);
  }

  // 拖拽状态
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let maxDragDist = 0;
  let dragMoved = false;

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    maxDragDist = 0;
  }

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    center.x -= dx / zoom;
    center.z -= dy / zoom;
    clampCenter();

    const totalDx = e.clientX - dragStartX;
    const totalDy = e.clientY - dragStartY;
    const dist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
    if (dist > maxDragDist) maxDragDist = dist;

    notify();
  }

  function onMouseUp(_e: MouseEvent): void {
    if (!isDragging) return;
    isDragging = false;
    if (maxDragDist > 4) {
      dragMoved = true;
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();

    const anchorSx = e.offsetX;
    const anchorSy = e.offsetY;
    const [wx, wz] = screenToWorld(anchorSx, anchorSy);

    // 缩放量与 deltaY 幅度成比例：触控板的连续小增量得到平滑缩放，
    // 传统滚轮一格（deltaY≈±100）约 ±12%
    const factor = Math.exp(-e.deltaY * 0.0012);
    zoom = clamp(zoom * factor, zoomMin(), zoomMax);

    // 调整 center 使锚点不动
    const [newWx, newWz] = screenToWorld(anchorSx, anchorSy);
    center.x += wx - newWx;
    center.z += wz - newWz;
    clampCenter();

    notify();
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup',   onMouseUp);
  canvas.addEventListener('wheel',     onWheel, { passive: false });

  return {
    get center() { return center; },
    get zoom()   { return zoom; },
    set zoom(v: number) { zoom = clamp(v, zoomMin(), zoomMax); clampCenter(); },
    worldToScreen,
    screenToWorld,
    apply,
    onChange(cb: () => void) {
      listeners.push(cb);
    },
    consumeDragMoved() {
      const v = dragMoved;
      dragMoved = false;
      return v;
    },
    setView(cx: number, cz: number, zoomPx: number) {
      zoom = clamp(zoomPx, zoomMin(), zoomMax);
      center.x = cx;
      center.z = cz;
      clampCenter();
      notify();
    },
    dispose() {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup',   onMouseUp);
      canvas.removeEventListener('wheel',     onWheel);
    },
  };
}
