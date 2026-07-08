// Notopolis 雏形服务（零依赖）
// 用法: node server.mjs [vault路径]
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(process.argv[2] ?? '/Users/xueqiang/Git/knowledge-base');
const PORT = Number(process.env.NOTOPOLIS_PORT ?? 4777);

// ---------- 工具 ----------
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 解析 ----------
function parseNote(raw) {
  let frontmatter = {};
  let content = raw;
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    content = raw.slice(fm[0].length);
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    if (desc) frontmatter.description = desc[1].trim();
  }
  const body = content.replace(/```[\s\S]*?```/g, '');
  const linkTargets = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1].trim());
  const openTasks = (body.match(/^\s*[-*]\s\[ \]/gm) ?? []).length;
  const cjk = (body.match(/[一-鿿]/g) ?? []).length;
  const latin = (body.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  const firstPara = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#')) ?? '';
  return {
    frontmatter,
    wordCount: cjk + latin,
    openTasks,
    linkTargets,
    excerpt: (frontmatter.description ?? firstPara).slice(0, 120),
  };
}

async function scanVault(root) {
  const notes = [];
  const errors = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      errors.push({ path: rel || '.', reason: e.message });
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const absChild = path.join(abs, ent.name);
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { await walk(absChild, relChild); continue; }
      if (!ent.name.endsWith('.md')) continue;
      try {
        const [raw, st] = await Promise.all([readFile(absChild, 'utf8'), stat(absChild)]);
        const p = parseNote(raw);
        notes.push({
          path: relChild,
          title: ent.name.replace(/\.md$/, ''),
          dir: relChild.includes('/') ? relChild.split('/')[0] : '',
          wordCount: p.wordCount, openTasks: p.openTasks, links: p.linkTargets,
          excerpt: p.excerpt, mtimeMs: st.mtimeMs,
        });
      } catch (e) {
        errors.push({ path: relChild, reason: e.message });
      }
    }
  }
  await walk(root, '');
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { notes, errors };
}

// ---------- 链接图 ----------
function buildGraph(notes) {
  const byTitle = new Map();
  const byPath = new Set(notes.map((n) => n.path));
  for (const n of notes) if (!byTitle.has(n.title)) byTitle.set(n.title, n.path);
  const inlinks = Object.fromEntries(notes.map((n) => [n.path, 0]));
  const intraDirEdges = [], crossDirEdges = [];
  const topDir = (p) => (p.includes('/') ? p.split('/')[0] : '');
  for (const n of notes) {
    for (const t of n.links) {
      const resolved = byPath.has(`${t}.md`) ? `${t}.md` : byTitle.get(t.split('/').pop());
      if (!resolved || resolved === n.path) continue;
      inlinks[resolved]++;
      (topDir(n.path) === topDir(resolved) ? intraDirEdges : crossDirEdges).push([n.path, resolved]);
    }
  }
  return { inlinks, intraDirEdges, crossDirEdges };
}

// ---------- 布局 ----------
const UNIT_AREA = 64;
function layoutDistricts(counts) {
  const items = counts.filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
  const total = items.reduce((s, c) => s + c.count, 0);
  if (!total) return [];
  const side = Math.ceil(Math.sqrt(total * UNIT_AREA));
  const plots = [];
  (function slice(rect, rest, sum, horizontal) {
    if (!rest.length) return;
    if (rest.length === 1) { plots.push({ dir: rest[0].dir, ...rect }); return; }
    const [head, ...tail] = rest;
    const frac = head.count / sum;
    if (horizontal) {
      const w = rect.width * frac;
      plots.push({ dir: head.dir, x: rect.x, z: rect.z, width: w, depth: rect.depth });
      slice({ ...rect, x: rect.x + w, width: rect.width - w }, tail, sum - head.count, false);
    } else {
      const d = rect.depth * frac;
      plots.push({ dir: head.dir, x: rect.x, z: rect.z, width: rect.width, depth: d });
      slice({ ...rect, z: rect.z + d, depth: rect.depth - d }, tail, sum - head.count, true);
    }
  })({ x: -side / 2, z: -side / 2, width: side, depth: side }, items, total, true);
  return plots;
}

