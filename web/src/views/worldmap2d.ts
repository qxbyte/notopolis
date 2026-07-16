/**
 * views/worldmap2d.ts
 * 2D 世界地图视图 — 羊皮纸风格，城邦印章布局。
 */

import { PAPER } from '../render2d/sketch';
import { TIER } from '../ui/hud';
import type { WorldVault } from '../api';
import { currentMode, isDarkTheme, MAP_NIGHT_TINT, setMode, type ThemeMode } from '../ui/theme';
import {
  createWeather,
  startRain,
  tickWeather,
  inCloudHitbox,
  SUN_MS,
} from '../util/weather';

/** 读主题令牌（世界地图背景跟随六套主题换肤；每帧读取，主题切换即时生效） */
function themeVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface WorldMap2DHandle {
  dispose(): void;
  /** 程序化触发雨云小剧场（等同点击云朵；e2e/调试用） */
  startRain(): void;
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

/**
 * 世界地图背景：现代画布风（与 UI 主题令牌联动）——
 * 主题底色 + 点阵网格（设计工具质感）+ 中央圆角白板承载城邦印章。
 * 城邦印章本身保留手绘风：它们是通往手绘城市世界的入口。
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): void {
  const { minX, minZ, maxX, maxZ } = bounds;
  const w = maxX - minX;
  const h = maxZ - minZ;
  const bg = themeVar('--bg', '#F2F3F6');
  const surface = themeVar('--surface', '#FFFFFF');
  const border = themeVar('--border', '#E5E7EB');

  // 页面底色
  ctx.fillStyle = bg;
  ctx.fillRect(minX, minZ, w, h);

  // 中央圆角白板（软投影 + 细描边）
  const inset = 14;
  const r = 16;
  const bx = minX + inset;
  const bz = minZ + inset;
  const bw = w - inset * 2;
  const bh = h - inset * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(22, 24, 26, 0.10)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  ctx.beginPath();
  ctx.roundRect(bx, bz, bw, bh, r);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(bx, bz, bw, bh, r);
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // 白板内点阵网格（Figma/白板工具质感）
  ctx.fillStyle = border;
  const step = 20;
  const pad = 14;
  for (let x = bx + pad; x < bx + bw - pad / 2; x += step) {
    for (let z = bz + pad; z < bz + bh - pad / 2; z += step) {
      ctx.beginPath();
      ctx.arc(x, z, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function showWorldMap2D(
  container: HTMLElement,
  vaults: WorldVault[],
  onEnterCity: (vault: WorldVault) => void,
  onSettings?: () => void,
): WorldMap2DHandle {
  // 白板世界范围：高固定 400 单位，宽比正方形略宽（上限 1.25，不追满屏）
  const bounds = { minX: -200, minZ: -200, maxX: 200, maxZ: 200 };
  function computeBounds(): void {
    const aspect = Math.min(1.25, Math.max(0.8, container.clientWidth / Math.max(1, container.clientHeight)));
    bounds.minX = -200 * aspect;
    bounds.maxX = 200 * aspect;
  }
  computeBounds();

  // ---- 全屏 canvas ----
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  // ---- 设置按钮（右上）：打开设置中心弹窗（内含配置仓库/配置模型菜单） ----
  let settingsBtn: HTMLButtonElement | null = null;
  const onSettingsBtnClick = (): void => onSettings?.();
  if (onSettings) {
    settingsBtn = document.createElement('button');
    settingsBtn.id = 'settings-btn';
    settingsBtn.textContent = '⚙ 设置';
    settingsBtn.addEventListener('click', onSettingsBtnClick);
    container.appendChild(settingsBtn);
  }

  // ---- 明暗模式按钮（设置按钮左侧）：亮色→暗色→跟随系统 三态循环 ----
  const MODE_UI: Record<ThemeMode, { icon: string; label: string }> = {
    light: { icon: '☀', label: '亮色' },
    dark: { icon: '☾', label: '暗色' },
    system: { icon: '◐', label: '系统' },
  };
  const NEXT_MODE: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
  const modeBtn = document.createElement('button');
  modeBtn.id = 'theme-mode-btn';
  const renderModeBtn = (): void => {
    const mode = currentMode() ?? (isDarkTheme() ? 'dark' : 'light');
    modeBtn.textContent = `${MODE_UI[mode].icon} ${MODE_UI[mode].label}`;
    modeBtn.title = `页面明暗（点击切换）：当前${MODE_UI[mode].label}`;
  };
  const onModeBtnClick = (): void => {
    setMode(NEXT_MODE[currentMode() ?? (isDarkTheme() ? 'dark' : 'light')]);
    renderModeBtn();
  };
  renderModeBtn();
  modeBtn.addEventListener('click', onModeBtnClick);
  container.appendChild(modeBtn);

  // ---- 固定视角（无缩放/平移）：contain 适配窗口，一屏展示全貌 ----
  let scale = 1;
  let offX = 0;
  let offY = 0;
  function computeTransform(): void {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxZ - bounds.minZ;
    scale = Math.min(canvas.width / w, canvas.height / h) * 0.94;
    offX = canvas.width / 2;
    offY = canvas.height / 2;
  }
  computeTransform();

  function screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - offX) / scale, (sy - offY) / scale];
  }

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

  // ---- 城邦居民（装饰动画层）：手绘小生物，瞳孔跟随鼠标 + 眨眼 + 呼吸 + 弹跳入场 ----
  // 纯装饰不参与命中检测；眨眼节奏用 Math.random（表现层豁免确定性铁律）
  interface Critter {
    kind: 'dome' | 'rect';
    xOff: number; // 距白板左缘的偏移（锚定角落，白板宽度自适应时跟随）
    w: number;
    h: number;
    fill: string;
    sclera: boolean; // 深色身体需要白眼底
    delay: number; // 入场延迟 ms
    phase: number; // 呼吸相位
    mouth: 'smile' | 'flat' | 'none';
  }
  const CRITTERS: Critter[] = [
    { kind: 'rect', xOff: 88, w: 34, h: 76, fill: '#A9BCF5', sclera: false, delay: 0, phase: 0.5, mouth: 'none' },
    { kind: 'rect', xOff: 114, w: 28, h: 58, fill: '#3A3428', sclera: true, delay: 140, phase: 2.1, mouth: 'none' },
    { kind: 'dome', xOff: 60, w: 54, h: 42, fill: '#F2A65C', sclera: false, delay: 280, phase: 3.6, mouth: 'smile' },
    { kind: 'dome', xOff: 140, w: 40, h: 34, fill: '#DCF231', sclera: false, delay: 420, phase: 5.2, mouth: 'flat' },
  ];
  const critterBlink = CRITTERS.map(() => ({ until: 0, next: performance.now() + 1200 + Math.random() * 2600 }));
  const mountAt = performance.now();
  let mouseWorld: [number, number] | null = null;

  const easeOutBack = (p: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  };

  // ---- 雨云小剧场：点云 → 下雨 3s（小生物淋雨）→ 太阳 2s（欢呼）→ 复原 ----
  // 时序在 util/weather.ts 纯状态机；雨滴/涟漪用 Math.random（表现层豁免确定性铁律）
  const weather = createWeather();
  interface Drop { x: number; y: number; v: number }
  let drops: Drop[] = [];
  let splashes: Array<{ x: number; until: number }> = [];

  /** 云朵基准点（左圆心）：挂在白板左上高空（小生物聚落正上方）+ 柔和游移 */
  function cloudPos(now: number): { cx: number; cy: number } {
    return {
      cx: bounds.minX + 85 + Math.sin(now / 6800) * 5,
      cy: bounds.minZ + 58 + Math.sin(now / 4200) * 3,
    };
  }

  function triggerRain(now: number): void {
    if (!startRain(weather, now)) return;
    const { cx, cy } = cloudPos(now);
    const ground = bounds.maxZ - 30;
    // 雨幕比云略宽罩住小生物聚落；初始铺满整条下落柱，点云即见满幕雨
    drops = Array.from({ length: 34 }, () => ({
      x: cx + 11 + (Math.random() * 2 - 1) * 52,
      y: cy + 12 + Math.random() * (ground - cy - 20),
      v: 3.2 + Math.random() * 2,
    }));
    splashes = [];
  }

  /** 云（idle 白云 / rain 灰雨云鼓起）；sun 相位淡出让位太阳，复原时淡回 */
  function drawCloud(ctx2: CanvasRenderingContext2D, now: number): void {
    let alpha = 1;
    if (weather.phase === 'sun') alpha = Math.max(0, 1 - (now - weather.since) / 260);
    else if (weather.phase === 'idle' && weather.since > 0) {
      alpha = Math.min(1, (now - weather.since) / 300);
    }
    if (alpha <= 0) return;
    const raining = weather.phase === 'rain';
    const { cx, cy } = cloudPos(now);
    ctx2.save();
    ctx2.globalAlpha = alpha;
    ctx2.strokeStyle = PAPER.ink;
    ctx2.lineWidth = 1.2;
    ctx2.lineCap = 'round';
    // 雨云微微鼓起（以云心为锚缩放）
    if (raining) {
      const puff = 1 + 0.22 * Math.min(1, (now - weather.since) / 320);
      ctx2.translate(cx + 11, cy - 5);
      ctx2.scale(puff, puff);
      ctx2.translate(-(cx + 11), -(cy - 5));
    }
    ctx2.beginPath();
    ctx2.arc(cx, cy, 9, Math.PI * 0.5, Math.PI * 1.5);
    ctx2.arc(cx + 9, cy - 9, 10, Math.PI, Math.PI * 1.9);
    ctx2.arc(cx + 22, cy - 6, 8, Math.PI * 1.2, Math.PI * 1.98);
    ctx2.arc(cx + 26, cy, 7, Math.PI * 1.5, Math.PI * 0.5);
    ctx2.closePath();
    ctx2.fillStyle = raining ? '#B9C2CE' : '#FFFFFF';
    ctx2.fill();
    ctx2.stroke();
    ctx2.restore();
  }

  /** 雨丝 + 落地涟漪（画在小生物之上，营造「淋在身上」） */
  function drawRain(ctx2: CanvasRenderingContext2D, now: number): void {
    if (weather.phase !== 'rain') return;
    const ground = bounds.maxZ - 30;
    const { cy } = cloudPos(now);
    ctx2.save();
    ctx2.strokeStyle = PAPER.waterEdge;
    ctx2.lineWidth = 1.1;
    ctx2.lineCap = 'round';
    ctx2.globalAlpha = 0.75;
    ctx2.beginPath();
    for (const d of drops) {
      d.y += d.v;
      if (d.y > ground) {
        if (splashes.length < 12) splashes.push({ x: d.x, until: now + 220 });
        d.y = cy + 10;
      }
      ctx2.moveTo(d.x + 1, d.y - 5);
      ctx2.lineTo(d.x, d.y);
    }
    ctx2.stroke();
    // 涟漪：落点处一圈渐散的小椭圆
    splashes = splashes.filter((s) => s.until > now);
    for (const s of splashes) {
      const p = 1 - (s.until - now) / 220;
      ctx2.globalAlpha = 0.5 * (1 - p);
      ctx2.beginPath();
      ctx2.ellipse(s.x, ground, 2 + p * 4, 1 + p * 1.6, 0, 0, Math.PI * 2);
      ctx2.stroke();
    }
    ctx2.restore();
  }

  /** 太阳：雨后在云位弹性出场，带笑脸与缓转光芒 */
  function drawSun(ctx2: CanvasRenderingContext2D, now: number): void {
    if (weather.phase !== 'sun') return;
    const t = now - weather.since;
    // 出场弹跳；最后 250ms 缩小退场，恢复原样
    const s = t > SUN_MS - 250
      ? Math.max(0, (SUN_MS - t) / 250)
      : easeOutBack(Math.min(1, t / 420));
    if (s <= 0) return;
    const { cx, cy } = cloudPos(now);
    const sx = cx + 11;
    const sy = cy - 5;
    ctx2.save();
    ctx2.translate(sx, sy);
    ctx2.scale(s, s);
    ctx2.strokeStyle = PAPER.ink;
    ctx2.lineCap = 'round';
    // 光芒（缓慢旋转）
    const spin = now / 2600;
    ctx2.lineWidth = 1.4;
    ctx2.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = spin + (i / 8) * Math.PI * 2;
      ctx2.moveTo(Math.cos(a) * 17, Math.sin(a) * 17);
      ctx2.lineTo(Math.cos(a) * 23, Math.sin(a) * 23);
    }
    ctx2.stroke();
    // 日面 + 笑脸
    ctx2.beginPath();
    ctx2.arc(0, 0, 13, 0, Math.PI * 2);
    ctx2.fillStyle = '#FFD34D';
    ctx2.fill();
    ctx2.lineWidth = 1.5;
    ctx2.stroke();
    ctx2.fillStyle = PAPER.ink;
    for (const side of [-1, 1]) {
      ctx2.beginPath();
      ctx2.arc(side * 4.5, -2.5, 1.5, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.beginPath();
    ctx2.lineWidth = 1.3;
    ctx2.arc(0, 1.5, 5, Math.PI * 0.15, Math.PI * 0.85);
    ctx2.stroke();
    ctx2.restore();
  }

  function drawCritter(ctx2: CanvasRenderingContext2D, c: Critter, idx: number, now: number): void {
    const cx = bounds.minX + c.xOff;
    const ground = bounds.maxZ - 30;
    // 入场弹跳（各自延迟）
    const p = Math.min(1, Math.max(0, (now - mountAt - c.delay) / 480));
    if (p <= 0) return;
    const appear = easeOutBack(p);
    // 呼吸：轻微纵向缩放（以地面为锚点）
    const breath = 1 + 0.022 * Math.sin(now / 520 + c.phase);
    // 天气心情：淋雨缩脖发抖；放晴欢快蹦跳
    let shiverX = 0;
    let hopY = 0;
    let hunch = 1;
    if (weather.phase === 'rain') {
      shiverX = Math.sin(now / 45 + c.phase * 7) * 1.1;
      hunch = 0.94;
    } else if (weather.phase === 'sun') {
      hopY = Math.abs(Math.sin((now - weather.since) / 170 + c.phase)) * 4;
    }
    ctx2.save();
    ctx2.translate(cx + shiverX, ground - hopY);
    ctx2.scale(appear * (2 - breath), appear * breath * hunch);

    // 身体（墨线描边，手绘同源）
    ctx2.lineWidth = 1.6;
    ctx2.strokeStyle = PAPER.ink;
    ctx2.fillStyle = c.fill;
    ctx2.beginPath();
    if (c.kind === 'dome') {
      ctx2.ellipse(0, 0, c.w / 2, c.h, 0, Math.PI, Math.PI * 2);
      ctx2.closePath();
    } else {
      ctx2.roundRect(-c.w / 2, -c.h, c.w, c.h, [10, 10, 3, 3]);
    }
    ctx2.fill();
    ctx2.stroke();

    // 眼睛：瞳孔朝向鼠标（无鼠标时缓慢游移）
    const eyeY = -c.h * (c.kind === 'dome' ? 0.52 : 0.72);
    const eyeDx = c.w * 0.18;
    const blink = critterBlink[idx];
    if (now > blink.next) {
      blink.until = now + 130;
      blink.next = now + 1600 + Math.random() * 3200;
    }
    const blinking = now < blink.until || weather.phase === 'rain'; // 淋雨时眼睛紧闭
    for (const side of [-1, 1]) {
      const ex = side * eyeDx;
      if (c.sclera) {
        ctx2.beginPath();
        ctx2.arc(ex, eyeY, 4.6, 0, Math.PI * 2);
        ctx2.fillStyle = '#FFFFFF';
        ctx2.fill();
      }
      if (blinking) {
        ctx2.beginPath();
        ctx2.moveTo(ex - 2.6, eyeY);
        ctx2.lineTo(ex + 2.6, eyeY);
        ctx2.lineWidth = 1.4;
        ctx2.strokeStyle = c.sclera ? PAPER.ink : '#20241C';
        ctx2.stroke();
      } else {
        // 目光方向：放晴时集体望向太阳；平时看鼠标（无鼠标缓慢游移）
        let dx = 0;
        let dz = 0;
        if (weather.phase === 'sun') {
          const cp = cloudPos(now);
          dx = cp.cx + 11 - (cx + ex);
          dz = cp.cy - 5 - (ground + eyeY);
        } else if (mouseWorld) {
          dx = mouseWorld[0] - (cx + ex);
          dz = mouseWorld[1] - (ground + eyeY);
        } else {
          dx = Math.sin(now / 2400 + c.phase);
          dz = Math.cos(now / 3100 + c.phase);
        }
        const len = Math.hypot(dx, dz) || 1;
        const off = 1.9;
        ctx2.beginPath();
        ctx2.arc(ex + (dx / len) * off, eyeY + (dz / len) * off, 2.1, 0, Math.PI * 2);
        ctx2.fillStyle = c.sclera ? PAPER.ink : '#20241C';
        ctx2.fill();
      }
    }

    // 嘴：淋雨全员委屈下弯，放晴全员微笑，平时各自默认表情
    const mood: 'smile' | 'flat' | 'none' | 'sad' =
      weather.phase === 'rain' ? 'sad' : weather.phase === 'sun' ? 'smile' : c.mouth;
    if (mood !== 'none') {
      ctx2.beginPath();
      ctx2.lineWidth = 1.3;
      ctx2.strokeStyle = PAPER.ink;
      const my = eyeY + c.h * 0.22;
      if (mood === 'smile') ctx2.arc(0, my - 1.5, 4, Math.PI * 0.15, Math.PI * 0.85);
      else if (mood === 'sad') ctx2.arc(0, my + 2.5, 4, Math.PI * 1.15, Math.PI * 1.85);
      else {
        ctx2.moveTo(-3.4, my);
        ctx2.lineTo(3.4, my);
      }
      ctx2.stroke();
    }
    ctx2.restore();
  }

  /** 静态手绘点缀：小新芽 × 2（云朵移交 drawCloud，悬在小生物头顶可点击降雨） */
  function drawDoodles(ctx2: CanvasRenderingContext2D): void {
    ctx2.save();
    ctx2.strokeStyle = PAPER.ink;
    ctx2.lineWidth = 1.2;
    ctx2.lineCap = 'round';
    const sprouts: Array<[number, number]> = [
      [bounds.minX + 176, bounds.maxZ - 32],
      [bounds.minX + 22, bounds.maxZ - 34],
    ];
    for (const [sx, sz] of sprouts) {
      ctx2.beginPath();
      ctx2.moveTo(sx, sz);
      ctx2.quadraticCurveTo(sx + 1, sz - 6, sx, sz - 10);
      ctx2.stroke();
      ctx2.beginPath();
      ctx2.moveTo(sx, sz - 7);
      ctx2.quadraticCurveTo(sx - 6, sz - 10, sx - 5, sz - 15);
      ctx2.quadraticCurveTo(sx + 1, sz - 12, sx, sz - 7);
      ctx2.fillStyle = '#DCF231';
      ctx2.fill();
      ctx2.stroke();
    }
    ctx2.restore();
  }

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
    const [wx, wz] = screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    // 云朵优先：点云触发雨云小剧场
    const now = performance.now();
    const cp = cloudPos(now);
    if (inCloudHitbox(wx, wz, cp.cx, cp.cy)) {
      triggerRain(now);
      return;
    }
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
    const [wx, wz] = screenToWorld(e.offsetX * dpr, e.offsetY * dpr);
    mouseWorld = [wx, wz]; // 居民目光跟随
    // 云朵可点提示：仅 idle 时显示手型（雨中/晴天点了也无效）
    const cp = cloudPos(performance.now());
    canvas.style.cursor =
      weather.phase === 'idle' && inCloudHitbox(wx, wz, cp.cx, cp.cy) ? 'pointer' : 'default';
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
    // 先以主题底色填满整个 canvas（世界图边界外同底色，无缝延伸）
    ctx.fillStyle = themeVar('--bg', '#F2F3F6');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 应用固定变换（世界原点居中，contain 缩放）
    ctx.setTransform(scale, 0, 0, scale, offX, offY);

    // 背景（在世界坐标下绘制）
    drawBackground(ctx, bounds);

    // 手绘点缀 + 雨云小剧场 + 城邦居民（画在印章之下，不遮挡城邦）
    const nowMs = performance.now();
    tickWeather(weather, nowMs);
    drawDoodles(ctx);
    drawCloud(ctx, nowMs);
    drawSun(ctx, nowMs);
    for (let ci = 0; ci < CRITTERS.length; ci++) drawCritter(ctx, CRITTERS[ci], ci, nowMs);
    drawRain(ctx, nowMs); // 雨丝盖在小生物身上，营造「淋在身上」

    // 贸易路线（环形虚线，主题次要色）
    if (vaults.length > 1) {
      ctx.strokeStyle = themeVar('--muted', '#84898F');
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
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
      ctx.globalAlpha = 1;
    }

    // 城邦印章（名称标签在夜幕滤镜之后绘制，保证暗色主题下文字可读）
    for (let i = 0; i < vaults.length; i++) {
      const pos = vaultPositions[i];
      drawStamp(ctx, pos.x, pos.z, vaults[i]);
    }

    // 暗色主题：夜幕滤镜——multiply 压暗手绘图层（文字统一在滤镜后绘制）。
    // 世界地图底色本就跟随暗色令牌，滤镜减弱（0.6）只压亮色印章/点缀，避免全图漆黑。
    if (isDarkTheme()) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = MAP_NIGHT_TINT;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    // 空状态：还没有仓库时给出指引
    if (vaults.length === 0) {
      const hintPx = 19 * dpr;
      const uiFont = `-apple-system, 'PingFang SC', 'Segoe UI', sans-serif`;
      ctx.save();
      ctx.scale(1 / scale, 1 / scale);
      ctx.font = `600 ${hintPx}px ${uiFont}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = themeVar('--text', '#16181A');
      ctx.fillText('世界还是一片空白', 0, -hintPx * 0.4);
      ctx.font = `${hintPx * 0.68}px ${uiFont}`;
      ctx.fillStyle = themeVar('--muted', '#84898F');
      ctx.fillText('点击右上「⚙ 设置 → 配置仓库」，添加你的第一座 Obsidian 城邦', 0, hintPx);
      ctx.restore();
    }

    // 城邦名称标签（印章下方；逆缩放绘制，字号按 CSS 像素 × dpr 保证清晰可读）
    for (let i = 0; i < vaults.length; i++) {
      const pos = vaultPositions[i];
      const labelPx = 15 * dpr;
      ctx.save();
      ctx.translate(pos.x, pos.z);
      ctx.scale(1 / scale, 1 / scale);
      ctx.font = `600 ${labelPx}px -apple-system, 'PingFang SC', 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      const stampH = hitRadius(vaults[i].tier) + 6;
      const labelY = stampH * scale + labelPx * 0.4;
      // 表面色描边打底，避免与贸易路线虚线交叠时看不清
      ctx.strokeStyle = themeVar('--surface', '#FFFFFF');
      ctx.lineWidth = labelPx * 0.25;
      ctx.strokeText(vaults[i].name, 0, labelY);
      ctx.fillStyle = themeVar('--text', '#16181A');
      ctx.fillText(vaults[i].name, 0, labelY);
      ctx.restore();
    }

    ctx.restore();
  }

  animId = requestAnimationFrame(loop);

  // ---- Resize ----
  function onResize(): void {
    canvas.width  = container.clientWidth  * dpr;
    canvas.height = container.clientHeight * dpr;
    computeBounds();
    computeTransform();
  }
  window.addEventListener('resize', onResize);

  return {
    startRain(): void {
      triggerRain(performance.now());
    },
    dispose(): void {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      canvas.remove();
      tooltip.remove();
      errTip.remove();
      if (errTipTimer) clearTimeout(errTipTimer);
      if (settingsBtn) {
        settingsBtn.removeEventListener('click', onSettingsBtnClick);
        settingsBtn.remove();
        settingsBtn = null;
      }
      modeBtn.removeEventListener('click', onModeBtnClick);
      modeBtn.remove();
    },
  };
}
