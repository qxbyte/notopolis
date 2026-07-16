/**
 * render2d/biomes.ts — 四套生物群系配置
 *
 * BiomeSpec 驱动 worldParams 地貌生成和 citypainter 分层绘制。
 * 色彩只从 PAPER 常量 + 此处定义的 biome 色板取。
 */

import { PAPER } from './sketch';

export type WaterStyle = 'river' | 'sea' | 'frozen' | 'torrent';
export type VegetationKind = 'mixed' | 'sparse-pine' | 'dense-pine' | 'palm-ish';

export interface BiomeSpec {
  key: string;
  /** 地面基色 / 斑块色（hex 字符串） */
  ground: { paper: string; patch: string };
  waterStyle: WaterStyle;
  /** proximity：山带距城心系数（世界单位加成，越小越近）
   *  density：峰数量 5-8 基础上的额外峰数
   *  snowline：0–1，雪帽覆盖比例（高于 peakH * snowline 的部分画雪） */
  mountains: { proximity: number; density: number; snowline: number };
  vegetation: { kind: VegetationKind; density: number };
  /** 可选：将街区 pastel 颜色偏移到适合生物群系的冷暖调
   *  接收 hex + rng，返回新 hex */
  pastelShift?: (hex: string, rng: () => number) => string;
  /** 专属元素开关列表（citypainter 按 extras.includes('xxx') 判断） */
  extras: string[];
}

/* ------------------------------------------------------------------ */
/* 辅助：hex 混色（线性插值 RGB 通道）                                   */
/* ------------------------------------------------------------------ */

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + r.toString(16).padStart(2, '0')
             + g.toString(16).padStart(2, '0')
             + bl.toString(16).padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* BIOMES 四套配置                                                      */
/* ------------------------------------------------------------------ */

export const BIOMES: Record<string, BiomeSpec> = {

  plains: {
    key: 'plains',
    ground: { paper: PAPER.paper, patch: PAPER.grass },
    waterStyle: 'river',
    mountains: { proximity: 0, density: 0, snowline: 0.85 },
    vegetation: { kind: 'mixed', density: 1.0 },
    extras: ['fields', 'windmill', 'haybale'],
  },

  harbor: {
    key: 'harbor',
    ground: { paper: PAPER.paper, patch: '#dde5e0' },   // 淡冷灰白 + 盐沼灰绿斑块（弃暖沙 #f5f0e2/#e8e0c8）
    waterStyle: 'sea',
    mountains: { proximity: 40, density: -2, snowline: 0.9 },
    vegetation: { kind: 'palm-ish', density: 0.5 },
    pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#b8d4e8', 0.08),
    extras: ['lighthouse', 'pier', 'seagull', 'coast'],
  },

  snow: {
    key: 'snow',
    ground: { paper: '#eef2f6', patch: '#d8e4ee' },   // 冷白底 + 冰蓝斑块
    waterStyle: 'frozen',
    mountains: { proximity: -30, density: 2, snowline: 0.55 },
    vegetation: { kind: 'sparse-pine', density: 0.7 },
    pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#ffffff', 0.30),
    extras: ['sled-track', 'ice-lake'],
  },

  mountain: {
    key: 'mountain',
    ground: { paper: '#f0ece4', patch: '#d8d0c4' },   // 灰褐岩地
    waterStyle: 'torrent',
    mountains: { proximity: -20, density: 3, snowline: 0.70 },
    vegetation: { kind: 'dense-pine', density: 0.9 },
    pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#9a9080', 0.15),
    extras: ['terraces', 'gate-wall', 'alpine-lake'],
  },
};

/** 安全获取 BiomeSpec，未知主题回退 plains */
export function getBiome(theme: string): BiomeSpec {
  return BIOMES[theme] ?? BIOMES['plains'];
}
