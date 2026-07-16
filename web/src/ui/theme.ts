/**
 * ui/theme.ts — 主题系统（单一数据源）。
 * 一个主题 = THEMES 里的一个对象：tokens 只声明与基础主题的差异，applyTheme
 * 合并后经 setProperty 批量写 CSS 变量——业务组件只消费 var(--token)，对主题零感知。
 * 加新主题：在 THEMES 数组追加一条即可（ThemeId 自动派生，无需改类型/CSS）。
 * style.css 的 :root 块保留同值基础令牌，作为令牌清单文档与 JS 异常时的兜底。
 */

/** 全套设计令牌（键名 camelCase，写入时转 --kebab-case CSS 变量） */
export interface ThemeTokens {
  primary: string;      /* 主色：主按钮底/进度条/选中描边 */
  onPrimary: string;    /* 主色底上的文字（亮色主色配深字，深色主色配白字） */
  primaryDark: string;  /* 主按钮 hover/按下底色 */
  accentText: string;   /* 强调文字色：链接/选中态文字/成功提示（浅底上必须可读） */
  primarySoft: string;  /* 选中背景/标签底 */
  accent2: string;      /* 次级点缀色（计数徽标/横幅圆点等，如浅蓝） */
  bg: string;           /* 页面/面板底 */
  surface: string;      /* 卡片/弹窗表面 */
  text: string;         /* 主文字 */
  muted: string;        /* 次要文字 */
  border: string;       /* 边框/分割线 */
  danger: string;       /* 删除/错误 */
  warn: string;         /* 警示 */
  shadow: string;       /* 大投影（弹窗/卡片） */
  shadowSm: string;     /* 小投影（按钮/悬浮标签） */
}

export interface ThemeDef {
  id: string;
  label: string;
  desc: string;
  /** 深色主题标记：地图 canvas 侧据此叠加夜幕滤镜（multiply 压暗手绘图层） */
  dark?: boolean;
  /** 与基础主题（BASE_TOKENS）的差异；缺省项自动继承 */
  tokens: Partial<ThemeTokens>;
}

/** 基础令牌 = 默认主题「荧光绿」（与 style.css :root 保持同值） */
const BASE_TOKENS: ThemeTokens = {
  primary: '#DCF231',
  onPrimary: '#141414',
  primaryDark: '#CDE41C',
  accentText: '#16181A',
  primarySoft: '#F1F9CE',
  accent2: '#C9D5F8',
  bg: '#F2F3F6',
  surface: '#FFFFFF',
  text: '#16181A',
  muted: '#84898F',
  border: '#E5E7EB',
  danger: '#D25C4E',
  warn: '#B98A3A',
  shadow: '0 1px 2px rgba(22, 24, 26, 0.05), 0 12px 40px rgba(22, 24, 26, 0.12)',
  shadowSm: '0 1px 2px rgba(22, 24, 26, 0.05), 0 4px 14px rgba(22, 24, 26, 0.08)',
};

export const THEMES = [
  {
    id: 'lime',
    label: '荧光绿',
    desc: '默认 · 亮绿+黑白+浅蓝，仪表盘风',
    tokens: {},
  },
  {
    id: 'matcha',
    label: '抹茶暖灰',
    desc: '中性暖灰底，抹茶绿点缀',
    tokens: {
      primary: '#7CA85F',
      onPrimary: '#FFFFFF',
      primaryDark: '#5F8A45',
      accentText: '#5F8A45',
      primarySoft: '#EEF3E8',
      accent2: '#E3EBF6',
      bg: '#F7F7F5',
      text: '#37352F',
      muted: '#787774',
      border: '#E9E9E6',
    },
  },
  {
    id: 'indigo',
    label: '靛蓝晴空',
    desc: '冷调 · 冷灰底，靛蓝主色',
    tokens: {
      primary: '#5B6EE8',
      onPrimary: '#FFFFFF',
      primaryDark: '#4557C9',
      accentText: '#4557C9',
      primarySoft: '#ECEFFC',
      accent2: '#E4E9FB',
      bg: '#F5F6FA',
      text: '#22263A',
      muted: '#6E7385',
      border: '#E4E7F0',
    },
  },
  {
    id: 'amber',
    label: '琥珀暖阳',
    desc: '暖调 · 奶油纸感底，赤陶橙主色',
    tokens: {
      primary: '#C97E3D',
      onPrimary: '#FFFFFF',
      primaryDark: '#A96426',
      accentText: '#A96426',
      primarySoft: '#F6ECDD',
      accent2: '#EAE0EF',
      bg: '#FAF6EF',
      surface: '#FFFDF8',
      text: '#3D362C',
      muted: '#8A8274',
      border: '#ECE5D6',
    },
  },
  {
    id: 'mono',
    label: '极简黑白',
    desc: '单色 · 灰白底黑主色，控制台风格',
    tokens: {
      primary: '#202123',
      onPrimary: '#FFFFFF',
      primaryDark: '#000000',
      accentText: '#202123',
      primarySoft: '#F0F0F1',
      accent2: '#E7E7EC',
      bg: '#F7F7F8',
      text: '#202123',
      muted: '#6E6E80',
      border: '#ECECF1',
    },
  },
  {
    id: 'dark',
    label: '暗夜',
    desc: '深色 · 近黑底，提亮绿点缀',
    dark: true,
    tokens: {
      primary: '#8FBC6E',
      onPrimary: '#141414',
      primaryDark: '#A5CC86',
      accentText: '#A5CC86',
      primarySoft: '#2A3324',
      accent2: '#333B49',
      bg: '#161616',
      surface: '#1F1F1F',
      text: '#E9E9E4',
      muted: '#9B9B94',
      border: '#30302E',
      danger: '#E06C5E',
      warn: '#D2A45C',
      shadow: '0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 40px rgba(0, 0, 0, 0.55)',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.35), 0 4px 14px rgba(0, 0, 0, 0.45)',
    },
  },
] as const satisfies readonly ThemeDef[];