function placeBuildings(plot, notes, inlinks) {
  const CELL = 4;
  const cols = Math.max(3, Math.floor(plot.width / CELL));
  const rows = Math.max(3, Math.floor(plot.depth / CELL));
  const streetRow = Math.floor(rows / 2);
  const occupied = new Set();
  const readme = notes.find((n) => n.title.toLowerCase() === 'readme');
  const streetTargets = new Set((readme?.links ?? []).map((t) => t.split('/').pop()));
  const ordered = [...notes].sort(
    (a, b) => (inlinks[b.path] ?? 0) - (inlinks[a.path] ?? 0) || a.path.localeCompare(b.path));
  const landmarks = new Set(ordered.filter((n) => (inlinks[n.path] ?? 0) >= 2).slice(0, 3).map((n) => n.path));
  let streetCursor = 0;
  const out = [];
  for (const note of ordered) {
    const rng = mulberry32(hashSeed(note.path));
    const isCivic = note === readme;
    const onStreet = !isCivic && streetTargets.has(note.title);
    let col, row;
    if (isCivic) { col = Math.floor(cols / 2); row = streetRow; }
    else if (onStreet) {
      row = Math.min(rows - 1, Math.max(0, streetCursor % 2 === 0 ? streetRow - 1 : streetRow + 1));
      col = Math.floor(streetCursor / 2) % cols;
      streetCursor++;
    } else if (landmarks.has(note.path)) { col = Math.floor(cols / 2); row = Math.max(0, streetRow - 1); }
    else { col = Math.floor(rng() * cols); row = Math.floor(rng() * rows); }
    let i = row * cols + col, guard = 0;
    while ((occupied.has(i) || (Math.floor(i / cols) === streetRow && !isCivic)) && guard < cols * rows) {
      i = (i + 1) % (cols * rows); guard++;
    }
    occupied.add(i);
    const c = i % cols, r = Math.floor(i / cols);
    out.push({
      notePath: note.path, title: note.title,
      x: plot.x + (c + 0.5) * (plot.width / cols),
      z: plot.z + (r + 0.5) * (plot.depth / rows),
      rotY: Math.floor(rng() * 4) * (Math.PI / 2),
      size: note.wordCount < 300 ? 1 : note.wordCount < 1500 ? 2 : 3,
      landmark: landmarks.has(note.path),
      construction: note.openTasks > 0,
      isCivic, mainStreet: onStreet,
      mtimeMs: note.mtimeMs, wordCount: note.wordCount,
      inlinks: inlinks[note.path] ?? 0, openTasks: note.openTasks, excerpt: note.excerpt,
    });
  }
  return out;
}

function buildRoads(districts, graph) {
  const roads = [];
  const pos = new Map();
  for (const d of districts) {
    roads.push({ kind: 'main', points: [[d.x, d.z + d.depth / 2], [d.x + d.width, d.z + d.depth / 2]] });
    for (const b of d.buildings) pos.set(b.notePath, [b.x, b.z]);
  }
  for (const [from, to] of graph.intraDirEdges) {
    const a = pos.get(from), b = pos.get(to);
    if (a && b) roads.push({ kind: 'street', points: [a, b] });
  }
  const center = new Map(districts.map((d) => [d.dir, [d.x + d.width / 2, d.z + d.depth / 2]]));
  const dirOf = (p) => (p.includes('/') ? p.split('/')[0] : '');
  const pairCount = new Map();
  for (const [from, to] of graph.crossDirEdges) {
    const key = [dirOf(from), dirOf(to)].sort().join(' ');
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([key]) => {
    const [d1, d2] = key.split(' ');
    if (center.get(d1) && center.get(d2))
      roads.push({ kind: 'avenue', points: [center.get(d1), center.get(d2)] });
  });
  return roads;
}

async function buildCity() {
  const scan = await scanVault(VAULT);
  const graph = buildGraph(scan.notes);
  const byDir = new Map();
  for (const n of scan.notes) {
    (byDir.get(n.dir) ?? byDir.set(n.dir, []).get(n.dir)).push(n);
  }
  const plots = layoutDistricts([...byDir.entries()].map(([dir, l]) => ({ dir, count: l.length })));
  const districts = plots.map((plot) => ({
    dir: plot.dir, x: plot.x, z: plot.z, width: plot.width, depth: plot.depth,
    isInbox: /inbox/i.test(plot.dir),
    buildings: placeBuildings(plot, byDir.get(plot.dir), graph.inlinks),
  }));
  const now = Date.now();
  const noteCount = scan.notes.length;
  return {
    vaultPath: VAULT,
    name: path.basename(VAULT),
    tier: noteCount < 30 ? 'camp' : noteCount < 150 ? 'village' : noteCount < 600 ? 'city' : 'capital',
    districts,
    roads: buildRoads(districts, graph),
    noteCount,
    activeCount7d: scan.notes.filter((n) => now - n.mtimeMs < 7 * 86400000).length,
    errors: scan.errors,
    generatedAt: now,
  };
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/city') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(await buildCity()));
    } else if (url.pathname === '/api/note') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = path.resolve(VAULT, rel);
      if (!abs.startsWith(VAULT + path.sep)) { res.writeHead(400); res.end('invalid path'); return; }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(await readFile(abs, 'utf8'));
    } else {
      const html = await readFile(path.join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(PORT, () => {
  console.log(`Notopolis prototype: http://localhost:${PORT}`);
  console.log(`Vault: ${VAULT}`);
});
