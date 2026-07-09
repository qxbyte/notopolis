import type {
  CityModel,
  District,
  GraphResult,
  NoteMeta,
  ScanResult,
  Tier,
  VaultConfig,
} from '../../shared/types.js';
import { placeBuildings } from './buildings.js';
import { layoutDistricts } from './districts.js';
import { buildDistrictRoads } from './districtroads.js';
import { buildRoads } from './roads.js';

export function tierOf(noteCount: number): Tier {
  if (noteCount < 30) return 'camp';
  if (noteCount < 150) return 'village';
  if (noteCount < 600) return 'city';
  return 'capital';
}

export function buildCityModel(
  vault: VaultConfig,
  scan: ScanResult,
  graph: GraphResult,
  now: number,
): CityModel {
  const byDir = new Map<string, NoteMeta[]>();
  for (const n of scan.notes) {
    const list = byDir.get(n.dir) ?? [];
    list.push(n);
    byDir.set(n.dir, list);
  }
  const plots = layoutDistricts(
    [...byDir.entries()].map(([dir, list]) => ({ dir, count: list.length })),
  );
  const districts: District[] = plots.map((plot) => ({
    dir: plot.dir,
    x: plot.x,
    z: plot.z,
    width: plot.width,
    depth: plot.depth,
    polygon: plot.polygon,
    isInbox: /inbox/i.test(plot.dir),
    buildings: placeBuildings(plot, byDir.get(plot.dir)!, graph.inlinks, buildDistrictRoads(plot), graph.outlinks),
  }));

  return {
    vaultId: vault.id,
    name: vault.name,
    theme: vault.theme,
    tier: tierOf(scan.notes.length),
    districts,
    roads: buildRoads(districts, graph),
    noteCount: scan.notes.length,
    activeCount7d: scan.notes.filter((n) => now - n.mtimeMs < 7 * 86_400_000).length,
    generatedAt: now,
  };
}
