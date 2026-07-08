# Notopolis 前端性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 685 栋建筑城市视图的 draw calls 从 35,919 降至 <800、三角形从 9.97M 降至 <3M，视觉与交互行为不变。

**Architecture:** 分五层叠加优化——①共享材质缓存消除重复 MeshLambertMaterial 对象；②小件几何降级+共享消除每件独立 SoftBox；③静态合批（BufferGeometryUtils.mergeGeometries）将同材质静态 Mesh 合并为单次 draw call；④拾取代理盒替代消失的建筑原始 Mesh；⑤植被 InstancedMesh 替代逐棵独立 Group。每层独立可测，失败不影响上层。

**Tech Stack:** Three.js 0.160、BufferGeometryUtils（three/examples/jsm）、Playwright 测量脚本、Vitest 单元测试、TypeScript 5.5、Vite 5

## Global Constraints

- Three.js 版本锁定 ^0.160.0，不得升级或降级
- 所有新文件放 web/src/scene/（materials.ts / geometries.ts / batch.ts）
- 测量脚本放 scripts/perf-measure.mjs 入库
- npm test 全量绿 + npx tsc -p web/tsconfig.json 零错误 + npm run build 成功 + npx playwright test 1/1 绿
- 动态对象约定：在创建处设 `obj.userData.dynamic = true`，合批阶段跳过其子树
- glow windows：所有活跃窗户共用 **1 个** MeshBasicMaterial，updateBuildings 只 set 一次
- 烟雾 puffs：每 puff 保留独立 MeshLambertMaterial（opacity 独立逐帧变化）
- 红绿灯三色灯 mats：每灯独立，不共享（逐灯 setHex）
- 区块 plate（ExtrudeGeometry）不参与合批，保留拾取 userData
- 合批报告写到 /Users/xueqiang/Git/notopolis/.superpowers/sdd/task-perf-report.md
- commit message 前缀 `perf(web):`，HEREDOC 双署名（Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> + git config user）

---

## File Map

| 文件 | 动作 | 职责 |
|------|------|------|
| `web/src/scene/materials.ts` | 新建 | 全局共享材质缓存：sharedLambert / sharedBasic |
| `web/src/scene/geometries.ts` | 新建 | 全局共享几何缓存：sharedBox / sharedSoftBox |
| `web/src/scene/batch.ts` | 新建 | 静态合批：bakeStatic(root, scene) |
| `web/src/city/buildings.ts` | 修改 | 使用共享材质/几何；glow windows 共用 1 mat；标记动态对象；生成拾取代理盒 |
| `web/src/city/roads.ts` | 修改 | 使用共享材质/几何；灯杆/灯箱用 sharedBox |
| `web/src/city/districts.ts` | 修改 | 使用共享材质；bench/stairs 用 sharedBox |
| `web/src/agents/vehicles.ts` | 修改 | 使用共享材质/几何；整个载具 Group 标记 dynamic |
| `web/src/agents/citizens.ts` | 修改 | 整个市民 Group 标记 dynamic；limb geo 用缓存 |
| `web/src/world/vegetation.ts` | 重写 | 松冠/阔叶冠/树干/岩石改 InstancedMesh；云保持动态 Group |
| `web/src/views/cityview.ts` | 修改 | buildBuildings 后调用 bakeStatic(rootGroup)；拾取 pickables 切换代理盒 |
| `web/src/scene/picking.ts` | 无需改 | 通过 userData.root 向上查找，代理盒上挂 userData 即可 |
| `scripts/perf-measure.mjs` | 新建 | 无头 Chromium 采样脚本 |
| `web/tests/scene-materials.test.ts` | 新建 | sharedLambert/sharedBasic 缓存行为单测 |
| `web/tests/scene-geometries.test.ts` | 新建 | sharedBox/sharedSoftBox 缓存行为单测 |
| `web/tests/scene-batch.test.ts` | 新建 | bakeStatic 合批逻辑单测 |
| `web/tests/city-buildings.test.ts` | 修改 | 追加：代理盒 userData 断言、glowWindows 材质共享断言 |
| `tests/e2e/smoke.spec.ts` | 无需改 | 现有 pickBuilding(0) 路径经代理盒仍可触发 |

---

### Task 1: 共享材质缓存（materials.ts）

**Files:**
- Create: `web/src/scene/materials.ts`
- Create: `web/tests/scene-materials.test.ts`

**Interfaces:**
- Produces:
  - `sharedLambert(color: number, opts?: { transparent?: boolean; opacity?: number; side?: THREE.Side }): THREE.MeshLambertMaterial`
  - `sharedBasic(color: number, opts?: { transparent?: boolean; opacity?: number; depthWrite?: boolean; colorWrite?: boolean }): THREE.MeshBasicMaterial`
  - `sharedInvisible(): THREE.MeshBasicMaterial`  — transparent+opacity 0+depthWrite false+colorWrite false，拾取代理盒专用

- [ ] **Step 1: 写失败测试**

```typescript
// web/tests/scene-materials.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sharedLambert, sharedBasic, sharedInvisible } from '../src/scene/materials';
import * as THREE from 'three';

describe('sharedLambert', () => {
  it('相同 color+opts 返回同一实例', () => {
    const a = sharedLambert(0xff0000);
    const b = sharedLambert(0xff0000);
    expect(a).toBe(b);
  });

  it('不同 color 返回不同实例', () => {
    const a = sharedLambert(0xff0000);
    const b = sharedLambert(0x00ff00);
    expect(a).not.toBe(b);
  });

  it('带 opts 时以 JSON 序列化为 key', () => {
    const a = sharedLambert(0xff0000, { transparent: true, opacity: 0.5 });
    const b = sharedLambert(0xff0000, { transparent: true, opacity: 0.5 });
    expect(a).toBe(b);
    const c = sharedLambert(0xff0000, { transparent: true, opacity: 0.9 });
    expect(a).not.toBe(c);
  });

  it('返回 MeshLambertMaterial', () => {
    expect(sharedLambert(0x123456)).toBeInstanceOf(THREE.MeshLambertMaterial);
  });
});

describe('sharedBasic', () => {
  it('相同 color+opts 返回同一实例', () => {
    const a = sharedBasic(0x333333);
    const b = sharedBasic(0x333333);
    expect(a).toBe(b);
  });
});

describe('sharedInvisible', () => {
  it('每次调用返回同一实例', () => {
    const a = sharedInvisible();
    const b = sharedInvisible();
    expect(a).toBe(b);
  });

  it('transparent=true, opacity=0, depthWrite=false, colorWrite=false', () => {
    const m = sharedInvisible();
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0);
    expect(m.depthWrite).toBe(false);
    expect(m.colorWrite).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-materials.test.ts
```
预期：FAIL，模块找不到

- [ ] **Step 3: 实现 materials.ts**

