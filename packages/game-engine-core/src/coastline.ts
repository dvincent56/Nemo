import { point, lineString } from '@turf/helpers';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import distance from '@turf/distance';
import lineIntersect from '@turf/line-intersect';
import type { Position } from '@nemo/shared-types';

/**
 * Pure-geometry coastline spatial index for grounding detection.
 *
 * Browser-safe: no `fs`, no `path`, no Node built-ins.
 * Load data by calling `loadFromGeoJson()` with the already-parsed GeoJSON.
 *
 * Public API (mirrors the module-level functions of the Node wrapper):
 *   loadFromGeoJson(geojson)            → build spatial index
 *   isLoaded()                          → true after successful load
 *   distanceToCoastNm(lat, lon)         → distance in nm to nearest coast
 *   coastRiskLevel(lat, lon)            → 0 | 1 | 2 | 3
 *   segmentCrossesCoast(from, to, n?)   → true if path intersects coast
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoastSegment {
  coords: [number, number][]; // [lon, lat][]
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export interface CoastGeometry {
  segments: CoastSegment[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CELL_SIZE = 1; // 1° grid cells
const NM_PER_KM = 0.539957;
/** Search radius in degrees for candidate segments (covers ~60 nm at equator) */
const SEARCH_DEG = 1;

// ── Helpers (module-private) ──────────────────────────────────────────────────

function cellKey(latCell: number, lonCell: number): string {
  return `${latCell},${lonCell}`;
}

function cellsForBBox(minLat: number, maxLat: number, minLon: number, maxLon: number): string[] {
  const keys: string[] = [];
  const lat0 = Math.floor(minLat / CELL_SIZE) * CELL_SIZE;
  const lat1 = Math.floor(maxLat / CELL_SIZE) * CELL_SIZE;
  const lon0 = Math.floor(minLon / CELL_SIZE) * CELL_SIZE;
  const lon1 = Math.floor(maxLon / CELL_SIZE) * CELL_SIZE;
  for (let la = lat0; la <= lat1; la += CELL_SIZE) {
    for (let lo = lon0; lo <= lon1; lo += CELL_SIZE) {
      keys.push(cellKey(la, lo));
    }
  }
  return keys;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class CoastlineIndex {
  private grid = new Map<string, CoastSegment[]>();
  private loaded = false;

  // ── Loading ──────────────────────────────────────────────────────────────────

  /**
   * Parse a Natural Earth GeoJSON FeatureCollection and build the spatial index.
   * Idempotent: if already loaded, subsequent calls are no-ops.
   */
  loadFromGeoJson(geojson: GeoJSON.FeatureCollection): void {
    if (this.loaded) return;

    for (const feature of geojson.features) {
      if (feature.geometry.type !== 'LineString') continue;
      const coords = feature.geometry.coordinates as [number, number][];

      // Split long linestrings into chunks of ~50 vertices for tighter bboxes
      const CHUNK = 50;
      for (let i = 0; i < coords.length - 1; i += CHUNK - 1) {
        const slice = coords.slice(i, i + CHUNK);
        if (slice.length < 2) continue;
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of slice) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        this.insertSegment({ coords: slice, minLon, maxLon, minLat, maxLat });
      }
    }

    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  // ── Grid insertion ────────────────────────────────────────────────────────────

  private insertSegment(seg: CoastSegment): void {
    const cells = cellsForBBox(seg.minLat, seg.maxLat, seg.minLon, seg.maxLon);
    for (const key of cells) {
      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push(seg);
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  private getCandidateSegments(lat: number, lon: number, radiusDeg: number): CoastSegment[] {
    const cells = cellsForBBox(
      lat - radiusDeg, lat + radiusDeg,
      lon - radiusDeg, lon + radiusDeg,
    );
    const seen = new Set<CoastSegment>();
    const result: CoastSegment[] = [];
    for (const key of cells) {
      const bucket = this.grid.get(key);
      if (!bucket) continue;
      for (const seg of bucket) {
        if (!seen.has(seg)) {
          seen.add(seg);
          result.push(seg);
        }
      }
    }
    return result;
  }

  /**
   * Distance to the nearest coastline in nautical miles.
   * Returns Infinity if no coast segment is found within ~60 nm.
   */
  distanceToCoastNm(lat: number, lon: number): number {
    if (!this.loaded) return Infinity;
    const candidates = this.getCandidateSegments(lat, lon, SEARCH_DEG);
    if (candidates.length === 0) return Infinity;

    const pt = point([lon, lat]);
    let minDist = Infinity;

    for (const seg of candidates) {
      const line = lineString(seg.coords);
      const nearest = nearestPointOnLine(line, pt, { units: 'kilometers' });
      const d = (nearest.properties.dist ?? distance(pt, nearest, { units: 'kilometers' })) * NM_PER_KM;
      if (d < minDist) minDist = d;
    }

    return minDist;
  }

  /**
   * Coast risk level for broadcast payload.
   *   0 = safe (> 5 nm)
   *   1 = caution (2–5 nm)
   *   2 = warning (0.5–2 nm)
   *   3 = critical (< 0.5 nm — imminent grounding)
   */
  coastRiskLevel(lat: number, lon: number): 0 | 1 | 2 | 3 {
    const d = this.distanceToCoastNm(lat, lon);
    if (d < 0.5) return 3;
    if (d < 2) return 2;
    if (d < 5) return 1;
    return 0;
  }

  /**
   * Check if a straight-line segment between two positions crosses any coastline.
   * Used to detect grounding during a tick (boat moved from A to B).
   *
   * Also checks intermediate points along the segment (configured by
   * game-balance `grounding.detectionIntermediatePoints`) to detect cases
   * where both endpoints are at sea but the path clips through land.
   */
  segmentCrossesCoast(
    from: Position,
    to: Position,
    intermediatePoints: number = 20,
  ): boolean {
    if (!this.loaded) return false;

    // Build the boat's path as a LineString
    const pathCoords: [number, number][] = [[from.lon, from.lat]];
    // Add intermediate points for better resolution
    for (let i = 1; i < intermediatePoints; i++) {
      const t = i / intermediatePoints;
      pathCoords.push([
        from.lon + (to.lon - from.lon) * t,
        from.lat + (to.lat - from.lat) * t,
      ]);
    }
    pathCoords.push([to.lon, to.lat]);

    const pathLine = lineString(pathCoords);

    // Find candidate coast segments near the path bbox
    const lons = [from.lon, to.lon];
    const lats = [from.lat, to.lat];
    const minLon = Math.min(...lons) - 0.1;
    const maxLon = Math.max(...lons) + 0.1;
    const minLat = Math.min(...lats) - 0.1;
    const maxLat = Math.max(...lats) + 0.1;

    const cells = cellsForBBox(minLat, maxLat, minLon, maxLon);
    const seen = new Set<CoastSegment>();

    for (const key of cells) {
      const bucket = this.grid.get(key);
      if (!bucket) continue;
      for (const seg of bucket) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        const coastLine = lineString(seg.coords);
        const intersections = lineIntersect(pathLine, coastLine);
        if (intersections.features.length > 0) return true;
      }
    }

    return false;
  }
}
