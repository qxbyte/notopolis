import type { CityDiff, CityModel, CitySnapshot } from '../shared/types.js';

function titleOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

/** 从当前 CityModel 生成快照（now 注入，不取 Date.now） */
export function snapshotOf(city: CityModel, now: number): CitySnapshot {
  const notes: CitySnapshot['notes'] = {};
  for (const d of city.districts) {
    for (const b of d.buildings) {
      notes[b.notePath] = { mtimeMs: b.mtimeMs, openTasks: b.openTasks, landmark: b.landmark };
    }
  }
  return { visitedAt: now, notes };
}

/**
 * 对比上次快照与当前城市。
 * created 判定用「快照中不存在」（改名/移动 = removed+created，符合拆迁重建隐喻，不用 birthtimeMs）。
 * 输出数组按 path 排序保证确定性。
 */
export function diffCity(prev: CitySnapshot | null, city: CityModel): CityDiff {
  const diff: CityDiff = {
    firstVisit: !prev,
    lastVisitAt: prev?.visitedAt ?? null,
    created: [], updated: [], removed: [], newLandmarks: [],
    tasksDone: 0, tasksAdded: 0,
  };
  if (!prev) return diff;

  const current = new Map<string, { title: string; mtimeMs: number; openTasks: number; landmark: boolean }>();
  for (const d of city.districts) {
    for (const b of d.buildings) {
      current.set(b.notePath, {
        title: b.title, mtimeMs: b.mtimeMs, openTasks: b.openTasks, landmark: b.landmark,
      });
    }
  }

  for (const [path, cur] of current) {
    const old = prev.notes[path];
    if (!old) {
      diff.created.push({ path, title: cur.title });
      diff.tasksAdded += cur.openTasks; // 新建笔记任务全额计入
      if (cur.landmark) diff.newLandmarks.push({ path, title: cur.title });
      continue;
    }
    if (cur.mtimeMs !== old.mtimeMs) diff.updated.push({ path, title: cur.title });
    if (cur.openTasks < old.openTasks) diff.tasksDone += old.openTasks - cur.openTasks;
    if (cur.openTasks > old.openTasks) diff.tasksAdded += cur.openTasks - old.openTasks;
    if (cur.landmark && !old.landmark) diff.newLandmarks.push({ path, title: cur.title });
  }

  for (const path of Object.keys(prev.notes)) {
    if (!current.has(path)) diff.removed.push({ path, title: titleOf(path) });
  }

  for (const arr of [diff.created, diff.updated, diff.removed, diff.newLandmarks]) {
    arr.sort((a, b) => a.path.localeCompare(b.path));
  }
  return diff;
}
