# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev        # 启动服务（tsx 直跑 src/server/index.ts），默认 http://localhost:4777
npm run dev:web    # 仅前端热更（Vite dev server, 5173，/api 与 /ws 代理到 4777）
npm run build      # 构建前端到 web/dist（服务端无需构建，tsx 直跑）
npm test           # vitest 全量单测（tests/ + web/tests/）
npx vitest run tests/rag-chunker.test.ts   # 跑单个测试文件
npm run typecheck  # 服务端 tsc；前端另跑 npx tsc --noEmit -p web/tsconfig.json
npm run e2e        # Playwright 冒烟（自起 4777 服务；若 4777 被开发服务占用，
                   # 需临时复制 playwright.config.ts 改用其他端口跑）
```

- 运行时配置存 `~/.notopolis/`（`NOTOPOLIS_CONFIG_DIR` 可覆盖，测试即用此方式指向 mkdtemp 临时目录）；端口用 `NOTOPOLIS_PORT` 覆盖。
- 前端测试文件需首行 `// @vitest-environment jsdom`；服务端路由测试用 Fastify `app.inject`（不真开端口），fixture vault 在 `tests/fixtures/vault-a`。

## 架构

把本地 Obsidian vault 渲染成手绘风 2D 城市（笔记=建筑、顶层目录=城区），并带向量检索知识库（RAG）。前后端仅通过 REST + WebSocket 交互，共享类型在 `src/shared/types.ts`（前端以 `@shared` 别名引用，vite 与 web/tsconfig 各配了一份）。

### 服务端 `src/server/`（Fastify + TS ESM，tsx 直跑）

- 数据流：`scanner.ts` 扫 vault → `parse.ts`（gray-matter）出 NoteMeta → `graph.ts` 链接图 → `layout/` 纯函数布局引擎生成 CityModel → `server.ts` REST 输出；`watcher.ts`（chokidar）文件变更 → WS 广播 `city-updated` → 前端整城重建。
- **确定性铁律**：布局/地貌全部由 vault 路径种子化（`layout/rng.ts` hashSeed），同库同城；服务端不得在布局路径中使用 `Date.now()`/`Math.random()`（`generatedAt` 参数传入）。
- 读写笔记（`/api/note`）与 RAG 入库都必须做路径穿越防护（`path.resolve` + `startsWith(root + sep)`），且只允许 vault 内已存在的 `.md`。

### RAG 子系统 `src/server/rag/`（详细设计文档在 Obsidian：07-Ideas/游戏/Notopolis/向量知识库/）

- 流水线：`chunker.ts` 清洗+标题感知切片（章节链/行号/hash）→ `embed.ts` OpenAI 兼容客户端（本地 Ollama / 云端 DashScope 同一实现，`fetchFn` 可注入供离线测试）→ `store.ts` 文件型向量库（`~/.notopolis/rag/<vaultId>/index.json` + `vectors.bin`，归一化点积精确检索，VectorStore 接口可换后端）→ `retriever.ts` BM25(`keyword.ts`)+向量 RRF 混合检索 → `answer.ts` 约束生成（强制引用/拒答）。
- 治理闭环：`indexer.ts`（文档 hash 版本管理、跳过未变更、单 vault 入库互斥任务）、`evaluate.ts`（recall@k/MRR/生成/引用四层指标）、`feedback.ts`（JSONL 反馈、差评导入评估集）。
- **松耦合铁律**：`rag.enabled=false`（缺省）时前端无任何 RAG 入口、原名称搜索行为不变；RAG 端点异常只返回 400/500 中文原因，绝不影响其他端点。apiKey 在 GET/PUT config 全程掩码往返（`ragconfig.ts`）。

### 前端 `web/src/`（Vite + 原生 TS + Canvas 2D，无 UI 框架）

- `main.ts` 视图路由（首页即 worldmap2d → cityview2d）+ 全局 Esc/⌘K + WS 重建恢复；`window.__notopolis` 挂调试钩子（e2e 依赖）。设置中心是 `ui/settingshub.ts` 弹窗（左菜单/右内容，面板：`ui/vaultpane.ts` 配置仓库、`ui/settings.ts` 配置模型；加新设置项 = 加菜单项 + pane 工厂），无仓库时自动弹出「配置仓库」，增删仓库后地图就地刷新不清浮层。
- `views/cityview2d.ts` 是城市视图的装配中心：相机/命中/透镜/搜索/各面板全在此接线。侧栏面板（工地/园丁/文书档案）共用 `ui/panel.ts` + `util/tree.ts` 目录树；浮层统一注册进 `ui/overlaystack.ts`（Esc 关最上层）。
- 面板、卡片、文书档案互斥收起；「常规」透镜按钮同时是文书档案面板（`ui/docpanel.ts`，入库按钮+印章标记）的开关。
- UI 风格：现代圆润（按钮胶囊、卡片/弹窗大圆角、软投影），颜色/形状只用 `ui/style.css` 的 CSS 设计令牌（--primary/--bg/--surface/--radius 等）；地图画布保持手绘风不动。**主题系统单一数据源**：`ui/theme.ts` 的 THEMES 数组（每主题一个 tokens 差异对象，applyTheme 运行时批量写 CSS 变量），加新主题只在该数组追加一条，ThemeId 自动派生，CSS 无需改动；style.css 的 :root 仅是与 BASE_TOKENS 同值的兜底。
- 纯逻辑放 `util/`（可单测），DOM 组件放 `ui/`，每个组件返回带 `dispose()` 的 handle 并在 cityview2d 的 dispose 中逐一清理。

## 约定

- 注释与 UI 文案用中文；模块头部写「职责一句话」注释。
- 新增配置字段一律做缺省值合并（旧 config.json 无缝升级），写盘用 tmp+rename 原子写。