/** 主题 id 从注册表自动派生——加主题不需要改任何类型定义 */
export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'notopolis-theme';
const DEFAULT: ThemeId = 'lime';

function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

/** 合并后的完整令牌（主题卡预览、完整性校验共用） */
export function tokensOf(id: ThemeId): ThemeTokens {
  const def = THEMES.find((t) => t.id === id) ?? THEMES[0];
  return { ...BASE_TOKENS, ...def.tokens };
}

/** camelCase → --kebab-case（primaryDark → --primary-dark） */
function cssVarName(key: string): string {
  return '--' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

/** 应用主题：批量写 CSS 变量到 <html>；data-theme 属性保留供调试/测试断言 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokensOf(id))) {
    root.style.setProperty(cssVarName(k), v);
  }
  root.dataset.theme = id;
}

/** 应用并持久化（设置中心显式选主题 = 自定义，清除明暗模式覆盖） */
export function setTheme(id: ThemeId): void {
  applyTheme(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.removeItem(MODE_KEY);
  } catch {
    /* 无痕模式等场景下静默 */
  }
}

export function currentTheme(): ThemeId {
  const v = document.documentElement.dataset.theme;
  return isThemeId(v) ? v : DEFAULT;
}

/** 当前主题是否深色（地图夜幕滤镜开关） */
export function isDarkTheme(): boolean {
  const def = THEMES.find((t) => t.id === currentTheme());
  return (def as ThemeDef | undefined)?.dark ?? false;
}

/** 地图夜幕滤镜色：深色主题下以 multiply 合成压暗整张手绘地图（线稿保留 → 城市夜景） */
export const MAP_NIGHT_TINT = '#515c72';

/* ---- 明暗模式（顶栏快速切换）：亮色=荧光绿默认 / 暗色=暗夜 / 跟随系统 ---- */

export type ThemeMode = 'light' | 'dark' | 'system';
const MODE_KEY = 'notopolis-theme-mode';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function themeForMode(mode: ThemeMode): ThemeId {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : DEFAULT;
  return mode === 'dark' ? 'dark' : DEFAULT;
}

/** 当前明暗模式；null = 用户在设置中心显式选过主题（自定义，不受模式管） */
export function currentMode(): ThemeMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : null;
  } catch {
    return null;
  }
}

/** 切换明暗模式并应用对应主题 */
export function setMode(mode: ThemeMode): void {
  applyTheme(themeForMode(mode));
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(STORAGE_KEY, themeForMode(mode));
  } catch {
    /* ignore */
  }
}

/** 读取当前生效的 CSS 令牌值（canvas 绘制侧取主题色用） */
export function cssToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 启动时恢复上次主题（main.ts 调用）：明暗模式优先，其次显式主题 */
export function initTheme(): void {
  const mode = currentMode();
  if (mode) {
    applyTheme(themeForMode(mode));
  } else {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    applyTheme(isThemeId(saved) ? saved : DEFAULT);
  }
  // 跟随系统：系统明暗切换时实时跟随
  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (currentMode() === 'system') applyTheme(themeForMode('system'));
    });
  }
}
