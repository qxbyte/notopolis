export function ih(x: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + 1013904223;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = ih(xi, zi), b = ih(xi + 1, zi), c = ih(xi, zi + 1), d = ih(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number): number {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 37, z * 2.1 + 91) * 0.28 + vnoise(x * 4.3 + 113, z * 4.3 + 7) * 0.17;
}
