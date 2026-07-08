# Notopolis MVP 前端（Three.js 渲染层）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已验证的雏形渲染器（`prototype/public/index.html`，约 1700 行，全部视觉决策已经用户三轮打磨确认）移植为模块化 Vite + TypeScript 前端，消费后端 API（`/api/world`、`/api/city/:id`、`/api/note/:id`、`/ws`），并补齐雏形没有的首启配置页与多城邦世界地图。

**Architecture:** Vite（web/ 目录）+ three（npm 包 r160+，替换 CDN r147）。视图两层：世界地图（多 vault 城邦缩略）↔ 城市视图（单 vault 完整渲染）。WS 收到 `city-updated` 后重拉 CityModel 增量刷新。类型契约直接 import 后端 `src/shared/types.ts`。

**Tech Stack:** Vite ^5, TypeScript, three ^0.160, vitest（纯逻辑模块）, Playwright（冒烟，最后一个任务）。

**代码规范来源（最重要）：** `prototype/public/index.html` 是唯一视觉规范——移植时**参数值（颜色/尺寸/速度/阈值）必须原样保留**，只做结构化改造：
- 全局圆角化 SoftBox（RoundedBoxGeometry 子类，three r160 从 `three/examples/jsm/geometries/RoundedBoxGeometry.js` 导入）
- 世界种子 `hash('world:' + vaultPath)` 驱动一切地貌（河/山/运河/湖/植被/人群）
- 偏写实沙盘配色 + NoToneMapping + 草坪条纹 + 假 AO
- 建筑 7 基础档案 + 7 公共设施；新鲜度/施工/地标/区府状态层
- 市民（男女老幼/肤色/发型/手脚摆动）、交通（车+红绿灯/自行车/火车/飞机/船）、蜿蜒小路、桥、不规则湖泊
- **一处必须适配**：雏形的街区是矩形 plate，正式版 `District.polygon` 是不规则多边形 → 用 `THREE.Shape` + `ExtrudeGeometry`(depth 0.5) 生成地块，道路/主街端点仍用 bbox 中线（视觉可接受）

## Global Constraints

- 移植不是重写：逐段对照雏形，参数值原样保留；发现雏形 bug 先记录再修，不静默偏离
- 前端不重复实现布局：一切几何布局来自 CityModel JSON；前端只做「渲染时状态」（新鲜度 = now − mtimeMs 实时算）
- 纯逻辑模块（api client、seed rng、noise、polyline 工具）配 vitest 单测；渲染模块以「场景对象计数 + 无异常」为最低验证，视觉验收靠人
- commit 规范同后端：HEREDOC 双 Co-Authored-By，第一行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`，第二行实时取 git config
- dev 工作流：`npm run dev`（后端 4777）+ `npm run dev:web`（Vite 5173，proxy /api 与 /ws → 4777）

## 文件结构

```
web/
├── index.html                     # 挂载点 + HUD/卡片/提示 DOM（移植雏形 CSS）
├── vite.config.ts                 # root=web, proxy /api /ws → 4777, alias @shared → ../src/shared
└── src/
    ├── main.ts                    # 启动：读配置状态 → 首启页 或 世界地图；视图切换
    ├── api.ts                     # REST client + WS client（重连 + city-updated 回调）
    ├── util/seed.ts               # hashStr/rng0/mulberry32（纯函数，vitest）
    ├── util/noise.ts              # ih/vnoise/fbm（纯函数，vitest）
    ├── util/poly.ts               # polyAt/polyDist/segHit/lakeShapeR（纯函数，vitest）
    ├── scene/setup.ts             # renderer/scene/lights/SoftBox 全局圆角化
    ├── scene/camera.ts            # 自由轨道（左键平移/右键旋转俯仰/滚轮缩放）
    ├── world/params.ts            # 世界种子 → 河/山/运河/湖参数（纯函数，vitest）
    ├── world/terrain.ts           # 地形网格 + 顶点色（草坪条纹/沙滩/岩雪）
    ├── world/water.ts             # 河/运河/湖/池塘（不规则岸线 + 坡道汇入）+ 桥
    ├── world/vegetation.ts        # 树林/散生树/巨石/云
    ├── city/districts.ts          # polygon → Shape/Extrude 地块 + 公园/池塘/灌木花丛
    ├── city/roads.ts              # 折线分段道路 + 红绿灯（对象与状态机）
    ├── city/buildings.ts          # 14 种建筑档案 + AO + 状态层（窗/烟/苔/脚手架）
    ├── agents/citizens.ts         # 人物生成器 + 行走/闲逛/摆肢
    ├── agents/vehicles.ts         # 车/公交/自行车/火车+铁轨/飞机/船
    ├── ui/hud.ts                  # 统计条 + 悬浮标签
    ├── ui/cards.ts                # 建筑信息卡/街区总览卡 + obsidian:// 跳转
    ├── ui/onboarding.ts           # 首启配置页（vault 增删 + 主题选择）
    └── views/worldmap.ts          # 多城邦世界地图（tier 缩略 + 点击进城）
