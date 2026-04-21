import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoastlineIndex } from '@nemo/game-engine-core';
import type { Position } from '@nemo/shared-types';

/**
 * Node I/O wrapper for coastline grounding detection.
 *
 * Delegates all geometry to `CoastlineIndex` from `@nemo/game-engine-core`
 * (pure, browser-safe). This file only handles the `node:fs` I/O needed to
 * read the GeoJSON from disk at server startup.
 *
 * Public API (unchanged — all callers import these names):
 *   loadCoastline(path)             → read file and build spatial index
 *   isCoastlineLoaded()             → true after successful load
 *   distanceToCoastNm(lat, lon)     → distance in nm to nearest coast
 *   coastRiskLevel(lat, lon)        → 0 | 1 | 2 | 3
 *   segmentCrossesCoast(from, to)   → true if path intersects coast
 *   coastlineIndex                  → the underlying CoastlineIndex instance
 */

const globalIndex = new CoastlineIndex();

/**
 * Load coastline GeoJSON and build spatial index.
 * Call once at server startup. The path should point to the same
 * `coastline.geojson` (Natural Earth 10m) served by the frontend.
 */
export function loadCoastline(geojsonPath: string): void {
  const raw = readFileSync(resolve(geojsonPath), 'utf-8');
  globalIndex.loadFromGeoJson(JSON.parse(raw) as GeoJSON.FeatureCollection);
}

export const isCoastlineLoaded = (): boolean => globalIndex.isLoaded();

export const segmentCrossesCoast = (
  from: Position,
  to: Position,
  intermediatePoints?: number,
): boolean => globalIndex.segmentCrossesCoast(from, to, intermediatePoints);

export const coastRiskLevel = (lat: number, lon: number): 0 | 1 | 2 | 3 =>
  globalIndex.coastRiskLevel(lat, lon);

export const distanceToCoastNm = (lat: number, lon: number): number =>
  globalIndex.distanceToCoastNm(lat, lon);

export { globalIndex as coastlineIndex };