```typescript
// web/src/scene/materials.ts
import * as THREE from 'three';

const lambertCache = new Map<string, THREE.MeshLambertMaterial>();
const basicCache   = new Map<string, THREE.MeshBasicMaterial>();

export function sharedLambert(
  color: number,
  opts?: { transparent?: boolean; opacity?: number; side?: THREE.Side }
): THREE.MeshLambertMaterial {
  const key = color + (opts ? JSON.stringify(opts) : '');
  let m = lambertCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    lambertCache.set(key, m);
  }
  return m;
}

export function sharedBasic(
  color: number,
  opts?: { transparent?: boolean; opacity?: number; depthWrite?: boolean; colorWrite?: boolean }
): THREE.MeshBasicMaterial {
  const key = color + (opts ? JSON.stringify(opts) : '');
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, ...opts });
    basicCache.set(key, m);
  }
  return m;
}

let _invisible: THREE.MeshBasicMaterial | null = null;

export function sharedInvisible(): THREE.MeshBasicMaterial {
  if (!_invisible) {
    _invisible = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
  }
  return _invisible;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-materials.test.ts
```
预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/scene/materials.ts web/tests/scene-materials.test.ts
git commit -m "$(cat <<'EOF'
perf(web): add shared material cache (Task 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config --get user.name) <$(git config --get user.email)>
EOF
)"
```

> 注意：commit 时把上面两行 Co-Authored-By 中的 `$(git config ...)` 替换为真实值，或改用两步：先读取变量，再写入 HEREDOC。

---

### Task 2: 共享几何缓存（geometries.ts）

**Files:**
- Create: `web/src/scene/geometries.ts`
- Create: `web/tests/scene-geometries.test.ts`

**Interfaces:**
- Consumes: Three.js `BoxGeometry`, `SoftBox`（from `../scene/softbox`）
- Produces:
  - `sharedBox(w: number, h: number, d: number): THREE.BoxGeometry` — plain 12-tri box，Map 缓存
  - `sharedSoftBox(w: number, h: number, d: number): RoundedBoxGeometry` — 圆角 box，Map 缓存，建筑主体级别用
  - `sharedCylinder(r1: number, r2: number, h: number, seg: number): THREE.CylinderGeometry` — 缓存
  - `sharedLimbGeo(r1: number, r2: number, len: number): THREE.CylinderGeometry` — 含 translate(0,-len/2,0)，缓存

- [ ] **Step 1: 写失败测试**

```typescript
// web/tests/scene-geometries.test.ts
import { describe, it, expect } from 'vitest';
import { sharedBox, sharedSoftBox, sharedCylinder, sharedLimbGeo } from '../src/scene/geometries';
import * as THREE from 'three';

describe('sharedBox', () => {
  it('相同尺寸返回同一实例', () => {
    const a = sharedBox(1, 2, 3);
    const b = sharedBox(1, 2, 3);
    expect(a).toBe(b);
  });

  it('不同尺寸返回不同实例', () => {
    const a = sharedBox(1, 1, 1);
    const b = sharedBox(2, 1, 1);
    expect(a).not.toBe(b);
  });

  it('返回 BoxGeometry', () => {
    expect(sharedBox(1, 1, 1)).toBeInstanceOf(THREE.BoxGeometry);
  });
});

describe('sharedSoftBox', () => {
  it('相同尺寸返回同一实例', () => {
    const a = sharedSoftBox(2, 3, 2);
    const b = sharedSoftBox(2, 3, 2);
    expect(a).toBe(b);
  });

  it('顶点数比 BoxGeometry 多（圆角细分）', () => {
    const soft = sharedSoftBox(1, 1, 1);
    const box = sharedBox(1, 1, 1);
    const softPos = soft.getAttribute('position');
    const boxPos = box.getAttribute('position');
    expect(softPos.count).toBeGreaterThan(boxPos.count);
  });
});

describe('sharedCylinder', () => {
  it('相同参数返回同一实例', () => {
    const a = sharedCylinder(0.1, 0.12, 1.6, 8);
    const b = sharedCylinder(0.1, 0.12, 1.6, 8);
    expect(a).toBe(b);
  });
});

describe('sharedLimbGeo', () => {
  it('相同参数返回同一实例', () => {
    const a = sharedLimbGeo(0.05, 0.045, 0.4);
    const b = sharedLimbGeo(0.05, 0.045, 0.4);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-geometries.test.ts
```
预期：FAIL

- [ ] **Step 3: 实现 geometries.ts**

```typescript
// web/src/scene/geometries.ts
import * as THREE from 'three';
import { SoftBox } from './softbox';

const boxCache      = new Map<string, THREE.BoxGeometry>();
const softboxCache  = new Map<string, InstanceType<typeof SoftBox>>();
const cylinderCache = new Map<string, THREE.CylinderGeometry>();
const limbCache     = new Map<string, THREE.CylinderGeometry>();

function k(...args: number[]): string {
  return args.join(',');
}

export function sharedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = k(w, h, d);
  let g = boxCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxCache.set(key, g); }
  return g;
}

export function sharedSoftBox(w: number, h: number, d: number): InstanceType<typeof SoftBox> {
  const key = k(w, h, d);
  let g = softboxCache.get(key);
  if (!g) { g = new SoftBox(w, h, d); softboxCache.set(key, g); }
  return g;
}

export function sharedCylinder(r1: number, r2: number, h: number, seg: number): THREE.CylinderGeometry {
  const key = k(r1, r2, h, seg);
  let g = cylinderCache.get(key);
  if (!g) { g = new THREE.CylinderGeometry(r1, r2, h, seg); cylinderCache.set(key, g); }
  return g;
}

/**
 * 用于 citizens.ts limb()：带 translate(0,-len/2,0) 的圆柱几何。
 * WARNING: 共享几何不能再次调用 translate()，调用方只做 position 偏移即可。
 */
export function sharedLimbGeo(r1: number, r2: number, len: number): THREE.CylinderGeometry {
  const key = k(r1, r2, len);
  let g = limbCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(r1, r2, len, 6);
    g.translate(0, -len / 2, 0);
    limbCache.set(key, g);
  }
  return g;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-geometries.test.ts
```
预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/scene/geometries.ts web/tests/scene-geometries.test.ts
git commit -m "$(cat <<'EOF'
perf(web): add shared geometry cache (Task 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 3: 替换 buildings.ts 里的材质/几何 + 共用 glowMat + 生成代理盒

**Files:**
- Modify: `web/src/city/buildings.ts`
- Modify: `web/tests/city-buildings.test.ts`（追加断言）

**Interfaces:**
- Consumes: `sharedLambert`, `sharedBasic`, `sharedInvisible`（Task 1）; `sharedBox`, `sharedSoftBox`, `sharedCylinder`（Task 2）
- Produces（修改后 BuildingsResult 新增字段）:
  ```typescript
  export interface BuildingsResult {
    pickables: THREE.Object3D[];  // 现在是代理盒数组
    proxyBoxes: THREE.Mesh[];     // 与 pickables 相同引用，供合批阶段查阅
    glowWindows: THREE.Mesh[];
    glowMat: THREE.MeshBasicMaterial;  // 唯一共用 glow 材质
    smokes: SmokePuff[];
    windmills: THREE.Group[];
  }
  ```

**关键变更清单（参考 buildings.ts 源码）：**

1. 删除内部 `M()` 函数，改为 `sharedLambert(color)` 调用。
2. 窗户材质：`active` 时所有窗共用模块级 `glowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 })`（在 `buildBuildings` 入口创建一次）；非 active 仍用 `sharedBasic(0x46505c)`。
3. 门（door SoftBox）改 `sharedBox(0.5, 0.85, 0.06)` + `sharedLambert(0x6f5a3e)`。
4. 窗户几何（SoftBox 0.32, 0.42, 0.05）改 `sharedBox(0.32, 0.42, 0.05)`。
5. 烟囱几何（SoftBox 0.35, 0.9, 0.35）改 `sharedSoftBox(0.35, 0.9, 0.35)`（允许圆角但共享）。
6. 烟雾 puff SphereGeometry：改用 `sharedCylinder` 不适合；保留独立 `new THREE.SphereGeometry(0.16, 6, 5)` 但材质也可 clone 一份（opacity 独立）。实际上 puff 本身是动态的，保留独立材质没问题（每 smoke 最多 3 puff，数量小）。
7. 各 arch 的主体 SoftBox 改 `sharedSoftBox()`；prismGeo 不缓存（形状唯一性低，行数少，可按需缓存或保留 new）。
8. 雉堞（crenel SoftBox 0.3, 0.4, 0.3）改 `sharedBox(0.3, 0.4, 0.3)`。
9. 医院红十字（SoftBox + SoftBox）改 `sharedBox()`。
10. 集市雨棚条（SoftBox per stripe）改 `sharedBox()`。
11. 动态对象标记：windmill blades Group → `blades.userData.dynamic = true`；烟雾 puff Group 在 addChimney 里标记 `p.userData.dynamic = true`。
12. **每栋楼生成代理盒**（用于拾取）：

```typescript
// 在 g.position/rotation 设置后，pickables.push(g) 之前：
const bboxW = Math.max(bw, bd) * 1.2;
const proxy = new THREE.Mesh(sharedBox(bboxW, Math.max(bh, 2) + 1, bboxW), sharedInvisible());
proxy.userData = { type: 'building', b, dir: d.dir, root: proxy };
proxy.position.set(b.x - cx, (Math.max(bh, 2) + 1) / 2, b.z - cz);
proxy.rotation.y = b.rotY;
proxy.userData.dynamic = false; // 明确标记为静态（实际不动，但不合批 proxy 本身，见 batch.ts）
scene.add(proxy);
pickables.push(proxy);
proxyBoxes.push(proxy);
```

- [ ] **Step 1: 追加 city-buildings.test.ts 断言（先写失败测试）**

在 `web/tests/city-buildings.test.ts` 文件末尾追加：

```typescript
// ---------- 追加：Task 3 验证 ----------

