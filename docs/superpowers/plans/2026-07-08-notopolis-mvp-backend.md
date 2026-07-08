# Notopolis MVP 后端（数据管线）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零初始化 Notopolis 项目，交付本地服务：扫描多个 Obsidian vault → 链接图 → 确定性城市布局（CityModel JSON）→ REST + WebSocket API + 文件监听。

**Architecture:** Node.js + Fastify 本地服务。纯函数布局引擎（种子哈希驱动，同 vault 永远同布局），扫描/图/布局三层解耦，chokidar 监听文件变更后通过 WS 推送失效事件（客户端重拉全量模型，前端自行 diff 动画——MVP 简化，非增量 diff 推送）。

**Tech Stack:** TypeScript (ESM/NodeNext), Fastify ^4, @fastify/websocket ^10, chokidar ^3.6, gray-matter ^4, vitest ^2, tsx ^4。

**设计文档:** `/Users/xueqiang/Documents/Obsidian/Notes/07-Ideas/游戏/Notopolis/Notopolis 设计文档.md`

## Global Constraints

- Node ≥ 20，`"type": "module"`，tsconfig `module: NodeNext`（源码内相对导入写 `.js` 后缀）。
- **确定性原则**：布局函数不得调用 `Math.random()` / `Date.now()`（时间由调用方传入 `now` 参数），随机只用 `rng.ts` 的种子 PRNG。
- **TCC 降级**：任何目录读取失败（macOS `EPERM`）记入 `errors` 数组并继续，绝不整体抛出。
- 所有实现走 TDD：先写失败测试，再实现。
- 每次 commit 末尾追加两行署名（Claude 在前、用户在后），用户信息实时取自 git config：
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
  ```
- 已知 MVP 简化（不要"顺手修复"）：① WS 只推 `city-updated` 失效事件；② 街区相邻性（跨链多的区靠近）不做，用 slice-dice treemap；③ 运行中新增 vault 不动态加 watcher（重启生效）。

## 文件结构

```
notopolis/
├── package.json / tsconfig.json / .gitignore
├── docs/superpowers/plans/          # 本计划
├── src/
│   ├── shared/types.ts              # 全部共享类型（前端计划复用）
│   └── server/
│       ├── parse.ts                 # 单文件 md 解析（纯函数）
│       ├── scanner.ts               # vault 遍历 + EPERM 降级
│       ├── graph.ts                 # 链接解析、被引数、孤儿
│       ├── layout/
│       │   ├── rng.ts               # 种子哈希 + PRNG
│       │   ├── districts.ts         # 顶层目录 → 地块（treemap）
│       │   ├── buildings.ts         # 区内排楼（主街/地标/区府）
│       │   ├── roads.ts             # 主街/街巷/跨区大道
│       │   └── city.ts              # 组装 CityModel + tier
│       ├── config.ts                # ~/.notopolis/config.json
│       ├── server.ts                # Fastify REST + WS
│       ├── watcher.ts               # chokidar 防抖监听
│       └── index.ts                 # 入口
└── tests/
    ├── fixtures/vault-a/            # 固定测试 vault
    └── *.test.ts
