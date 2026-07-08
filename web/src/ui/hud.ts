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

export interface HUDHandle {
  setStats(text: string): void;
  setTip(text: string): void;
  root: HTMLElement; // #hud 元素
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

  const stats = hud.querySelector<HTMLElement>('#stats')!;

  return {
    root: hud,
    setStats(text: string): void {
      stats.textContent = text;
    },
    setTip(text: string): void {
      tip.textContent = text;
    },
  };
}