describe('glowWindows 共用同一 MeshBasicMaterial 实例（active 建筑）', () => {
  it('所有 glowWindows 的 material 是同一个引用', () => {
    const scene = new THREE.Scene();
    const result = buildBuildings(scene, city, 0, 0, NOW - 1 * DAY); // NOW - 1day → active
    if (result.glowWindows.length < 2) return; // 没有足够窗户则跳过
    const first = result.glowWindows[0].material;
    for (const w of result.glowWindows) {
      expect(w.material).toBe(first);
    }
  });
});

describe('代理盒 userData', () => {
  it('每栋建筑对应 1 个代理盒，userData.type === building', () => {
    const scene = new THREE.Scene();
    const result = buildBuildings(scene, city, 0, 0, NOW);
    expect(result.pickables.length).toBe(city.districts[0].buildings.length);
    for (const p of result.pickables) {
      expect((p.userData as any).type).toBe('building');
    }
  });
});
```

- [ ] **Step 2: 运行确认新测试失败**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/city-buildings.test.ts 2>&1 | tail -20
```
预期：新增的两个 describe 失败

- [ ] **Step 3: 修改 buildings.ts**

修改要点（在已读源码基础上逐点操作）：

**3a. 顶部 import 追加：**
```typescript
import { sharedLambert, sharedBasic, sharedInvisible } from '../scene/materials';
import { sharedBox, sharedSoftBox, sharedCylinder } from '../scene/geometries';
```

**3b. 删除内部 `M()` 函数，全局替换调用：**
```typescript
// 删除：
function M(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}
// 所有 M(color) 调用替换为 sharedLambert(color)
```

**3c. addWindows 内：**
- `new THREE.MeshBasicMaterial({ color: 0xffd9a0 })` → 改为接收外部传入的 `glowMat` 参数
- `new SoftBox(0.32, 0.42, 0.05)` → `sharedBox(0.32, 0.42, 0.05)`
- `new SoftBox(0.5, 0.85, 0.06)` (door) → `sharedBox(0.5, 0.85, 0.06)`
- `M(0x46505c)` → `sharedBasic(0x46505c)`

addWindows 签名改为：
```typescript
function addWindows(
  g: THREE.Group,
  bw: number,
  bh: number,
  bd: number,
  rnd: () => number,
  active: boolean,
  glowWindows: THREE.Mesh[],
  glowMat: THREE.MeshBasicMaterial   // 新增
): void
```

**3d. addChimney 内：**
- `new SoftBox(0.35, 0.9, 0.35)` → `sharedSoftBox(0.35, 0.9, 0.35)`
- `sharedLambert(0x9a8f80)` 替换 M() 调用
- puff 材质保留 new（opacity 独立，数量极少）
- puff mesh 标记 `p.userData.dynamic = true`

**3e. BuildingsResult 新增 glowMat / proxyBoxes：**
```typescript
export interface BuildingsResult {
  pickables: THREE.Object3D[];
  proxyBoxes: THREE.Mesh[];
  glowWindows: THREE.Mesh[];
  glowMat: THREE.MeshBasicMaterial;
  smokes: SmokePuff[];
  windmills: THREE.Group[];
}
```

**3f. buildBuildings 函数开头创建 glowMat：**
```typescript
const proxyBoxes: THREE.Mesh[] = [];
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
```

**3g. 各 arch 主体 SoftBox → sharedSoftBox；雉堞/小件 SoftBox → sharedBox：**
- temple body: `new SoftBox(tw, th, tw)` → `sharedSoftBox(tw, th, tw)`
- civic body: `new SoftBox(bw * 1.6, 2.4, bd * 1.2)` → `sharedSoftBox(bw * 1.6, 2.4, bd * 1.2)`
- tower crenel: `new SoftBox(0.3, 0.4, 0.3)` → `sharedBox(0.3, 0.4, 0.3)`
- manor body: `sharedSoftBox(bw, bh, bd)` 等
- hospital crossV/crossH: `new SoftBox(0.2, 0.7, 0.06)` / `new SoftBox(0.7, 0.2, 0.06)` → `sharedBox()`
- windmill blade: `new SoftBox(0.25, 2.2, 0.05)` → `sharedBox(0.25, 2.2, 0.05)`
- windmill blades Group: `blades.userData.dynamic = true`（风车扇叶会旋转）
- inn signArm/sign: `sharedBox()`
- market stripes/stall/crate: `sharedBox()`
- moss/weed (dormant): `sharedSoftBox()` / 保留 ConeGeometry（已 new，尺寸唯一性低，可选共享）

