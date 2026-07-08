/**
 * scene/camera.ts
 * 自由轨道相机（左键平移、右键旋转/俯仰、滚轮缩放）。
 * 参数与公式对应原型 prototype/public/index.html 行 1375-1414，一字不改。
 */

import * as THREE from 'three';

export interface OrbitCamera {
  camera: THREE.PerspectiveCamera;
  update(): void;
  dispose(): void;
  isDragging(): boolean;
  /** 读取后清除 dragMoved 标志 */
  consumeDragMoved(): boolean;
}

export function createOrbitCamera(
  dom: HTMLElement,
  opts: { worldR: number; T: number }
): OrbitCamera {
  const { worldR, T } = opts;

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, T * 6);

  let theta = Math.PI / 4;
  let phi = (28 * Math.PI) / 180;
  let radius = worldR * 2.3;
  const target = new THREE.Vector3(0, 0, 0);
  let drag: { btn: number; x: number; y: number } | null = null;
  let dragMoved = false;

  function updateCam(): void {
    camera.position.set(
      target.x + radius * Math.cos(phi) * Math.sin(theta),
      target.y + radius * Math.sin(phi),
      target.z + radius * Math.cos(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }

  updateCam();

  // --- Event handlers ---

  function onMouseDown(e: MouseEvent): void {
    drag = { btn: e.button, x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  function onMouseUp(): void {
    drag = null;
  }

  function onMouseMove(e: MouseEvent): void {
    if (!drag) return;
    dragMoved = true;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;

    if (drag.btn === 0) {
      // 左键：平移地图（地图跟随光标方向）
      const s = radius * 0.0011;
      const fx = Math.sin(theta), fz = Math.cos(theta);
      target.x -= (dx * fz + dy * fx * 1.5) * s;
      target.z += (dx * fx - dy * fz * 1.5) * s;
      target.x = Math.max(-T * 0.85, Math.min(T * 0.85, target.x));
      target.z = Math.max(-T * 0.85, Math.min(T * 0.85, target.z));
    } else {
      // 右键：旋转/俯仰
      theta -= dx * 0.005;
      phi = Math.min((75 * Math.PI) / 180, Math.max((15 * Math.PI) / 180, phi + dy * 0.004));
    }
    updateCam();
  }

  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    radius = Math.min(T * 0.75, Math.max(8, radius * (1 + e.deltaY * 0.001)));
    updateCam();
  }

  function onResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  // mousedown/contextmenu/wheel on dom (canvas)
  dom.addEventListener('mousedown', onMouseDown);
  dom.addEventListener('contextmenu', onContextMenu);
  dom.addEventListener('wheel', onWheel, { passive: false });

  // mouseup/mousemove/resize on window
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onResize);

  return {
    camera,
    update(): void {
      updateCam();
    },
    dispose(): void {
      dom.removeEventListener('mousedown', onMouseDown);
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
    },
    isDragging(): boolean {
      return drag !== null;
    },
    consumeDragMoved(): boolean {
      const val = dragMoved;
      dragMoved = false;
      return val;
    },
  };
}
