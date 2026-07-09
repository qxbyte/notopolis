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

/** 入城快照（F3 变化摘要基线）——存于 <configDir>/snapshots/<vaultId>.json */
export interface CitySnapshot {
  visitedAt: number;
  notes: Record<string, { mtimeMs: number; openTasks: number; landmark: boolean }>;
}

/** 自上次到访以来的变化 */
export interface CityDiff {
  firstVisit: boolean;
  lastVisitAt: number | null;
  created: { path: string; title: string }[];
  updated: { path: string; title: string }[];
  removed: { path: string; title: string }[];
  newLandmarks: { path: string; title: string }[];
  tasksDone: number;
  tasksAdded: number;
}
