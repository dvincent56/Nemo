// apps/web/src/lib/simulator/test-fixtures.ts
// Read polars and game-balance from disk (Node-only) so tests can build the
// payloads the worker would normally receive from the main thread.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BoatClass, Polar } from '@nemo/shared-types';
import { resolveBoatLoadout } from '@nemo/game-engine-core';
import type { WindGridConfig } from '../projection/windLookup';
import type { SimBoatSetup } from './types';

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
    const p = resolve('packages/polar-lib/polars', filename);
    out[c] = JSON.parse(readFileSync(p, 'utf-8')) as Polar;
  }
  return out as Record<BoatClass, Polar>;
}

export function loadFixtureGameBalance(): unknown {
  return JSON.parse(readFileSync(resolve('packages/game-balance/game-balance.json'), 'utf-8'));
}

/**
 * A minimal 2×2 grid of constant 12 m/s wind from the north covering 48 h.
 *
 * Shape matches createWindLookup(config: WindGridConfig, data: Float32Array)
 * from apps/web/src/lib/projection/windLookup.ts:
 *   - WindGridConfig: { bounds, resolution, cols, rows, timestamps }
 *   - data: flat Float32Array, layout per layer = rows × cols × 5 floats
 *     [tws, twd, swh, swellDir, swellPeriod] per point,
 *     ordered south→north, west→east.
 *
 * Source: apps/web/src/lib/projection/windLookup.ts, lines 3-9 (WindGridConfig)
 * and lines 20-33 (FIELDS_PER_POINT, data layout).
 */
export function makeConstantWind(): { windGrid: WindGridConfig; windData: Float32Array } {
  // 2 cols × 2 rows grid covering 40°N–50°N, 10°W–0°W, 10° resolution
  const cols = 2;
  const rows = 2;
  const timestamps = [0, 3600 * 48]; // two layers: t=0 and t=48h (ms)

  const windGrid: WindGridConfig = {
    bounds: { north: 50, south: 40, east: 0, west: -10 },
    resolution: 10,
    cols,
    rows,
    timestamps,
  };

  // 5 fields per point: tws, twd, swh, swellDir, swellPeriod
  const FIELDS = 5;
  const pointsPerLayer = rows * cols;
  const floatsPerLayer = pointsPerLayer * FIELDS;
  const numLayers = timestamps.length;
  const windData = new Float32Array(numLayers * floatsPerLayer);

  // Fill all points in all layers with constant 12 m/s wind from north (twd=0)
  for (let i = 0; i < windData.length; i += FIELDS) {
    windData[i + 0] = 12;  // tws m/s
    windData[i + 1] = 0;   // twd degrees (from north)
    windData[i + 2] = 1.5; // swh meters
    windData[i + 3] = 0;   // swellDir degrees
    windData[i + 4] = 8;   // swellPeriod seconds
  }

  return { windGrid, windData };
}

export function makeBoat(id: string, boatClass: BoatClass): SimBoatSetup {
  return {
    id,
    name: id,
    boatClass,
    loadout: resolveBoatLoadout(`fixture-${id}`, [], boatClass),
    initialSail: 'SPI',
    initialCondition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
  };
}
