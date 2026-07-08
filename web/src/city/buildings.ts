/**
 * city/buildings.ts
 * 建筑（多样化档案库）—— 将 prototype/public/index.html 行 599–965 移植为独立 TS 模块。
 * 所有几何尺寸、色值与原型完全一致；Math.random() 已替换为确定性 rng（修复原型 bug）。
 */

import * as THREE from 'three';
import type { Building, CityModel } from '@shared/types';
import { rng0 } from '../util/seed';

// --------------------------------------------------------------------------
// 常量
// --------------------------------------------------------------------------

const DAY = 86400000;

const wallPalette = [0xfff0d0, 0xffe6b8, 0xf7d9a8, 0xffedc4, 0xf5ddb0];
const roofPalette = [0xe04b38, 0x3f7ec9, 0x4fae3f, 0xf2a52e, 0xa564c9, 0xcf6b3f];

// --------------------------------------------------------------------------
// 导出类型
// --------------------------------------------------------------------------

export type SmokePuff = { puffs: THREE.Mesh[]; base: THREE.Vector3; seed: number };

export interface BuildingsResult {
  pickables: THREE.Object3D[];
  glowWindows: THREE.Mesh[];
  smokes: SmokePuff[];
  windmills: THREE.Group[];
}

// --------------------------------------------------------------------------
// 内部材质工厂（与原型 M() 函数等价）
// --------------------------------------------------------------------------

function M(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

// --------------------------------------------------------------------------
// 内部：双坡屋顶几何（prismGeo）
// --------------------------------------------------------------------------

function prismGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------
// 内部：添加窗户（addWindows）
// --------------------------------------------------------------------------

function addWindows(
  g: THREE.Group,
  bw: number,
  bh: number,
  bd: number,
  rnd: () => number,
  active: boolean,
  glowWindows: THREE.Mesh[]
): void {
  const rows = Math.max(1, Math.floor(bh / 1.3));
  const cols = Math.max(1, Math.floor(bw / 0.9));
  const mat = active
    ? new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
    : M(0x46505c);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.25) continue;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.05), mat);
      win.position.set((c + 0.5 - cols / 2) * 0.9, 1.1 + r * 1.3, bd / 2 + 0.02);
      g.add(win);
      if (active) glowWindows.push(win);
    }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.06), M(0x6f5a3e));
  door.position.set(0, 0.93, bd / 2 + 0.03);
  g.add(door);
}

// --------------------------------------------------------------------------
// 内部：添加烟囱（addChimney）
// --------------------------------------------------------------------------

function addChimney(
  g: THREE.Group,
  bw: number,
  bh: number,
  bd: number,
  active: boolean,
  smokes: SmokePuff[],
  rng: () => number
): void {
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, 0.35), M(0x9a8f80));
  ch.position.set(bw * 0.28, bh + 0.75, -bd * 0.2);
  g.add(ch);
  if (active && smokes.length < 40) {
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xdedede, transparent: true, opacity: 0.7 })
      );
      p.position.copy(ch.position);
      g.add(p);
      puffs.push(p);
    }
    // 原型 bug 修复：原型用 Math.random()*10，改为确定性 seed = rng() * 10
    smokes.push({ puffs, base: ch.position.clone(), seed: rng() * 10 });
  }
}

// --------------------------------------------------------------------------
// 主函数：buildBuildings
// --------------------------------------------------------------------------

