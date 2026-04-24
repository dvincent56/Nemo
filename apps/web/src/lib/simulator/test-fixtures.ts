// apps/web/src/lib/simulator/test-fixtures.ts
// Read polars and game-balance from disk (Node-only) so tests can build the
// payloads the worker would normally receive from the main thread.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoatClass, Polar } from '@nemo/shared-types';
import { resolveBoatLoadout } from '@nemo/game-engine-core';
import type { WindGridConfig } from '../projection/windLookup';
import type { SimBoatSetup } from './types';

// Resolve from this file's location so the path is stable regardless of the
// process cwd (tests run from various package dirs via pnpm exec).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../..');

export function loadFixturePolars(classes: BoatClass[]): Record<BoatClass, Polar> {
  const out: Record<string, Polar> = {};
  const map: Partial<Record<BoatClass, string>> = {
    FIGARO: 'figaro.json',
    CLASS40: 'class40.json',
    OCEAN_FIFTY: 'ocean-fifty.json',
    IMOCA60: 'imoca60.json',
    ULTIM: 'ultim.json',
  };
  for (const c of classes) {
    const filename = map[c];
    if (!filename) throw new Error(`No polar file for boat class: ${c}`);
    const p = resolve(repoRoot, 'packages/polar-lib/polars', filename);
    out[c] = JSON.parse(readFileSync(p, 'utf-8')) as Polar;
  }
  return out as Record<BoatClass, Polar>;
}

export function loadFixtureGameBalance(): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/game-balance/game-balance.json'), 'utf-8'));
}

/**
 * A minimal 2×2 grid of constant 12 (knots) wind from the north covering 48 h.
 *
 * Shape matches createWindLookup(config: WindGridConfig, data: Float32Array)
 * from apps/web/src/lib/projection/windLookup.ts:
 *   - WindGridConfig: { bounds, resolution, cols, rows, timestamps }
 *   - data: flat Float32Array, layout per layer = rows × cols × 6 floats
 *     [u_kn, v_kn, swh, swellSin, swellCos, swellPeriod] per point,
 *     ordered south→north, west→east.
 *
 * Source: apps/web/src/lib/projection/windLookup.ts (FIELDS_PER_POINT, layout).
 */
export function makeConstantWind(): { windGrid: WindGridConfig; windData: Float32Array } {
  // 2 cols × 2 rows grid covering 40°N–50°N, 10°W–0°W, 10° resolution
  const cols = 2;
  const rows = 2;
  const timestamps = [0, 3_600_000 * 48]; // two layers: t=0 and t=48h in Unix ms (matches WindGridConfig.timestamps)

  const windGrid: WindGridConfig = {
    bounds: { north: 50, south: 40, east: 0, west: -10 },
    resolution: 10,
    cols,
    rows,
    timestamps,
  };

  // 6 fields per point: u_kn, v_kn, swh, swellSin, swellCos, swellPeriod
  const FIELDS = 6;
  const pointsPerLayer = rows * cols;
  const floatsPerLayer = pointsPerLayer * FIELDS;
  const numLayers = timestamps.length;
  const windData = new Float32Array(numLayers * floatsPerLayer);

  // Constant 12-knot wind from the north (twd = 0°). Wind blows TO the south
  // → u = 0, v = -12. Swell from north (sin = 0, cos = 1).
  for (let i = 0; i < windData.length; i += FIELDS) {
    windData[i + 0] = 0;    // u (kn) — east-west component
    windData[i + 1] = -12;  // v (kn) — north-south component (negative = blowing south)
    windData[i + 2] = 1.5;  // swh meters
    windData[i + 3] = 0;    // swellSin (0° → sin=0)
    windData[i + 4] = 1;    // swellCos (0° → cos=1)
    windData[i + 5] = 8;    // swellPeriod seconds
  }

  return { windGrid, windData };
}

export function makeBoat(id: string, boatClass: BoatClass): SimBoatSetup {
  // resolveBoatLoadout requires GameBalance to be loaded.
  // Ensure it is loaded from disk before building the fixture boat.
  const { GameBalance } = require('@nemo/game-balance') as { GameBalance: { isLoaded: boolean; load: (raw: unknown) => void } };
  if (!GameBalance.isLoaded) {
    const raw = loadFixtureGameBalance();
    GameBalance.load(raw);
  }
  return {
    id,
    name: id,
    boatClass,
    loadout: resolveBoatLoadout(`fixture-${id}`, [], boatClass),
    initialSail: 'SPI',
    initialCondition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
  };
}
