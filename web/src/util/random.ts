/**
 * util/random.ts — 加权随机选择（F7 随机漫步）。
 * rand 注入以便单测；生产用 Math.random（用户主动触发的交互性随机，
 * 不受「同一 vault 渲染确定」铁律约束）。
 */

/** 从 items 按 weights 加权随机选一个索引；rand ∈ [0,1)。空/零权返回 -1 */
export function pickWeightedIndex(weights: number[], rand: number): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let r = rand * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** 越久未修改越可能被选中：clamp((now - mtimeMs)/天, 1, 365) */
export function staleWeight(mtimeMs: number, now: number): number {
  const days = (now - mtimeMs) / 86400000;
  return days < 1 ? 1 : days > 365 ? 365 : days;
}