**3h. 每栋楼 g.add 到 scene 前，生成代理盒：**
```typescript
// 在所有 arch if-else 完成后，dormant/construction 追加后：
const proxyW = (bw + 0.4) * 1.3;
const proxyH = bh + 2.5;
const proxy = new THREE.Mesh(sharedBox(proxyW, proxyH, proxyW), sharedInvisible());
proxy.position.set(b.x - cx, proxyH / 2, b.z - cz);
proxy.rotation.y = b.rotY;
proxy.userData = { type: 'building', b, dir: d.dir, root: proxy };
scene.add(proxy);
pickables.push(proxy);
proxyBoxes.push(proxy);

// 建筑 Group 不再推入 pickables，但仍 scene.add：
g.position.set(b.x - cx, 0, b.z - cz);
g.rotation.y = b.rotY;
g.userData = { type: 'building', b, dir: d.dir };
g.traverse((o) => { o.userData.root = g; });
scene.add(g);
// 注意：pickables.push(g) 这行删掉，改为推 proxy
```

**3i. 返回时加上 glowMat / proxyBoxes：**
```typescript
return { pickables, proxyBoxes, glowWindows, glowMat, smokes, windmills };
```

**3j. updateBuildings 改为只 set glowMat 一次：**
```typescript
export function updateBuildings(result: BuildingsResult, t: number): void {
  // glowWindows 呼吸 — 所有窗共用同一材质，只改一次
  if (result.glowWindows.length > 0) {
    result.glowMat.color.setHSL(0.09, 0.85, 0.72 + Math.sin(t * 2.2) * 0.08);
  }
  // smokes / windmills 保持不变
  ...
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/city-buildings.test.ts
```
预期：全部 PASS（含旧测试）

- [ ] **Step 5: TypeScript 检查**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit
```
预期：零错误

- [ ] **Step 6: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/city/buildings.ts web/tests/city-buildings.test.ts
git commit -m "$(cat <<'EOF'
perf(web): shared mat/geo + proxy boxes in buildings (Task 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 4: 替换 roads / districts / vehicles / citizens 里的材质/几何

**Files:**
- Modify: `web/src/city/roads.ts`
- Modify: `web/src/city/districts.ts`
- Modify: `web/src/agents/vehicles.ts`
- Modify: `web/src/agents/citizens.ts`

**Interfaces:**
- Consumes: `sharedLambert`, `sharedBasic`（Task 1）; `sharedBox`, `sharedSoftBox`, `sharedCylinder`, `sharedLimbGeo`（Task 2）

**变更清单：**

**roads.ts：**
- 删除内部 `mat()` 工厂（已有，改为 `sharedLambert`）
- `buildRoadMeshes`：
  - 道路段 `new SoftBox(len+w*0.5, 0.07, w)` → 道路段尺寸唯一性高（每段不同 len），**保留 new SoftBox**（道路段是连续大块，数量有限；合批会处理）
  - mat 改为函数外 Map 缓存：街道 / main / avenue 各 1 个 sharedLambert → 已覆盖
- `buildTrafficLightMeshes`：
  - 灯杆 CylinderGeometry(0.06, 0.07, 2.4, 8) → `sharedCylinder(0.06, 0.07, 2.4, 8)`
  - 灯箱 SoftBox(0.28, 0.78, 0.22) → `sharedSoftBox(0.28, 0.78, 0.22)`
  - 灯珠 SphereGeometry(0.075, 8, 8) → 只有 3×8=24 个，保留 new 或用 sharedCylinder 近似；保留 new（灯珠动态改色，不合批）
  - 灯珠材质：**每灯保留独立 new MeshBasicMaterial**（`updateTrafficLights` 逐灯 setHex）
  - 灯杆/灯箱材质改 sharedLambert

```typescript
// roads.ts 顶部追加：
import { sharedLambert } from '../scene/materials';
import { sharedCylinder, sharedSoftBox } from '../scene/geometries';
```

**districts.ts：**
- 删除内部 `waterMat()` / `sandMat()` 工厂（每次调用 new），改为：
  ```typescript
  import { sharedLambert } from '../scene/materials';
  import { sharedBox } from '../scene/geometries';
  import * as THREE from 'three';
  // water: sharedLambert(0x2fa4e8, { transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  // sand:  sharedLambert(0xd9c9a0, { side: THREE.DoubleSide })
  ```
- bench（buildPark）：`new SoftBox(0.7, 0.12, 0.25)` → `sharedBox(0.7, 0.12, 0.25)`
- park trunk/crown CylinderGeometry/SphereGeometry：尺寸固定，可用 `sharedCylinder(0.1, 0.14, 0.6, 5)`
- 灌木 SphereGeometry(随机 r)：r = 0.35+rndS()*0.3 故不同，**保留 new**（或做近似量化，当前级别不做）
- 花朵 SphereGeometry(0.07, 5, 5)：固定，用 `sharedCylinder` 近似不合适；数量少，**保留 new 或 sharedCylinder** → 暂保留 new

**vehicles.ts：**
- 删除内部 `mat()` 工厂，改为 `sharedLambert(color, opts?)`
- `makeCar`：
  - wheelGeo `new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10)` → `sharedCylinder(0.16, 0.16, 0.1, 10)` 
  - 车身/车窗 SoftBox → `sharedSoftBox()`
  - wheel 材质 sharedLambert(0x2e3238)
- `makeTrainUnit`：
  - wheelGeo → `sharedCylinder(0.16, 0.16, 0.1, 10)`
  - body/cab SoftBox → `sharedSoftBox()`
  - winStrip SoftBox → `sharedBox()`
  - mat(color) → `sharedLambert(color)`
- 飞机 prop SoftBox → `sharedBox(0.06, 1.0, 0.06)`
- 帆船/快艇 SoftBox → `sharedSoftBox()`
- **整个载具 Group 标记 dynamic：**
  ```typescript
  // makeCar 末尾：
  g.userData.dynamic = true;
  // makeTrainUnit 末尾：
  g.userData.dynamic = true;
  // 飞机 planeG：
  planeG.userData.dynamic = true;
  // 帆船/快艇：
  boatG.userData.dynamic = true;
  sbG.userData.dynamic = true;
  ```
- 铁路路基/双轨 SoftBox → `sharedSoftBox()` （静态，不 dynamic）

**citizens.ts：**
- 删除内部 `mat()` 工厂，改 `sharedLambert(color)`
- `limb()` 函数：
  ```typescript
  // 改为：
  import { sharedLambertMat } from '../scene/materials'; // 即 sharedLambert
  import { sharedLimbGeo } from '../scene/geometries';
  function limb(r1: number, r2: number, len: number, color: number): THREE.Mesh {
    return new THREE.Mesh(sharedLimbGeo(r1, r2, len), sharedLambert(color));
  }
  ```
- 背篓 SoftBox → `sharedBox(0.2, 0.26, 0.14)` 
- 帽子 ConeGeometry / CylinderGeometry：固定尺寸，用 `sharedCylinder`；草帽 ConeGeometry 用 `new THREE.ConeGeometry` 保留（种类少）
- **整个市民 Group 标记 dynamic：**
  ```typescript
  // makeVillager 末尾 return g 之前：
  g.userData.dynamic = true;
  ```

- [ ] **Step 1: 修改四个文件**

按上述变更清单依次编辑：
1. `web/src/city/roads.ts`
2. `web/src/city/districts.ts`
3. `web/src/agents/vehicles.ts`
4. `web/src/agents/citizens.ts`

- [ ] **Step 2: 运行全量单测**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run
```
预期：全部 PASS