```

## 任务列表（每任务 = 独立可验证交付）

### Task F1: web 脚手架 + 空场景渲染
**Files:** `web/index.html`, `web/vite.config.ts`, `web/src/main.ts`, `web/src/scene/setup.ts`, package.json（加 three/vite/依赖与 dev:web script）
**Interfaces:** Produces `createScene(container): { scene, renderer, tick(cb) }`，SoftBox 全局替换生效。
**验证:** `npm run dev:web` 启动，浏览器出天空色空场景 + 一个测试圆角盒；`npx tsc --noEmit`（web tsconfig）通过。commit。

### Task F2: 纯工具模块移植（TDD）
**Files:** `web/src/util/{seed,noise,poly}.ts` + `web/tests/util.test.ts`
**Interfaces:** 与雏形同名函数逐一导出；vitest 断言：同种子同序列、fbm 值域、polyAt 端点/中点、segHit 相交/平行、lakeShapeR 周期性。
**来源:** 雏形 rng0/hashStr（~L86-90）、ih/vnoise/fbm（噪声段）、polyAt/polyDist/segHit/lakeShapeR。commit。

### Task F3: API client + WS（TDD）
**Files:** `web/src/api.ts` + `web/tests/api.test.ts`
**Interfaces:** `fetchWorld() / fetchCity(id) / fetchNote(id, path) / addVault(...) / removeVault(id) / connectWS(onCityUpdated)`（指数退避重连，mock fetch/WebSocket 测试）。类型 import 自 `@shared/types`。commit。

### Task F4: 世界参数 + 地形 + 水系 + 桥
**Files:** `web/src/world/{params,terrain,water}.ts`
**Interfaces:** `worldParams(vaultPath, cityBBox)` 返回 { riverU/riverWorld/riverDist, MA 山脉向, canalPts/canalY, lakes }（纯函数，vitest 确定性断言）；`buildTerrain(scene, params)`、`buildWater(scene, params, roads)`（含桥）。
**来源:** 雏形世界种子段 + terrainH + buildTerrain/buildRiver/buildCanal/buildBridges/湖泊段，参数原样。城市 bbox 由 CityModel districts 推导。commit。

### Task F5: 街区（polygon 地块）+ 道路 + 红绿灯
**Files:** `web/src/city/{districts,roads}.ts`
**Interfaces:** `buildDistricts(scene, city)` 用 District.polygon 建 Shape/Extrude 地块（hue 同雏形 hashStr 公式）+ 公园/池塘/灌木花丛；`buildRoads(scene, city)` 返回 { walkables, trafficLights, roadMeshes }——弯曲小路预处理（r.pts/lens/total）与红绿灯（segHit 交点 + lightGreen 状态机）逻辑照搬。commit。

### Task F6: 建筑档案库
**Files:** `web/src/city/buildings.ts`
**Interfaces:** `buildBuildings(scene, city, now)` → { pickables, glowWindows, smokes, windmills }。14 档案 + prismGeo + addWindows/addChimney + AO 圈 + dormant/active 状态，参数原样。commit。

### Task F7: 市民 + 交通工具
**Files:** `web/src/agents/{citizens,vehicles}.ts`
**Interfaces:** `spawnCitizens(scene, city, walkables, idleSpots)` / `spawnVehicles(scene, city, params, walkables)`；各返回 `update(t)`。人物生成器（性别/年龄/肤色/发型/手脚）与全部载具（含红灯停车、铁轨、螺旋桨）照搬。commit。

### Task F8: 相机 + 拾取 + 信息卡 + HUD
**Files:** `web/src/scene/camera.ts`, `web/src/ui/{hud,cards}.ts`
**Interfaces:** `createCamera(dom, worldR, T)`（方向跟随朝向的平移，15°–75° 俯仰钳制）；raycast 拾取 → 悬浮标签 / 建筑卡（含 obsidian:// 跳转，vaultPath 来自 world 数据）/ 区府点击出街区总览卡。commit。

### Task F9: 首启配置页 + 世界地图视图 + 视图编排
**Files:** `web/src/ui/onboarding.ts`, `web/src/views/worldmap.ts`, `web/src/main.ts`（完善）
**Interfaces:** 无 vault → 配置页（路径输入 + 城邦名 + 4 主题选择 + 增删列表 + 「奠基建城」）；有 vault → 世界地图（按 tier 渲染营地/村镇/城市/都城缩略 + ok:false 迷雾态 + 商路虚线装饰），点击城邦 → 加载 CityModel 进城市视图（Esc/按钮返回）；WS city-updated → 若当前城受影响则重拉重建（简单全量重建，动画二期）。commit。

### Task F10: 静态托管 + Playwright 冒烟 + 收尾
**Files:** `src/server/index.ts`（追加 web/dist 静态托管，@fastify/static）、`playwright.config.ts`、`tests/e2e/smoke.spec.ts`、package.json scripts（build/e2e）
**验证:** `vite build` 后 `npm run dev` 单进程可用；Playwright：注册 fixture vault → 世界地图出现 1 城 → 点击进城 → canvas 存在且 pickables>0（暴露 window.__notopolis 调试钩子）→ 点击建筑出卡片。全量 npm test 回归。commit。

## 自查清单（对照设计文档）
一期范围全部覆盖：配置页/多 vault/世界地图/单城渲染（街区/建筑/道路/新鲜度/施工/市民/区府）/信息卡/跳 Obsidian/文件监听实时更新 ✓；抽屉全文、搜索飞行、跨 vault 商路数据化、昼夜、时间轴 → 二期不做。
