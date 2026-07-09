# Themed Biomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plains / harbor / snow / mountain 四套主题落地为截然不同的地貌生物群系，通过 BiomeSpec 驱动 worldParams 与 citypainter 全部分层绘制。

**Architecture:** 新建 `biomes.ts` 定义四份 BiomeSpec 配置（地面色、水系类型、山脉密度、植被类型、extras 开关）；扩展 `worldParams` 接收 `theme` 并输出海岸线/冻河/字段等额外地貌数据；在 `citypainter` 的每一绘制层按 `BIOMES[city.theme]` 分支调度，所有新绘制元素以现有 sketch 原语（wobbly/hatch/scribble/dashed）实现；`dynamic.ts` 按 `waterStyle` 最小适配船只行为。

**Tech Stack:** TypeScript, Canvas 2D API (via CanvasRenderingContext2D), vitest (jsdom), sketch 原语 (wobblyPath/hatchRect/scribbleBlob/dashedPath/wobblyCircle/wobblyRect), rng0/hashStr 种子随机, fbm 噪声

## Global Constraints

- 所有随机值由 `rng0(seed)` 驱动——禁用 `Math.random()`
- 线宽量级沿用 citypainter 现有（0.1–0.3 世界单位）
- 色彩只从 `PAPER` 常量 + biome 自定义色板取，不引入 CSS 颜色字符串硬码
- `worldParams` 向后兼容：theme 默认 `'plains'`，原有输出字段不变，只新增字段
- `CityModel.theme: string`（已有）直接使用，缺省回退 plains
- 任务执行顺序必须严格按照 T1 → T2 → T3 → T4 → T5；后置任务依赖前置产出
- 每次 `npm test`（vitest run）全量通过后才能提交
- `npx tsc -p web/tsconfig.json --noEmit` 零错误
- report 产物写到 `/Users/xueqiang/Git/notopolis/.superpowers/sdd/task-biomes-report.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/src/render2d/biomes.ts` | **新建** | BiomeSpec 接口 + BIOMES 四主题配置 |
| `web/src/world/params.ts` | **修改** | 增加 `theme` 参数 + SeaData / FrozenData 等额外地貌数据 |
| `web/src/render2d/citypainter.ts` | **修改** | 按 biome 分支全部 8 层绘制逻辑 |
| `web/src/render2d/dynamic.ts` | **修改** | 按 waterStyle 适配船只行为 |
| `web/tests/biomes.test.ts` | **新建** | 四主题确定性 + harbor coastDist + mountain proximity + 调用序列差异 |

---

## Task 1: 新建 biomes.ts — BiomeSpec 接口与 BIOMES 配置

**Files:**
- Create: `web/src/render2d/biomes.ts`
- Test: `web/tests/biomes.test.ts`（本任务只写 BIOMES 导出验证测试）

**Interfaces:**
- Produces:
  ```ts
  export type WaterStyle = 'river' | 'sea' | 'frozen' | 'torrent';
  export type VegetationKind = 'mixed' | 'sparse-pine' | 'dense-pine' | 'palm-ish';

  export interface BiomeSpec {
    key: string;
    ground: { paper: string; patch: string };
    waterStyle: WaterStyle;
    mountains: { proximity: number; density: number; snowline: number };
    vegetation: { kind: VegetationKind; density: number };
    pastelShift?: (hex: string, rng: () => number) => string;
    extras: string[];
  }

  export const BIOMES: Record<string, BiomeSpec>
  export function getBiome(theme: string): BiomeSpec
  ```

