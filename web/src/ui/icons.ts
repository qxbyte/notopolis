/**
 * ui/icons.ts — 彩色手绘风格图标（内联 SVG）。
 * 统一 18×18 viewBox、圆角描边、палитре 取自纸墨配色，取代实物风格 emoji。
 */

const A = `viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="#4A5442" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"`;

export const ICON = {
  // 放大镜（搜索）
  search: `<svg ${A}><circle cx="7.5" cy="7.5" r="4.3" fill="#bcd4e6"/><line x1="10.8" y1="10.8" x2="15" y2="15"/></svg>`,

  // 施工路障（工地）——黄底斜纹
  tasks: `<svg ${A}><rect x="2.5" y="6.2" width="13" height="4.2" rx="1" fill="#e6b81e"/><path d="M4.4 10.4 6.4 6.2 M7.6 10.4 9.6 6.2 M10.8 10.4 12.8 6.2" stroke-width="1.1"/><line x1="4.6" y1="10.4" x2="4.6" y2="15"/><line x1="13.4" y1="10.4" x2="13.4" y2="15"/></svg>`,

  // 指南针（漫游）
  roam: `<svg ${A}><circle cx="9" cy="9" r="6.3" fill="#f4efe2"/><path d="M9 3.6 10.6 9 9 8 Z" fill="#c0453a" stroke="none"/><path d="M9 14.4 7.4 9 9 10 Z" fill="#8a8070" stroke="none"/><circle cx="9" cy="9" r="0.9" fill="#3a3428" stroke="none"/></svg>`,

  // 地图叠层（常规视图）
  normal: `<svg ${A}><path d="M9 2.6 15.4 6 9 9.4 2.6 6 Z" fill="#a9c48c"/><path d="M3 9.4 9 12.8 15 9.4" /><path d="M3 12.4 9 15.8 15 12.4" opacity="0.55"/></svg>`,

  // 孤岛（孤立笔记）
  island: `<svg ${A}><path d="M1.5 13.8 Q4 12.4 6 13.4 T10 13.4 T16.5 13.8" stroke="#3e6b9e"/><path d="M5 13.6 Q9 8.4 13 13.6 Z" fill="#e2cb8c"/><path d="M9 10.4 9 6.4 M9 6.4 Q6.8 5.4 5.6 6.6 M9 6.4 Q11.2 5.4 12.4 6.6" stroke="#4f7a3f"/></svg>`,

  // 幼苗（园丁）
  sprout: `<svg ${A}><path d="M9 15.4 9 8" stroke="#5a8f42"/><path d="M9 10.4 Q4.6 9.4 4 5 Q8.4 5.4 9 10.4 Z" fill="#7bbf5a"/><path d="M9 8.8 Q13.4 7.8 14 3.6 Q9.8 4 9 8.8 Z" fill="#8fce6a"/></svg>`,

  // 齿轮（设置）
  gear: `<svg ${A}><circle cx="9" cy="9" r="3" fill="#bcd4e6"/><path d="M9 2.6 9 4.8 M9 13.2 9 15.4 M2.6 9 4.8 9 M13.2 9 15.4 9 M4.5 4.5 6 6 M12 12 13.5 13.5 M13.5 4.5 12 6 M6 12 4.5 13.5"/></svg>`,

  // 已入库标记：抹茶绿圆角徽标 + 白 ✓
  sealIndexed: `<svg viewBox="0 0 18 18" width="13" height="13" style="vertical-align:-2px"><rect x="2" y="2" width="14" height="14" rx="5" fill="#7CA85F"/><path d="M5.8 9.2 8 11.6 12.4 6.4" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 已过期标记：琥珀描边圆角徽标 + ↻（内容变更需重新入库）
  sealStale: `<svg viewBox="0 0 18 18" width="13" height="13" style="vertical-align:-2px"><rect x="2" y="2" width="14" height="14" rx="5" fill="none" stroke="#B98A3A" stroke-width="1.5"/><path d="M12 6.6 A4 4 0 1 0 12.8 10" stroke="#B98A3A" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12.4 4.4 12.2 6.9 9.8 6.5" stroke="#B98A3A" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 文书档案（常规视图的文档面板）
  archive: `<svg ${A}><path d="M4 3.4 H12.6 L14.6 5.4 V14.6 H4 Z" fill="#f4efe2"/><path d="M12.4 3.6 V5.6 H14.4"/><line x1="6" y1="7.4" x2="12.4" y2="7.4" stroke-width="1.1"/><line x1="6" y1="9.8" x2="12.4" y2="9.8" stroke-width="1.1"/><line x1="6" y1="12.2" x2="10.2" y2="12.2" stroke-width="1.1"/></svg>`,

  // 列表定位（currentColor 准星：在文书档案列表中定位当前文档）
  locate: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px"><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,

  // 目录树全部展开/收起（currentColor 双箭头，unfold/fold 语义）
  expandAll: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 9 12 4 17 9"/><polyline points="7 15 12 20 17 15"/></svg>`,
  collapseAll: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 4 12 9 17 4"/><polyline points="7 20 12 15 17 20"/></svg>`,

  // 线性点赞/点踩（currentColor 描边：跟随按钮文字颜色与选中态）
  thumbUp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
  thumbDown: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`,
} as const;

export type IconName = keyof typeof ICON;