```

---

### Task 1: 项目初始化

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: 可运行的 `npm test`（vitest）与 `npm run typecheck` 环境，后续所有任务依赖。

- [ ] **Step 1: git init 与骨架文件**

```bash
cd ~/Git/notopolis && git init -b main
```

`package.json`：

```json
{
  "name": "notopolis",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/websocket": "^10.0.1",
    "chokidar": "^3.6.0",
    "fastify": "^4.28.1",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`.gitignore`：

```
node_modules/
dist/
.superpowers/
```

- [ ] **Step 2: 写冒烟测试** `tests/smoke.test.ts`

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: 安装依赖并验证**

Run: `npm install && npm test && npm run typecheck`
Expected: smoke 测试 PASS，typecheck 无错误。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<EOF
chore: init notopolis project skeleton

Node ESM + TypeScript + vitest toolchain.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 2: 共享类型 + 测试 fixture vault + md 解析器

**Files:**
- Create: `src/shared/types.ts`, `src/server/parse.ts`, `tests/fixtures/vault-a/**`, `tests/parse.test.ts`

**Interfaces:**
- Produces: `parseNote(raw: string): ParsedNote`（`{ frontmatter, wordCount, openTasks, linkTargets, excerpt }`）；`types.ts` 导出 `VaultConfig/AppConfig/NoteMeta/ScanResult/GraphResult/Building/District/Road/CityModel`，后续所有任务按此签名消费。

- [ ] **Step 1: 写共享类型** `src/shared/types.ts`

```ts
export interface VaultConfig {
  id: string;
  name: string;
  path: string;
  theme: 'plains' | 'mountain' | 'harbor' | 'snow';
}

export interface AppConfig {
  vaults: VaultConfig[];
}

export interface NoteMeta {
  path: string; // vault 相对路径（posix 分隔）
  title: string; // 文件名去 .md
  dir: string; // 顶层目录名，根目录为 ''
  wordCount: number;
  openTasks: number;
  links: string[]; // 原始 [[链接]] 目标（未解析）
  frontmatter: Record<string, unknown>;
  excerpt: string;
  mtimeMs: number;
  birthtimeMs: number;
}

export interface ScanResult {
  notes: NoteMeta[];
  errors: { path: string; reason: string }[];
}

export interface GraphResult {
  inlinks: Record<string, number>; // notePath -> 被引数
  orphans: string[];
  intraDirEdges: [string, string][]; // [fromPath, toPath] 同顶层目录
  crossDirEdges: [string, string][];
}

export interface Building {
  notePath: string;
  title: string;
  x: number;
  z: number;
  rotY: number;
  size: 1 | 2 | 3; // 小屋/楼/塔
  landmark: boolean;
  construction: boolean; // openTasks > 0
  isCivic: boolean; // README 区府
  mainStreet: boolean;
  mtimeMs: number;
  wordCount: number;
  inlinks: number;
  openTasks: number;
  excerpt: string;
}

export interface District {
  dir: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  polygon: [number, number][]; // 不规则边界（在 bbox 内、闭合、互不重叠）
  isInbox: boolean;
  buildings: Building[];
}

export interface Road {
  kind: 'main' | 'street' | 'avenue';
  points: [number, number][];
}

export type Tier = 'camp' | 'village' | 'city' | 'capital';

export interface CityModel {
  vaultId: string;
  name: string;
  theme: string;
  tier: Tier;
  districts: District[];
  roads: Road[];
  noteCount: number;
  activeCount7d: number;
  generatedAt: number;
}
```

- [ ] **Step 2: 建 fixture vault**（后续 scanner/graph/layout/server 测试共用）

`tests/fixtures/vault-a/01-AI/README.md`：

```markdown
---
description: AI 学院区导航
---
# AI 索引

- [[Transformer]]
- [[RAG]]
```

`tests/fixtures/vault-a/01-AI/Transformer.md`：

```markdown
Transformer 是基于注意力机制的架构，参见 [[RAG]]。

- [ ] 补充位置编码小节
- [x] 已写自注意力
```

`tests/fixtures/vault-a/01-AI/RAG.md`：

```markdown
检索增强生成。引用 [[Transformer]]。
```

`tests/fixtures/vault-a/02-Dev/Git 技巧.md`：

```markdown
rebase 与 cherry-pick 笔记，关联 [[Transformer]]。
```

`tests/fixtures/vault-a/99-Inbox/随手记.md`：

```markdown
- [ ] 待整理的一条想法
```

`tests/fixtures/vault-a/.obsidian/app.json`（验证忽略规则）：

```json
{}
```

- [ ] **Step 3: 写失败测试** `tests/parse.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/server/parse.js';

describe('parseNote', () => {
  it('解析 frontmatter、双链、任务、字数、摘要', () => {
    const raw = [
      '---',
      'description: 测试摘要',
      '---',
      '# 标题',
      '',
      '这是正文，链接到 [[目标笔记]] 和 [[别名笔记|显示名]] 与 [[章节#小节]]。',
      '',
      '- [ ] 未完成一',
      '- [ ] 未完成二',
      '- [x] 已完成',
      '',
      '```',
      '- [ ] 代码块里的不算',
      '[[代码块里的链接不算]]',
      '```',
    ].join('\n');
    const p = parseNote(raw);
    expect(p.frontmatter.description).toBe('测试摘要');
    expect(p.linkTargets).toEqual(['目标笔记', '别名笔记', '章节']);
    expect(p.openTasks).toBe(2);
    expect(p.excerpt).toBe('测试摘要');
    expect(p.wordCount).toBeGreaterThan(10);
  });

  it('无 frontmatter 时摘要取首段', () => {
    const p = parseNote('# 头\n\n第一段正文。\n\n第二段。');
    expect(p.excerpt).toBe('第一段正文。');
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npm test -- parse`
Expected: FAIL（`parse.js` 不存在）。

- [ ] **Step 5: 实现** `src/server/parse.ts`

```ts
import matter from 'gray-matter';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  wordCount: number;
  openTasks: number;
  linkTargets: string[];
  excerpt: string;
}

export function parseNote(raw: string): ParsedNote {
  const { data, content } = matter(raw);
  const body = content.replace(/```[\s\S]*?```/g, '');
  const linkTargets = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  );
  const openTasks = (body.match(/^\s*[-*]\s\[ \]/gm) ?? []).length;
  const cjk = (body.match(/[一-鿿]/g) ?? []).length;
  const latinWords = (body.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  const desc = typeof data.description === 'string' ? data.description : undefined;
  const firstPara =
    body
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#')) ?? '';
  return {
    frontmatter: data,
    wordCount: cjk + latinWords,
    openTasks,
    linkTargets,
    excerpt: (desc ?? firstPara).slice(0, 120),
  };
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test -- parse && npm run typecheck`
Expected: 2 个测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/server/parse.ts tests/fixtures tests/parse.test.ts
git commit -m "$(cat <<EOF
feat: shared types, fixture vault and markdown note parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 3: Vault Scanner（含 TCC 降级）

**Files:**
- Create: `src/server/scanner.ts`, `tests/scanner.test.ts`

**Interfaces:**
- Consumes: `parseNote`（Task 2）。
- Produces: `scanVault(root: string): Promise<ScanResult>`——notes 按 path 排序；目录读取失败进 errors 不抛出。

- [ ] **Step 1: 写失败测试** `tests/scanner.test.ts`

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

describe('scanVault', () => {
  it('扫描 fixture vault：5 篇笔记，忽略 .obsidian', async () => {
    const r = await scanVault(FIXTURE);
    expect(r.notes.map((n) => n.path)).toEqual([
      '01-AI/README.md',
      '01-AI/RAG.md',
      '01-AI/Transformer.md',
      '02-Dev/Git 技巧.md',
      '99-Inbox/随手记.md',
    ]);
    const tf = r.notes.find((n) => n.title === 'Transformer')!;
    expect(tf.dir).toBe('01-AI');
    expect(tf.openTasks).toBe(1);
    expect(tf.links).toEqual(['RAG']);
    expect(tf.mtimeMs).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
  });

  it('根目录不可读时降级为 errors 而非抛出', async () => {
    const r = await scanVault('/nonexistent/path/xyz');
    expect(r.notes).toEqual([]);
    expect(r.errors.length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- scanner`
Expected: FAIL（`scanner.js` 不存在）。

- [ ] **Step 3: 实现** `src/server/scanner.ts`

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NoteMeta, ScanResult } from '../shared/types.js';
import { parseNote } from './parse.js';

const IGNORED = new Set(['node_modules']);

export async function scanVault(root: string): Promise<ScanResult> {
  const notes: NoteMeta[] = [];
  const errors: ScanResult['errors'] = [];

  async function walk(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      errors.push({ path: rel || '.', reason: (e as Error).message });
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || IGNORED.has(ent.name)) continue;
      const absChild = path.join(abs, ent.name);
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        await walk(absChild, relChild);
        continue;
      }
      if (!ent.name.endsWith('.md')) continue;
      try {
        const [raw, st] = await Promise.all([readFile(absChild, 'utf8'), stat(absChild)]);
        const parsed = parseNote(raw);
        notes.push({
          path: relChild,
          title: ent.name.replace(/\.md$/, ''),
          dir: relChild.includes('/') ? relChild.split('/')[0] : '',
          wordCount: parsed.wordCount,
          openTasks: parsed.openTasks,
          links: parsed.linkTargets,
          frontmatter: parsed.frontmatter,
          excerpt: parsed.excerpt,
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs,
        });
      } catch (e) {
        errors.push({ path: relChild, reason: (e as Error).message });
      }
    }
  }

  await walk(root, '');
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { notes, errors };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- scanner && npm run typecheck`
Expected: 2 个测试 PASS。（注意：排序断言依赖 `localeCompare`，若 fixture 断言顺序与实际不符，以 `localeCompare` 实际输出修正断言——顺序本身稳定即可。）

- [ ] **Step 5: Commit**

```bash
git add src/server/scanner.ts tests/scanner.test.ts
git commit -m "$(cat <<EOF
feat: vault scanner with TCC-safe error degradation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 4: 链接图构建

