import type { Building, NoteMeta } from '../../shared/types.js';
import { pointInPolygon, type Plot } from './districts.js';
import { hashSeed, mulberry32 } from './rng.js';

const CELL = 4;

export function placeBuildings(
  plot: Plot,
  notes: NoteMeta[],
  inlinks: Record<string, number>,
): Building[] {
  const cols = Math.max(3, Math.floor(plot.width / CELL));
  const rows = Math.max(3, Math.floor(plot.depth / CELL));
  const streetRow = Math.floor(rows / 2);
  const occupied = new Set<number>();

  const readme = notes.find((n) => n.title.toLowerCase() === 'readme');
  const streetTargets = new Set((readme?.links ?? []).map((t) => t.split('/').pop()!));
  const ordered = [...notes].sort(
    (a, b) => (inlinks[b.path] ?? 0) - (inlinks[a.path] ?? 0) || a.path.localeCompare(b.path),
  );
  const landmarks = new Set(
    ordered
      .filter((n) => (inlinks[n.path] ?? 0) >= 2)
      .slice(0, 3)
      .map((n) => n.path),
  );

  /** 计算格（col, row）的格心世界坐标 */
  function cellCenter(c: number, r: number): [number, number] {
    return [plot.x + (c + 0.5) * (plot.width / cols), plot.z + (r + 0.5) * (plot.depth / rows)];
  }

  /** 格心是否在 polygon 内 */
  function cellInPoly(c: number, r: number): boolean {
    const [wx, wz] = cellCenter(c, r);
    return pointInPolygon(wx, wz, plot.polygon);
  }

  /**
   * 从起始格 startIdx 开始线性探测，找到：
   * 1. 未被占用
   * 2. 格心在 polygon 内
   * 3. 不是主街行（除非 isForStreet 为 true）
   * 若穷尽（guard 达到 cols*rows）后仍未找到多边形内空格，
   * 回退到 bbox 内任意空格（忽略 polygon 约束）。
   */
  function probe(startIdx: number, isCivic: boolean, onStreet: boolean): number {
    const total = cols * rows;
    let i = startIdx;
    let guard = 0;

    // 第一轮：多边形约束
    while (guard < total) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const isStreetRow = r === streetRow;
      const cellOk =
        !occupied.has(i) &&
        (!isStreetRow || isCivic) &&
        cellInPoly(c, r);
      if (cellOk) return i;
      i = (i + 1) % total;
      guard++;
    }

    // 回退：bbox 内任意空格（忽略 polygon，但仍跳过主街行和已占格）
    i = startIdx;
    guard = 0;
    while (guard < total) {
      const r = Math.floor(i / cols);
      const isStreetRow = r === streetRow;
      const cellOk = !occupied.has(i) && (!isStreetRow || isCivic);
      if (cellOk) return i;
      i = (i + 1) % total;
      guard++;
    }

    // 极端情况：全满，允许主街行回退（保证每篇笔记必有落位）
    i = startIdx;
    guard = 0;
    while (guard < total) {
      if (!occupied.has(i)) return i;
      i = (i + 1) % total;
      guard++;
    }

    // 理论上不会走到这里（格数 >= 笔记数时）
    return startIdx;
  }

  let streetCursor = 0;
  const out: Building[] = [];

  for (const note of ordered) {
    const rng = mulberry32(hashSeed(note.path));
    const isCivic = note === readme;
    const onStreet = !isCivic && streetTargets.has(note.title);
    let startCol: number;
    let startRow: number;

    if (isCivic) {
      startCol = Math.floor(cols / 2);
      startRow = streetRow;
    } else if (onStreet) {
      startRow = streetCursor % 2 === 0 ? streetRow - 1 : streetRow + 1;
      startRow = Math.min(rows - 1, Math.max(0, startRow));
      startCol = Math.floor(streetCursor / 2) % cols;
      streetCursor++;
    } else if (landmarks.has(note.path)) {
      startCol = Math.floor(cols / 2);
      startRow = Math.max(0, streetRow - 1);
    } else {
      startCol = Math.floor(rng() * cols);
      startRow = Math.floor(rng() * rows);
    }

    const startIdx = startRow * cols + startCol;
    const idx = probe(startIdx, isCivic, onStreet);
    occupied.add(idx);

    const c = idx % cols;
    const r = Math.floor(idx / cols);
    const [wx, wz] = cellCenter(c, r);

    // 消耗 rng 调用（与 Step 代码对齐：rotY 用第 3 次 rng）
    // 对于 isCivic 和 onStreet，rng 还没有调用过——补两次以对齐
    if (isCivic || onStreet || landmarks.has(note.path)) {
      rng(); // align: col
      rng(); // align: row
    }

    out.push({
      notePath: note.path,
      title: note.title,
      x: wx,
      z: wz,
      rotY: Math.floor(rng() * 4) * (Math.PI / 2),
      size: note.wordCount < 300 ? 1 : note.wordCount < 1500 ? 2 : 3,
      landmark: landmarks.has(note.path),
      construction: note.openTasks > 0,
      isCivic,
      mainStreet: onStreet,
      mtimeMs: note.mtimeMs,
      wordCount: note.wordCount,
      inlinks: inlinks[note.path] ?? 0,
      openTasks: note.openTasks,
      excerpt: note.excerpt,
    });
  }
  return out;
}
