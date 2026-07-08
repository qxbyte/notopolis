# Notopolis 渲染层重构：手绘涂鸦 2D（doodle-slam 风）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 Canvas 2D 手绘涂鸦渲染层整体替换 Three.js 渲染层。后端、CityModel、API client、配置页/信息卡 DOM 全部保留。性能目标：685 篇城市稳定 60fps（静态世界离屏一次绘制，每帧只 blit + 动态小件），万篇级不劣化。

**Architecture:** `web/src/render2d/` 新渲染层：sketch 手绘原语（自 doodle-slam 移植）→ painter 注册表（grounds/features 插件式）→ 离屏静态世界图（种子随机，分块 tile 支持超大城）→ camera2d 视口变换 → dynamic 层（市民/车/烟每帧矢量绘制）→ hit 模型坐标命中测试。三大视图（onboarding 复用 / worldmap2d / cityview2d）。**Three.js 渲染层整体删除**（git 历史保留），依赖里移除 three。

**画风参照（唯一视觉规范）：** `/Users/xueqiang/Git/doodle-slam/js/core/sketch.js`（wobblyPath/wobblyRect/wobblyCircle/hatchRect/scribbleBlob/withInkSilhouette + palette）与 `js/world/render.js` 注册表架构、`js/world/themes/city.js` 的城市主题画法。移植为 TypeScript，算法与手感参数保持。

## Global Constraints

- 确定性：一切静态美术用 `rng0(seed)` 种子随机（与 CityModel 确定性同源）；动态动画用时间参数；禁 Math.random
- **不渲染链接路**（street kind 不画）；市民/载具活动网 = main + avenue + 公园广场；自行车挪到 avenue
- 新鲜度墨色浓淡、施工虚线、地标/区府差异化必须保留（设计文档 3.2 v2 映射表达）
- 离屏世界图分辨率 8px/世界单位，超过 4096px 时切 tile（2048 一块）
- vitest 覆盖纯逻辑（hit 测试/坐标变换/painter 数据准备）；e2e 冒烟改为 2D 断言（canvas 存在 + pickables>0 + 点击出卡）
- commit：HEREDOC 双署名，第一行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 任务列表

### Task R1: sketch 原语移植 + 纸面调色板
Files: `web/src/render2d/sketch.ts`, `web/tests/sketch.test.ts`
从 doodle-slam sketch.js 移植：wobblyPath/wobblyRect/wobblyCircle/hatchRect/scribbleBlob/withInkSilhouette（ctx 显式传参、rng 显式传参、TS 类型化）；Notopolis 纸面调色板（纸底 #f6f1e3、墨线 #3a3428、街区粉彩系、水 #7ab8d4、活跃墨 #2e2a26 / 沉睡墨 #b8b0a0）。测试：确定性（同 rng 序列同路径点）、wobble 幅度界。commit。

### Task R2: camera2d + 离屏世界图管理 + 命中测试（TDD）
Files: `web/src/render2d/camera2d.ts`, `web/src/render2d/worldcanvas.ts`, `web/src/render2d/hit.ts`, `web/tests/render2d-core.test.ts`
camera2d：世界坐标↔屏幕坐标（pan 左键拖拽/滚轮缩放 0.3–6 倍/边界钳制）、`apply(ctx)` 设置变换。worldcanvas：给定世界 bbox 创建离屏 canvas（8px/单位，>4096 tile 化），`paint(fn)` 一次性绘制，`blit(ctx, camera)`。hit：`hitTest(x, y, items: HitItem[]): HitItem | null`（HitItem = { kind, bounds 圆或矩形, data }，倒序命中最上层）。三模块全 TDD（jsdom + OffscreenCanvas/mock ctx）。commit。

### Task R3: 城市静态画师（世界→纸面）
Files: `web/src/render2d/painters/{terrain,district,road,water,building}.ts`, `web/src/render2d/citypainter.ts`, `web/tests/citypainter.test.ts`
citypainter 编排：纸底+轻噪点 → 山脉笔触（worldParams 的山向带手绘峰线）→ 河/运河/湖（涂鸦水面+抖动岸线+桥=两道横线+排线板）→ 街区多边形粉彩补丁（wobbly 描边，hue 沿用 hashStr 公式映射到粉彩系）→ 主街/大道（双线夹排线，**不画 street**）→ 公园（scribble 绿团+池塘）→ 建筑（俯视手绘：体量→尺寸，屋顶用 roofPalette 粉彩化；地标=更大+旗帜涂鸦；区府=徽记图章+广场圈；新鲜度=墨色浓淡 lerp(活跃墨,沉睡墨,age)；施工=虚线轮廓+斜排线）→ 树木涂鸦。产出同时返回 HitItem[]（建筑圆形命中区 + 街区多边形 bbox）。测试：给 fixture CityModel 断言 HitItem 数量与坐标、painter 不抛异常（mock ctx 记录调用数>阈值）。commit。

### Task R4: 动态层（市民/载具 2D 涂鸦化）
Files: `web/src/render2d/dynamic.ts`, `web/tests/dynamic2d.test.ts`
每帧矢量绘制：市民=火柴人涂鸦（头圆+身线+摆动四肢，性别裙线/老人拐杖/小孩矮，肤色发色沿用色板），沿 main/avenue 折线 polyAt 行走（复用 util/poly）+ 公园闲逛；车/公交=俯视小方块车（红灯停车沿用 lightGreen——红绿灯画成路口小圆点三色）；火车沿环线；船在河上；飞机=小涂鸦剪影+虚线航迹。数量规则沿用（activeCount7d）。测试：位置确定性、红灯锁定。commit。

### Task R5: 视图接线 + Three 渲染层退役
Files: `web/src/views/{cityview2d,worldmap2d}.ts`, `web/src/main.ts`, 删除 `web/src/scene/ web/src/world/ web/src/city/ web/src/agents/ web/src/views/{cityview,worldmap}.ts`, package.json 移除 three/@types/three
cityview2d：fetchCity → worldParams（复用，纯数据）→ citypainter 离屏绘制 → 主循环（blit + dynamic + HUD）→ hit 点击出卡（cards 复用）→ perf() 探针（帧时间 + 静态图绘制耗时）。worldmap2d：羊皮纸底 + 城邦图章（tier 大小/迷雾灰调）+ 虚线商路 + 点击进城。main.ts 换 import。__notopolis 钩子保留（pickables=HitItem 数、enterCity、pickBuilding→出卡）。npm test 全绿 + tsc 零错误 + build。commit。

### Task R6: e2e 更新 + 性能验证 + 收尾
Files: `tests/e2e/smoke.spec.ts`, `scripts/perf-measure.mjs`（改读 2D perf）
e2e：断言链适配 2D（view 状态机不变）。性能实测：Notes 685 篇城 avgMs < 8ms（无头下限宽些：< 25ms）并记录进报告。vitest 全量回归。删除 vitest 中随 three 模块失效的测试（world-params 保留——params 仍在用）。commit。

## 自查
- 保留：后端全部、api.ts、util/*、ui/{style,hud,cards,onboarding}、world/params（数据用）
- 删除：three 相关 scene/world(除 params)/city/agents/旧 views；plan 2026-07-09-perf-draw-call-reduction.md 移入 docs 存档（标注未执行原因）
- 不渲染链接路已贯穿 R3/R4
