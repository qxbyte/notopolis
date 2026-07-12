export interface VaultConfig {
  id: string;
  name: string;
  path: string;
  theme: 'plains' | 'mountain' | 'harbor' | 'snow';
}

export interface AppConfig {
  vaults: VaultConfig[];
  rag?: RagConfig;
}

// ---------------------------------------------------------------------------
// RAG（向量检索）配置——存于 config.json 的 rag 字段；缺省时功能整体关闭，
// 不影响原有本地搜索（松耦合）。
// ---------------------------------------------------------------------------

/** OpenAI 兼容端点（本地 Ollama / 云端 DashScope compatible-mode 均适用） */
export interface RagEndpoint {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface RagConfig {
  /** 向量检索总开关：false 时前端不出现语义/问答入口，搜索完全走原逻辑 */
  enabled: boolean;
  embedding: {
    mode: 'local' | 'remote';
    local: RagEndpoint;
    remote: RagEndpoint;
  };
  /** 问答（生成）模型；mode 为 off 时问答功能隐藏 */
  chat: {
    mode: 'off' | 'local' | 'remote';
    local: RagEndpoint;
    remote: RagEndpoint;
  };
  retrieval: {
    /** 最终送入上下文的片段数上限 */
    topK: number;
    /** 向量余弦相似度阈值（低于此分数的召回丢弃） */
    minScore: number;
    /** 单文档最多贡献的片段数（防止一篇长文挤占全部上下文） */
    perDocLimit: number;
    /** 上下文字符预算（控制注意力，不让无关内容挤占） */
    maxContextChars: number;
    /** 混合检索：BM25 关键词 + 向量语义，RRF 融合重排 */
    hybrid: boolean;
  };
}

/** 单文档的向量索引状态（「常规」文档面板用） */
export type RagDocState = 'indexed' | 'stale' | 'none';

export interface RagDocStatus {
  path: string;
  title: string;
  state: RagDocState;
  chunkCount: number;
  indexedAt: number | null;
  model: string | null;
}

/** 入库任务进度（轮询用） */
export interface RagIndexProgress {
  running: boolean;
  total: number;
  done: number;
  skipped: number;
  current: string | null;
  errors: { path: string; reason: string }[];
  startedAt: number | null;
  finishedAt: number | null;
}

/** 向量库概览（向量库管理页 ① 库概览卡） */
export interface RagStats {
  docTotal: number;
  indexed: number;
  stale: number;
  none: number;
  chunkCount: number;
  dims: number;
  model: string | null;
  /** index.json + vectors.bin 磁盘占用（字节） */
  bytes: number;
  lastIndexedAt: number | null;
  /** 库记录模型 ≠ 当前配置模型（需重建） */
  modelMismatch: boolean;
}

/** 单文档切片信息（向量库管理页 ③ 切片检视） */
export interface RagChunkInfo {
  index: number;
  headings: string[];
  startLine: number;
  endLine: number;
  chars: number;
  hash: string;
  text: string;
}

/** 检索命中片段（语义搜索 / 问答证据共用） */
export interface RagHit {
  id: string;
  docPath: string;
  title: string;
  headings: string[];
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export interface RagAnswer {
  answer: string;
  refused: boolean;
  /** 答案中引用的证据序号（1-based，已过滤越界引用） */
  citations: number[];
  evidence: RagHit[];
  /** 生成约束校验警告（如：未附引用） */
  warning?: string;
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
  outlinks: Record<string, string[]>; // notePath -> 已解析的出链目标 notePath[]（去重、无自引用）
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
  outlinks: string[]; // 已解析的出链目标 notePath[]（F4 透镜/F6 漫游用）
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
