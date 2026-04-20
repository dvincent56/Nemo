/**
 * Browser-safe coastline grounding detection.
 * Builds a 1° grid spatial index of coastline segments and tests whether
 * a projection segment (from, to) crosses the coast.
 *
 * Port of the game-engine's coastline.ts without @turf dependencies.
 */

interface CoastSegment {
  coords: [number, number][]; // [lon, lat][]
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const CELL_SIZE = 1;
const CHUNK_SIZE = 50;

export class CoastlineIndex {
  private grid = new Map<string, CoastSegment[]>();
  private loaded = false;

  load(fc: GeoJSON.FeatureCollection): void {
    if (this.loaded) return;
    for (const feature of fc.features) {
      if (feature.geometry.type !== 'LineString') continue;
      const coords = feature.geometry.coordinates as [number, number][];
      for (let i = 0; i < coords.length - 1; i += CHUNK_SIZE - 1) {
        const slice = coords.slice(i, i + CHUNK_SIZE);
        if (slice.length < 2) continue;
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const c of slice) {
          const lon = c[0]!;
          const lat = c[1]!;
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

  isLoaded(): boolean { return this.loaded; }

  private cellKey(latCell: number, lonCell: number): string {
    return `${latCell},${lonCell}`;
  }

  private cellsForBBox(minLat: number, maxLat: number, minLon: number, maxLon: number): string[] {
    const keys: string[] = [];
    const lat0 = Math.floor(minLat / CELL_SIZE) * CELL_SIZE;
    const lat1 = Math.floor(maxLat / CELL_SIZE) * CELL_SIZE;
    const lon0 = Math.floor(minLon / CELL_SIZE) * CELL_SIZE;
    const lon1 = Math.floor(maxLon / CELL_SIZE) * CELL_SIZE;
    for (let la = lat0; la <= lat1; la += CELL_SIZE) {
      for (let lo = lon0; lo <= lon1; lo += CELL_SIZE) {
        keys.push(this.cellKey(la, lo));
      }
    }
    return keys;
  }

  private insertSegment(seg: CoastSegment): void {
    const cells = this.cellsForBBox(seg.minLat, seg.maxLat, seg.minLon, seg.maxLon);
    for (const key of cells) {
      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push(seg);
    }
  }

  /**
   * Check whether the great-line segment (fromLon, fromLat) → (toLon, toLat)
   * crosses any coastline segment. Returns the closest intersection point
   * along the path, or null if no collision.
   *
   * Also inserts a few intermediate sample points along the path for a
   * coarser check when the endpoints straddle a landmass.
   */
  segmentCrossesCoast(
    fromLat: number, fromLon: number,
    toLat: number, toLon: number,
    intermediatePoints = 10,
  ): { lat: number; lon: number } | null {
    if (!this.loaded) return null;

    // Build path as a list of sub-segments
    const pathPoints: [number, number][] = [[fromLon, fromLat]];
    for (let i = 1; i < intermediatePoints; i++) {
      const t = i / intermediatePoints;
      pathPoints.push([fromLon + (toLon - fromLon) * t, fromLat + (toLat - fromLat) * t]);
    }
    pathPoints.push([toLon, toLat]);

    // Pad bbox so we catch nearby coastline segments
    const minLon = Math.min(fromLon, toLon) - 0.1;
    const maxLon = Math.max(fromLon, toLon) + 0.1;
    const minLat = Math.min(fromLat, toLat) - 0.1;
    const maxLat = Math.max(fromLat, toLat) + 0.1;
    const cells = this.cellsForBBox(minLat, maxLat, minLon, maxLon);

    const seen = new Set<CoastSegment>();
    let bestT = Infinity;
    let bestPoint: { lat: number; lon: number } | null = null;

    for (const key of cells) {
      const bucket = this.grid.get(key);
      if (!bucket) continue;
      for (const seg of bucket) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        // Check each path sub-segment against each coast segment
        for (let pi = 0; pi < pathPoints.length - 1; pi++) {
          const pA = pathPoints[pi]!;
          const pB = pathPoints[pi + 1]!;
          for (let ci = 0; ci < seg.coords.length - 1; ci++) {
            const cA = seg.coords[ci]!;
            const cB = seg.coords[ci + 1]!;
            const hit = intersect(pA[0], pA[1], pB[0], pB[1], cA[0], cA[1], cB[0], cB[1]);
            if (hit) {
              // Parametric position along full path: pi/pathSegCount + hit.t / pathSegCount
              const pathSegCount = pathPoints.length - 1;
              const t = (pi + hit.t) / pathSegCount;
              if (t < bestT) {
                bestT = t;
                bestPoint = { lat: hit.y, lon: hit.x };
              }
            }
          }
        }
      }
    }

    return bestPoint;
  }
}

/**
 * Segment-segment intersection in 2D. Returns the intersection point and the
 * parameter t along AB where it hits (0 = A, 1 = B), or null if no intersection.
 */
function intersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): { x: number; y: number; t: number } | null {
  const denom = (dy - cy) * (bx - ax) - (dx - cx) * (by - ay);
  if (denom === 0) return null;
  const ua = ((dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)) / denom;
  const ub = ((bx - ax) * (ay - cy) - (by - ay) * (ax - cx)) / denom;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: ax + ua * (bx - ax), y: ay + ua * (by - ay), t: ua };
}
