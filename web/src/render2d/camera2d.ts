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
  dispose(): void;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createCamera2D(
  canvas: HTMLCanvasElement,
  worldBounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): Camera2D {
  const { minX, minZ, maxX, maxZ } = worldBounds;

  const boundsW = maxX - minX;
  const boundsH = maxZ - minZ;

  const fitX = canvas.width  / boundsW;
  const fitZ = canvas.height / boundsH;
  const fit  = Math.min(fitX, fitZ);

  const zoomMin = fit * 0.5;
  const zoomMax = fit * 12;

  let zoom = fit;
  const center = {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
  };

  const listeners: Array<() => void> = [];

  function notify(): void {
    for (const cb of listeners) cb();
  }

  function clampCenter(): void {
    center.x = clamp(center.x, minX, maxX);
    center.z = clamp(center.z, minZ, maxZ);
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

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoom = clamp(zoom * factor, zoomMin, zoomMax);

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
    set zoom(v: number) { zoom = clamp(v, zoomMin, zoomMax); },
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
    dispose() {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup',   onMouseUp);
      canvas.removeEventListener('wheel',     onWheel);
    },
  };
}
