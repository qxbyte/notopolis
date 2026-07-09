/**
 * render2d/lenses.ts — 透镜框架（F4/F5）。图层切换，多种知识管理视角。
 * 纯数据/谓词，可单测；渲染在 cityview2d 每帧覆盖层完成。
 */
import type { Building, CityModel } from '@shared/types';

export type LensId = 'none' | 'tasks' | 'orphans' | 'garden';

export interface LensCtx {
  gardenSet: Set<string>;
}

export interface LensDef {
  id: LensId;
  label: string;
  icon: string;
  match(b: Building, ctx: LensCtx): boolean;
  emptyText: string;
}

export const LENSES: LensDef[] = [
  { id: 'none', label: '常规', icon: '◉', match: () => false, emptyText: '' },
  {
    id: 'tasks',
    label: '工地',
    icon: '🚧',
    match: (b) => b.construction,
    emptyText: '城中无施工，去写点带 - [ ] 的计划吧',
  },
  {
    id: 'orphans',
    label: '孤岛',
    icon: '🏝',
    match: (b) => !b.isCivic && b.inlinks === 0 && b.outlinks.length === 0,
    emptyText: '没有孤岛——所有笔记都连着',
  },
  {
    id: 'garden',
    label: '园丁',
    icon: '🌱',
    match: (b, ctx) => ctx.gardenSet.has(b.notePath),
    emptyText: '',
  },
];

export function lensById(id: LensId): LensDef {
  return LENSES.find((l) => l.id === id) ?? LENSES[0];
}

/** 非 civic 中 mtimeMs 最旧的 n 栋；并列按 notePath 字典序保证确定性 */
export function gardenSetOf(city: CityModel, n = 5): Set<string> {
  const all = city.districts.flatMap((d) => d.buildings).filter((b) => !b.isCivic);
  all.sort((a, b) => a.mtimeMs - b.mtimeMs || a.notePath.localeCompare(b.notePath));
  return new Set(all.slice(0, n).map((b) => b.notePath));
}

/** 收集某透镜的命中建筑（cityview2d 在 setLens 时调用一次缓存） */
export function lensHitBuildings(city: CityModel, id: LensId, ctx: LensCtx): Building[] {
  const def = lensById(id);
  if (id === 'none') return [];
  const out: Building[] = [];
  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (def.match(b, ctx)) out.push(b);
    }
  }
  return out;
}
