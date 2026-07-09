/**
 * ui/hud.ts
 * HUD 头部显示（标题、统计、操作提示）
 */

export const TIER: Record<string, string> = {
  camp: '拓荒营地',
  village: '村镇',
  city: '城市',
  capital: '都城',
};

export const THEME_LABELS: Record<string, string> = {
  plains: '平原王城',
  mountain: '山地雄关',
  harbor: '海港商邦',
  snow: '雪原孤城',
};

export interface HUDHandle {
  setStats(text: string): void;
  setTip(text: string): void;
  /** 在右上按钮栏加一个纸片按钮，返回引用（便于改文案 / dispose）；title 为悬浮说明 */
  addButton(label: string, onClick: () => void, title?: string): HTMLButtonElement;
  /** 右下透镜按钮栏容器（F4 挂按钮用） */
  lensBar: HTMLElement;
  root: HTMLElement; // #hud 元素
  dispose(): void;
}

export function createHUD(parent: HTMLElement): HUDHandle {
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = '<h1>NOTOPOLIS</h1><div class="sub" id="stats">加载中…</div>';
  parent.appendChild(hud);

  const tipDefaultText = '左键拖拽 平移地图 · 右键拖拽 旋转/俯仰 · 滚轮 缩放 · 点击建筑看笔记';
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.textContent = tipDefaultText;
  parent.appendChild(tip);

  // 右上功能按钮栏（搜索/工地/漫游/海报）
  const bar = document.createElement('div');
  bar.className = 'hud-bar';
  parent.appendChild(bar);

  // 右下透镜按钮栏
  const lensBar = document.createElement('div');
  lensBar.className = 'lens-bar';
  parent.appendChild(lensBar);

  const stats = hud.querySelector<HTMLElement>('#stats')!;

  return {
    root: hud,
    lensBar,
    setStats(text: string): void {
      stats.textContent = text;
    },
    setTip(text: string): void {
      tip.textContent = text;
    },
    addButton(label: string, onClick: () => void, title?: string): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.className = 'hud-btn';
      btn.textContent = label;
      if (title) btn.title = title;
      btn.addEventListener('click', onClick);
      bar.appendChild(btn);
      return btn;
    },
    dispose(): void {
      hud.remove();
      tip.remove();
      bar.remove();
      lensBar.remove();
    },
  };
}
