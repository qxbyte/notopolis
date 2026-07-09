/**
 * ui/icons.ts — 彩色手绘风格图标（内联 SVG）。
 * 统一 18×18 viewBox、圆角描边、палитре 取自纸墨配色，取代实物风格 emoji。
 */

const A = `viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="#3a3428" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"`;

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
} as const;

export type IconName = keyof typeof ICON;
