/**
 * views/cityview.ts
 * 城市完整渲染视图——组装所有之前构建的模块。
 */

import * as THREE from 'three';
import { createOrbitCamera } from '../scene/camera';
import { createPicking } from '../scene/picking';
import type { UserData } from '../scene/picking';
import { worldParams } from '../world/params';
import { buildTerrain } from '../world/terrain';
import { buildWater, buildBridges } from '../world/water';
import { buildWilds, buildClouds, updateClouds } from '../world/vegetation';
import { buildDistricts } from '../city/districts';
import {
  prepareRoads,
  computeTrafficLights,
  buildRoadMeshes,
  buildTrafficLightMeshes,
  updateTrafficLights,
} from '../city/roads';
import { buildBuildings, updateBuildings } from '../city/buildings';
import { spawnCitizens, updateCitizens } from '../agents/citizens';
import { spawnVehicles, updateVehicles } from '../agents/vehicles';
import { createHUD, TIER } from '../ui/hud';
import { createCards } from '../ui/cards';
import type { WorldVault } from '../api';
import type { CityModel } from '@shared/types';

export interface CityViewHandle {
  dispose(): void;
  /** 可拾取对象数量（供调试钩子读取） */
  pickableCount: number;
  /** 对 pickables[index] 触发等价于鼠标点击的卡片显示 */
  triggerPick(index: number): void;
}

