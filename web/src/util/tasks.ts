/**
 * util/tasks.ts — 工地（含未完成任务的建筑）按区分组，纯函数可单测。
 */
import type { CityModel } from '@shared/types';

export interface TaskItem {
  notePath: string;
  title: string;
  openTasks: number;
  mtimeMs: number;
}
export interface TaskGroup {
  dir: string;
  total: number; // 该区工地数
  items: TaskItem[];
}

/**
 * construction===true 的建筑按区分组。
 * 组间：total 降序，同 total 按 dir 字典序。
 * 组内：openTasks 降序，再 mtimeMs 降序，再 notePath 字典序。
 */
export function groupTasks(city: CityModel): TaskGroup[] {
  const byDir = new Map<string, TaskItem[]>();
  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (!b.construction) continue;
      const list = byDir.get(d.dir) ?? [];
      list.push({ notePath: b.notePath, title: b.title, openTasks: b.openTasks, mtimeMs: b.mtimeMs });
      byDir.set(d.dir, list);
    }
  }

  const groups: TaskGroup[] = [];
  for (const [dir, items] of byDir) {
    items.sort(
      (a, b) =>
        b.openTasks - a.openTasks ||
        b.mtimeMs - a.mtimeMs ||
        a.notePath.localeCompare(b.notePath),
    );
    groups.push({ dir, total: items.length, items });
  }
  groups.sort((a, b) => b.total - a.total || a.dir.localeCompare(b.dir));
  return groups;
}

/** 全城工地总数 */
export function totalConstruction(city: CityModel): number {
  let n = 0;
  for (const d of city.districts) for (const b of d.buildings) if (b.construction) n++;
  return n;
}

/** 全城工地扁平列表，按 openTasks 降序、mtime 降序、path 字典序（供目录树） */
export function listTasks(city: CityModel): TaskItem[] {
  const items: TaskItem[] = [];
  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (!b.construction) continue;
      items.push({ notePath: b.notePath, title: b.title, openTasks: b.openTasks, mtimeMs: b.mtimeMs });
    }
  }
  items.sort(
    (a, b) =>
      b.openTasks - a.openTasks || b.mtimeMs - a.mtimeMs || a.notePath.localeCompare(b.notePath),
  );
  return items;
}
