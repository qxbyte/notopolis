/**
 * util/weather.ts — 首页雨云小剧场的纯状态机。
 * 点击云朵：下雨 3 秒 → 太阳出现 2 秒 → 恢复原样。
 * 只管相位与时序，不碰 DOM/Canvas，供 worldmap2d 每帧驱动（可单测）。
 */

export type WeatherPhase = 'idle' | 'rain' | 'sun';

export const RAIN_MS = 3000;
export const SUN_MS = 2000;

export interface WeatherState {
  phase: WeatherPhase;
  /** 当前相位的开始时刻（performance.now() 时间轴） */
  since: number;
}

export function createWeather(): WeatherState {
  return { phase: 'idle', since: 0 };
}

/** 点云触发下雨：仅 idle 时生效，返回是否触发成功（雨中/晴天重复点击无效） */
export function startRain(s: WeatherState, now: number): boolean {
  if (s.phase !== 'idle') return false;
  s.phase = 'rain';
  s.since = now;
  return true;
}

/** 每帧推进：雨满 3 秒切晴，晴满 2 秒复原 */
export function tickWeather(s: WeatherState, now: number): void {
  if (s.phase === 'rain' && now - s.since >= RAIN_MS) {
    s.phase = 'sun';
    s.since = now;
  } else if (s.phase === 'sun' && now - s.since >= SUN_MS) {
    s.phase = 'idle';
    s.since = now;
  }
}

/**
 * 云朵命中盒（世界坐标）：以云的基准点（左圆心）为原点的宽松包围盒。
 * 云形横跨约 [-9, 33]、纵跨约 [-19, 9]，各向外放 3~4 单位方便点中。
 */
export function inCloudHitbox(wx: number, wz: number, cx: number, cy: number): boolean {
  return wx >= cx - 13 && wx <= cx + 37 && wz >= cy - 23 && wz <= cy + 13;
}