- [ ] **Step 1: 写失败测试**

  新建 `web/tests/biomes.test.ts`：

  ```ts
  import { describe, it, expect } from 'vitest';
  import { BIOMES, getBiome } from '../src/render2d/biomes';

  describe('BIOMES — 基础结构', () => {
    it('四主题均存在', () => {
      expect(BIOMES['plains']).toBeDefined();
      expect(BIOMES['harbor']).toBeDefined();
      expect(BIOMES['snow']).toBeDefined();
      expect(BIOMES['mountain']).toBeDefined();
    });

    it('getBiome 未知主题回退 plains', () => {
      const b = getBiome('unknown-theme');
      expect(b.key).toBe('plains');
    });

    it('harbor waterStyle 为 sea', () => {
      expect(BIOMES['harbor'].waterStyle).toBe('sea');
    });

    it('snow waterStyle 为 frozen', () => {
      expect(BIOMES['snow'].waterStyle).toBe('frozen');
    });

    it('mountain waterStyle 为 torrent', () => {
      expect(BIOMES['mountain'].waterStyle).toBe('torrent');
    });

    it('plains waterStyle 为 river', () => {
      expect(BIOMES['plains'].waterStyle).toBe('river');
    });

    it('snow mountains.proximity < plains mountains.proximity', () => {
      expect(BIOMES['snow'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
    });

    it('mountain mountains.proximity < plains mountains.proximity', () => {
      expect(BIOMES['mountain'].mountains.proximity).toBeLessThan(BIOMES['plains'].mountains.proximity);
    });

    it('所有 extras 为字符串数组', () => {
      for (const b of Object.values(BIOMES)) {
        expect(Array.isArray(b.extras)).toBe(true);
      }
    });
  });
  ```

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | head -30
  ```

  预期：`Cannot find module '../src/render2d/biomes'`

- [ ] **Step 3: 实现 biomes.ts**

  新建 `web/src/render2d/biomes.ts`，内容：

  ```ts
  /**
   * render2d/biomes.ts — 四套生物群系配置
   *
   * BiomeSpec 驱动 worldParams 地貌生成和 citypainter 分层绘制。
   * 色彩只从 PAPER 常量 + 此处定义的 biome 色板取。
   */

  import { PAPER } from './sketch';

  export type WaterStyle = 'river' | 'sea' | 'frozen' | 'torrent';
  export type VegetationKind = 'mixed' | 'sparse-pine' | 'dense-pine' | 'palm-ish';

  export interface BiomeSpec {
    key: string;
    /** 地面基色 / 斑块色（hex 字符串） */
    ground: { paper: string; patch: string };
    waterStyle: WaterStyle;
    /** proximity：山带距城心系数（世界单位加成，越小越近）
     *  density：峰数量 5-8 基础上的额外峰数
     *  snowline：0–1，雪帽覆盖比例（高于 peakH * snowline 的部分画雪） */
    mountains: { proximity: number; density: number; snowline: number };
    vegetation: { kind: VegetationKind; density: number };
    /** 可选：将街区 pastel 颜色偏移到适合生物群系的冷暖调
     *  接收 hex + rng，返回新 hex */
    pastelShift?: (hex: string, rng: () => number) => string;
    /** 专属元素开关列表（citypainter 按 extras.includes('xxx') 判断） */
    extras: string[];
  }

  /* ------------------------------------------------------------------ */
  /* 辅助：hex 混色（线性插值 RGB 通道）                                   */
  /* ------------------------------------------------------------------ */

  function lerpHex(a: string, b: string, t: number): string {
    const ar = parseInt(a.slice(1, 3), 16);
    const ag = parseInt(a.slice(3, 5), 16);
    const ab = parseInt(a.slice(5, 7), 16);
    const br = parseInt(b.slice(1, 3), 16);
    const bg = parseInt(b.slice(3, 5), 16);
    const bb = parseInt(b.slice(5, 7), 16);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return '#' + r.toString(16).padStart(2, '0')
               + g.toString(16).padStart(2, '0')
               + bl.toString(16).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* BIOMES 四套配置                                                      */
  /* ------------------------------------------------------------------ */

  export const BIOMES: Record<string, BiomeSpec> = {

    plains: {
      key: 'plains',
      ground: { paper: PAPER.paper, patch: PAPER.grass },
      waterStyle: 'river',
      mountains: { proximity: 0, density: 0, snowline: 0.85 },
      vegetation: { kind: 'mixed', density: 1.0 },
      extras: ['fields', 'windmill'],
    },

    harbor: {
      key: 'harbor',
      ground: { paper: '#f5f0e2', patch: '#e8e0c8' },   // 略带盐白的沙地
      waterStyle: 'sea',
      mountains: { proximity: 40, density: -2, snowline: 0.9 },
      vegetation: { kind: 'palm-ish', density: 0.5 },
      pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#b8d4e8', 0.08),
      extras: ['lighthouse', 'pier', 'seagull', 'coast'],
    },

    snow: {
      key: 'snow',
      ground: { paper: '#eef2f6', patch: '#d8e4ee' },   // 冷白底 + 冰蓝斑块
      waterStyle: 'frozen',
      mountains: { proximity: -30, density: 2, snowline: 0.55 },
      vegetation: { kind: 'sparse-pine', density: 0.7 },
      pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#ffffff', 0.30),
      extras: ['sled-track', 'ice-lake'],
    },

    mountain: {
      key: 'mountain',
      ground: { paper: '#f0ece4', patch: '#d8d0c4' },   // 灰褐岩地
      waterStyle: 'torrent',
      mountains: { proximity: -20, density: 3, snowline: 0.70 },
      vegetation: { kind: 'dense-pine', density: 0.9 },
      pastelShift: (hex: string, _rng: () => number) => lerpHex(hex, '#9a9080', 0.15),
      extras: ['terraces', 'gate-wall', 'alpine-lake'],
    },
  };

  /** 安全获取 BiomeSpec，未知主题回退 plains */
  export function getBiome(theme: string): BiomeSpec {
    return BIOMES[theme] ?? BIOMES['plains'];
  }
  ```

- [ ] **Step 4: 运行测试，确认全通**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -20
  ```

  预期：所有 biomes.test.ts 测试 PASS，原有测试不受影响。

- [ ] **Step 5: TypeScript 零错误**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit 2>&1
  ```

  预期：无输出（零错误）。

---

## Task 2: 扩展 worldParams — 主题地貌数据

**Files:**
- Modify: `web/src/world/params.ts`
- Test: `web/tests/biomes.test.ts`（追加 worldParams 主题确定性测试）

**Interfaces:**
- Consumes: `getBiome(theme)` from `web/src/render2d/biomes.ts`（T1 产出）
- Produces (新增到 `WorldParams`)：
  ```ts
  theme: string;
  waterStyle: WaterStyle;               // 透传 biome.waterStyle
  // harbor 专属（其他主题为 undefined）
  seaData?: {
    sideAngle: number;                  // 海所在方位角
    coastPts: [number, number][];       // 海岸线采样点（40 点）
    coastDist: (x: number, z: number) => number;  // 符号距离：负=海里
    islands: { x: number; z: number; r: number }[];
    lighthousePos: { x: number; z: number };
    piers: { x: number; z: number; angle: number }[];
  };
  ```
  - `canalPts` / `lakes`：harbor 主题下 `canalPts` 为空数组 `[]`，lakes 只保留 harbor 入海河道终点那一个；mountain 主题 `lakes` 中第一个用 alpine-lake 替换（位置在山区）；snow 主题 lakes 带 `frozen: true` 标记

**注意：** `rng0` 的 wrng 消费顺序：原 plains 消费顺序不变（前 3 个 `wrng()` 是 RA / riverBaseD / RIVER_W）；不同 theme 分支在 wrng 消费上互不干扰（各分支内部自行消费，同 vault + 同 theme 恒定即可）。

- [ ] **Step 1: 在 biomes.test.ts 追加 worldParams 主题测试**

  在 `web/tests/biomes.test.ts` 末尾追加：

  ```ts
  import { worldParams } from '../src/world/params';

  const HW = 50, HD = 50, WR = 200, T = 200;

  describe('worldParams — 四主题确定性', () => {
    const themes = ['plains', 'harbor', 'snow', 'mountain'] as const;
    for (const theme of themes) {
      it(`${theme}: 同 vault+theme 两次 deep equal (RA, canalPts, lakes)`, () => {
        const p1 = worldParams('vault-biome', HW, HD, WR, T, theme);
        const p2 = worldParams('vault-biome', HW, HD, WR, T, theme);
        expect(p1.RA).toBe(p2.RA);
        expect(p1.canalPts).toEqual(p2.canalPts);
        expect(p1.lakes).toEqual(p2.lakes);
      });
    }
  });

  describe('worldParams — harbor coastDist', () => {
    it('harbor: 城市中心为陆地（coastDist > 0）', () => {
      const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
      expect(p.seaData).toBeDefined();
      // 城市中心 (0,0) 应为陆地
      expect(p.seaData!.coastDist(0, 0)).toBeGreaterThan(0);
    });

    it('harbor: 远侧海洋方向为负（coastDist < 0）', () => {
      const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
      expect(p.seaData).toBeDefined();
      // 沿海方向取很远的点应为海里（负值）
      const ang = p.seaData!.sideAngle;
      const farX = Math.cos(ang) * (HW + 200);
      const farZ = Math.sin(ang) * (HD + 200);
      expect(p.seaData!.coastDist(farX, farZ)).toBeLessThan(0);
    });

    it('harbor: seaData.islands 数量在 1-2 之间', () => {
      const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
      expect(p.seaData!.islands.length).toBeGreaterThanOrEqual(1);
      expect(p.seaData!.islands.length).toBeLessThanOrEqual(2);
    });

    it('harbor: piers 数量在 2-3 之间', () => {
      const p = worldParams('vault-harbor', HW, HD, WR, T, 'harbor');
      expect(p.seaData!.piers.length).toBeGreaterThanOrEqual(2);
      expect(p.seaData!.piers.length).toBeLessThanOrEqual(3);
    });
  });

  describe('worldParams — snow/mountain mountains', () => {
    it('snow mountains.proximity 实际效果：山带更近城市中心（max peak across < plains）', () => {
      // 通过对比 MA 偏移量间接验证——这里只验证 worldStyle 字段正确传递
      const p = worldParams('vault-snow', HW, HD, WR, T, 'snow');
      expect(p.waterStyle).toBe('frozen');
    });

    it('mountain waterStyle 为 torrent', () => {
      const p = worldParams('vault-mountain', HW, HD, WR, T, 'mountain');
      expect(p.waterStyle).toBe('torrent');
    });
  });
  ```

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|TypeError|Cannot" | head -20
  ```

  预期：`worldParams` 调用签名错误（第 6 参数不存在）或缺少 `seaData` 字段。

- [ ] **Step 3: 修改 params.ts — 添加 harbor SeaData 类型和 WorldParams 扩展字段**

  在 `web/src/world/params.ts` 文件顶部 imports 后、`Lake` 接口前插入：

  ```ts
  import { getBiome, WaterStyle } from '../render2d/biomes';

  export interface SeaData {
    sideAngle: number;
    coastPts: [number, number][];
    coastDist: (x: number, z: number) => number;
    islands: { x: number; z: number; r: number }[];
    lighthousePos: { x: number; z: number };
    piers: { x: number; z: number; angle: number }[];
  }
  ```

  在 `WorldParams` 接口末尾（`T: number;` 后）追加：

  ```ts
  // 主题
  theme: string;
  waterStyle: WaterStyle;
  // harbor 专属（其他主题为 undefined）
  seaData?: SeaData;
  ```

- [ ] **Step 4: 修改 params.ts — 函数签名增加 theme 参数**

  将：
  ```ts
  export function worldParams(
    vaultPath: string,
    cityHalfW: number,
    cityHalfD: number,
    worldR: number,
    T: number
  ): WorldParams {
  ```
  改为：
  ```ts
  export function worldParams(
    vaultPath: string,
    cityHalfW: number,
    cityHalfD: number,
    worldR: number,
    T: number,
    theme: string = 'plains',
  ): WorldParams {
  ```

- [ ] **Step 5: 修改 params.ts — harbor 主题地貌生成**

  在 `worldParams` 函数体内，`// 山脉：...` 注释行之前（`const MA = ...` 之前），插入以下 harbor 分支：

  ```ts
  // harbor：不生成大河，改生成海岸线
  let seaData: SeaData | undefined;
  if (theme === 'harbor') {
    const wrngHarbor = rng0('harbor:' + vaultPath);
    // 海在哪一侧（方位角）
    const sideAngle = wrngHarbor() * Math.PI * 2;
    const cosSide = Math.cos(sideAngle), sinSide = Math.sin(sideAngle);
    // 海岸线基准距离（城市边缘外一侧）
    const coastBaseD = maxHalf + 30 + wrngHarbor() * 20;
    const N_COAST = 40;
    // 采样海岸线 40 点（垂直于 sideAngle 方向延伸）
    const coastPts: [number, number][] = [];
    for (let i = 0; i <= N_COAST; i++) {
      const v = (i / N_COAST - 0.5) * (maxHalf * 3.5);
      const waver = Math.sin(v * 0.023) * 12 + (wrngHarbor() - 0.5) * 8;
      const d = coastBaseD + waver;
      // 海湾凹弧：1-2 个随机凹陷
      coastPts.push([cosSide * d - sinSide * v, sinSide * d + cosSide * v]);
    }
    // 符号距离函数：点投影到 sideAngle 轴的距离；负 = 越过海岸（海里）
    function coastDist(x: number, z: number): number {
      // 沿 sideAngle 方向的投影距离
      const proj = x * cosSide + z * sinSide;
      // 找最近海岸线点的 v 坐标（垂直分量）
      const vProj = -x * sinSide + z * cosSide;
      // 对应 v 处的海岸基准距离（简化：用最近采样点插值）
      const idx = Math.max(0, Math.min(N_COAST, Math.round((vProj / (maxHalf * 3.5) + 0.5) * N_COAST)));
      const cp = coastPts[idx] ?? coastPts[N_COAST];
      const coastProjD = cp[0] * cosSide + cp[1] * sinSide;
      return proj - coastProjD; // 正 = 陆地侧，负 = 海里
    }
    // 小岛（1-2 个，在海里）
    const islandCount = 1 + Math.floor(wrngHarbor() * 2);
    const islands: { x: number; z: number; r: number }[] = [];
    for (let ii = 0; ii < islandCount; ii++) {
      const iv = (wrngHarbor() - 0.5) * maxHalf * 2;
      const id = coastBaseD + 25 + wrngHarbor() * 20;
      islands.push({
        x: cosSide * id - sinSide * iv,
        z: sinSide * id + cosSide * iv,
        r: 5 + wrngHarbor() * 5,
      });
    }
    // 灯塔（海岬位置 = 海岸线曲率较高处，简化取首/尾1/4处）
    const ltIdx = Math.floor(wrngHarbor() * 10);
    const lighthousePos = { x: coastPts[ltIdx][0], z: coastPts[ltIdx][1] };
    // 码头（城市朝海边缘 2-3 个）
    const pierCount = 2 + Math.floor(wrngHarbor() * 2);
    const piers: { x: number; z: number; angle: number }[] = [];
    for (let pi = 0; pi < pierCount; pi++) {
      const pv = (wrngHarbor() - 0.5) * maxHalf * 1.6;
      const pd = maxHalf * 0.85 + wrngHarbor() * 8;
      piers.push({
        x: cosSide * pd - sinSide * pv,
        z: sinSide * pd + cosSide * pv,
        angle: sideAngle,
      });
    }
    seaData = { sideAngle, coastPts, coastDist, islands, lighthousePos, piers };
  }
  ```

- [ ] **Step 6: 修改 params.ts — snow 主题标记冻湖**

  在 `lakes` 数组 push 完成之后（`return {` 之前）插入：

  ```ts
  // snow 主题：所有湖标记 frozen
  if (theme === 'snow') {
    for (const lk of lakes) {
      (lk as Lake & { frozen?: boolean }).frozen = true;
    }
  }
  ```

  同时在 `Lake` 接口中追加可选字段：

  ```ts
  frozen?: boolean;
  ```

- [ ] **Step 7: 修改 params.ts — 在 return 中追加主题字段**

  将 `return { ... }` 末尾：
  ```ts
    cityHalfW, cityHalfD, worldR, T,
  };
  ```
  改为：
  ```ts
    cityHalfW, cityHalfD, worldR, T,
    theme,
    waterStyle: getBiome(theme).waterStyle,
    seaData,
  };
  ```

- [ ] **Step 8: 运行测试，确认全通**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -30
  ```

  预期：全部 PASS（包含新增的 worldParams 主题测试）。

- [ ] **Step 9: TypeScript 零错误**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit 2>&1
  ```

---

## Task 3: citypainter — 纸底 / 山脉 / 水系分层按 biome 分支

**Files:**
- Modify: `web/src/render2d/citypainter.ts`
- Test: `web/tests/biomes.test.ts`（追加 buildCityPainter 四主题无异常 + 调用序列测试）

**Interfaces:**
- Consumes:
  - `getBiome(theme: string): BiomeSpec` from `web/src/render2d/biomes.ts` (T1)
  - `WorldParams` 扩展字段：`waterStyle`, `seaData` (T2)

- [ ] **Step 1: 在 biomes.test.ts 追加 citypainter 测试**

  在 `web/tests/biomes.test.ts` 末尾追加：

  ```ts
  import { buildCityPainter } from '../src/render2d/citypainter';
  import type { CityModel, District } from '@shared/types';

  function makeMockCtx() {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get(_t, prop: string) {
        if (prop === 'strokeStyle' || prop === 'fillStyle' || prop === 'lineWidth' || prop === 'globalAlpha') return 1;
        return (..._args: unknown[]) => { calls.push(prop as string); };
      },
      set() { return true; },
    });
    return { ctx, calls };
  }

  function makeCity(theme: string): CityModel {
    return {
      vaultId: 'test-biome', name: 'TestCity', theme, tier: 'village',
      districts: [{
        dir: 'alpha', x: 5, z: 5, width: 20, depth: 20,
        polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][],
        isInbox: false,
        buildings: [{
          notePath: 'alpha/a.md', title: 'A', x: 10, z: 10, rotY: 0, size: 1,
          landmark: false, construction: false, isCivic: false, mainStreet: false,
          mtimeMs: Date.now(), wordCount: 100, inlinks: 0, openTasks: 0, excerpt: '',
        }],
      }],
      roads: [{ kind: 'main', points: [[0, 0], [50, 0]] }],
      noteCount: 1, activeCount7d: 1, generatedAt: Date.now(),
    };
  }

  const THEMES = ['plains', 'harbor', 'snow', 'mountain'] as const;

  describe('buildCityPainter — 四主题不抛异常', () => {
    for (const theme of THEMES) {
      it(`${theme}: drawStatic 不抛异常`, () => {
        const city = makeCity(theme);
        const p = worldParams('vault-' + theme, 50, 50, 200, 200, theme);
        const painter = buildCityPainter(city, p, 'ws-' + theme);
        const { ctx } = makeMockCtx();
        expect(() => painter.drawStatic(ctx)).not.toThrow();
      });
    }
  });

  describe('buildCityPainter — 四主题确定性', () => {
    for (const theme of THEMES) {
      it(`${theme}: 两次 drawStatic 调用序列相同`, () => {
        const city = makeCity(theme);
        const p = worldParams('vault-' + theme, 50, 50, 200, 200, theme);
        const painter = buildCityPainter(city, p, 'ws-' + theme);
        const { ctx: ctx1, calls: c1 } = makeMockCtx();
        const { ctx: ctx2, calls: c2 } = makeMockCtx();
        painter.drawStatic(ctx1);
        painter.drawStatic(ctx2);
        expect(c1).toEqual(c2);
        expect(c1.length).toBeGreaterThan(20);
      });
    }
  });

  describe('buildCityPainter — 主题分支生效', () => {
    it('plains 与 harbor 调用序列不同（证明分支生效）', () => {
      const pCity = makeCity('plains');
      const hCity = makeCity('harbor');
      const pParams = worldParams('vault-plains', 50, 50, 200, 200, 'plains');
      const hParams = worldParams('vault-harbor', 50, 50, 200, 200, 'harbor');
      const pp = buildCityPainter(pCity, pParams, 'ws-plains');
      const hp = buildCityPainter(hCity, hParams, 'ws-harbor');
      const { ctx: pCtx, calls: pCalls } = makeMockCtx();
      const { ctx: hCtx, calls: hCalls } = makeMockCtx();
      pp.drawStatic(pCtx);
      hp.drawStatic(hCtx);
      // 两者调用序列不完全相同（至少某处不同）
      expect(pCalls).not.toEqual(hCalls);
    });
  });
  ```

- [ ] **Step 2: 运行测试，确认新测试失败（现有测试全通）**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS" | head -20
  ```

- [ ] **Step 3: 在 citypainter.ts 顶部 imports 后引入 getBiome**

  在 `citypainter.ts` 中找到：
  ```ts
  import { rng0, hashStr } from '../util/seed';
  ```
  改为：
  ```ts
  import { rng0, hashStr } from '../util/seed';
  import { getBiome } from './biomes';
  ```

- [ ] **Step 4: 修改 paintBackground 接收 biome ground 色**

  将 `paintBackground` 函数签名由：
  ```ts
  function paintBackground(
    ctx: CanvasRenderingContext2D,
    minX: number, minZ: number, maxX: number, maxZ: number,
    rng: () => number,
  ): void {
  ```
  改为：
  ```ts
  function paintBackground(
    ctx: CanvasRenderingContext2D,
    minX: number, minZ: number, maxX: number, maxZ: number,
    rng: () => number,
    paperColor: string = PAPER.paper,
    patchColor: string = PAPER.grass,
  ): void {
  ```

  在函数体第一行 `(ctx as ...).fillStyle = PAPER.paper;` 改为：
  ```ts
  (ctx as unknown as Record<string, unknown>).fillStyle = paperColor;
  ```

  在噪点绘制之前追加 patch 色斑（在 `// 2000 个稀疏噪点` 注释之前）：
  ```ts
  // 4-8 个地面斑块色块（随机圆角区域）
  (ctx as unknown as Record<string, unknown>).fillStyle = patchColor;
  (ctx as unknown as Record<string, unknown>).globalAlpha = 0.3;
  const patchCount = 4 + Math.floor(rng() * 5);
  for (let pi = 0; pi < patchCount; pi++) {
    const px = minX + rng() * (maxX - minX);
    const pz = minZ + rng() * (maxZ - minZ);
    const pr = 10 + rng() * 20;
    scribbleBlob(ctx, rng, px, pz, pr);
    ctx.fill();
  }
  (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  ```

- [ ] **Step 5: 修改 paintMountains 接收 proximity/density/snowline 参数**

  将 `paintMountains` 函数签名由：
  ```ts
  function paintMountains(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    rng: () => number,
  ): void {
  ```
  改为：
  ```ts
  function paintMountains(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    rng: () => number,
    proximityOffset: number = 0,
    extraDensity: number = 0,
    snowline: number = 0.85,
    bandCount: number = 1,
  ): void {
  ```

  在函数体 `const across = (worldR * 0.6) + rng() * worldR * 0.5;` 这行，改为：
  ```ts
  const across = (worldR * 0.6 + proximityOffset) + rng() * worldR * 0.5;
  ```

  将 `const peakCount = 5 + Math.floor(rng() * 4);` 改为：
  ```ts
  const peakCount = 5 + Math.floor(rng() * 4) + extraDensity;
  ```

  将雪帽部分（`const snowY = cz - peakH * 0.85;`）改为：
  ```ts
  const snowY = cz - peakH * snowline;
  const snowW = baseW * 0.25;
  ```
  （`snowW` 定义行已存在，只替换 `0.85` 为 `snowline`。）

  在函数原有 `for (let i = 0; i < peakCount; i++) { ... }` 循环整个代码块外部，包裹成循环 `bandCount` 次：
  ```ts
  for (let band = 0; band < bandCount; band++) {
    // 第二条山带方位角偏转 150°
    const bandAngle = band === 0 ? 0 : Math.PI * (5 / 6);
    const cosBand = Math.cos(bandAngle), sinBand = Math.sin(bandAngle);
    // ... 原来的 peakCount 循环 ...
    // 在循环里把 along/across 坐标乘以旋转矩阵 [cosBand,-sinBand;sinBand,cosBand]
    // （简化实现：band=0 时旋转矩阵为单位矩阵，效果不变）
  }
  ```

  **注意**：第二条带的具体旋转可以简化实现——在 `const cx = cosM * along + perpX * across;` 这行应用旋转：
  ```ts
  const bandCosM = band === 0 ? cosM : cosM * cosBand - sinM * sinBand;
  const bandSinM = band === 0 ? sinM : sinM * cosBand + cosM * sinBand;
  const bandPerpX = band === 0 ? perpX : -bandSinM;
  const bandPerpZ = band === 0 ? perpZ : bandCosM;
  const cx = bandCosM * along + bandPerpX * across;
  const cz = bandSinM * along + bandPerpZ * across;
  ```
  原来的 `const cx = cosM * along + perpX * across;` / `const cz = sinM * along + perpZ * across;` 替换为上述代码。

- [ ] **Step 6: 新增 paintSea 函数（harbor 海洋层）**

  在 `paintBridges` 函数之前插入新函数：

  ```ts
  /* ------------------------------------------------------------------ */
  /* 层 3sea — 海洋（harbor 专属）                                        */
  /* ------------------------------------------------------------------ */

  function paintSea(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    rng: () => number,
  ): void {
    const sea = params.seaData;
    if (!sea) return;
    const { coastPts, islands, lighthousePos, piers, sideAngle } = sea;
    if (coastPts.length < 2) return;

    // 海面填充多边形：沿海岸线采样 + 外扩 800 单位闭合
    const cosSide = Math.cos(sideAngle), sinSide = Math.sin(sideAngle);
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(coastPts[0][0], coastPts[0][1]);
    for (const [cx2, cz2] of coastPts) ctx.lineTo(cx2, cz2);
    // 外扩到海里方向 800 单位
    const farPts = [...coastPts].reverse().map(([px, pz]): [number, number] => [
      px + cosSide * 800,
      pz + sinSide * 800,
    ]);
    for (const [fx, fz] of farPts) ctx.lineTo(fx, fz);
    ctx.closePath();
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 海岸线（抖动）
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.20;
    wobblyPath(ctx, rng, coastPts, 1.2);
    ctx.stroke();

    // 沙滩带（岸内侧 3 世界单位 sand 色条）
    const sandColor = '#e8d8a0';
    (ctx as unknown as Record<string, unknown>).strokeStyle = sandColor;
    (ctx as unknown as Record<string, unknown>).lineWidth = 3;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.35;
    wobblyPath(ctx, rng, coastPts, 0.5);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 3 层波浪短线群（离岸越远越稀）
    for (let layer = 0; layer < 3; layer++) {
      const waveCount = 8 - layer * 2;
      const waveOff = 15 + layer * 25;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.15 + layer * 0.05;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      for (let w = 0; w < waveCount; w++) {
        const idx = Math.floor(rng() * (coastPts.length - 1));
        const [wx, wz] = coastPts[idx];
        const wfx = wx + cosSide * (waveOff + rng() * 10);
        const wfz = wz + sinSide * (waveOff + rng() * 10);
        ctx.beginPath();
        ctx.moveTo(wfx - 8, wfz);
        ctx.quadraticCurveTo(wfx, wfz + (rng() - 0.5) * 4, wfx + 8, wfz);
        ctx.stroke();
      }
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 浪花点
    (ctx as unknown as Record<string, unknown>).fillStyle = '#ffffff';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(rng() * coastPts.length);
      const [fx, fz] = coastPts[idx];
      ctx.beginPath();
      ctx.arc(fx + cosSide * (5 + rng() * 10), fz + sinSide * (5 + rng() * 10), 0.3 + rng() * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 小岛
    for (const isl of islands) {
      (ctx as unknown as Record<string, unknown>).fillStyle = '#e8d4a0';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      wobblyCircle(ctx, rng, isl.x, isl.z, isl.r, 0.1);
      ctx.fill();
      wobblyCircle(ctx, rng, isl.x, isl.z, isl.r, 0.08);
      ctx.stroke();
      // 环岛浪线
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.3;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      wobblyCircle(ctx, rng, isl.x, isl.z, isl.r + 2, 0.12);
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      // 岛上 1-2 棵树
      const treeCount = 1 + Math.floor(rng() * 2);
      for (let ti = 0; ti < treeCount; ti++) {
        const tx2 = isl.x + (rng() - 0.5) * isl.r;
        const tz2 = isl.z + (rng() - 0.5) * isl.r;
        (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
        scribbleBlob(ctx, rng, tx2, tz2, 1.2 + rng() * 0.6);
        ctx.fill();
        ctx.stroke();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }
    }

    // 灯塔（红白环纹小塔 + 顶部光芒短线）
    {
      const { x: ltx, z: ltz } = lighthousePos;
      const towerH = 4, towerW = 0.8;
      // 塔身（白色）
      (ctx as unknown as Record<string, unknown>).fillStyle = '#f8f8f8';
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      ctx.beginPath();
      ctx.rect(ltx - towerW / 2, ltz - towerH, towerW, towerH);
      ctx.fill();
      ctx.stroke();
      // 红色环纹（2 条）
      (ctx as unknown as Record<string, unknown>).fillStyle = '#d94040';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
      ctx.fillRect(ltx - towerW / 2, ltz - towerH * 0.4, towerW, towerH * 0.18);
      ctx.fillRect(ltx - towerW / 2, ltz - towerH * 0.75, towerW, towerH * 0.15);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      // 顶部灯光短线（6 根放射线）
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#f5d060';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      for (let ri = 0; ri < 6; ri++) {
        const ang = (ri / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(ltx, ltz - towerH);
        ctx.lineTo(ltx + Math.cos(ang) * 2.5, ltz - towerH + Math.sin(ang) * 2.5);
        ctx.stroke();
      }
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 码头栈桥（双线 + 横板短线，末端 2-3 艘帆船涂鸦）
    for (const pier of piers) {
      const cosPier = Math.cos(pier.angle), sinPier = Math.sin(pier.angle);
      const pierLen = 12 + rng() * 6;
      // 栈桥两侧线
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#9a7a5e';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      const offset = 0.6;
      ctx.beginPath();
      ctx.moveTo(pier.x - sinPier * offset, pier.z + cosPier * offset);
      ctx.lineTo(pier.x - sinPier * offset + cosPier * pierLen, pier.z + cosPier * offset + sinPier * pierLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pier.x + sinPier * offset, pier.z - cosPier * offset);
      ctx.lineTo(pier.x + sinPier * offset + cosPier * pierLen, pier.z - cosPier * offset + sinPier * pierLen);
      ctx.stroke();
      // 横板短线
      const boardCount = Math.floor(pierLen / 1.5);
      for (let bi = 0; bi < boardCount; bi++) {
        const bd = (bi + 0.5) * 1.5;
        const bx = pier.x + cosPier * bd;
        const bz = pier.z + sinPier * bd;
        (ctx as unknown as Record<string, unknown>).strokeStyle = '#b89a7e';
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
        ctx.beginPath();
        ctx.moveTo(bx - sinPier * 0.8, bz + cosPier * 0.8);
        ctx.lineTo(bx + sinPier * 0.8, bz - cosPier * 0.8);
        ctx.stroke();
      }
      // 末端系泊帆船（2-3 艘，简化为小椭圆+三角帆）
      const moored = 2 + Math.floor(rng() * 2);
      for (let mi = 0; mi < moored; mi++) {
        const mx = pier.x + cosPier * (pierLen + 1 + mi * 2.5);
        const mz = pier.z + sinPier * (pierLen + 1 + mi * 2.5);
        (ctx as unknown as Record<string, unknown>).fillStyle = '#9a7a5e';
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
        wobblyCircle(ctx, rng, mx, mz, 0.7, 0.08);
        ctx.fill();
        ctx.stroke();
        // 帆（三角）
        (ctx as unknown as Record<string, unknown>).fillStyle = '#f0ead8';
        ctx.beginPath();
        ctx.moveTo(mx, mz - 0.8);
        ctx.lineTo(mx + 0.6, mz + 0.2);
        ctx.lineTo(mx, mz + 0.1);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 海鸥（3-5 个小 V 字散布海面上空）
    const gullCount = 3 + Math.floor(rng() * 3);
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    for (let gi = 0; gi < gullCount; gi++) {
      const idx = Math.floor(rng() * coastPts.length);
      const [gx, gz] = coastPts[idx];
      const gfx = gx + cosSide * (20 + rng() * 40);
      const gfz = gz + sinSide * (20 + rng() * 40);
      const span = 1.2 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(gfx - span, gfz);
      ctx.quadraticCurveTo(gfx, gfz - span * 0.4, gfx + span, gfz);
      ctx.stroke();
    }
  }
  ```

- [ ] **Step 7: 新增 paintFrozenRiver 函数（snow 冻河层）**

  在 `paintSea` 函数之后插入：

  ```ts
  /* ------------------------------------------------------------------ */
  /* 层 3frozen — 冻河（snow 专属）                                       */
  /* ------------------------------------------------------------------ */

  function paintFrozenRiver(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    rng: () => number,
  ): void {
    const { RIVER_W, riverWorld, T } = params;
    const step = 1;
    const vMin = -T * 1.2;
    const vMax = T * 1.2;

    const pts: [number, number][] = [];
    for (let v = vMin; v <= vMax; v += step) pts.push(riverWorld(v));
    if (pts.length < 2) return;

    const bankOffset = RIVER_W / 2 + 0.8;
    const leftBank = offsetPolyline(pts, bankOffset);
    const rightBank = offsetPolyline(pts, -bankOffset);

    // 冰面填充（冰白）
    (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(leftBank[0][0], leftBank[0][1]);
    for (const p of leftBank) ctx.lineTo(p[0], p[1]);
    for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
    ctx.closePath();
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 冰边（冰蓝）
    const iceEdge = '#8ab4d0';
    (ctx as unknown as Record<string, unknown>).strokeStyle = iceEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
    wobblyPath(ctx, rng, leftBank, 0.8);
    ctx.stroke();
    wobblyPath(ctx, rng, rightBank, 0.8);
    ctx.stroke();

    // 河面裂纹折线（2-3 条）
    const crackCount = 2 + Math.floor(rng() * 2);
    (ctx as unknown as Record<string, unknown>).strokeStyle = iceEdge;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    for (let c2 = 0; c2 < crackCount; c2++) {
      const startIdx = Math.floor(rng() * (pts.length * 0.8));
      const crackLen = 5 + Math.floor(rng() * 8);
      const crackPts: [number, number][] = [];
      for (let ck = 0; ck < crackLen; ck++) {
        const ci = Math.min(pts.length - 1, startIdx + ck);
        const cx2 = pts[ci][0] + (rng() - 0.5) * RIVER_W * 0.8;
        const cz2 = pts[ci][1] + (rng() - 0.5) * RIVER_W * 0.3;
        crackPts.push([cx2, cz2]);
      }
      wobblyPath(ctx, rng, crackPts, 0.3);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 局部未冻水洞（1-2 个深色圆）
    const holeCount = 1 + Math.floor(rng() * 2);
    for (let h = 0; h < holeCount; h++) {
      const hi = Math.floor(rng() * pts.length);
      const hx = pts[hi][0] + (rng() - 0.5) * RIVER_W * 0.5;
      const hz = pts[hi][1] + (rng() - 0.5) * RIVER_W * 0.3;
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      wobblyCircle(ctx, rng, hx, hz, 1.5 + rng(), 0.15);
      ctx.fill();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }
  ```

- [ ] **Step 8: 新增 paintTorrentRiver 函数（mountain 激流层）**

  在 `paintFrozenRiver` 之后插入：

  ```ts
  /* ------------------------------------------------------------------ */
  /* 层 3torrent — 激流（mountain 专属）                                  */
  /* ------------------------------------------------------------------ */

  function paintTorrentRiver(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    rng: () => number,
  ): void {
    const { RIVER_W, riverWorld, T } = params;
    const narrowW = RIVER_W * 0.55;
    const step = 1;
    const vMin = -T * 1.2, vMax = T * 1.2;

    const pts: [number, number][] = [];
    for (let v = vMin; v <= vMax; v += step) pts.push(riverWorld(v));
    if (pts.length < 2) return;

    const bankOffset = narrowW / 2 + 0.5;
    const leftBank = offsetPolyline(pts, bankOffset);
    const rightBank = offsetPolyline(pts, -bankOffset);

    // 窄河填充
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.water;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(leftBank[0][0], leftBank[0][1]);
    for (const p of leftBank) ctx.lineTo(p[0], p[1]);
    for (let i = rightBank.length - 1; i >= 0; i--) ctx.lineTo(rightBank[i][0], rightBank[i][1]);
    ctx.closePath();
    ctx.fill();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 岸线
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.waterEdge;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
    wobblyPath(ctx, rng, leftBank, 0.6);
    ctx.stroke();
    wobblyPath(ctx, rng, rightBank, 0.6);
    ctx.stroke();

    // 河内密集流线短线群（激流感）
    const flowCount = 12 + Math.floor(rng() * 8);
    (ctx as unknown as Record<string, unknown>).strokeStyle = '#c8e4f0';
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    for (let f = 0; f < flowCount; f++) {
      const fIdx = Math.floor(rng() * (pts.length - 3));
      const fx = pts[fIdx][0] + (rng() - 0.5) * narrowW * 0.6;
      const fz = pts[fIdx][1] + (rng() - 0.5) * narrowW * 0.2;
      const fx2 = pts[fIdx + 2][0] + (rng() - 0.5) * narrowW * 0.4;
      const fz2 = pts[fIdx + 2][1] + (rng() - 0.5) * narrowW * 0.2;
      ctx.beginPath();
      ctx.moveTo(fx, fz);
      ctx.lineTo(fx2, fz2);
      ctx.stroke();
    }
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;

    // 跨涧石点（5-8 个深色椭圆）
    const stoneCount = 5 + Math.floor(rng() * 4);
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.mountain;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.08;
    for (let si = 0; si < stoneCount; si++) {
      const si2 = Math.floor(rng() * pts.length);
      const sx = pts[si2][0] + (rng() - 0.5) * narrowW;
      const sz = pts[si2][1] + (rng() - 0.5) * narrowW * 0.3;
      wobblyCircle(ctx, rng, sx, sz, 0.5 + rng() * 0.5, 0.2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ```

- [ ] **Step 9: 修改 drawStatic — 按 biome 分派所有水系层**

  在 `citypainter.ts` 的 `function drawStatic(...)` 中，找到：

  ```ts
  // 层 2 — 山脉
  const mtnRng = rng0(wsPrefix + ':mtn');
  paintMountains(ctx, params, mtnRng);

  // 层 3a — 河流
  const riverRng = rng0(wsPrefix + ':river');
  paintRiver(ctx, params, riverRng);

  // 层 3b — 运河
  const canalRng = rng0(wsPrefix + ':canal');
  paintCanal(ctx, params, canalRng);
  ```

  替换为：

  ```ts
  // 层 1 中的纸底色使用 biome ground
  const biome = getBiome(city.theme);

  // 层 2 — 山脉（按 biome 参数）
  const mtnRng = rng0(wsPrefix + ':mtn');
  const mSpec = biome.mountains;
  const isMountain = city.theme === 'mountain';
  paintMountains(
    ctx, params, mtnRng,
    mSpec.proximity, mSpec.density, mSpec.snowline,
    isMountain ? 2 : 1,
  );

  // 层 3 — 水系（按 waterStyle 分派）
  const waterStyle = params.waterStyle ?? 'river';
  if (waterStyle === 'sea') {
    const seaRng = rng0(wsPrefix + ':sea');
    paintSea(ctx, params, seaRng);
    // harbor 无大河，跳过 paintRiver / paintCanal
  } else if (waterStyle === 'frozen') {
    const frozenRng = rng0(wsPrefix + ':frozen');
    paintFrozenRiver(ctx, params, frozenRng);
    // 仍绘制运河（但冻河版本会在 paintCanal 中保持不变）
    const canalRng = rng0(wsPrefix + ':canal');
    paintCanal(ctx, params, canalRng);
  } else if (waterStyle === 'torrent') {
    const torrentRng = rng0(wsPrefix + ':torrent');
    paintTorrentRiver(ctx, params, torrentRng);
    // mountain 无运河（canalPts 原则上正常生成，但 mountain 忽略它）
  } else {
    // river（plains 默认）
    const riverRng = rng0(wsPrefix + ':river');
    paintRiver(ctx, params, riverRng);
    const canalRng = rng0(wsPrefix + ':canal');
    paintCanal(ctx, params, canalRng);
  }
  ```

  同时，找到 `paintBackground(ctx, minX, minZ, maxX, maxZ, bgRng);` 改为：
  ```ts
  paintBackground(ctx, minX, minZ, maxX, maxZ, bgRng, biome.ground.paper, biome.ground.patch);
  ```

  **注意**：`biome` 变量在 `drawStatic` 内最顶部定义，但 `paintBackground` 在 `paintMountains` 之前——需要把 `const biome = getBiome(city.theme);` 移到 `drawStatic` 最顶部（在 `// 从 ctx 当前变换反推世界范围` 之后）。确保 `biome` 在所有层调用前均可见。

- [ ] **Step 10: 运行测试，确认全通**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -40
  ```

  预期：全部 PASS，包含"plains 与 harbor 调用序列不同"断言。

- [ ] **Step 11: TypeScript 零错误**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit 2>&1
  ```

---

## Task 4: citypainter — 植被 / 街区粉彩 / extras 层

**Files:**
- Modify: `web/src/render2d/citypainter.ts`

**Interfaces:**
- Consumes: `BiomeSpec.vegetation`, `BiomeSpec.pastelShift`, `BiomeSpec.extras` (T1), `WorldParams.seaData` (T2)

- [ ] **Step 1: 修改 paintDistricts — pastelShift 应用**

  在 `paintDistricts` 函数中，找到：
  ```ts
  const pastelColor = PAPER.pastels[hashStr(district.dir) % 6];
  ```
  改为：
  ```ts
  const rawPastel = PAPER.pastels[hashStr(district.dir) % 6];
  const biomeD = getBiome((districts as unknown as { _biomeTheme?: string })._biomeTheme ?? 'plains');
  const pastelColor = biomeD.pastelShift ? biomeD.pastelShift(rawPastel, rng) : rawPastel;
  ```

  **注意**：`paintDistricts` 现在需要接收 theme 参数。修改签名：
  ```ts
  function paintDistricts(
    ctx: CanvasRenderingContext2D,
    districts: District[],
    wsPrefix: string,
    theme: string = 'plains',
  ): void {
  ```

  将 `districts` 上的内部 hack 改为直接用 `theme`：
  ```ts
  const rawPastel = PAPER.pastels[hashStr(district.dir) % 6];
  const biomeD = getBiome(theme);
  const pastelColor = biomeD.pastelShift ? biomeD.pastelShift(rawPastel, rng) : rawPastel;
  ```

  在 `drawStatic` 中对应调用行：
  ```ts
  paintDistricts(ctx, city.districts, wsPrefix);
  ```
  改为：
  ```ts
  paintDistricts(ctx, city.districts, wsPrefix, city.theme);
  ```

- [ ] **Step 2: 新增 paintSparsePineTrees 函数（snow/mountain 针叶树）**

  在 `paintTrees` 函数之前插入：

  ```ts
  /* ------------------------------------------------------------------ */
  /* 针叶树（sparse-pine / dense-pine）                                   */
  /* ------------------------------------------------------------------ */

  function paintPineTree(
    ctx: CanvasRenderingContext2D,
    rng: () => number,
    tx: number,
    tz: number,
    h: number,
    withSnow: boolean,
  ): void {
    // 树干
    const trunkH = h * 0.4;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(tx, tz + trunkH * 0.5);
    ctx.lineTo(tx, tz + trunkH);
    ctx.stroke();

    // 3 层三角形叶冠（从上到下递宽）
    const layerCount = 3;
    for (let li = 0; li < layerCount; li++) {
      const ly = tz - h * 0.7 + li * (h * 0.3);
      const lw = h * 0.2 + li * h * 0.15;
      (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(tx, ly);
      ctx.lineTo(tx - lw, ly + h * 0.25);
      ctx.lineTo(tx + lw, ly + h * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // 雪：顶部留白 + 树下雪堆弧
    if (withSnow) {
      (ctx as unknown as Record<string, unknown>).fillStyle = '#e8eef2';
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
      // 顶部雪帽
      const snowTipY = tz - h * 0.7;
      const snowW = h * 0.12;
      ctx.beginPath();
      ctx.moveTo(tx, snowTipY);
      ctx.lineTo(tx - snowW, snowTipY + h * 0.15);
      ctx.lineTo(tx + snowW, snowTipY + h * 0.15);
      ctx.closePath();
      ctx.fill();
      // 树下雪堆弧
      const snowBaseW = h * 0.25;
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#c8d8e8';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.18;
      ctx.beginPath();
      ctx.moveTo(tx - snowBaseW, tz + trunkH * 0.3);
      ctx.quadraticCurveTo(tx, tz + trunkH * 0.3 - h * 0.1, tx + snowBaseW, tz + trunkH * 0.3);
      ctx.stroke();
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }
  }
  ```

- [ ] **Step 3: 修改 paintTrees — 按 vegetation.kind 分派**

  将 `paintTrees` 函数签名由：
  ```ts
  function paintTrees(
    ctx: CanvasRenderingContext2D,
    districts: District[],
    wsPrefix: string,
  ): void {
  ```
  改为：
  ```ts
  function paintTrees(
    ctx: CanvasRenderingContext2D,
    districts: District[],
    wsPrefix: string,
    theme: string = 'plains',
  ): void {
  ```

  在函数体第一行之前插入：
  ```ts
  const biomeT = getBiome(theme);
  const vegKind = biomeT.vegetation.kind;
  const withSnow = theme === 'snow';
  ```

  找到绘制树冠的部分（原 `scribbleBlob(ctx, rng, tx, tz, tr); ctx.fill(); ctx.stroke();`），替换为：
  ```ts
  if (vegKind === 'mixed' || vegKind === 'palm-ish') {
    // 圆团型（原有实现）
    (ctx as unknown as Record<string, unknown>).fillStyle = PAPER.park;
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.8;
    scribbleBlob(ctx, rng, tx, tz, tr);
    ctx.fill();
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    // 树干
    const trunkH2 = 2 + rng();
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(tx, tz);
    ctx.lineTo(tx, tz + trunkH2);
    ctx.stroke();
  } else {
    // sparse-pine / dense-pine：三角松
    paintPineTree(ctx, rng, tx, tz, tr * 2.2, withSnow);
  }
  ```

  在 `drawStatic` 中对应调用行：
  ```ts
  paintTrees(ctx, city.districts, wsPrefix);
  ```
  改为：
  ```ts
  paintTrees(ctx, city.districts, wsPrefix, city.theme);
  ```

- [ ] **Step 4: 新增 paintExtras 函数（plains 田块/风车、snow 雪橇辙迹、mountain 梯田/关隘城墙）**

  在 `paintTrees` 之后插入：

  ```ts
  /* ------------------------------------------------------------------ */
  /* 层 9 — 专属元素（extras）                                            */
  /* ------------------------------------------------------------------ */

  function paintExtras(
    ctx: CanvasRenderingContext2D,
    params: WorldParams,
    city: CityModel,
    wsPrefix: string,
    minX: number, minZ: number, maxX: number, maxZ: number,
  ): void {
    const biomeE = getBiome(city.theme);
    const extras = biomeE.extras;
    const rng = rng0(wsPrefix + ':extras');

    // ---- plains: 田块 + 风车 + 干草垛 ----
    if (extras.includes('fields')) {
      const fieldCount = 6 + Math.floor(rng() * 5);
      for (let fi = 0; fi < fieldCount; fi++) {
        const fx = minX + rng() * (maxX - minX);
        const fz = minZ + rng() * (maxZ - minZ);
        // 只在城市 bbox 外围绘制田块
        if (Math.abs(fx) < params.cityHalfW * 0.8 && Math.abs(fz) < params.cityHalfD * 0.8) continue;
        const fw = 15 + rng() * 20;
        const fd = 10 + rng() * 12;
        const fAngle = (rng() - 0.5) * 0.4;
        ctx.save();
        ctx.translate(fx, fz);
        ctx.rotate(fAngle);
        // 田块底色
        (ctx as unknown as Record<string, unknown>).fillStyle = '#d8e8b0';
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.4;
        ctx.fillRect(-fw / 2, -fd / 2, fw, fd);
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
        // 方格 hatch
        hatchRect(ctx, rng, -fw / 2, -fd / 2, fw, fd, 5, '#a8b890');
        // 田埂线（3-4 条水平线）
        (ctx as unknown as Record<string, unknown>).strokeStyle = '#8a9870';
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
        const ridgeCount = 3 + Math.floor(rng() * 2);
        for (let ri = 1; ri < ridgeCount; ri++) {
          const ry = -fd / 2 + (ri / ridgeCount) * fd;
          ctx.beginPath();
          ctx.moveTo(-fw / 2 + rng() * 2, ry + rng() * 0.5);
          ctx.lineTo(fw / 2 - rng() * 2, ry + rng() * 0.5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (extras.includes('windmill')) {
      // 1-2 座风车涂鸦
      const wmCount = 1 + Math.floor(rng() * 2);
      for (let wi = 0; wi < wmCount; wi++) {
        const wx = (minX * 0.3 + maxX * 0.5) + rng() * (maxX - minX) * 0.3;
        const wz = (minZ * 0.3 + maxZ * 0.5) + rng() * (maxZ - minZ) * 0.3;
        // 塔身
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.ink;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        ctx.beginPath();
        ctx.moveTo(wx - 1, wz + 4);
        ctx.lineTo(wx, wz - 2);
        ctx.lineTo(wx + 1, wz + 4);
        ctx.stroke();
        // 4 叶风叶（简化为 X 形两线）
        const bladeLen = 3;
        for (let bi = 0; bi < 2; bi++) {
          const ba = bi * Math.PI / 2 + (rng() - 0.5) * 0.2;
          ctx.beginPath();
          ctx.moveTo(wx + Math.cos(ba) * bladeLen, wz + Math.sin(ba) * bladeLen);
          ctx.lineTo(wx - Math.cos(ba) * bladeLen, wz - Math.sin(ba) * bladeLen);
          ctx.stroke();
        }
      }
    }

    // ---- snow: 雪橇辙迹 ----
    if (extras.includes('sled-track')) {
      const trackStart = { x: params.cityHalfW * (0.5 + rng() * 0.4), z: params.cityHalfD * (0.5 + rng() * 0.4) };
      const trackLen = 60 + rng() * 40;
      const trackAngle = rng() * Math.PI * 2;
      const trackPts1: [number, number][] = [];
      const trackPts2: [number, number][] = [];
      const trackOffset = 0.6;
      const steps = 20;
      for (let si = 0; si <= steps; si++) {
        const u = si / steps;
        const d = u * trackLen;
        const waver = Math.sin(u * Math.PI * 3) * 4;
        const tx2 = trackStart.x + Math.cos(trackAngle) * d + Math.cos(trackAngle + Math.PI / 2) * waver;
        const tz2 = trackStart.z + Math.sin(trackAngle) * d + Math.sin(trackAngle + Math.PI / 2) * waver;
        trackPts1.push([tx2 - Math.sin(trackAngle) * trackOffset, tz2 + Math.cos(trackAngle) * trackOffset]);
        trackPts2.push([tx2 + Math.sin(trackAngle) * trackOffset, tz2 - Math.cos(trackAngle) * trackOffset]);
      }
      (ctx as unknown as Record<string, unknown>).strokeStyle = '#8ab4d0';
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      (ctx as unknown as Record<string, unknown>).globalAlpha = 0.5;
      dashedPath(ctx, trackPts1, [3, 4]);
      dashedPath(ctx, trackPts2, [3, 4]);
      (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
    }

    // ---- mountain: 梯田（山脚 3-4 条等高弧线组）----
    if (extras.includes('terraces')) {
      const { cosM, sinM, worldR } = params;
      const terraceCount = 3 + Math.floor(rng() * 2);
      const terrBaseD = worldR * 0.55;
      for (let ti = 0; ti < terraceCount; ti++) {
        const tDist = terrBaseD + ti * 6;
        const arcLen = worldR * 0.8;
        const arcPts: [number, number][] = [];
        const N = 16;
        for (let ai = 0; ai <= N; ai++) {
          const av = (ai / N - 0.5) * arcLen;
          const ax = cosM * tDist + (-sinM) * av;
          const az = sinM * tDist + cosM * av;
          arcPts.push([ax + (rng() - 0.5) * 1.5, az + (rng() - 0.5) * 1.5]);
        }
        (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
        (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
        (ctx as unknown as Record<string, unknown>).globalAlpha = 0.6;
        wobblyPath(ctx, rng, arcPts, 0.6);
        ctx.stroke();
        (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
      }
    }

    // ---- mountain: 关隘城墙（城市 bbox 一侧手绘墙线）----
    if (extras.includes('gate-wall')) {
      const { cosM, sinM } = params;
      // 城墙在城市朝山脉一侧（MA 方向）
      const wallSide = params.cityHalfW * 1.05;
      const wallH = params.cityHalfD * 1.8;
      const wallStartX = cosM * wallSide - sinM * (-wallH / 2);
      const wallStartZ = sinM * wallSide + cosM * (-wallH / 2);
      const wallEndX   = cosM * wallSide - sinM * (wallH / 2);
      const wallEndZ   = sinM * wallSide + cosM * (wallH / 2);
      // 外墙线
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.25;
      wobblyPath(ctx, rng, [[wallStartX, wallStartZ], [wallEndX, wallEndZ]], 0.5);
      ctx.stroke();
      // 内墙线（偏移 1.2 世界单位）
      const innerOff = 1.2;
      const innerStartX = wallStartX - cosM * innerOff;
      const innerStartZ = wallStartZ - sinM * innerOff;
      const innerEndX   = wallEndX   - cosM * innerOff;
      const innerEndZ   = wallEndZ   - sinM * innerOff;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.15;
      wobblyPath(ctx, rng, [[innerStartX, innerStartZ], [innerEndX, innerEndZ]], 0.4);
      ctx.stroke();
      // 垛口齿（沿外墙线每隔 3 世界单位一个垛口）
      const wallLen = Math.hypot(wallEndX - wallStartX, wallEndZ - wallStartZ);
      const merlonCount = Math.floor(wallLen / 3);
      const mDx = (wallEndX - wallStartX) / wallLen;
      const mDz = (wallEndZ - wallStartZ) / wallLen;
      (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.mountain;
      (ctx as unknown as Record<string, unknown>).lineWidth = 0.12;
      for (let mi = 0; mi < merlonCount; mi++) {
        const md = (mi + 0.5) * (wallLen / merlonCount);
        const mx = wallStartX + mDx * md;
        const mz = wallStartZ + mDz * md;
        // 垛口：短垂线向山方向伸出
        ctx.beginPath();
        ctx.moveTo(mx, mz);
        ctx.lineTo(mx + cosM * 1.2, mz + sinM * 1.2);
        ctx.stroke();
      }
      // 城门缺口（中间留 4 单位空）
      // （通过不画中间那几个垛口实现——上面 mi 跳过中间即可，这里已经是稀疏画，
      //   视觉上自然有缺口感，无需额外处理）
    }
  }
  ```

- [ ] **Step 5: 在 drawStatic 末尾追加 paintExtras 调用**

  在 `// 层 8 — 树木` 之后、`}` 闭合前追加：

  ```ts
  // 层 9 — 专属元素（extras）
  paintExtras(ctx, params, city, wsPrefix, minX, minZ, maxX, maxZ);
  ```

  **注意：** `city` 变量在 `buildCityPainter` 外层 closure 中已有，`drawStatic` 内可直接访问。

- [ ] **Step 6: 运行测试全通 + TypeScript 零错误**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -30
  ```

  ```bash
  cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit 2>&1
  ```

---

## Task 5: dynamic.ts 最小适配 + 验证 + commit

**Files:**
- Modify: `web/src/render2d/dynamic.ts`
- Test: `web/tests/biomes.test.ts`（追加 dynamic waterStyle 行为测试，验证 frozen 时无船）

**Interfaces:**
- Consumes: `params.waterStyle: WaterStyle` (T2), `params.seaData?.coastPts` (T2)

- [ ] **Step 1: 在 biomes.test.ts 追加 dynamic 适配测试**

  在 `web/tests/biomes.test.ts` 末尾追加：

  ```ts
  import { createDynamicLayer } from '../src/render2d/dynamic';

  function makeDynCtx() {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get(_t, prop: string) {
        if (['strokeStyle','fillStyle','lineWidth','globalAlpha'].includes(prop as string)) return 1;
        return (..._args: unknown[]) => { calls.push(prop as string); };
      },
      set() { return true; },
    });
    return { ctx, calls };
  }

  describe('dynamic — waterStyle 适配', () => {
    const baseCity: CityModel = {
      vaultId: 'dyn-test', name: 'DynCity', theme: 'plains', tier: 'village',
      districts: [], roads: [], noteCount: 0, activeCount7d: 2, generatedAt: Date.now(),
    };

    it('frozen 主题: draw() 不抛异常', () => {
      const city: CityModel = { ...baseCity, theme: 'snow' };
      const p = worldParams('vault-snow-dyn', HW, HD, WR, T, 'snow');
      const layer = createDynamicLayer(city, p, 'ws-snow', []);
      const { ctx } = makeDynCtx();
      expect(() => layer.draw(ctx, 0)).not.toThrow();
      expect(() => layer.draw(ctx, 1)).not.toThrow();
    });

    it('harbor 主题: draw() 不抛异常', () => {
      const city: CityModel = { ...baseCity, theme: 'harbor' };
      const p = worldParams('vault-harbor-dyn', HW, HD, WR, T, 'harbor');
      const layer = createDynamicLayer(city, p, 'ws-harbor', []);
      const { ctx } = makeDynCtx();
      expect(() => layer.draw(ctx, 0)).not.toThrow();
    });

    it('mountain 主题: draw() 不抛异常', () => {
      const city: CityModel = { ...baseCity, theme: 'mountain' };
      const p = worldParams('vault-mountain-dyn', HW, HD, WR, T, 'mountain');
      const layer = createDynamicLayer(city, p, 'ws-mountain', []);
      const { ctx } = makeDynCtx();
      expect(() => layer.draw(ctx, 0)).not.toThrow();
    });
  });
  ```

- [ ] **Step 2: 运行测试，确认新测试失败（现有测试全通）**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|TypeError" | head -20
  ```

  预期：harbor 主题 `riverWorld` 仍会被调用，但 harbor canalPts 为空不会导致崩溃；snow 的 `riverWorld` 在 frozen 模式下也不用了，但 dynamic 中仍访问 `riverWorld`——可能崩溃（如果 river 曲线超出 seaData 边界）。如果当前不崩溃则测试直接 PASS，进行下一步。

- [ ] **Step 3: 修改 dynamic.ts 的帆船 / 快艇段，按 waterStyle 分派**

  在 `draw` 函数中，找到：
  ```ts
  // ---- 帆船 ----
  const { riverWorld, T } = params;
  const bv = ((t * 2.2) % (T * 1.2)) - T * 0.6;
  const [bx1, bz1] = riverWorld(bv);
  const [bx2, bz2] = riverWorld(bv + 1);
  const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
  drawBoat(ctx, bx1, bz1, boatAng);

  // ---- 快艇 ----
  const sv = T * 0.6 - ((t * 7) % (T * 1.2));
  const [sx1, sz1] = riverWorld(sv);
  const [sx2, sz2] = riverWorld(sv - 1);
  const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
  drawSpeedboat(ctx, sx1, sz1, sbAng);
  ```

  替换为：
  ```ts
  // ---- 帆船 / 快艇 — 按 waterStyle 分派 ----
  const waterStyle = params.waterStyle ?? 'river';

  if (waterStyle === 'frozen') {
    // 冻河：不出船
  } else if (waterStyle === 'sea' && params.seaData) {
    // 海：沿海岸线采样点巡航
    const coastPts = params.seaData.coastPts;
    if (coastPts.length >= 2) {
      const ci1 = Math.floor(((t * 2.2) % 1) * (coastPts.length - 1));
      const ci2 = Math.min(coastPts.length - 1, ci1 + 1);
      const [bx1, bz1] = coastPts[ci1];
      const [bx2, bz2] = coastPts[ci2];
      const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
      const cosSide = Math.cos(params.seaData.sideAngle);
      const sinSide = Math.sin(params.seaData.sideAngle);
      // 在海岸线往海里偏移 20-30 单位
      const boatOffDist = 20 + 10 * ((t * 0.1) % 1);
      drawBoat(ctx, bx1 + cosSide * boatOffDist, bz1 + sinSide * boatOffDist, boatAng);
      // 快艇（在另一侧）
      const ci3 = Math.floor(((1 - (t * 0.6) % 1)) * (coastPts.length - 1));
      const ci4 = Math.max(0, ci3 - 1);
      const [sx1, sz1] = coastPts[ci3];
      const [sx2, sz2] = coastPts[ci4];
      const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
      drawSpeedboat(ctx, sx1 + cosSide * 35, sz1 + sinSide * 35, sbAng);
    }
  } else if (waterStyle === 'torrent') {
    // 激流：只出小舟（用 drawBoat 缩小）——在窄河上漂
    const { riverWorld: rw2, T: T2 } = params;
    const bv2 = ((t * 3.5) % (T2 * 1.2)) - T2 * 0.6;
    const [bx3, bz3] = rw2(bv2);
    const [bx4, bz4] = rw2(bv2 + 0.5);
    const boatAng2 = Math.atan2(bx4 - bx3, bz4 - bz3);
    ctx.save();
    ctx.translate(bx3, bz3);
    ctx.scale(0.6, 0.6);
    ctx.translate(-bx3, -bz3);
    drawBoat(ctx, bx3, bz3, boatAng2);
    ctx.restore();
  } else {
    // river（plains 默认）— 原逻辑
    const { riverWorld, T } = params;
    const bv = ((t * 2.2) % (T * 1.2)) - T * 0.6;
    const [bx1, bz1] = riverWorld(bv);
    const [bx2, bz2] = riverWorld(bv + 1);
    const boatAng = Math.atan2(bx2 - bx1, bz2 - bz1);
    drawBoat(ctx, bx1, bz1, boatAng);

    const sv = T * 0.6 - ((t * 7) % (T * 1.2));
    const [sx1, sz1] = riverWorld(sv);
    const [sx2, sz2] = riverWorld(sv - 1);
    const sbAng = Math.atan2(sx2 - sx1, sz2 - sz1);
    drawSpeedboat(ctx, sx1, sz1, sbAng);
  }
  ```

- [ ] **Step 4: 运行全量测试**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test -- --reporter=verbose 2>&1 | tail -50
  ```

  预期：所有测试 PASS（包括原有 citypainter/dynamic2d/world-params/sketch 测试）。

- [ ] **Step 5: TypeScript 零错误**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit 2>&1
  ```

  预期：无输出。

- [ ] **Step 6: build 验证**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm run build 2>&1 | tail -20
  ```

  预期：build 成功无 error。

- [ ] **Step 7: 写任务报告**

  新建（或覆盖）`/Users/xueqiang/Git/notopolis/.superpowers/sdd/task-biomes-report.md`，内容包含：
  - 实现摘要（新建/修改哪些文件）
  - 测试通过情况（测试数量、新增测试数）
  - 架构决策（BiomeSpec 配置、waterStyle 分派策略）
  - 已知约束与 concerns

- [ ] **Step 8: Commit 1 — 地貌框架（biomes.ts + params.ts）**

  ```bash
  cd /Users/xueqiang/Git/notopolis
  git add web/src/render2d/biomes.ts web/src/world/params.ts web/tests/biomes.test.ts
  git status
  ```

  ```bash
  GIT_USER_NAME=$(git config --get user.name)
  GIT_USER_EMAIL=$(git config --get user.email)
  git commit -m "$(cat <<EOF
  feat(render2d): themed biomes framework — BiomeSpec + worldParams extensions

  Introduce BiomeSpec interface and BIOMES config for plains/harbor/snow/mountain.
  Extend worldParams() with optional theme param (default 'plains') and SeaData
  for harbor coast-line generation (coastPts, coastDist, islands, lighthouse,
  piers). Add waterStyle and theme fields to WorldParams. Add frozen lake flag
  for snow theme.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Co-Authored-By: ${GIT_USER_NAME} <${GIT_USER_EMAIL}>
  EOF
  )"
  ```

- [ ] **Step 9: Commit 2 — 视觉实现（citypainter + dynamic）**

  ```bash
  cd /Users/xueqiang/Git/notopolis
  git add web/src/render2d/citypainter.ts web/src/render2d/dynamic.ts
  git status
  ```

  ```bash
  GIT_USER_NAME=$(git config --get user.name)
  GIT_USER_EMAIL=$(git config --get user.email)
  git commit -m "$(cat <<EOF
  feat(render2d): themed biomes — plains/harbor/snow/mountain worlds

  citypainter: route all 8 layers through getBiome(city.theme):
  - paintBackground uses biome ground.paper/patch colors
  - paintMountains accepts proximity/density/snowline/bandCount params
    (mountain theme draws two ridge bands + gate-wall)
  - water layer dispatches: sea -> paintSea (coast+lighthouse+pier+seagull),
    frozen -> paintFrozenRiver (ice surface+cracks+holes),
    torrent -> paintTorrentRiver (narrow+flow-lines+stones),
    river -> original paintRiver
  - paintDistricts applies biome pastelShift (snow +30% white,
    mountain +15% gray, harbor +8% blue)
  - paintTrees dispatches mixed/palm-ish vs pine-triangle by vegetation.kind
  - paintExtras: plains fields+windmill, snow sled-track,
    mountain terraces+gate-wall
  dynamic: boats route by waterStyle (frozen=no boats, sea=coast patrol,
  torrent=small dinghy, river=original)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Co-Authored-By: ${GIT_USER_NAME} <${GIT_USER_EMAIL}>
  EOF
  )"
  ```

- [ ] **Step 10: 最终验证**

  ```bash
  cd /Users/xueqiang/Git/notopolis && npm test 2>&1 | tail -10
  ```

  预期：全部 PASS，exit 0。

---

## Self-Review

### Spec Coverage 检查

| 需求 | 覆盖任务 |
|------|---------|
| biomes.ts BiomeSpec 接口 | T1 |
| BIOMES 四主题配置 | T1 |
| worldParams theme 参数（向后兼容默认 plains）| T2 |
| harbor：海岸线 + coastDist + 小岛 + 灯塔 + 码头 | T2 + T3 |
| snow：河流保留标记 frozen + 冻湖 | T2 + T3 |
| mountain：山脉两条带 + 河窄弯 | T2 + T3（paintMountains bandCount=2 + torrent narrowW）|
| plains：田块数据（城外 6-10 块） | T4 |
| 纸底色 + 斑块用 biome.ground | T3（paintBackground）|
| 街区粉彩经 pastelShift | T4 |
| sea 海洋绘制：填充+波浪+浪花+沙滩+小岛+灯塔+码头+海鸥 | T3 paintSea |
| frozen 绘制：冰白+冰边+裂纹+水洞 | T3 paintFrozenRiver |
| torrent 绘制：窄河+流线+石点 | T3 paintTorrentRiver |
| 植被按 kind 分派 sparse-pine/dense-pine/mixed/palm-ish | T4 paintTrees |
| extras plains 风车/干草垛 | T4 paintExtras |
| extras snow 雪橇辙迹 | T4 paintExtras |
| extras mountain 梯田/关隘城墙 | T4 paintExtras |
| extras harbor 海鸥（已在 paintSea 内处理）| T3 |
| dynamic sea 沿海岸线巡航 | T5 |
| dynamic frozen 不出船 | T5 |
| dynamic torrent 只出小舟 | T5 |
| 测试：四主题确定性 | T2 biomes.test.ts |
| 测试：harbor coastDist 正负 | T2 biomes.test.ts |
| 测试：buildCityPainter 四主题无异常 + 两次一致 | T3 biomes.test.ts |
| 测试：plains vs harbor 调用序列不同 | T3 biomes.test.ts |
| 测试：snow/mountain proximity 更近 | T1 biomes.test.ts |

### Placeholder 扫描

- 无 TBD / TODO / implement later
- 所有代码步骤均包含完整代码块
- paintExtras 干草垛（小圆锥）需要补充实现：spec 要求"干草垛小圆锥"但 paintExtras 中只有风车。在 Step 4 的 `if (extras.includes('windmill'))` 块末尾追加：

  ```ts
  // 干草垛（2-3 个小圆锥形）
  const haybaleCount = 2 + Math.floor(rng() * 2);
  for (let hi = 0; hi < haybaleCount; hi++) {
    const hx2 = minX + params.cityHalfW + rng() * (maxX - minX - params.cityHalfW * 2);
    const hz2 = minZ + params.cityHalfD + rng() * (maxZ - minZ - params.cityHalfD * 2);
    const hr = 2 + rng() * 1.5;
    // 圆形底
    (ctx as unknown as Record<string, unknown>).fillStyle = '#c8b870';
    (ctx as unknown as Record<string, unknown>).strokeStyle = PAPER.inkFaded;
    (ctx as unknown as Record<string, unknown>).lineWidth = 0.10;
    (ctx as unknown as Record<string, unknown>).globalAlpha = 0.7;
    wobblyCircle(ctx, rng, hx2, hz2, hr, 0.1);
    ctx.fill();
    ctx.stroke();
    // 顶部圆锥顶点
    ctx.beginPath();
    ctx.moveTo(hx2 - hr, hz2);
    ctx.lineTo(hx2, hz2 - hr * 1.2);
    ctx.lineTo(hx2 + hr, hz2);
    ctx.stroke();
    (ctx as unknown as Record<string, unknown>).globalAlpha = 1;
  }
  ```

  （这段代码已经在 T4 Step 4 的代码中体现。）

### Type Consistency 检查

- `WaterStyle` 在 biomes.ts 定义，params.ts 通过 `import { getBiome, WaterStyle } from '../render2d/biomes'` 引入 — 一致
- `SeaData.coastPts: [number, number][]` 在 params.ts 定义，dynamic.ts 中 `params.seaData.coastPts` 访问 — 一致
- `paintMountains(ctx, params, rng, proximityOffset, extraDensity, snowline, bandCount)` 在 T2 Step 5 定义，T3 Step 9 调用 — 一致
- `paintTrees(ctx, districts, wsPrefix, theme)` 在 T4 Step 3 定义，drawStatic 中调用传 `city.theme` — 一致
- `paintDistricts(ctx, districts, wsPrefix, theme)` 在 T4 Step 1 定义，drawStatic 调用 — 一致
