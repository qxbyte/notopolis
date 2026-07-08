import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VaultConfig } from '../src/shared/types.js';
import { buildGraph } from '../src/server/graph.js';
import { buildCityModel, tierOf } from '../src/server/layout/city.js';
import { scanVault } from '../src/server/scanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/vault-a');
const VAULT: VaultConfig = { id: 'va', name: '测试城', path: FIXTURE, theme: 'plains' };

describe('tierOf', () => {
  it('聚落分级阈值', () => {
    expect(tierOf(5)).toBe('camp');
    expect(tierOf(30)).toBe('village');
    expect(tierOf(150)).toBe('city');
    expect(tierOf(600)).toBe('capital');
  });
});

describe('buildCityModel', () => {
  it('组装完整城市模型且确定性', async () => {
    const scan = await scanVault(FIXTURE);
    const graph = buildGraph(scan.notes);
    const now = 1_800_000_000_000;
    const m1 = buildCityModel(VAULT, scan, graph, now);
    const m2 = buildCityModel(VAULT, scan, graph, now);
    expect(m1).toEqual(m2);
    expect(m1.noteCount).toBe(5);
    expect(m1.tier).toBe('camp');
    expect(m1.districts.map((d) => d.dir).sort()).toEqual(['01-AI', '02-Dev', '99-Inbox']);
    expect(m1.districts.find((d) => d.dir === '99-Inbox')!.isInbox).toBe(true);
    // 道路：每区一条主街 + 至少一条区内街巷 + 跨区大道
    expect(m1.roads.filter((r) => r.kind === 'main').length).toBe(3);
    expect(m1.roads.some((r) => r.kind === 'street')).toBe(true);
    expect(m1.roads.some((r) => r.kind === 'avenue')).toBe(true);
  });
});