**Files:**
- Create: `src/server/graph.ts`, `tests/graph.test.ts`

**Interfaces:**
- Consumes: `NoteMeta[]`（Task 3 产出）。
- Produces: `buildGraph(notes: NoteMeta[]): GraphResult`——wikilink 目标按「完整相对路径 → 标题（basename）」两级解析；自链忽略。

- [ ] **Step 1: 写失败测试** `tests/graph.test.ts`

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/server/graph.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

describe('buildGraph', () => {
  it('统计被引数/孤儿/同区与跨区边', async () => {
    const { notes } = await scanVault(FIXTURE);
    const g = buildGraph(notes);
    // Transformer 被 README、RAG、Git 技巧引用
    expect(g.inlinks['01-AI/Transformer.md']).toBe(3);
    expect(g.inlinks['01-AI/RAG.md']).toBe(2); // README + Transformer
    expect(g.orphans).toEqual(['99-Inbox/随手记.md']);
    expect(g.intraDirEdges).toContainEqual(['01-AI/Transformer.md', '01-AI/RAG.md']);
    expect(g.crossDirEdges).toContainEqual(['02-Dev/Git 技巧.md', '01-AI/Transformer.md']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- graph`
Expected: FAIL（`graph.js` 不存在）。

- [ ] **Step 3: 实现** `src/server/graph.ts`

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- graph && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/graph.ts tests/graph.test.ts
git commit -m "$(cat <<EOF
feat: link graph builder (inlinks, orphans, intra/cross-dir edges)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 5: 种子随机数 + 街区划分

**Files:**
- Create: `src/server/layout/rng.ts`, `src/server/layout/districts.ts`, `tests/layout-districts.test.ts`

**Interfaces:**
- Produces: `hashSeed(str): number`、`mulberry32(seed): () => number`、`layoutDistricts(counts: {dir: string; count: number}[]): Plot[]`，`Plot = { dir, x, z, width, depth, polygon }`。世界以原点为中心，面积 ∝ 笔记总数。**街区形状不规则**：treemap 分配 bbox 后，沿矩形周界每 ~4 单位取点、以 `mulberry32(hashSeed(dir))` 向内扰动 0–18% 半边长生成闭合多边形（只向内扰动 → 天然不重叠）。测试补充断言：多边形所有顶点位于 bbox 内、两次调用输出全等。`pointInPolygon(x, z, poly): boolean`（射线法）一并在 districts.ts 导出，供 Task 6 使用。

- [ ] **Step 1: 写失败测试** `tests/layout-districts.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { layoutDistricts } from '../src/server/layout/districts.js';
import { hashSeed, mulberry32 } from '../src/server/layout/rng.js';

describe('rng', () => {
  it('同种子同序列，异种子异序列', () => {
    const a = mulberry32(hashSeed('x'));
    const b = mulberry32(hashSeed('x'));
    const c = mulberry32(hashSeed('y'));
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([c(), c(), c()]);
    seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });
});

describe('layoutDistricts', () => {
  const counts = [
    { dir: '01-AI', count: 30 },
    { dir: '02-Dev', count: 10 },
    { dir: '99-Inbox', count: 5 },
  ];

  it('确定性：两次调用完全相同', () => {
    expect(layoutDistricts(counts)).toEqual(layoutDistricts(counts));
  });

  it('每个目录一块地，面积与笔记数正相关', () => {
    const plots = layoutDistricts(counts);
    expect(plots.map((p) => p.dir).sort()).toEqual(['01-AI', '02-Dev', '99-Inbox']);
    const area = (d: string) => {
      const p = plots.find((x) => x.dir === d)!;
      return p.width * p.depth;
    };
    expect(area('01-AI')).toBeGreaterThan(area('02-Dev'));
    expect(area('02-Dev')).toBeGreaterThan(area('99-Inbox'));
  });

  it('地块互不重叠', () => {
    const plots = layoutDistricts(counts);
    for (const a of plots)
      for (const b of plots) {
        if (a === b) continue;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapZ = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
        expect(overlapX <= 0.001 || overlapZ <= 0.001).toBe(true);
      }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- layout-districts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/layout/rng.ts`

```ts
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: 实现** `src/server/layout/districts.ts`（slice-dice treemap）

```ts
export interface Plot {
  dir: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

const UNIT_AREA = 64; // 每篇笔记占据的世界面积（4x4 建筑格 × 4 格余量）

interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export function layoutDistricts(counts: { dir: string; count: number }[]): Plot[] {
  const items = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
  const total = items.reduce((s, c) => s + c.count, 0);
  if (total === 0) return [];
  const side = Math.ceil(Math.sqrt(total * UNIT_AREA));
  const plots: Plot[] = [];

  function slice(rect: Rect, rest: typeof items, sum: number, horizontal: boolean): void {
    if (rest.length === 0) return;
    if (rest.length === 1) {
      plots.push({ dir: rest[0].dir, ...rect });
      return;
    }
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
  }

  slice({ x: -side / 2, z: -side / 2, width: side, depth: side }, items, total, true);
  return plots;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- layout-districts && npm run typecheck`
Expected: 4 个测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/server/layout/rng.ts src/server/layout/districts.ts tests/layout-districts.test.ts
git commit -m "$(cat <<EOF
feat: seeded rng and deterministic district treemap layout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 6: 区内排楼（区府/主街/地标）

**Files:**
- Create: `src/server/layout/buildings.ts`, `tests/layout-buildings.test.ts`

**Interfaces:**
- Consumes: `Plot`（Task 5）、`NoteMeta[]`、`GraphResult.inlinks`。
- Produces: `placeBuildings(plot: Plot, notes: NoteMeta[], inlinks: Record<string, number>): Building[]`。规则：README → `isCivic`，置于主街行中心；README 链接的笔记 → `mainStreet`，沿主街两侧排；被引 ≥2 的前 3 名 → `landmark`；其余按 `hashSeed(note.path)` 落格 + 线性探测防撞。**多边形约束**：线性探测时跳过格心不在 `plot.polygon` 内的格（用 Task 5 的 `pointInPolygon`）；探测穷尽后回退到 bbox 内任意空格（保证每篇笔记必有落位）。测试补充：所有建筑坐标满足 `pointInPolygon === true` 或属于回退落位。

- [ ] **Step 1: 写失败测试** `tests/layout-buildings.test.ts`

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/server/graph.js';
import { placeBuildings } from '../src/server/layout/buildings.js';
import type { Plot } from '../src/server/layout/districts.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');
const PLOT: Plot = { dir: '01-AI', x: 0, z: 0, width: 24, depth: 24 };

async function aiNotes() {
  const { notes } = await scanVault(FIXTURE);
  return { notes: notes.filter((n) => n.dir === '01-AI'), graph: buildGraph(notes) };
}

describe('placeBuildings', () => {
  it('确定性 + 无重叠落位', async () => {
    const { notes, graph } = await aiNotes();
    const a = placeBuildings(PLOT, notes, graph.inlinks);
    const b = placeBuildings(PLOT, notes, graph.inlinks);
    expect(a).toEqual(b);
    const keys = a.map((x) => `${x.x},${x.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of a) {
      expect(x.x).toBeGreaterThan(PLOT.x);
      expect(x.x).toBeLessThan(PLOT.x + PLOT.width);
    }
  });

  it('README 是区府，README 链接的笔记在主街', async () => {
    const { notes, graph } = await aiNotes();
    const placed = placeBuildings(PLOT, notes, graph.inlinks);
    const civic = placed.find((x) => x.isCivic)!;
    expect(civic.title).toBe('README');
    expect(placed.find((x) => x.title === 'Transformer')!.mainStreet).toBe(true);
    expect(placed.find((x) => x.title === 'RAG')!.mainStreet).toBe(true);
  });

  it('高被引成为地标，任务笔记有施工位，体量随字数', async () => {
    const { notes, graph } = await aiNotes();
    const placed = placeBuildings(PLOT, notes, graph.inlinks);
    const tf = placed.find((x) => x.title === 'Transformer')!;
    expect(tf.landmark).toBe(true);
    expect(tf.construction).toBe(true);
    expect(tf.size).toBe(1); // fixture 字数少
    expect(tf.inlinks).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- layout-buildings`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/layout/buildings.ts`

```ts
import type { Building, NoteMeta } from '../../shared/types.js';
import type { Plot } from './districts.js';
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

  let streetCursor = 0;
  const out: Building[] = [];

  for (const note of ordered) {
    const rng = mulberry32(hashSeed(note.path));
    const isCivic = note === readme;
    const onStreet = !isCivic && streetTargets.has(note.title);
    let col: number;
    let row: number;

    if (isCivic) {
      col = Math.floor(cols / 2);
      row = streetRow;
    } else if (onStreet) {
      row = streetCursor % 2 === 0 ? streetRow - 1 : streetRow + 1;
      row = Math.min(rows - 1, Math.max(0, row));
      col = Math.floor(streetCursor / 2) % cols;
      streetCursor++;
    } else if (landmarks.has(note.path)) {
      col = Math.floor(cols / 2);
      row = Math.max(0, streetRow - 1);
    } else {
      col = Math.floor(rng() * cols);
      row = Math.floor(rng() * rows);
    }

    // 线性探测：跳过已占格；主街行只留给区府
    let i = row * cols + col;
    let guard = 0;
    while (
      (occupied.has(i) || (Math.floor(i / cols) === streetRow && !isCivic)) &&
      guard < cols * rows
    ) {
      i = (i + 1) % (cols * rows);
      guard++;
    }
    occupied.add(i);
    const c = i % cols;
    const r = Math.floor(i / cols);

    out.push({
      notePath: note.path,
      title: note.title,
      x: plot.x + (c + 0.5) * (plot.width / cols),
      z: plot.z + (r + 0.5) * (plot.depth / rows),
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- layout-buildings && npm run typecheck`
Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/buildings.ts tests/layout-buildings.test.ts
git commit -m "$(cat <<EOF
feat: deterministic in-district building placement (civic/main-street/landmark)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 7: 道路生成 + CityModel 组装

**Files:**
- Create: `src/server/layout/roads.ts`, `src/server/layout/city.ts`, `tests/layout-city.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 全部产出。
- Produces: `buildRoads(districts: District[], graph: GraphResult): Road[]`；`tierOf(noteCount: number): Tier`；`buildCityModel(vault: VaultConfig, scan: ScanResult, graph: GraphResult, now: number): CityModel`。`now` 由调用方传入（保持纯函数）。

- [ ] **Step 1: 写失败测试** `tests/layout-city.test.ts`

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VaultConfig } from '../src/shared/types.js';
import { buildGraph } from '../src/server/graph.js';
import { buildCityModel, tierOf } from '../src/server/layout/city.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');
const VAULT: VaultConfig = { id: 'va', name: '测试城', path: FIXTURE, theme: 'plains' };

describe('tierOf', () => {
  it('聚落分级阈值', () => {
    expect(tierOf(5)).toBe('camp');
    expect(tierOf(30)).toBe('village');
    expect(tierOf(150)).toBe('city');
    expect(tierOf(600)).toBe('capital');
  });
});

describe('buildCityModel', () => {
  it('组装完整城市模型且确定性', async () => {
    const scan = await scanVault(FIXTURE);
    const graph = buildGraph(scan.notes);
    const now = 1_800_000_000_000;
    const m1 = buildCityModel(VAULT, scan, graph, now);
    const m2 = buildCityModel(VAULT, scan, graph, now);
    expect(m1).toEqual(m2);
    expect(m1.noteCount).toBe(5);
    expect(m1.tier).toBe('camp');
    expect(m1.districts.map((d) => d.dir).sort()).toEqual(['01-AI', '02-Dev', '99-Inbox']);
    expect(m1.districts.find((d) => d.dir === '99-Inbox')!.isInbox).toBe(true);
    // 道路：每区一条主街 + 至少一条区内街巷 + 跨区大道
    expect(m1.roads.filter((r) => r.kind === 'main').length).toBe(3);
    expect(m1.roads.some((r) => r.kind === 'street')).toBe(true);
    expect(m1.roads.some((r) => r.kind === 'avenue')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- layout-city`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/layout/roads.ts`

```ts
import type { District, GraphResult, Road } from '../../shared/types.js';

function dirOf(p: string): string {
  return p.includes('/') ? p.split('/')[0] : '';
}

export function buildRoads(districts: District[], graph: GraphResult): Road[] {
  const roads: Road[] = [];
  const pos = new Map<string, [number, number]>();

  for (const d of districts) {
    roads.push({
      kind: 'main',
      points: [
        [d.x, d.z + d.depth / 2],
        [d.x + d.width, d.z + d.depth / 2],
      ],
    });
    for (const b of d.buildings) pos.set(b.notePath, [b.x, b.z]);
  }

  for (const [from, to] of graph.intraDirEdges) {
    const a = pos.get(from);
    const b = pos.get(to);
    if (a && b) roads.push({ kind: 'street', points: [a, b] });
  }

  const center = new Map(
    districts.map((d) => [d.dir, [d.x + d.width / 2, d.z + d.depth / 2] as [number, number]]),
  );
  const pairCount = new Map<string, number>();
  for (const [from, to] of graph.crossDirEdges) {
    const key = [dirOf(from), dirOf(to)].sort().join(' ');
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  [...pairCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .forEach(([key]) => {
      const [d1, d2] = key.split(' ');
      const c1 = center.get(d1);
      const c2 = center.get(d2);
      if (c1 && c2) roads.push({ kind: 'avenue', points: [c1, c2] });
    });
  return roads;
}
```

- [ ] **Step 4: 实现** `src/server/layout/city.ts`

```ts
import type {
  CityModel,
  District,
  GraphResult,
  NoteMeta,
  ScanResult,
  Tier,
  VaultConfig,
} from '../../shared/types.js';
import { placeBuildings } from './buildings.js';
import { layoutDistricts } from './districts.js';
import { buildRoads } from './roads.js';

export function tierOf(noteCount: number): Tier {
  if (noteCount < 30) return 'camp';
  if (noteCount < 150) return 'village';
  if (noteCount < 600) return 'city';
  return 'capital';
}

export function buildCityModel(
  vault: VaultConfig,
  scan: ScanResult,
  graph: GraphResult,
  now: number,
): CityModel {
  const byDir = new Map<string, NoteMeta[]>();
  for (const n of scan.notes) {
    const list = byDir.get(n.dir) ?? [];
    list.push(n);
    byDir.set(n.dir, list);
  }
  const plots = layoutDistricts(
    [...byDir.entries()].map(([dir, list]) => ({ dir, count: list.length })),
  );
  const districts: District[] = plots.map((plot) => ({
    dir: plot.dir,
    x: plot.x,
    z: plot.z,
    width: plot.width,
    depth: plot.depth,
    isInbox: /inbox/i.test(plot.dir),
    buildings: placeBuildings(plot, byDir.get(plot.dir)!, graph.inlinks),
  }));

  return {
    vaultId: vault.id,
    name: vault.name,
    theme: vault.theme,
    tier: tierOf(scan.notes.length),
    districts,
    roads: buildRoads(districts, graph),
    noteCount: scan.notes.length,
    activeCount7d: scan.notes.filter((n) => now - n.mtimeMs < 7 * 86_400_000).length,
    generatedAt: now,
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: 全部测试 PASS（含此前任务的回归）。

- [ ] **Step 6: Commit**

```bash
git add src/server/layout/roads.ts src/server/layout/city.ts tests/layout-city.test.ts
git commit -m "$(cat <<EOF
feat: road network generation and CityModel assembly

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 8: 配置存储

**Files:**
- Create: `src/server/config.ts`, `tests/config.test.ts`

**Interfaces:**
- Produces: `configDir(): string`（可被 `NOTOPOLIS_CONFIG_DIR` 环境变量覆盖，供测试与多环境）；`loadConfig(): Promise<AppConfig>`（缺省 `{vaults: []}`）；`saveConfig(cfg): Promise<void>`（原子写）；`makeVault(name, path, theme): VaultConfig`（id = 路径哈希 base36，确定性）。

- [ ] **Step 1: 写失败测试** `tests/config.test.ts`

```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, makeVault, saveConfig } from '../src/server/config.js';

afterEach(() => {
  delete process.env.NOTOPOLIS_CONFIG_DIR;
});

describe('config store', () => {
  it('无配置文件时返回空配置', async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
    expect(await loadConfig()).toEqual({ vaults: [] });
  });

  it('保存后可读回；vault id 由路径确定', async () => {
    process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
    const v = makeVault('主城', '/tmp/vault-x', 'plains');
    expect(v.id).toBe(makeVault('别名', '/tmp/vault-x', 'snow').id);
    await saveConfig({ vaults: [v] });
    expect((await loadConfig()).vaults).toEqual([v]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- config`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/config.ts`

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AppConfig, VaultConfig } from '../shared/types.js';
import { hashSeed } from './layout/rng.js';

export function configDir(): string {
  return process.env.NOTOPOLIS_CONFIG_DIR ?? path.join(homedir(), '.notopolis');
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    return JSON.parse(await readFile(path.join(configDir(), 'config.json'), 'utf8'));
  } catch {
    return { vaults: [] };
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'config.json.tmp');
  await writeFile(tmp, JSON.stringify(cfg, null, 2));
  await rename(tmp, path.join(dir, 'config.json'));
}

export function makeVault(
  name: string,
  vaultPath: string,
  theme: VaultConfig['theme'],
): VaultConfig {
  return { id: hashSeed(vaultPath).toString(36), name, path: vaultPath, theme };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- config && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts tests/config.test.ts
git commit -m "$(cat <<EOF
feat: persistent multi-vault config store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 9: Fastify REST API

**Files:**
- Create: `src/server/server.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: Task 3/4/7/8 全部产出。
- Produces: `createServer(): Promise<{ app: FastifyInstance; broadcast: (msg: unknown) => void }>`。路由：`GET /api/world`（vault 摘要含 `ok/reason` 迷雾标记）、`GET /api/city/:vaultId`、`POST /api/vaults`、`DELETE /api/vaults/:vaultId`、`GET /api/note/:vaultId?path=`（带路径穿越防护）、`GET /ws`（WebSocket）。

- [ ] **Step 1: 写失败测试** `tests/server.test.ts`

```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server/server.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');

beforeEach(async () => {
  process.env.NOTOPOLIS_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'noto-'));
});

async function addFixtureVault(app: Awaited<ReturnType<typeof createServer>>['app']) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vaults',
    payload: { name: '测试城', path: FIXTURE, theme: 'plains' },
  });
  return res.json() as { id: string };
}

describe('REST API', () => {
  it('vault 增删与 world 摘要', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);

    const world = (await app.inject('/api/world')).json();
    expect(world.vaults).toHaveLength(1);
    expect(world.vaults[0]).toMatchObject({ id: v.id, noteCount: 5, tier: 'camp', ok: true });

    await app.inject({ method: 'DELETE', url: `/api/vaults/${v.id}` });
    expect((await app.inject('/api/world')).json().vaults).toHaveLength(0);
  });

  it('失效路径的 vault 标记迷雾（ok:false）', async () => {
    const { app } = await createServer();
    await app.inject({
      method: 'POST',
      url: '/api/vaults',
      payload: { name: '迷雾城', path: '/nonexistent/xyz', theme: 'snow' },
    });
    const world = (await app.inject('/api/world')).json();
    expect(world.vaults[0].ok).toBe(false);
    expect(world.vaults[0].reason).toBeTruthy();
  });

  it('返回城市模型', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);
    const city = (await app.inject(`/api/city/${v.id}`)).json();
    expect(city.noteCount).toBe(5);
    expect(city.districts).toHaveLength(3);
    expect((await app.inject('/api/city/nope')).statusCode).toBe(404);
  });

  it('读笔记原文并阻止路径穿越', async () => {
    const { app } = await createServer();
    const v = await addFixtureVault(app);
    const ok = await app.inject(`/api/note/${v.id}?path=${encodeURIComponent('01-AI/RAG.md')}`);
    expect(ok.json().markdown).toContain('检索增强生成');
    const evil = await app.inject(`/api/note/${v.id}?path=${encodeURIComponent('../../etc/passwd')}`);
    expect(evil.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/server.ts`

```ts
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { loadConfig, makeVault, saveConfig } from './config.js';
import { buildGraph } from './graph.js';
import { buildCityModel, tierOf } from './layout/city.js';
import { scanVault } from './scanner.js';

export async function createServer(): Promise<{
  app: FastifyInstance;
  broadcast: (msg: unknown) => void;
}> {
  const app = Fastify();
  await app.register(websocket);
  const sockets = new Set<WebSocket>();

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  app.get('/api/world', async () => {
    const cfg = await loadConfig();
    const vaults = [];
    for (const v of cfg.vaults) {
      const scan = await scanVault(v.path);
      const ok = scan.notes.length > 0 || scan.errors.length === 0;
      vaults.push({
        ...v,
        noteCount: scan.notes.length,
        tier: tierOf(scan.notes.length),
        ok,
        reason: ok ? undefined : scan.errors[0]?.reason,
      });
    }
    return { vaults };
  });

  app.get('/api/city/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const scan = await scanVault(vault.path);
    return buildCityModel(vault, scan, buildGraph(scan.notes), Date.now());
  });

  app.post('/api/vaults', async (req, reply) => {
    const body = req.body as { name?: string; path?: string; theme?: string };
    if (!body?.name || !body?.path) return reply.code(400).send({ error: 'name/path required' });
    const cfg = await loadConfig();
    const vault = makeVault(body.name, body.path, (body.theme as never) ?? 'plains');
    if (!cfg.vaults.some((v) => v.id === vault.id)) cfg.vaults.push(vault);
    await saveConfig(cfg);
    return vault;
  });

  app.delete('/api/vaults/:vaultId', async (req) => {
    const { vaultId } = req.params as { vaultId: string };
    const cfg = await loadConfig();
    cfg.vaults = cfg.vaults.filter((v) => v.id !== vaultId);
    await saveConfig(cfg);
    return { ok: true };
  });

  app.get('/api/note/:vaultId', async (req, reply) => {
    const { vaultId } = req.params as { vaultId: string };
    const rel = (req.query as { path?: string }).path;
    const cfg = await loadConfig();
    const vault = cfg.vaults.find((v) => v.id === vaultId);
    if (!vault || !rel) return reply.code(404).send({ error: 'not found' });
    const rootAbs = path.resolve(vault.path);
    const abs = path.resolve(vault.path, rel);
    if (!abs.startsWith(rootAbs + path.sep)) return reply.code(400).send({ error: 'invalid path' });
    try {
      return { markdown: await readFile(abs, 'utf8') };
    } catch {
      return reply.code(404).send({ error: 'note not found' });
    }
  });

  const broadcast = (msg: unknown): void => {
    const s = JSON.stringify(msg);
    for (const sock of sockets) if (sock.readyState === 1) sock.send(s);
  };

  return { app, broadcast };
}
```

注：`ws` 是 `@fastify/websocket` 的传递依赖，其类型若未随包暴露则 `npm i -D @types/ws` 或将 `WebSocket` 类型改为 `{ readyState: number; send(s: string): void; on(ev: string, fn: () => void): void }` 结构类型。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- server && npm run typecheck`
Expected: 4 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts tests/server.test.ts
git commit -m "$(cat <<EOF
feat: fastify REST API with vault CRUD, city model and note endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 10: 文件监听

**Files:**
- Create: `src/server/watcher.ts`, `tests/watcher.test.ts`

**Interfaces:**
- Consumes: `VaultConfig[]`。
- Produces: `watchVaults(vaults: {id: string; path: string}[], onChange: (vaultId: string) => void, debounceMs?: number): FSWatcher[]`——仅 `.md` 变更触发，按 vault 防抖（默认 500ms）。

- [ ] **Step 1: 写失败测试** `tests/watcher.test.ts`

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchVaults } from '../src/server/watcher.js';

describe('watchVaults', () => {
  it('md 变更触发防抖回调', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'noto-watch-'));
    const events: string[] = [];
    const watchers = watchVaults([{ id: 'v1', path: dir }], (id) => events.push(id), 100);
    await new Promise((r) => setTimeout(r, 300)); // 等 watcher 就绪
    await writeFile(path.join(dir, 'a.md'), '# 新笔记');
    await writeFile(path.join(dir, 'b.txt'), '非 md 不触发');
    await new Promise((r) => setTimeout(r, 800));
    expect(events).toEqual(['v1']);
    await Promise.all(watchers.map((w) => w.close()));
  }, 10_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- watcher`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** `src/server/watcher.ts`

```ts
import chokidar, { type FSWatcher } from 'chokidar';

export function watchVaults(
  vaults: { id: string; path: string }[],
  onChange: (vaultId: string) => void,
  debounceMs = 500,
): FSWatcher[] {
  return vaults.map((v) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = chokidar.watch(v.path, {
      ignored: /(^|[/\\])\./,
      ignoreInitial: true,
      depth: 12,
    });
    watcher.on('all', (_event, p) => {
      if (!p.endsWith('.md')) return;
      clearTimeout(timer);
      timer = setTimeout(() => onChange(v.id), debounceMs);
    });
    return watcher;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- watcher && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/watcher.ts tests/watcher.test.ts
git commit -m "$(cat <<EOF
feat: debounced per-vault markdown file watcher

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

### Task 11: 服务入口与端到端冒烟

**Files:**
- Create: `src/server/index.ts`
- Modify: `package.json`（无需改动 scripts，`dev` 已指向入口）

**Interfaces:**
- Consumes: Task 8/9/10 全部产出。
- Produces: `npm run dev` 起服务于 `http://localhost:4777`；watcher 变更时向所有 WS 客户端广播 `{type: 'city-updated', vaultId}`。

- [ ] **Step 1: 实现** `src/server/index.ts`（入口为组装代码，无独立单测，由下方冒烟验证）

```ts
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { watchVaults } from './watcher.js';

const PORT = Number(process.env.NOTOPOLIS_PORT ?? 4777);

const { app, broadcast } = await createServer();
const cfg = await loadConfig();
watchVaults(cfg.vaults, (vaultId) => broadcast({ type: 'city-updated', vaultId }));

await app.listen({ port: PORT });
console.log(`Notopolis server: http://localhost:${PORT}`);
console.log(`已加载 ${cfg.vaults.length} 个 vault（新增 vault 后需重启以生效监听）`);
```

- [ ] **Step 2: 全量回归**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 3: 真实 vault 端到端冒烟**

```bash
npm run dev &
sleep 2
curl -s -X POST http://localhost:4777/api/vaults \
  -H 'content-type: application/json' \
  -d '{"name":"Notes","path":"/Users/xueqiang/Documents/Obsidian/Notes","theme":"plains"}'
curl -s http://localhost:4777/api/world
curl -s "http://localhost:4777/api/city/$(curl -s http://localhost:4777/api/world | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).vaults[0].id))')" | head -c 600
kill %1
```

Expected: world 返回真实 vault 摘要（noteCount > 0, ok: true）；city 返回含 districts/roads 的 JSON。若 `ok: false` 且 reason 含 `EPERM`——即 TCC 拦截，属预期降级路径，记录现象，提示授权后重试。

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "$(cat <<EOF
feat: server entrypoint wiring config, watcher and websocket broadcast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

---

## 计划外（Plan 2 预告，勿在本计划实现）

前端计划（Vite + Three.js）将消费本计划产出的 `/api/world`、`/api/city/:id`、`/api/note/:id?path=`、`/ws`，实现世界地图、城区渲染（新鲜度/施工位/市民/区府）、信息卡与首启配置页。`src/shared/types.ts` 为前后端共享契约。