- [ ] **Step 3: TypeScript 检查**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit
```
预期：零错误

- [ ] **Step 4: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/city/roads.ts web/src/city/districts.ts web/src/agents/vehicles.ts web/src/agents/citizens.ts
git commit -m "$(cat <<'EOF'
perf(web): shared mat/geo in roads/districts/vehicles/citizens (Task 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 5: 植被 InstancedMesh（vegetation.ts 重写）

**Files:**
- Modify: `web/src/world/vegetation.ts`（原 buildWilds 改为 InstancedMesh）

**Interfaces:**
- Consumes: `sharedLambert`（Task 1）
- Produces: `buildWilds` 签名不变（scene, p, wsPrefix），内部改用 InstancedMesh；`buildClouds` / `updateClouds` 不变

**说明：**
- 散生树 150 棵 + 树林团簇 14 组（6~13 棵/组）：松冠（ConeGeometry）/ 阔叶冠（SphereGeometry）/ 树干（CylinderGeometry）各 1 个 InstancedMesh；岩石 1 个 InstancedMesh（IcosahedronGeometry）
- 实例矩阵 = 原算法的 position + scale，材质与原相同颜色（无 per-instance color）
- 云层 buildClouds 保持原动态 Group（每朵云每帧 x 方向漂移）

**关键问题：** 原 plantTree 的树选冠类型 `rnd() < 0.65 ? ConeGeo : SphereGeo` 和材质 `rnd() < 0.65 ? matPine : matOak`，意味着每棵树随机属于 4 个组合（细分为：松冠+松材质、阔叶冠+橡树材质为主要，其余为杂交）。简化方案：**按 rnd() < 0.65 分入"松树组"（ConeGeo+matPine）和"阔叶组"（SphereGeo+matOak）**，各建 1 个 InstancedMesh。树干共用 1 个 InstancedMesh（松+阔叶共 totalTrees 棵）。岩石固定 1 个。

预分配上限：松树最多 ~180（150+团簇上限）× 0.7 ≈ 126，阔叶最多 54，树干 = 总树数。建议上限：松 200、阔叶 100、树干 300、岩 40。

- [ ] **Step 1: 重写 vegetation.ts**

```typescript
/**
 * world/vegetation.ts — InstancedMesh 版本（松冠/阔叶冠/树干/岩石各1个 InstancedMesh）
 */

import * as THREE from 'three';
import { rng0 } from '../util/seed';
import type { WorldParams } from './params';
import { terrainH } from './terrain';
import { polyDist } from '../util/poly';
import { sharedLambert } from '../scene/materials';

export interface CloudState {
  g: THREE.Group;
  v: number;
}

const MAT_PINE  = () => sharedLambert(0x2f8a3c);
const MAT_OAK   = () => sharedLambert(0x4fae3f);
const MAT_TRUNK = () => sharedLambert(0x7a5c38);
const MAT_ROCK  = () => sharedLambert(0x8f8a7c); // flatShading 在 InstancedMesh 上需要 material.flatShading=true

const MAX_PINE  = 200;
const MAX_OAK   = 100;
const MAX_TRUNK = 300;
const MAX_ROCK  = 40;

export function buildWilds(scene: THREE.Scene, p: WorldParams, wsPrefix: string): void {
  const rnd = rng0(wsPrefix + ':wilds');
  const { RIVER_W, lakes, canalPts, cityHalfW, cityHalfD, T } = p;

  // ---- InstancedMesh 容器 ----
  const geoCone   = new THREE.ConeGeometry(1, 2.6, 7);
  const geoSphere = new THREE.SphereGeometry(1.1, 7, 6);
  const geoCyl    = new THREE.CylinderGeometry(0.14, 0.2, 1, 5);
  const geoRock   = new THREE.IcosahedronGeometry(1, 0);

  const matRock = sharedLambert(0x8f8a7c);
  (matRock as THREE.MeshLambertMaterial).flatShading = true;

  const imPine  = new THREE.InstancedMesh(geoCone,   MAT_PINE(),  MAX_PINE);
  const imOak   = new THREE.InstancedMesh(geoSphere, MAT_OAK(),   MAX_OAK);
  const imTrunk = new THREE.InstancedMesh(geoCyl,    MAT_TRUNK(), MAX_TRUNK);
  const imRock  = new THREE.InstancedMesh(geoRock,   matRock,     MAX_ROCK);

  imPine.castShadow  = true;
  imOak.castShadow   = true;
  imTrunk.castShadow = false;
  imRock.castShadow  = false;

  let nPine = 0, nOak = 0, nTrunk = 0, nRock = 0;
  const dummy = new THREE.Object3D();

  function isBlocked(x: number, z: number): boolean {
    if (p.riverDist(x, z) < RIVER_W + 4) return true;
    for (const lk of lakes) {
      if (Math.hypot(x - lk.x, z - lk.z) < lk.r + 2) return true;
    }
    if (polyDist(x, z, canalPts) < 4) return true;
    return false;
  }

  function plantTree(x: number, z: number, s: number, isPine: boolean): void {
    if (nTrunk >= MAX_TRUNK) return;
    const h = terrainH(x, z, p);
    if (h > 13 || h < -0.4) return;
    if (isBlocked(x, z)) return;

    // 树干
    dummy.position.set(x, h + 0.5, z);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    if (nTrunk < MAX_TRUNK) {
      imTrunk.setMatrixAt(nTrunk++, dummy.matrix);
    }

    // 冠
    dummy.position.set(x, h + 2, z);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    if (isPine && nPine < MAX_PINE) {
      imPine.setMatrixAt(nPine++, dummy.matrix);
    } else if (!isPine && nOak < MAX_OAK) {
      imOak.setMatrixAt(nOak++, dummy.matrix);
    }
  }

  // 散生树 150 棵
  for (let i = 0; i < 150; i++) {
    const x = (rnd() - 0.5) * T * 1.9;
    const z = (rnd() - 0.5) * T * 1.9;
    if (Math.abs(x) < cityHalfW + 12 && Math.abs(z) < cityHalfD + 12) continue;
    const s = 0.8 + rnd() * 1.4;
    const isPine = rnd() < 0.65;
    plantTree(x, z, s, isPine);
  }

  // 树林团簇
  for (let gi = 0; gi < 14; gi++) {
    const gx = (rnd() - 0.5) * T * 1.7;
    const gz = (rnd() - 0.5) * T * 1.7;
    if (Math.abs(gx) < cityHalfW + 18 && Math.abs(gz) < cityHalfD + 18) continue;
    if (terrainH(gx, gz, p) > 11) continue;
    const n = 6 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = rnd() * 8;
      const s = 0.9 + rnd() * 1.3;
      const isPine = rnd() < 0.65;
      plantTree(gx + Math.cos(a) * rr, gz + Math.sin(a) * rr, s, isPine);
    }
  }

  // 岩石 40 块
  for (let i = 0; i < 40 && nRock < MAX_ROCK; i++) {
    const x = (rnd() - 0.5) * T * 1.8;
    const z = (rnd() - 0.5) * T * 1.8;
    if (Math.abs(x) < cityHalfW + 10 && Math.abs(z) < cityHalfD + 10) continue;
    const h = terrainH(x, z, p);
    if (h < -1) continue;
    dummy.position.set(x, h + 0.3, z);
    dummy.scale.set(0.6 + rnd() * 2, 0.5 + rnd() * 1.2, 0.6 + rnd() * 2);
    dummy.rotation.y = rnd() * Math.PI;
    dummy.updateMatrix();
    imRock.setMatrixAt(nRock++, dummy.matrix);
  }

  // 设置实际 count，更新矩阵
  imPine.count  = nPine;
  imOak.count   = nOak;
  imTrunk.count = nTrunk;
  imRock.count  = nRock;
  imPine.instanceMatrix.needsUpdate  = true;
  imOak.instanceMatrix.needsUpdate   = true;
  imTrunk.instanceMatrix.needsUpdate = true;
  imRock.instanceMatrix.needsUpdate  = true;

  scene.add(imPine, imOak, imTrunk, imRock);
}