export function buildBuildings(
  scene: THREE.Scene,
  city: CityModel,
  cx: number,
  cz: number,
  now: number
): BuildingsResult {
  const pickables: THREE.Object3D[] = [];
  const glowWindows: THREE.Mesh[] = [];
  const smokes: SmokePuff[] = [];
  const windmills: THREE.Group[] = [];

  for (const d of city.districts) {
    for (const b of d.buildings) {
      const g = new THREE.Group();
      const rnd = rng0(b.notePath);
      const ageDays = (now - b.mtimeMs) / DAY;
      const dormant = ageDays > 180, active = ageDays < 7;

      const wallC = dormant ? 0xc4bcb0 : wallPalette[Math.floor(rnd() * wallPalette.length)];
      const roofC = b.landmark ? 0xb08a3e : dormant ? 0x7a7a72 : roofPalette[Math.floor(rnd() * roofPalette.length)];

      const bw = b.size === 1 ? 1.9 : b.size === 2 ? 2.3 : 2.6;
      let bh = b.size === 1 ? 1.6 : b.size === 2 ? 2.8 : 4.2;
      const bd = bw * (0.8 + rnd() * 0.35);

      let arch: string;
      if (b.isCivic) arch = 'civic';
      else if (b.landmark) arch = 'temple';
      else if (rnd() < 0.22) arch = ['hospital', 'school', 'library', 'chapel', 'market', 'windmill', 'inn'][Math.floor(rnd() * 7)];
      else if (b.size === 3) arch = rnd() < 0.5 ? 'tower' : 'manor';
      else arch = ['cottage', 'townhouse', 'workshop', 'cottage', 'townhouse'][Math.floor(rnd() * 5)];

      if (arch === 'temple') { // 地标神殿：叠层 + 金顶
        bh = 3.2;
        const tiers = 2 + (b.size === 3 ? 1 : 0);
        for (let tItr = 0; tItr < tiers; tItr++) {
          const tw = bw * (1.5 - tItr * 0.35);
          const th = 1.7;
          const body = new THREE.Mesh(new THREE.BoxGeometry(tw, th, tw), M(wallC));
          body.position.y = 0.5 + tItr * (th + 0.35) + th / 2;
          body.castShadow = body.receiveShadow = true;
          g.add(body);
          const tRoof = new THREE.Mesh(new THREE.ConeGeometry(tw * 0.85, 0.7, 4), M(roofC));
          tRoof.position.y = 0.5 + tItr * (th + 0.35) + th + 0.3;
          tRoof.rotation.y = Math.PI / 4;
          tRoof.castShadow = true;
          g.add(tRoof);
        }
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 6), M(0xd9c58a));
        finial.position.y = 0.5 + tiers * 2.05 + 0.6;
        g.add(finial);
        addWindows(g, bw * 1.4, 1.6, bw * 1.5, rnd, active, glowWindows);
      } else if (arch === 'civic') { // 区府：门廊立柱 + 旗
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.6, 2.4, bd * 1.2), M(wallC));
        body.position.y = 0.5 + 1.2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.75, 1.1, bd * 1.35), M(roofC));
        roof.position.y = 2.9;
        roof.castShadow = true;
        g.add(roof);
        for (let i = 0; i < 4; i++) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.6, 8), M(0xe8e0d0));
          col.position.set((i - 1.5) * 0.7, 1.3, bd * 0.6 + 0.35);
          g.add(col);
        }
        const porch = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.4, 0.12, 1), M(roofC));
        porch.position.set(0, 2.15, bd * 0.6 + 0.35);
        g.add(porch);
        const plaza = new THREE.Mesh(new THREE.CylinderGeometry(bw * 1.8, bw * 1.8, 0.08, 24), M(0xcfc2a0));
        plaza.position.y = 0.55;
        g.add(plaza);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), M(0x8a6a45));
        pole.position.set(bw * 1.1, 2, bd * 0.5);
        g.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), M(0xa85c50));
        flag.position.set(bw * 1.1 + 0.5, 3.2, bd * 0.5);
        g.add(flag);
        addWindows(g, bw * 1.6, 2.4, bd * 1.2, rnd, active, glowWindows);
      } else if (arch === 'tower') { // 石塔 + 雉堞
        const body = new THREE.Mesh(new THREE.CylinderGeometry(bw * 0.55, bw * 0.65, bh + 1, 8), M(0xb8b0a0));
        body.position.y = 0.5 + (bh + 1) / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        for (let i = 0; i < 6; i++) {
          const crenel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), M(0xa8a090));
          const ang = (i / 6) * Math.PI * 2;
          crenel.position.set(Math.cos(ang) * bw * 0.5, bh + 1.7, Math.sin(ang) * bw * 0.5);
          g.add(crenel);
        }
        const cone = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.45, 1.4, 8), M(roofC));
        cone.position.y = bh + 2.4;
        cone.castShadow = true;
        g.add(cone);
        addWindows(g, bw * 0.8, bh, bw * 0.9, rnd, active, glowWindows);
      } else if (arch === 'manor') { // 庄园：主楼 + 侧翼
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M(wallC));
        body.position.y = 0.5 + bh / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.12, bh * 0.4, bd * 1.08), M(roofC));
        roof.position.y = 0.5 + bh;
        roof.castShadow = true;
        g.add(roof);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, bh * 0.55, bd * 0.7), M(wallC));
        wing.position.set(bw * 0.8, 0.5 + bh * 0.275, bd * 0.1);
        wing.castShadow = true;
        g.add(wing);
        const wingRoof = new THREE.Mesh(prismGeo(bw * 0.8, bh * 0.25, bd * 0.78), M(roofC));
        wingRoof.position.set(bw * 0.8, 0.5 + bh * 0.55, bd * 0.1);
        g.add(wingRoof);
        addWindows(g, bw, bh, bd, rnd, active, glowWindows);
        addChimney(g, bw, bh, bd, active, smokes, rnd);
      } else if (arch === 'hospital') { // 医院：白楼 + 红十字
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.5, 2.6, bd * 1.2), M(0xf4f7f4));
        body.position.y = 0.5 + 1.3;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.6, 0.15, bd * 1.3), M(0xc9d4d8));
        top.position.y = 3.18;
        g.add(top);
        const crossMat = new THREE.MeshBasicMaterial({ color: 0xe23b3b });
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.06), crossMat);
        crossV.position.set(0, 2.4, bd * 0.6 + 0.04);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.06), crossMat);
        crossH.position.copy(crossV.position);
        g.add(crossV, crossH);
        addWindows(g, bw * 1.5, 2.6, bd * 1.2, rnd, active, glowWindows);
      } else if (arch === 'school') { // 学校：教学楼 + 钟塔 + 前院
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.4, 2.2, bd), M(wallC));
        body.position.y = 0.5 + 1.1;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.5, 0.9, bd * 1.08), M(roofC));
        roof.position.y = 2.7;
        roof.castShadow = true;
        g.add(roof);
        const towerB = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.6, 0.7), M(wallC));
        towerB.position.set(bw * 0.55, 0.5 + 1.8, 0);
        g.add(towerB);
        const towerR = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.7, 4), M(roofC));
        towerR.position.set(bw * 0.55, 4.5, 0);
        towerR.rotation.y = Math.PI / 4;
        g.add(towerR);
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), M(0xd9b23e));
        bell.position.set(bw * 0.55, 4.0, 0);
        g.add(bell);
        const yard = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.2, 0.06, 1.4), M(0xc9a86a));
        yard.position.set(0, 0.56, bd / 2 + 0.9);
        g.add(yard);
        addWindows(g, bw * 1.4, 2.2, bd, rnd, active, glowWindows);
      } else if (arch === 'library') { // 图书馆：柱廊 + 山花 + 台阶
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.5, 1.9, bd * 1.1), M(0xe8dfc8));
        body.position.y = 0.5 + 0.95;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const ped = new THREE.Mesh(prismGeo(bw * 1.6, 0.7, bd * 1.2), M(0xd8cdb0));
        ped.position.y = 2.4;
        ped.castShadow = true;
        g.add(ped);
        for (let i = 0; i < 4; i++) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 8), M(0xf0e8d4));
          col.position.set((i - 1.5) * 0.55, 1.25, bd * 0.55 + 0.3);
          g.add(col);
        }
        const steps = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.2, 0.18, 0.8), M(0xcfc2a0));
        steps.position.set(0, 0.6, bd * 0.55 + 0.6);
        g.add(steps);
        addWindows(g, bw * 1.5, 1.9, bd * 1.1, rnd, active, glowWindows);
      } else if (arch === 'chapel') { // 礼拜堂：窄身陡顶 + 尖塔金球
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.9, 2.2, bd * 1.3), M(wallC));
        body.position.y = 0.5 + 1.1;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.0, 1.6, bd * 1.36), M(roofC));
        roof.position.y = 2.7;
        roof.castShadow = true;
        g.add(roof);
        const spireB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), M(wallC));
        spireB.position.set(0, 3.4, bd * 0.45);
        g.add(spireB);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 6), M(roofC));
        spire.position.set(0, 4.9, bd * 0.45);
        spire.castShadow = true;
        g.add(spire);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), M(0xd9b23e));
        orb.position.set(0, 5.7, bd * 0.45);
        g.add(orb);
        addWindows(g, bw * 0.9, 2.2, bd * 1.3, rnd, active, glowWindows);
      } else if (arch === 'market') { // 集市摊位：条纹雨棚 + 货箱木桶
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6), M(0x8a6a45));
          post.position.set(sx * bw * 0.55, 0.5 + 0.85, sz * bd * 0.45);
          g.add(post);
        }
        const stripes = [0xd94848, 0xf2ead8];
        for (let i = 0; i < 6; i++) {
          const sMesh = new THREE.Mesh(new THREE.BoxGeometry((bw * 1.3) / 6, 0.05, bd * 1.05), M(stripes[i % 2]));
          sMesh.position.set((i - 2.5) * ((bw * 1.3) / 6), 0.5 + 1.75 - i * 0.02, 0);
          sMesh.rotation.z = -0.06;
          g.add(sMesh);
        }
        const stall = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.7, bd * 0.5), M(0xa87c4f));
        stall.position.y = 0.85;
        g.add(stall);
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), M(0xc9a86a));
        crate.position.set(bw * 0.4, 0.7, bd * 0.4);
        g.add(crate);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), M(0x8a6a45));
        barrel.position.set(-bw * 0.4, 0.75, bd * 0.4);
        g.add(barrel);
      } else if (arch === 'windmill') { // 风车磨坊（扇叶会转）
        const towerM = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 3.4, 10), M(0xe8dcc0));
        towerM.position.y = 0.5 + 1.7;
        towerM.castShadow = true;
        g.add(towerM);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.9, 10), M(roofC));
        cap.position.y = 4.3;
        g.add(cap);
        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.05), M(0xf2ead8));
          blade.position.y = 1.1;
          const armG = new THREE.Group();
          armG.rotation.z = (i * Math.PI) / 2;
          armG.add(blade);
          blades.add(armG);
        }
        blades.position.set(0, 3.9, 1.05);
        g.add(blades);
        windmills.push(blades);
        const mDoor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.06), M(0x6f5a3e));
        mDoor.position.set(0, 0.93, 1.05);
        g.add(mDoor);
      } else if (arch === 'inn') { // 客栈：小楼 + 挑出招牌
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M(wallC));
        body.position.y = 0.5 + bh / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.15, bh * 0.5, bd * 1.1), M(roofC));
        roof.position.y = 0.5 + bh;
        roof.castShadow = true;
        g.add(roof);
        const signArm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), M(0x6f5a3e));
        signArm.position.set(bw / 2 + 0.3, 0.5 + bh * 0.75, bd * 0.3);
        g.add(signArm);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.04), M(0xd9b23e));
        sign.position.set(bw / 2 + 0.55, 0.5 + bh * 0.75 - 0.25, bd * 0.3);
        g.add(sign);
        addWindows(g, bw, bh, bd, rnd, active, glowWindows);
        if (rnd() < 0.7) addChimney(g, bw, bh, bd, active, smokes, rnd);
      } else if (arch === 'workshop') { // 工坊：平顶 + 大烟囱 + 雨棚
        bh = Math.max(1.4, bh * 0.8);
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.15, bh, bd), M(wallC));
        body.position.y = 0.5 + bh / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.25, 0.15, bd * 1.1), M(roofC));
        top.position.y = 0.5 + bh + 0.08;
        g.add(top);
        const awning = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, 0.08, 0.8), M(roofC));
        awning.position.set(0, 0.5 + bh * 0.62, bd / 2 + 0.42);
        awning.rotation.x = 0.25;
        g.add(awning);
        addWindows(g, bw, bh, bd, rnd, active, glowWindows);
        addChimney(g, bw, bh + 0.3, bd, active, smokes, rnd);
      } else if (arch === 'townhouse') { // 联排小楼：双坡 + 山墙窗
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M(wallC));
        body.position.y = 0.5 + bh / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.1, bh * 0.45, bd * 1.06), M(roofC));
        roof.position.y = 0.5 + bh;
        roof.castShadow = true;
        g.add(roof);
        const dormer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.4), M(wallC));
        dormer.position.set(0, 0.5 + bh + bh * 0.16, bd * 0.4);
        g.add(dormer);
        addWindows(g, bw, bh, bd, rnd, active, glowWindows);
        if (rnd() < 0.6) addChimney(g, bw, bh, bd, active, smokes, rnd);
      } else { // cottage 农舍：矮身大顶
        bh = Math.max(1.3, bh * 0.85);
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M(wallC));
        body.position.y = 0.5 + bh / 2;
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        const roof = new THREE.Mesh(prismGeo(bw * 1.3, bh * 0.75, bd * 1.2), M(roofC));
        roof.position.y = 0.5 + bh;
        roof.castShadow = true;
        g.add(roof);
        addWindows(g, bw, bh, bd, rnd, active, glowWindows);
        if (rnd() < 0.5) addChimney(g, bw, bh * 0.9, bd, active, smokes, rnd);
      }

      // dormant：苔藓墙脚 + 屋顶杂草
      if (dormant) {
        const moss = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.2, 0.3, bd + 0.2), M(0x5a7a4f));
        moss.position.y = 0.66;
        g.add(moss);
        const weed = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 5), M(0x6d8a50));
        weed.position.set(bw * 0.2, 0.5 + bh + 0.3, bd * 0.15);
        g.add(weed);
      }

      // construction：脚手架（4 post + 1 frame = 5 个子对象）
      if (b.construction) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, bh + 1.2, 5), M(0x8a6a45));
          post.position.set(sx * (bw / 2 + 0.3), 0.5 + (bh + 1.2) / 2, sz * (bd / 2 + 0.3));
          g.add(post);
        }
        const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.7, 0.08, bd + 0.7), M(0x8a6a45));
        frame.position.y = bh + 1.6;
        g.add(frame);
      }

      // 假 AO：建筑底部柔和投影圈
      const ao = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(bw, bd) * 0.95, 16),
        new THREE.MeshBasicMaterial({ color: 0x14260e, transparent: true, opacity: 0.22 })
      );
      ao.rotation.x = -Math.PI / 2;
      ao.position.y = 0.515;
      g.add(ao);

      g.position.set(b.x - cx, 0, b.z - cz);
      g.rotation.y = b.rotY;
      g.userData = { type: 'building', b, dir: d.dir };
      g.traverse((o) => { o.userData.root = g; });
      scene.add(g);
      pickables.push(g);
    }
  }

  return { pickables, glowWindows, smokes, windmills };
}

// --------------------------------------------------------------------------
// 动画更新函数：updateBuildings
// --------------------------------------------------------------------------

export function updateBuildings(result: BuildingsResult, t: number): void {
  // glowWindows 呼吸
  for (const w of result.glowWindows) {
    (w.material as THREE.MeshBasicMaterial).color.setHSL(0.09, 0.85, 0.72 + Math.sin(t * 2.2) * 0.08);
  }

  // smokes 上升消散
  for (const s of result.smokes) {
    for (let i = 0; i < s.puffs.length; i++) {
      const phase = (t * 0.4 + s.seed + i * 0.7) % 1;
      s.puffs[i].position.y = s.base.y + phase * 2.2;
      (s.puffs[i].material as THREE.MeshLambertMaterial).opacity = 0.7 * (1 - phase);
      const sc = 0.8 + phase * 1.1;
      s.puffs[i].scale.set(sc, sc, sc);
    }
  }

  // windmills 旋转
  for (const wm of result.windmills) {
    wm.rotation.z = t * 1.1;
  }
}