export function showCity(
  ctx: { scene: THREE.Scene; renderer: THREE.WebGLRenderer; container: HTMLElement },
  vault: WorldVault,
  city: CityModel,
  onBack: () => void
): CityViewHandle {
  const { scene, renderer, container } = ctx;

  // ---- 1. 计算城市几何尺寸 ----
  const xs = city.districts.flatMap((d) => [d.x, d.x + d.width]);
  const zs = city.districts.flatMap((d) => [d.z, d.z + d.depth]);
  const minX = Math.min(...xs, -10), maxX = Math.max(...xs, 10);
  const minZ = Math.min(...zs, -10), maxZ = Math.max(...zs, 10);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const cityHalfW = (maxX - minX) / 2, cityHalfD = (maxZ - minZ) / 2;
  const worldR = Math.max(cityHalfW, cityHalfD) + 14;
  const T = Math.max(320, worldR * 6);

  // ---- 2. 雾 ----
  scene.fog = new THREE.Fog(0x8ecbf2, T * 0.9, T * 2.4);

  // ---- 根 Group：所有场景对象统一挂载到此，dispose 时一次性清理 ----
  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  // 代理 scene.add，将对象添加到 rootGroup 而非 scene（fog/background 仍在 scene 上设置）
  const sceneProxy = Object.assign(Object.create(scene), {
    add(...objects: THREE.Object3D[]): typeof sceneProxy {
      rootGroup.add(...objects);
      return sceneProxy;
    },
  }) as unknown as THREE.Scene;

  // ---- 3. 世界参数 ----
  const p = worldParams(vault.path, cityHalfW, cityHalfD, worldR, T);
  const WS = 'world:' + vault.path;

  // ---- 4. 地形 ----
  buildTerrain(sceneProxy, p);

  // ---- 5. 道路预处理 ----
  const roads = prepareRoads(city, cx, cz);

  // ---- 6. 区块 ----
  const { plates, idleSpots } = buildDistricts(sceneProxy, city, cx, cz, WS);

  // ---- 7. 道路网格 ----
  buildRoadMeshes(sceneProxy, roads, cx, cz);

  // ---- 8. 红绿灯 ----
  const lights = computeTrafficLights(roads);
  buildTrafficLightMeshes(sceneProxy, lights, cx, cz);

  // ---- 9. 水体 ----
  buildWater(sceneProxy, p);
  buildBridges(sceneProxy, p, roads, cx, cz);

  // ---- 10. 植被 & 云 ----
  buildWilds(sceneProxy, p, WS);
  const clouds = buildClouds(sceneProxy, p, WS);

  // ---- 11. 建筑 ----
  const buildResult = buildBuildings(sceneProxy, city, cx, cz, Date.now());

  // ---- 12. 市民 ----
  const citizens = spawnCitizens(sceneProxy, {
    wsPrefix: WS,
    activeCount7d: city.activeCount7d,
    walkables: roads,
    idleSpots,
    cx,
    cz,
  });

  // ---- 13. 车辆 ----
  const vehicles = spawnVehicles(sceneProxy, {
    roads,
    trafficLights: lights,
    cityHalfW,
    cityHalfD,
    cx,
    cz,
    worldParams: p,
  });

  // ---- 14. 镜头 ----
  const orbitCamera = createOrbitCamera(renderer.domElement, { worldR, T });

  // ---- 15. 信息卡 ----
  const cards = createCards(container);

  // ---- 拾取 ----
  const pickables: THREE.Object3D[] = [...plates, ...buildResult.pickables];

  const picking = createPicking({
    dom: renderer.domElement,
    camera: orbitCamera.camera,
    pickables,
    handlers: {
      onHoverLabel(text: string | null, x: number, y: number): void {
        let labelEl = container.querySelector<HTMLElement>('#label');
        if (!labelEl) {
          labelEl = document.createElement('div');
          labelEl.id = 'label';
          container.appendChild(labelEl);
        }
        if (!text) {
          labelEl.style.display = 'none';
          return;
        }
        labelEl.textContent = text;
        labelEl.style.display = 'block';
        labelEl.style.left = x + 14 + 'px';
        labelEl.style.top = y + 8 + 'px';
      },
      onPick(u: UserData | null): void {
        if (!u) {
          cards.hide();
          return;
        }
        if (u.type === 'building') {
          cards.showBuilding(u.b, u.dir, vault.path);
        } else if (u.type === 'district') {
          cards.showDistrict(u.district, Date.now());
        }
      },
    },
    isDragging: () => orbitCamera.isDragging(),
    consumeDragMoved: () => orbitCamera.consumeDragMoved(),
  });

  // ---- 16. HUD ----
  const hud = createHUD(container);
  const tierLabel = TIER[city.tier] ?? city.tier;
  hud.setStats(
    `${vault.name} · ${tierLabel} · ${city.noteCount} 栋建筑 · 近7天活跃 ${city.activeCount7d}`
  );

  // ---- 17. 返回按钮 ----
  const backBtn = document.createElement('button');
  backBtn.id = 'back-btn';
  backBtn.textContent = '← 返回世界地图';
  backBtn.addEventListener('click', onBack);
  container.appendChild(backBtn);

  // ---- 渲染循环 ----
  let animId: number;

  function loop(t: number): void {
    animId = requestAnimationFrame(loop);
    orbitCamera.update();
    const ts = t * 0.001;
    updateTrafficLights(lights, ts);
    updateBuildings(buildResult, ts);
    updateCitizens(citizens, ts, cx, cz);
    updateVehicles(vehicles, ts, cx, cz);
    updateClouds(clouds, ts, T);
    renderer.render(scene, orbitCamera.camera);
  }

  animId = requestAnimationFrame(loop);

  return {
    pickableCount: pickables.length,

    triggerPick(index: number): void {
      if (index < 0 || index >= pickables.length) return;
      const obj = pickables[index];
      const u = obj.userData as import('../scene/picking.js').UserData | undefined;
      if (!u?.type) return;
      if (u.type === 'building') {
        cards.showBuilding(u.b, u.dir, vault.path);
      } else if (u.type === 'district') {
        cards.showDistrict(u.district, Date.now());
      }
    },

    dispose(): void {
      cancelAnimationFrame(animId);
      orbitCamera.dispose();
      picking.dispose();
      scene.fog = null;
      // 移除所有场景对象（通过根 Group 一次性清理）
      scene.remove(rootGroup);
      rootGroup.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
      // 清理 DOM
      hud.root.remove();
      const tip = container.querySelector('#tip');
      if (tip) tip.remove();
      const card = container.querySelector('#card');
      if (card) card.remove();
      const label = container.querySelector('#label');
      if (label) label.remove();
      backBtn.remove();
    },
  };
}
