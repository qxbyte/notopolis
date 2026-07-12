// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createWeather,
  startRain,
  tickWeather,
  inCloudHitbox,
  RAIN_MS,
  SUN_MS,
} from '../src/util/weather';

describe('weather 状态机', () => {
  it('初始为 idle', () => {
    const s = createWeather();
    expect(s.phase).toBe('idle');
  });

  it('idle 时点云进入 rain 并记录时刻', () => {
    const s = createWeather();
    expect(startRain(s, 1000)).toBe(true);
    expect(s.phase).toBe('rain');
    expect(s.since).toBe(1000);
  });

  it('rain / sun 中重复点云无效', () => {
    const s = createWeather();
    startRain(s, 1000);
    expect(startRain(s, 1500)).toBe(false);
    expect(s.phase).toBe('rain');
    expect(s.since).toBe(1000);
    tickWeather(s, 1000 + RAIN_MS);
    expect(startRain(s, s.since + 100)).toBe(false);
    expect(s.phase).toBe('sun');
  });

  it('雨未满 3 秒不切相位', () => {
    const s = createWeather();
    startRain(s, 0);
    tickWeather(s, RAIN_MS - 1);
    expect(s.phase).toBe('rain');
  });

  it('雨满 3 秒切 sun，晴满 2 秒复原 idle', () => {
    const s = createWeather();
    startRain(s, 0);
    tickWeather(s, RAIN_MS);
    expect(s.phase).toBe('sun');
    expect(s.since).toBe(RAIN_MS);
    tickWeather(s, RAIN_MS + SUN_MS - 1);
    expect(s.phase).toBe('sun');
    tickWeather(s, RAIN_MS + SUN_MS);
    expect(s.phase).toBe('idle');
  });

  it('复原后可再次点云触发新一轮', () => {
    const s = createWeather();
    startRain(s, 0);
    tickWeather(s, RAIN_MS);
    tickWeather(s, RAIN_MS + SUN_MS);
    expect(startRain(s, 9000)).toBe(true);
    expect(s.phase).toBe('rain');
    expect(s.since).toBe(9000);
  });

  it('idle 时 tick 不变化', () => {
    const s = createWeather();
    tickWeather(s, 99999);
    expect(s.phase).toBe('idle');
  });
});

describe('inCloudHitbox 云朵命中盒', () => {
  const cx = 100;
  const cy = 50;

  it('云中心命中', () => {
    expect(inCloudHitbox(cx + 11, cy - 5, cx, cy)).toBe(true);
  });

  it('包围盒边缘内命中、边缘外不命中', () => {
    expect(inCloudHitbox(cx - 13, cy, cx, cy)).toBe(true);
    expect(inCloudHitbox(cx + 37, cy, cx, cy)).toBe(true);
    expect(inCloudHitbox(cx - 14, cy, cx, cy)).toBe(false);
    expect(inCloudHitbox(cx + 38, cy, cx, cy)).toBe(false);
    expect(inCloudHitbox(cx, cy - 24, cx, cy)).toBe(false);
    expect(inCloudHitbox(cx, cy + 14, cx, cy)).toBe(false);
  });

  it('远处不命中', () => {
    expect(inCloudHitbox(0, 0, cx, cy)).toBe(false);
  });
});
