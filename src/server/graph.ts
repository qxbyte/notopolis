import type { GraphResult, NoteMeta } from '../shared/types.js';

function topDir(p: string): string {
  return p.includes('/') ? p.split('/')[0] : '';
}

export function buildGraph(notes: NoteMeta[]): GraphResult {
  const byTitle = new Map<string, string>();
  const byPath = new Set(notes.map((n) => n.path));
  for (const n of notes) if (!byTitle.has(n.title)) byTitle.set(n.title, n.path);

  const inlinks: Record<string, number> = Object.fromEntries(notes.map((n) => [n.path, 0]));
  const intraDirEdges: [string, string][] = [];
  const crossDirEdges: [string, string][] = [];
  const hasOutlink = new Set<string>();

  for (const n of notes) {
    for (const target of n.links) {
      const resolved = byPath.has(`${target}.md`)
        ? `${target}.md`
        : byTitle.get(target.split('/').pop()!);
      if (!resolved || resolved === n.path) continue;
      inlinks[resolved]++;
      hasOutlink.add(n.path);
      const edge: [string, string] = [n.path, resolved];
      (topDir(n.path) === topDir(resolved) ? intraDirEdges : crossDirEdges).push(edge);
    }
  }

  const orphans = notes
    .filter((n) => inlinks[n.path] === 0 && !hasOutlink.has(n.path))
    .map((n) => n.path);
  return { inlinks, orphans, intraDirEdges, crossDirEdges };
}
