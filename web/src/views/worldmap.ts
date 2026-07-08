/**
 * views/worldmap.ts
 * 世界地图视图——展示所有城邦缩略图，点击进入城市。
 */

import * as THREE from 'three';
import { createOrbitCamera } from '../scene/camera';
import type { WorldVault } from '../api';
import { TIER } from '../ui/hud';

export interface WorldMapHandle {
  dispose(): void;
}

export function showWorldMap(
  ctx: { scene: THREE.Scene; renderer: THREE.WebGLRenderer; container: HTMLElement },
  vaults: WorldVault[],
  onEnterCity: (vault: WorldVault) => void
): WorldMapHandle {
  const { scene, renderer, container } = ctx;
  const T = 200;

  // 清空雾（城市视图可能留下了）
  scene.fog = null;

  // 绿色地面
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a7a28 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 镜头
  const orbitCamera = createOrbitCamera(renderer.domElement, { worldR: 100, T });

  // 城邦位置计算
  const radius = Math.min(Math.max(50, vaults.length * 20), T * 0.4);
  const vaultPositions: THREE.Vector3[] = vaults.map((_, i) => {
    if (vaults.length === 1) return new THREE.Vector3(0, 0, 0);
    const angle = (i / vaults.length) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  });

  // 城邦网格组（每个城邦一个 group）
  const vaultGroups: Array<{ group: THREE.Group; vault: WorldVault }> = [];

  for (let i = 0; i < vaults.length; i++) {
    const vault = vaults[i];
    const pos = vaultPositions[i];
    const group = new THREE.Group();
    group.position.copy(pos);

    const color = vault.ok ? getTierColor(vault.tier) : 0x888888;
    const opacity = vault.ok ? 1 : 0.4;

    function makeMat(c: number): THREE.MeshLambertMaterial {
      const m = new THREE.MeshLambertMaterial({ color: c });
      if (!vault.ok) {
        m.transparent = true;
        m.opacity = opacity;
        m.color.set(0x888888);
      }
      return m;
    }

    if (vault.tier === 'camp') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4, 8), makeMat(color));
      cone.position.y = 2;
      group.add(cone);
    } else if (vault.tier === 'village') {
      const offsets: [number, number][] = [[-1.2, -0.8], [1.2, -0.8], [0, 0.8]];
      for (const [ox, oz] of offsets) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 1.2), makeMat(color));
        box.position.set(ox, 1, oz);
        group.add(box);
      }
    } else if (vault.tier === 'city') {
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 2), makeMat(color));
      b1.position.set(-1.5, 1.25, 0);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 2), makeMat(color));
      b2.position.set(1.5, 1.25, 0);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 1.2), makeMat(color));
      tower.position.set(0, 2.5, 0);
      group.add(b1, b2, tower);
    } else if (vault.tier === 'capital') {
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 2), makeMat(color));
      b1.position.set(-1.5, 1.25, 0);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 2), makeMat(color));
      b2.position.set(1.5, 1.25, 0);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 1.2), makeMat(color));
      tower.position.set(0, 2.5, 0);
      const domeMat = new THREE.MeshLambertMaterial({ color: vault.ok ? 0xFFD700 : 0x888888 });
      if (!vault.ok) { domeMat.transparent = true; domeMat.opacity = 0.4; }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), domeMat);
      dome.position.set(0, 5.8, 0);
      group.add(b1, b2, tower, dome);
    }

    scene.add(group);
    vaultGroups.push({ group, vault });
  }

  // 贸易路线：相邻城邦连线（环形）
  const tradeLines: THREE.Line[] = [];
  if (vaults.length > 1) {
    for (let i = 0; i < vaults.length; i++) {
      const a = vaultPositions[i];
      const b = vaultPositions[(i + 1) % vaults.length];
      const points = [a, b];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xD4A76A,
        dashSize: 3,
        gapSize: 3,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      scene.add(line);
      tradeLines.push(line);
    }
  }

  // DOM 标签
  const labels: HTMLDivElement[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const vault = vaults[i];
    const label = document.createElement('div');
    label.style.cssText = `
      position: fixed; pointer-events: none; z-index: 5;
      background: rgba(30,26,46,0.88); color: #e8e0d4; border-radius: 5px;
      padding: 3px 9px; font-size: 12px; white-space: nowrap; display: none;
    `;
    const tierLabel = TIER[vault.tier] ?? vault.tier;
    label.textContent = `${vault.name} · ${tierLabel} · ${vault.noteCount}栋`;
    if (!vault.ok) {
      const warn = document.createElement('span');
      warn.style.color = '#e07060';
      warn.textContent = ' ⬛ 无法连接';
      label.appendChild(warn);
    }
    container.appendChild(label);
    labels.push(label);
  }

  // 工具提示（ok=false 时）
  let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: fixed; pointer-events: none; z-index: 10;
    background: rgba(200,80,60,0.92); color: #fff; border-radius: 5px;
    padding: 5px 12px; font-size: 12px; display: none;
  `;
  container.appendChild(tooltip);

  // 射线拾取
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onClick(e: MouseEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, orbitCamera.camera);

    for (const { group, vault } of vaultGroups) {
      const meshes: THREE.Object3D[] = [];
      group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        if (vault.ok) {
          onEnterCity(vault);
        } else {
          tooltip.textContent = vault.reason ?? '连接失败';
          tooltip.style.display = 'block';
          tooltip.style.left = e.clientX + 10 + 'px';
          tooltip.style.top = e.clientY + 10 + 'px';
          if (tooltipTimer) clearTimeout(tooltipTimer);
          tooltipTimer = setTimeout(() => { tooltip.style.display = 'none'; }, 2500);
        }
        return;
      }
    }
  }

  renderer.domElement.addEventListener('click', onClick);

  // RAF 循环
  let animId: number;

  function loop(): void {
    animId = requestAnimationFrame(loop);
    orbitCamera.update();

    // 更新标签位置
    const rect = renderer.domElement.getBoundingClientRect();
    for (let i = 0; i < vaults.length; i++) {
      const label = labels[i];
      const pos3 = vaultPositions[i].clone();
      pos3.y += 6;
      pos3.project(orbitCamera.camera);
      if (pos3.z > 1) { label.style.display = 'none'; continue; }
      const lx = ((pos3.x + 1) / 2) * rect.width + rect.left;
      const ly = ((-pos3.y + 1) / 2) * rect.height + rect.top;
      label.style.display = 'block';
      label.style.left = lx + 'px';
      label.style.top = ly + 'px';
    }

    renderer.render(scene, orbitCamera.camera);
  }

  animId = requestAnimationFrame(loop);

  return {
    dispose(): void {
      cancelAnimationFrame(animId);
      renderer.domElement.removeEventListener('click', onClick);
      orbitCamera.dispose();
      if (tooltipTimer) clearTimeout(tooltipTimer);
      tooltip.remove();
      for (const label of labels) label.remove();
      // 移除场景中本视图添加的对象
      scene.remove(ground);
      ground.geometry.dispose();
      groundMat.dispose();
      for (const { group } of vaultGroups) {
        scene.remove(group);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => m?.dispose?.());
          }
        });
      }
      // 明确移除本视图创建的贸易路线，避免误删其他视图的 Line 对象
      for (const line of tradeLines) {
        scene.remove(line);
        line.geometry.dispose();
        const mats = Array.isArray(line.material) ? line.material : [line.material];
        mats.forEach((m) => m?.dispose?.());
      }
    },
  };
}

function getTierColor(tier: string): number {
  switch (tier) {
    case 'camp': return 0x8B7355;
    case 'village': return 0xD4A76A;
    case 'city': return 0xE8C49A;
    case 'capital': return 0xE8C49A;
    default: return 0xD4A76A;
  }
}
