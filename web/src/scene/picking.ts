/**
 * scene/picking.ts
 * 鼠标射线拾取（hover 标签 + click 信息卡）。
 * 行为对应原型 prototype/public/index.html 行 1416-1475，一字不改。
 */

import * as THREE from 'three';
import type { Building, District } from '@shared/types';

export type UserData =
  | { type: 'building'; b: Building; dir: string }
  | { type: 'district'; dir: string; district: District };

export interface PickingOptions {
  dom: HTMLElement;
  camera: THREE.PerspectiveCamera;
  pickables: THREE.Object3D[];
  handlers: {
    onHoverLabel(text: string | null, x: number, y: number): void;
    onPick(u: UserData | null): void;
  };
  isDragging(): boolean;
  consumeDragMoved(): boolean;
}

export function createPicking(opts: PickingOptions): { dispose(): void } {
  const { dom, camera, pickables, handlers, isDragging, consumeDragMoved } = opts;

  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function pick(e: MouseEvent): UserData | null {
    const rect = dom.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    ray.setFromCamera(mouse, camera);
    for (const h of ray.intersectObjects(pickables, true)) {
      const root = (h.object.userData.root as THREE.Object3D | undefined) ?? h.object;
      if ((root.userData as { type?: string }).type) return root.userData as UserData;
    }
    return null;
  }

  function onHover(e: MouseEvent): void {
    if (isDragging()) {
      handlers.onHoverLabel(null, 0, 0);
      dom.style.cursor = 'default';
      return;
    }
    const u = pick(e);
    if (u?.type === 'building') {
      handlers.onHoverLabel(u.b.title, e.clientX, e.clientY);
      dom.style.cursor = 'pointer';
    } else {
      handlers.onHoverLabel(null, 0, 0);
      dom.style.cursor = 'default';
    }
  }

  function onClick(e: MouseEvent): void {
    if (consumeDragMoved()) return;
    const u = pick(e);
    handlers.onPick(u);
  }

  // mousedown on dom (to reset drag state tracking externally via camera)
  // click on dom
  dom.addEventListener('click', onClick);

  // mousemove on window (onHover needs drag state via isDragging())
  window.addEventListener('mousemove', onHover);

  return {
    dispose(): void {
      dom.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onHover);
    },
  };
}
