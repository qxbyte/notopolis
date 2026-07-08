export interface Polyline {
  pts: [number, number][];
  lens: number[];
  total: number;
}

export function buildPolyline(pts: [number, number][]): Polyline {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l);
    total += l;
  }
  return { pts, lens, total };
}

export function polyAt(r: Polyline, s: number): [number, number, number] {
  let d = Math.max(0, Math.min(1, s)) * r.total;
  for (let i = 0; i < r.lens.length; i++) {
    if (d <= r.lens[i] || i === r.lens.length - 1) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const f = r.lens[i] ? Math.min(1, d / r.lens[i]) : 0;
      return [ax + (bx - ax) * f, az + (bz - az) * f, Math.atan2(bx - ax, bz - az)];
    }
    d -= r.lens[i];
  }
  return [r.pts[0][0], r.pts[0][1], 0];
}

export function polyDist(x: number, z: number, pts: [number, number][]): number {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    let tt = ((x - ax) * dx + (z - az) * dz) / L2;
    tt = Math.max(0, Math.min(1, tt));
    const ex = ax + dx * tt - x, ez = az + dz * tt - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function segHit(
  p1: [number, number], p2: [number, number],
  q1: [number, number], q2: [number, number]
): [number, number, number, number] | null {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1];
  const d2x = q2[0] - q1[0], d2z = q2[1] - q1[1];
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-6) return null;
  const s = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den;
  const u = ((q1[0] - p1[0]) * d1z - (q1[1] - p1[1]) * d1x) / den;
  if (s < 0.05 || s > 0.95 || u < 0.05 || u > 0.95) return null;
  return [p1[0] + d1x * s, p1[1] + d1z * s, s, u];
}

export function lakeShapeR(seed: number, r: number, th: number): number {
  return r * (0.78 + 0.16 * Math.sin(th * 3 + seed * 0.9)
    + 0.1 * Math.sin(th * 5 + seed * 0.5) + 0.06 * Math.sin(th * 8 + seed * 1.7));
}