export function buildClouds(
  scene: THREE.Scene,
  p: WorldParams,
  wsPrefix: string
): CloudState[] {
  // 云层保持原动态 Group（每朵每帧漂移）
  const rnd = rng0(wsPrefix + ':clouds');
  const { T } = p;
  const clouds: CloudState[] = [];
  const mat = sharedLambert(0xffffff, { transparent: true, opacity: 0.92 });

  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 4, 7, 6), mat);
      puff.position.set(j * 4.5 - n * 2, rnd() * 1.5, rnd() * 3);
      puff.scale.y = 0.55;
      g.add(puff);
    }
    g.position.set(
      (rnd() - 0.5) * T * 1.6,
      55 + rnd() * 30,
      (rnd() - 0.5) * T * 1.6
    );
    g.userData.dynamic = true; // 云层每帧移动
    scene.add(g);
    clouds.push({ g, v: 0.6 + rnd() * 0.8 });
  }

  return clouds;
}

export function updateClouds(clouds: CloudState[], _t: number, T: number): void {
  for (const c of clouds) {
    c.g.position.x += c.v * 0.016;
    if (c.g.position.x > T * 1.1) c.g.position.x = -T * 1.1;
  }
}
```

- [ ] **Step 2: 运行全量单测（vegetation 无独立测试，跑全集确认无回归）**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run
```
预期：全部 PASS

- [ ] **Step 3: TypeScript 检查**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit
```
预期：零错误

- [ ] **Step 4: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/world/vegetation.ts
git commit -m "$(cat <<'EOF'
perf(web): vegetation InstancedMesh (Task 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 6: 静态合批（batch.ts）+ cityview.ts 集成

**Files:**
- Create: `web/src/scene/batch.ts`
- Create: `web/tests/scene-batch.test.ts`
- Modify: `web/src/views/cityview.ts`

**Interfaces:**
- Consumes: `BufferGeometryUtils.mergeGeometries`（three/examples/jsm/utils/BufferGeometryUtils.js）
- Produces:
  - `bakeStatic(root: THREE.Group, scene: THREE.Scene): void` — 合批 root 下所有静态 Mesh，原 Mesh 从 scene/root 移除，合批结果加回 scene

**合批规则：**
1. 先 `root.updateMatrixWorld(true)` 确保 matrixWorld 最新
2. 遍历 root（含 rootGroup 本身）：凡 Mesh 满足以下全部条件纳入合批：
   - `!obj.userData.dynamic` && `!isAncestorDynamic(obj)`
   - `material` 不是数组（single material）
   - `geometry` 不是 `InstancedMesh`（InstancedMesh 本身已批）
   - `visible !== false`（合批后的 baked mesh 继承 castShadow / receiveShadow）
   - `material.transparent !== true`（透明材质保守跳过，避免深度排序问题）
   - material 不是 `MeshBasicMaterial`（red-cross / proxy boxes / glow windows / AO circle 等 Basic 材质要么透明要么独立，统一跳过）
3. 按 `material.uuid` 分桶
4. 每桶：`geo.clone().applyMatrix4(mesh.matrixWorld)` 收集，`BufferGeometryUtils.mergeGeometries(geos)` 合并
5. 合批结果 Mesh 设 `castShadow = anyInBucket.castShadow`，`receiveShadow = anyInBucket.receiveShadow`，加入 scene
6. 原 Mesh 从父节点 remove（但不 remove 其 Group 父节点——动态子对象的 Group 壳要保留）

**isAncestorDynamic 实现：**
```typescript
function isAncestorDynamic(obj: THREE.Object3D): boolean {
  let cur = obj.parent;
  while (cur) {
    if (cur.userData.dynamic) return true;
    cur = cur.parent;
  }
  return false;
}
```

**注意事项：**
- 区块 plate（ExtrudeGeometry，MeshLambertMaterial）：透明=false，非动态 → **会被合批**。但 plate 有 userData.type='district' 用于拾取！解决：在 cityview.ts 里对 plates 设 `plate.userData.dynamic = true`（豁免合批，保留拾取能力）。
- 代理盒（MeshBasicMaterial，transparent，opacity=0）：colorWrite=false，被"跳过 transparent"规则排除 ✓
- 烟雾 puffs（MeshLambertMaterial，transparent）：transparent=true → 跳过 ✓
- 水面（MeshLambertMaterial，transparent）：transparent=true → 跳过 ✓
- 红绿灯灯珠（MeshBasicMaterial）：Basic → 跳过 ✓

- [ ] **Step 1: 写失败测试**

```typescript
// web/tests/scene-batch.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bakeStatic } from '../src/scene/batch';

function makeScene(): { scene: THREE.Scene; root: THREE.Group } {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  return { scene, root };
}

