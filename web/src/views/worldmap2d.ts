/**
 * views/worldmap2d.ts
 * 2D 世界地图视图 — 羊皮纸风格，城邦印章布局。
 */

import { createCamera2D } from '../render2d/camera2d';
import { PAPER } from '../render2d/sketch';
import { TIER } from '../ui/hud';
import type { WorldVault } from '../api';

export interface WorldMap2DHandle {
  dispose(): void;
}

function getTierColor(tier: string): string {
  switch (tier) {
    case 'camp': return '#8B7355';
    case 'village': return '#D4A76A';
    case 'city': return '#E8C49A';
    case 'capital': return '#E8C49A';
    default: return '#D4A76A';
  }
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  vault: WorldVault,
): void {
  const tier = vault.tier;
  const ok = vault.ok;
  const color = ok ? getTierColor(tier) : '#888888';
  const alpha = ok ? 1 : 0.5;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (tier === 'camp') {
    const r = 12;
    // 帐篷形状（三角形）
    ctx.beginPath();
    ctx.moveTo(x, z - r);
    ctx.lineTo(x + r, z + r * 0.6);
    ctx.lineTo(x - r, z + r * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (tier === 'village') {
    const r = 15;
    // 房子 + 树
    // 房子
    ctx.beginPath();
    ctx.rect(x - 6, z - 4, 9, 8);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 屋顶三角
    ctx.beginPath();
    ctx.moveTo(x - 7, z - 4);
    ctx.lineTo(x + 4, z - 4);
    ctx.lineTo(x - 1.5, z - 9);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 树（圆形）
    ctx.beginPath();
    ctx.arc(x + 7, z - 2, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = PAPER.park;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  } else if (tier === 'city') {
    const r = 18;
    // 房子组合 + 塔楼
    // 左楼
    ctx.beginPath();
    ctx.rect(x - r * 0.7, z - r * 0.5, r * 0.5, r * 0.8);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 右楼
    ctx.beginPath();
    ctx.rect(x + r * 0.2, z - r * 0.5, r * 0.5, r * 0.8);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 中央塔
    ctx.beginPath();
    ctx.rect(x - r * 0.2, z - r * 0.9, r * 0.4, r * 1.0);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (tier === 'capital') {
    const r = 22;
    // 宫墙弧 + 金顶
    // 基座
    ctx.beginPath();
    ctx.arc(x, z + r * 0.1, r * 0.8, Math.PI, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 中央高塔
    ctx.beginPath();
    ctx.rect(x - r * 0.2, z - r * 0.8, r * 0.4, r * 0.9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 金顶圆点
    ctx.beginPath();
    ctx.arc(x, z - r * 0.85, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = ok ? '#FFD700' : '#888888';
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.0;
    ctx.stroke();
  } else {
    // 默认：圆形
    ctx.beginPath();
    ctx.arc(x, z, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = PAPER.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): void {
  const { minX, minZ, maxX, maxZ } = bounds;
  const w = maxX - minX;
  const h = maxZ - minZ;

  // 羊皮纸底色
  ctx.fillStyle = PAPER.paper;
  ctx.fillRect(minX, minZ, w, h);

  // 轻微噪点质感
  ctx.fillStyle = 'rgba(90,80,60,0.03)';
  for (let i = 0; i < 1200; i++) {
    const nx = minX + Math.random() * w;
    const nz = minZ + Math.random() * h;
    ctx.fillRect(nx, nz, 1, 1);
  }

  // 四角斜线装饰
  const hatchSize = 30;
  ctx.strokeStyle = PAPER.inkFaded;
  ctx.lineWidth = 0.8;

  // 左上角
  for (let i = 0; i < 6; i++) {
    const o = i * 5;
    ctx.beginPath();
    ctx.moveTo(minX + o, minZ + hatchSize);
    ctx.lineTo(minX + hatchSize, minZ + o);
    ctx.stroke();
  }
  // 右上角
  for (let i = 0; i < 6; i++) {
    const o = i * 5;
    ctx.beginPath();
    ctx.moveTo(maxX - o, minZ + hatchSize);
    ctx.lineTo(maxX - hatchSize, minZ + o);
    ctx.stroke();
  }
  // 左下角
  for (let i = 0; i < 6; i++) {
    const o = i * 5;
    ctx.beginPath();
    ctx.moveTo(minX + o, maxZ - hatchSize);
    ctx.lineTo(minX + hatchSize, maxZ - o);
    ctx.stroke();
  }
  // 右下角
  for (let i = 0; i < 6; i++) {
    const o = i * 5;
    ctx.beginPath();
    ctx.moveTo(maxX - o, maxZ - hatchSize);
    ctx.lineTo(maxX - hatchSize, maxZ - o);
    ctx.stroke();
  }

  // 外框粗线
  ctx.strokeStyle = PAPER.roadEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(minX + 8, minZ + 8, w - 16, h - 16);
}

export function showWorldMap2D(
  container: HTMLElement,
  vaults: WorldVault[],
  onEnterCity: (vault: WorldVault) => void,
  onManage?: () => void,
): WorldMap2DHandle {
  const bounds = { minX: -200, minZ: -200, maxX: 200, maxZ: 200 };

  // ---- 全屏 canvas ----
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  // ---- 仓库管理按钮 ----
  let manageBtn: HTMLButtonElement | null = null;
  const onManageBtnClick = () => onManage?.();
  if (onManage) {
    manageBtn = document.createElement('button');
    manageBtn.id = 'manage-btn';
    manageBtn.textContent = '⚙ 仓库管理';
    manageBtn.style.cssText = 'position:absolute;top:12px;right:14px;z-index:10;background:rgba(30,26,46,0.85);border:1px solid #4a4264;color:#d9c58a;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;';
    manageBtn.addEventListener('click', onManageBtnClick);
    container.appendChild(manageBtn);
  }

  // ---- 相机 ----
  const camera = createCamera2D(canvas, bounds);

  // ---- 城邦位置（环形布局）----
  const radius = Math.min(Math.max(80, vaults.length * 30), 160);
  const vaultPositions: Array<{ x: number; z: number }> = vaults.map((_, i) => {
    if (vaults.length === 1) return { x: 0, z: 0 };
    const angle = (i / vaults.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  });

  // ---- 悬停标签 ----
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute; pointer-events: none; z-index: 10;
    background: rgba(30,26,46,0.92); color: #e8e0d4; border-radius: 5px;
    padding: 4px 10px; font-size: 12px; white-space: nowrap; display: none;
  `;
  container.appendChild(tooltip);

  // 无法连接提示
  const errTip = document.createElement('div');
  errTip.style.cssText = `
    position: absolute; pointer-events: none; z-index: 10;
    background: rgba(200,80,60,0.92); color: #fff; border-radius: 5px;
    padding: 5px 12px; font-size: 12px; display: none;
  `;
  container.appendChild(errTip);
  let errTipTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- 命中测试辅助 ----
  function hitRadius(tier: string): number {
    switch (tier) {
      case 'camp': return 14;
      case 'village': return 17;
      case 'city': return 20;
      case 'capital': return 24;
      default: return 14;
    }
  }

  function findVaultAt(wx: number, wz: number): number {
    for (let i = vaults.length - 1; i >= 0; i--) {
      const pos = vaultPositions[i];
      const r = hitRadius(vaults[i].tier);
      const dx = wx - pos.x;
      const dz = wz - pos.z;
      if (dx * dx + dz * dz <= r * r) return i;
    }
    return -1;
  }

  // ---- 点击 ----
  function onClick(e: MouseEvent): void {
    if (camera.consumeDragMoved()) return;
    const [wx, wz] = camera.screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    const idx = findVaultAt(wx, wz);
    if (idx < 0) return;
    const vault = vaults[idx];
    if (vault.ok) {
      onEnterCity(vault);
    } else {
      errTip.textContent = vault.reason ?? '无法连接';
      errTip.style.display = 'block';
      errTip.style.left = e.offsetX + 10 + 'px';
      errTip.style.top = e.offsetY + 10 + 'px';
      if (errTipTimer) clearTimeout(errTipTimer);
      errTipTimer = setTimeout(() => { errTip.style.display = 'none'; }, 2500);
    }
  }

  // ---- Hover ----
  function onMouseMove(e: MouseEvent): void {
    const [wx, wz] = camera.screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    const idx = findVaultAt(wx, wz);
    if (idx < 0) {
      tooltip.style.display = 'none';
      return;
    }
    const vault = vaults[idx];
    const tierLabel = TIER[vault.tier] ?? vault.tier;
    tooltip.textContent = `${vault.name} · ${tierLabel} · ${vault.noteCount} 栋`;
    tooltip.style.display = 'block';
    tooltip.style.left = e.offsetX + 14 + 'px';
    tooltip.style.top = e.offsetY + 8 + 'px';
  }

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMouseMove);

  // ---- RAF 循环 ----
  let animId: number;

  function loop(): void {
    animId = requestAnimationFrame(loop);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 先以纸底色填满整个 canvas，世界图边界外也是纸面
    ctx.fillStyle = PAPER.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 应用相机变换
    camera.apply(ctx);

    // 背景（在世界坐标下绘制）
    drawBackground(ctx, bounds);

    // 贸易路线（环形虚线）
    if (vaults.length > 1) {
      ctx.strokeStyle = '#D4A76A';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      for (let i = 0; i < vaults.length; i++) {
        const a = vaultPositions[i];
        const b = vaultPositions[(i + 1) % vaults.length];
        ctx.moveTo(a.x, a.z);
        ctx.lineTo(b.x, b.z);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 城邦印章
    for (let i = 0; i < vaults.length; i++) {
      const pos = vaultPositions[i];
      drawStamp(ctx, pos.x, pos.z, vaults[i]);

      // 城邦名称标签（世界坐标下绘制，需要逆缩放以保持字体大小一致）
      const zoom = camera.zoom;
      ctx.save();
      ctx.translate(pos.x, pos.z);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.fillStyle = PAPER.ink;
      ctx.font = `bold ${12}px sans-serif`;
      ctx.textAlign = 'center';
      // 调整为印章下方
      const stampH = hitRadius(vaults[i].tier) + 6;
      ctx.fillText(vaults[i].name, 0, stampH * zoom);
      ctx.restore();
    }

    ctx.restore();
  }

  animId = requestAnimationFrame(loop);

  // ---- Resize ----
  function onResize(): void {
    canvas.width  = container.clientWidth  * dpr;
    canvas.height = container.clientHeight * dpr;
  }
  window.addEventListener('resize', onResize);

  return {
    dispose(): void {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      camera.dispose();
      canvas.remove();
      tooltip.remove();
      errTip.remove();
      if (errTipTimer) clearTimeout(errTipTimer);
      if (manageBtn) {
        manageBtn.removeEventListener('click', onManageBtnClick);
        manageBtn.remove();
        manageBtn = null;
      }
    },
  };
}