describe('bakeStatic', () => {
  it('将同材质的两个静态 Mesh 合并为 1 个新 Mesh', () => {
    const { scene, root } = makeScene();
    const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const geo = new THREE.BoxGeometry(1, 1, 1);

    const m1 = new THREE.Mesh(geo, mat);
    m1.position.set(0, 0, 0);
    const m2 = new THREE.Mesh(geo, mat);
    m2.position.set(3, 0, 0);
    root.add(m1, m2);

    const beforeCount = scene.children.length;
    bakeStatic(root, scene);

    // 原两个 Mesh 应从 root 移除
    let remainingMeshes = 0;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) remainingMeshes++; });
    expect(remainingMeshes).toBe(0);

    // scene 中应新增至少 1 个合批 Mesh
    let bakedMeshes = 0;
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== m1 && o !== m2) bakedMeshes++; });
    expect(bakedMeshes).toBeGreaterThanOrEqual(1);
  });

  it('dynamic=true 的 Mesh 不参与合批，保留在 root 中', () => {
    const { scene, root } = makeScene();
    const mat = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const geo = new THREE.BoxGeometry(1, 1, 1);

    const dyn = new THREE.Mesh(geo, mat);
    dyn.userData.dynamic = true;
    root.add(dyn);

    bakeStatic(root, scene);

    // dyn 应仍在 root 中
    let found = false;
    root.traverse((o) => { if (o === dyn) found = true; });
    expect(found).toBe(true);
  });

  it('transparent 材质的 Mesh 不参与合批', () => {
    const { scene, root } = makeScene();
    const tMat = new THREE.MeshLambertMaterial({ color: 0x0000ff, transparent: true, opacity: 0.5 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Mesh(geo, tMat);
    root.add(m);

    bakeStatic(root, scene);

    let found = false;
    root.traverse((o) => { if (o === m) found = true; });
    expect(found).toBe(true); // 仍在 root
  });

  it('MeshBasicMaterial 的 Mesh 不参与合批', () => {
    const { scene, root } = makeScene();
    const bMat = new THREE.MeshBasicMaterial({ color: 0xe23b3b });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Mesh(geo, bMat);
    root.add(m);

    bakeStatic(root, scene);

    let found = false;
    root.traverse((o) => { if (o === m) found = true; });
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-batch.test.ts
```

- [ ] **Step 3: 实现 batch.ts**

```typescript
// web/src/scene/batch.ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function isAncestorDynamic(obj: THREE.Object3D): boolean {
  let cur = obj.parent;
  while (cur) {
    if (cur.userData.dynamic) return true;
    cur = cur.parent;
  }
  return false;
}

function canBatch(obj: THREE.Object3D): obj is THREE.Mesh {
  if (!(obj as THREE.Mesh).isMesh) return false;
  const mesh = obj as THREE.Mesh;
  if (obj.userData.dynamic) return false;
  if (isAncestorDynamic(obj)) return false;
  const mat = mesh.material;
  if (Array.isArray(mat)) return false;
  if (mat.transparent) return false;
  if (mat instanceof THREE.MeshBasicMaterial) return false;
  return true;
}

export function bakeStatic(root: THREE.Group, scene: THREE.Scene): void {
  root.updateMatrixWorld(true);

  // 收集可合批 Mesh
  const buckets = new Map<string, THREE.Mesh[]>();
  root.traverse((obj) => {
    if (!canBatch(obj)) return;
    const mesh = obj as THREE.Mesh;
    const key = (mesh.material as THREE.Material).uuid;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(mesh);
  });

  // 合并每桶
  for (const [, meshes] of buckets) {
    if (meshes.length === 0) continue;

    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });

    const merged = mergeGeometries(geos, false);
    if (!merged) continue;

    const baked = new THREE.Mesh(merged, meshes[0].material);
    baked.castShadow    = meshes.some((m) => m.castShadow);
    baked.receiveShadow = meshes.some((m) => m.receiveShadow);
    scene.add(baked);

    // 从父节点移除原 Mesh
    for (const m of meshes) {
      m.parent?.remove(m);
    }

    // 释放临时克隆的几何
    for (const g of geos) g.dispose();
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run web/tests/scene-batch.test.ts
```
预期：全部 PASS

- [ ] **Step 5: 修改 cityview.ts 集成 bakeStatic**

在 `web/src/views/cityview.ts` 中：

**5a. 追加 import：**
```typescript
import { bakeStatic } from '../scene/batch';
```

**5b. 在 buildBuildings 调用之前，对 plates 标记 dynamic（保护拾取）：**
```typescript
// ---- 6. 区块 ----
const { plates, idleSpots } = buildDistricts(sceneProxy, city, cx, cz, WS);
// plates 保留拾取，豁免合批
for (const pl of plates) { pl.userData.dynamic = true; }
```

**5c. 在 spawnCitizens/spawnVehicles 之前，buildBuildings 之后调用 bakeStatic：**
```typescript
// ---- 11. 建筑 ----
const buildResult = buildBuildings(sceneProxy, city, cx, cz, Date.now());

// ---- 合批（在 spawn 市民/载具之前，因为那些已标 dynamic 不会被合批）----
bakeStatic(rootGroup, scene);

// ---- 12. 市民 ----
const citizens = spawnCitizens(sceneProxy, { ... });
```

**5d. 修改 pickables 数组（切换为代理盒）：**
```typescript
// ---- 拾取（改用代理盒）----
const pickables: THREE.Object3D[] = [...plates, ...buildResult.pickables]; // pickables 现在是代理盒
```

**5e. dispose() 中 rootGroup.traverse 的材质/几何清理保持不变**（合批产生的 baked mesh 直接挂在 scene，dispose 里对 rootGroup 的遍历不会清理它们；需要额外处理）：

在 dispose() 的清理段追加对 scene 级 baked mesh 的清理：

```typescript
dispose(): void {
  cancelAnimationFrame(animId);
  orbitCamera.dispose();
  picking.dispose();
  scene.fog = null;
  // 清理 rootGroup
  scene.remove(rootGroup);
  rootGroup.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m?.dispose?.());
    }
  });
  // 清理 bakeStatic 产生的 baked mesh（直接挂 scene，uuid 记录在 bakedUuids 里）
  // 为此需要在 bakeStatic 后记录产生的 baked Mesh：
  // 方案：bakeStatic 返回 THREE.Mesh[]（改返回值）
  for (const baked of bakedMeshes) {
    scene.remove(baked);
    baked.geometry.dispose();
    // 材质是共享的，不 dispose
  }
  ...
}
```

因此需微调 batch.ts 返回 baked 列表：

```typescript
// batch.ts 改返回 THREE.Mesh[]
export function bakeStatic(root: THREE.Group, scene: THREE.Scene): THREE.Mesh[] {
  ...
  const baked: THREE.Mesh[] = [];
  for (const [, meshes] of buckets) {
    ...
    scene.add(bakedMesh);
    baked.push(bakedMesh);
    ...
  }
  return baked;
}
```

cityview.ts 里：
```typescript
const bakedMeshes = bakeStatic(rootGroup, scene);
```

dispose() 里用 `bakedMeshes` 清理。

- [ ] **Step 6: 更新 scene-batch.test.ts 适配返回值**

```typescript
// 改为：
const baked = bakeStatic(root, scene);
expect(baked.length).toBeGreaterThanOrEqual(1); // 替代原 bakedMeshes 计数方式
```

- [ ] **Step 7: 运行全量单测**

```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run
```
预期：全部 PASS

- [ ] **Step 8: TypeScript 检查**

```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit
```
预期：零错误

- [ ] **Step 9: Build**

```bash
cd /Users/xueqiang/Git/notopolis && npm run build
```
预期：成功

- [ ] **Step 10: Commit**

```bash
cd /Users/xueqiang/Git/notopolis
git add web/src/scene/batch.ts web/src/views/cityview.ts web/tests/scene-batch.test.ts
git commit -m "$(cat <<'EOF'
perf(web): static geometry merging with bakeStatic (Task 6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 7: 自适应像素比 + 测量脚本入库 + 性能测量 + 报告

**Files:**
- Modify: `web/src/views/cityview.ts`（渲染循环追加自适应像素比）
- Create: `scripts/perf-measure.mjs`
- Create: `/Users/xueqiang/Git/notopolis/.superpowers/sdd/task-perf-report.md`

**Interfaces:**
- Consumes: `renderer.setPixelRatio()`, `window.devicePixelRatio`

**自适应像素比逻辑：**
```typescript
// 在 loop() 中，renderer.render() 后追加：
let adaptCount = 0;   // 定义在 loop 外
// ...
function loop(t: number): void {
  ...
  renderer.render(scene, orbitCamera.camera);
  if (lastFrameT > 0) {
    frameTimes.push(t - lastFrameT);
    if (frameTimes.length > 240) frameTimes.shift();
  }
  lastFrameT = t;

  // 自适应像素比（连续 60 帧 avg > 33ms 且 pr > 1）
  if (frameTimes.length >= 60) {
    const recent = frameTimes.slice(-60);
    const avgRecent = recent.reduce((s, v) => s + v, 0) / 60;
    if (avgRecent > 33 && renderer.getPixelRatio() > 1) {
      adaptCount++;
      if (adaptCount === 1) { // 只降一次，不反复
        renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
      }
    }
  }
}
```

- [ ] **Step 1: 实现自适应像素比**

在 `web/src/views/cityview.ts` 的 `loop()` 函数外添加 `let adaptCount = 0`，在 `loop()` 内 `renderer.render()` 后追加上述逻辑。

- [ ] **Step 2: 写测量脚本**

```javascript
// scripts/perf-measure.mjs
// 无头 Chromium 采样 Notopolis 城市视图性能指标。
// 用法：NOTOPOLIS_PORT=4787 node --import tsx src/server/index.ts &
//       node scripts/perf-measure.mjs
import { chromium } from '@playwright/test';

const base = 'http://localhost:4787';
const world = await (await fetch(base + '/api/world')).json();
const kb = world.vaults.find(v => v.ok && v.noteCount > 100) ?? world.vaults.find(v => v.ok);
if (!kb) { console.error('no vault found'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(base + '/');
await page.waitForFunction(() => window.__notopolis?.view === 'worldmap', null, { timeout: 20000 });
await page.evaluate((id) => window.__notopolis.enterCity(id), kb.id);
await page.waitForFunction(
  () => window.__notopolis?.view === 'city' && window.__notopolis.pickables > 0,
  null,
  { timeout: 60000 }
);
await page.waitForTimeout(5000);
const result = await page.evaluate(() => window.__notopolis.perf());
console.log(JSON.stringify({ vault: kb.id, noteCount: kb.noteCount, ...result }));
await browser.close();
```

- [ ] **Step 3: 启动后端，逐层测量**

```bash
# 启动后端（4787 端口）
cd /Users/xueqiang/Git/notopolis
NOTOPOLIS_PORT=4787 node --import tsx src/server/index.ts &
BACKEND_PID=$!

# Build
npm run build

# 逐次 node scripts/perf-measure.mjs，记录每层结果
node scripts/perf-measure.mjs
```

记录格式：
```
基线：calls=35919 triangles=9970000 geometries=35689
Task1-4（材质/几何共享）：calls=? triangles=? geometries=?
Task5（植被 InstancedMesh）：calls=? triangles=? geometries=?
Task6（静态合批）：calls=? triangles=? geometries=?
```

- [ ] **Step 4: Kill 后端**

```bash
kill $BACKEND_PID 2>/dev/null || true
```

- [ ] **Step 5: 运行 Playwright E2E**

```bash
cd /Users/xueqiang/Git/notopolis && npx playwright test
```
预期：1/1 PASS

- [ ] **Step 6: 写性能报告**

写入 `/Users/xueqiang/Git/notopolis/.superpowers/sdd/task-perf-report.md`，格式见 Task 8。

- [ ] **Step 7: Commit（脚本+报告+自适应像素比）**

```bash
cd /Users/xueqiang/Git/notopolis
git add scripts/perf-measure.mjs web/src/views/cityview.ts .superpowers/sdd/task-perf-report.md
git commit -m "$(cat <<'EOF'
perf(web): adaptive pixel ratio + perf measurement script + report (Task 7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Co-Authored-By: $(git config user.name) <$(git config user.email)>
EOF
)"
```

---

### Task 8: 最终验收检查清单

- [ ] **Step 1: 全量单测**
```bash
cd /Users/xueqiang/Git/notopolis && npx vitest run
```
预期：全部 PASS

- [ ] **Step 2: TypeScript 检查**
```bash
cd /Users/xueqiang/Git/notopolis && npx tsc -p web/tsconfig.json --noEmit
```
预期：零错误

- [ ] **Step 3: Build**
```bash
cd /Users/xueqiang/Git/notopolis && npm run build
```
预期：成功

- [ ] **Step 4: E2E**
```bash
cd /Users/xueqiang/Git/notopolis && npx playwright test
```
预期：1/1 PASS

- [ ] **Step 5: 确认 perf 目标**

报告中 calls < 800、triangles < 3M

- [ ] **Step 6: 自检风险点**

合批后视觉风险点：
- 每栋楼的 Group 仍在 scene（供动态子对象 transform 参考），但静态几何已合批；视觉上结果等价（合批时用 matrixWorld，即已经含父 Group 的 transform）
- 拾取改用代理盒：代理盒 opacity=0 colorWrite=false，Raycaster 默认会命中（visible=true），userData.type='building' 正确 → onPick 触发卡片
- 植被 InstancedMesh：单次 draw call 无法逐棵 castShadow 控制 → 统一 castShadow=true，大 InstancedMesh 整体投影；视觉差异可接受

---

## 测量结果记录表（执行时填写）

| 阶段 | draw calls | triangles | geometries | avgMs | fps |
|------|-----------|-----------|------------|-------|-----|
| 基线 | 35,919 | 9,970,000 | 35,689 | - | - |
| Task 1-4（材质/几何共享） | TBD | TBD | TBD | - | - |
| Task 5（植被 InstancedMesh） | TBD | TBD | TBD | - | - |
| Task 6（静态合批） | TBD | TBD | TBD | - | - |
| Task 7（自适应 PR） | TBD | TBD | TBD | - | - |
| **目标** | **<800** | **<3,000,000** | — | — | — |
