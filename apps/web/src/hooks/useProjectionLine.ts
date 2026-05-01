// apps/web/src/hooks/useProjectionLine.ts
import { useEffect, useRef, useCallback } from 'react';
import type maplibregl from 'maplibre-gl';
import { useGameStore } from '@/lib/store';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';
import type { BoatClass, ExclusionZone } from '@nemo/shared-types';
import type {
  ProjectionInput,
  ProjectionSegment,
  ProjectionZone,
  WorkerInMessage,
  WorkerOutMessage,
  ProjectionResult,
  ProjectionRun,
} from '@/lib/projection/types';
import { serializeDraft } from '@/lib/prog/serialize';
import { deepEqDraft } from '@/lib/prog/equality';
import type {
  ProgDraft, ProgEditorPreview, CapOrder, SailOrder,
} from '@/lib/prog/types';

const ZONE_DEFAULT_MULTIPLIER = { WARN: 0.8, PENALTY: 0.5 };

// ── line-gradient color ramp ──
// Mirrors the previous static `line-color` interpolate stops (red → orange →
// yellow → green by speed-to-bspMax ratio). We bake colors per vertex client-
// side because `line-gradient` only accepts `['line-progress']` as input —
// data-driven attributes are not allowed inside it.
const COLOR_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 192, 57, 43],   // #c0392b — red
  [0.2, 192, 57, 43],
  [0.35, 230, 126, 34], // #e67e22 — orange
  [0.5, 241, 196, 15],  // #f1c40f — yellow
  [0.75, 39, 174, 96],  // #27ae60 — green
  [1.0, 39, 174, 96],
];

function bspRatioToRgb(ratio: number): string {
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [t0, r0, g0, b0] = COLOR_STOPS[i]!;
    const [t1, r1, g1, b1] = COLOR_STOPS[i + 1]!;
    if (r >= t0 && r <= t1) {
      const f = t1 === t0 ? 0 : (r - t0) / (t1 - t0);
      const R = Math.round(r0 + (r1 - r0) * f);
      const G = Math.round(g0 + (g1 - g0) * f);
      const B = Math.round(b0 + (b1 - b0) * f);
      return `rgb(${R},${G},${B})`;
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]!;
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

import { haversineKmScalar as haversineKm } from '@/lib/geo';

/**
 * Build a MapLibre `line-gradient` expression directly from the packed
 * pointsBuf [lat, lon, dtMs, bsp, tws, twd] × N. Avoids any per-vertex
 * object allocation on the hot path.
 *
 * Note: MapLibre's `line-progress` is computed in projected (mercator) space
 * while we use geodesic (haversine). At mid-latitudes the two diverge by less
 * than ~1% over the projection's typical extent — visually invisible.
 */
function buildLineGradient(
  buf: Float32Array,
  count: number,
  bspMax: number,
): unknown | null {
  if (count < 2) return null;

  const dist = new Float64Array(count);
  let total = 0;
  for (let i = 1; i < count; i++) {
    const b0 = (i - 1) * 6;
    const b1 = i * 6;
    const d = haversineKm(buf[b0]!, buf[b0 + 1]!, buf[b1]!, buf[b1 + 1]!);
    total += d;
    dist[i] = total;
  }
  if (total <= 0) return null;

  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  // MapLibre requires strictly increasing stops. We skip duplicates entirely:
  // if a vertex is at the same line-progress as the previous one (zero-length
  // segment, e.g. when the WPT capture path pushed a synthetic vertex right
  // at a point already in the buffer), the previous stop's color still applies
  // up to the next valid stop. The first stop is always emitted.
  let lastT = -1;
  for (let i = 0; i < count; i++) {
    let t = dist[i]! / total;
    if (t > 1) t = 1;
    if (i > 0 && t <= lastT) continue;
    lastT = t;
    const bsp = buf[i * 6 + 3]!;
    const ratio = bspMax > 0 ? bsp / bspMax : 0;
    expr.push(t, bspRatioToRgb(ratio));
  }
  // Defensive: if dedup left fewer than 2 stops, return null (no gradient).
  if (expr.length < 7) return null; // 'interpolate' + ['linear'] + ['line-progress'] + 2 stops = 7 entries
  return expr;
}

// Packed layout: [u_kn, v_kn, swh, swellSin, swellCos, swellPeriod]. Storing
// wind as (u, v) and swell direction as (sin, cos) lets the lookup interpolate
// every field linearly — no per-corner trig in the hot sample path.
const FIELDS_PER_POINT = 6;
const MS_TO_KTS = 1.94384;

/**
 * Pack the multi-hour decoded GRIB grid (u/v/swh/mwdSin/mwdCos/mwp per hour)
 * into the worker's expected layout (u_kn/v_kn/swh/mwdSin/mwdCos/mwp).
 * One layer per forecast hour — enables temporal interpolation.
 */
function packWindDataFromDecoded(decoded: DecodedWeatherGrid): {
  data: Float32Array;
  timestamps: number[];
  cols: number;
  rows: number;
  resolution: number;
  bounds: { north: number; south: number; east: number; west: number };
} {
  const { header, data: src } = decoded;
  const { numLat, numLon, numHours } = header;
  const pointsPerHour = numLat * numLon;
  const out = new Float32Array(numHours * pointsPerHour * FIELDS_PER_POINT);
  const timestamps: number[] = [];
  // Layers aren't necessarily one hour apart — use the actual hour offsets
  // attached by fetchWeatherGrid (fallback to sequential hours if missing).
  const hoursList = decoded.hours ?? Array.from({ length: numHours }, (_, i) => i);

  console.log('[Projection] GRIB header:', {
    runTs: header.runTimestamp,
    runDate: new Date(header.runTimestamp * 1000).toISOString(),
    numLat, numLon, numHours,
    stepLat: header.gridStepLat, stepLon: header.gridStepLon,
    bounds: { north: header.latMax, south: header.latMin, east: header.lonMax, west: header.lonMin },
    hoursList: hoursList.slice(0, 10),
  });
  // Sample a few raw u,v values at known positions to verify data integrity.
  // Expected: u,v in m/s; sqrt(u² + v²) × 1.944 ≈ knots.
  {
    const sampleLat = 47, sampleLon = -3;
    const latIdx = Math.max(0, Math.min(numLat - 1, Math.round((header.latMax - sampleLat) / header.gridStepLat)));
    const lonIdx = Math.max(0, Math.min(numLon - 1, Math.round((sampleLon - header.lonMin) / header.gridStepLon)));
    const base = (latIdx * numLon + lonIdx) * 6;
    const u = src[base]!;
    const v = src[base + 1]!;
    const ms = Math.sqrt(u * u + v * v);
    console.log('[Projection] sample (47°N, -3°W) hour 0 raw:', {
      latIdx, lonIdx, u: u.toFixed(3), v: v.toFixed(3),
      magnitude_ms: ms.toFixed(2),
      magnitude_kn_if_ms: (ms * MS_TO_KTS).toFixed(2),
      magnitude_kn_if_already_kn: ms.toFixed(2),
    });
  }

  for (let h = 0; h < numHours; h++) {
    const forecastHour = hoursList[h] ?? h;
    timestamps.push((header.runTimestamp + forecastHour * 3600) * 1000);
    const srcHour = h * pointsPerHour * 6;
    const outHour = h * pointsPerHour * FIELDS_PER_POINT;
    for (let i = 0; i < pointsPerHour; i++) {
      const sb = srcHour + i * 6;
      const ob = outHour + i * FIELDS_PER_POINT;
      const u = src[sb]!;
      const v = src[sb + 1]!;
      const swh = src[sb + 2]!;
      const mwdSin = src[sb + 3]!;
      const mwdCos = src[sb + 4]!;
      const mwp = src[sb + 5]!;
      // u/v converted to knots once at pack time; the lookup just runs sqrt.
      out[ob] = u * MS_TO_KTS;
      out[ob + 1] = v * MS_TO_KTS;
      out[ob + 2] = Number.isFinite(swh) && swh > 0 ? swh : 0;
      // mwdSin/mwdCos already form a unit vector — store as-is for linear interp.
      out[ob + 3] = Number.isFinite(mwdSin) ? mwdSin : 0;
      out[ob + 4] = Number.isFinite(mwdCos) ? mwdCos : 0;
      out[ob + 5] = Number.isFinite(mwp) ? mwp : 0;
    }
  }

  return {
    data: out,
    timestamps,
    cols: numLon,
    rows: numLat,
    resolution: header.gridStepLat,
    bounds: { north: header.latMax, south: header.latMin, east: header.lonMax, west: header.lonMin },
  };
}

const BOAT_CLASS_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

/**
 * Single-snapshot fallback: pack a WeatherGrid (already tws/twd) when the
 * decoded multi-hour binary isn't available yet. Converts tws/twd → u/v and
 * swellDir → sin/cos to match the layout the lookup expects.
 */
function packWindDataFromSnapshot(grid: {
  points: Array<{ tws: number; twd: number; swellHeight: number; swellDir: number; swellPeriod: number }>;
  cols: number;
  rows: number;
  resolution: number;
  bounds: { north: number; south: number; east: number; west: number };
  timestamps: number[];
}): {
  data: Float32Array;
  timestamps: number[];
  cols: number;
  rows: number;
  resolution: number;
  bounds: { north: number; south: number; east: number; west: number };
} {
  const n = grid.points.length;
  const data = new Float32Array(n * FIELDS_PER_POINT);
  const DEG_TO_RAD = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const p = grid.points[i]!;
    const b = i * FIELDS_PER_POINT;
    // Recover u/v from (tws, twd). twd is the direction wind comes FROM, so
    // (-sin, -cos) gives the direction it blows TO — matches the GRIB convention.
    const twdRad = p.twd * DEG_TO_RAD;
    data[b] = -Math.sin(twdRad) * p.tws;
    data[b + 1] = -Math.cos(twdRad) * p.tws;
    data[b + 2] = p.swellHeight > 0 ? p.swellHeight : 0;
    const swdRad = p.swellDir * DEG_TO_RAD;
    data[b + 3] = Math.sin(swdRad);
    data[b + 4] = Math.cos(swdRad);
    data[b + 5] = p.swellPeriod;
  }
  return {
    data,
    timestamps: grid.timestamps.length > 0 ? [grid.timestamps[0]!] : [Date.now()],
    cols: grid.cols,
    rows: grid.rows,
    resolution: grid.resolution,
    bounds: grid.bounds,
  };
}

/**
 * Convert an ExclusionZone (GeoJSON polygon) to a ProjectionZone (flat ring
 * with precomputed bbox and ms timestamps).
 */
function toProjectionZone(z: ExclusionZone): ProjectionZone | null {
  const outerRing = z.geometry.coordinates[0];
  if (!outerRing || outerRing.length < 3) return null;
  const ring: number[] = [];
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of outerRing) {
    const lon = p[0]!;
    const lat = p[1]!;
    ring.push(lon, lat);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return {
    id: z.id,
    name: z.name,
    type: z.type,
    speedMultiplier: z.speedMultiplier ?? ZONE_DEFAULT_MULTIPLIER[z.type],
    ring,
    bbox: { minLat, maxLat, minLon, maxLon },
    activeFromMs: z.activeFrom ? Date.parse(z.activeFrom) : null,
    activeToMs: z.activeTo ? Date.parse(z.activeTo) : null,
  };
}

/**
 * Convert store's orderQueue to ProjectionSegments. Includes WPT orders so
 * the projection follows the route's waypoints (mirrors the engine tick's
 * applyOrder WPT case which recomputes heading toward the active waypoint).
 *
 * AT_WAYPOINT triggers don't carry a time — they cascade. We record the
 * predecessor id on the segment and stamp triggerMs with the
 * Number.MAX_SAFE_INTEGER sentinel so the segment never fires by pure time
 * comparison. The worker rewrites triggerMs to the capture moment when the
 * referenced WPT is captured. This matters for:
 *   - WPT chain ordering (existing behaviour, preserved).
 *   - Final cap (CAP/TWA with AT_WAYPOINT(lastWp)): used to fire at Date.now()
 *     in the old code, getting overridden by the WPT chain heading and never
 *     observable. Now it fires at the moment the last WP is captured and
 *     drives the projection past the last WP.
 *   - Sail-at-WP (SAIL with AT_WAYPOINT(wpN)): same fix — fires at WP capture.
 */
const TRIGGER_MS_PENDING = Number.MAX_SAFE_INTEGER;

function orderQueueToSegments(queue: Array<{ id: string; type: string; trigger: { type: string; time?: number; waypointOrderId?: string }; value: Record<string, unknown> }>): ProjectionSegment[] {
  return queue
    .filter((o) => o.type === 'CAP' || o.type === 'TWA' || o.type === 'SAIL' || o.type === 'MODE' || o.type === 'WPT')
    .map((o): ProjectionSegment => {
      let value: ProjectionSegment['value'];
      if (o.type === 'CAP') value = Number(o.value['heading'] ?? o.value['cap'] ?? 0);
      else if (o.type === 'TWA') value = Number(o.value['twa'] ?? 0);
      else if (o.type === 'SAIL') value = String(o.value['sail'] ?? 'JIB');
      else if (o.type === 'MODE') value = Boolean(o.value['auto'] ?? false);
      else {
        // WPT
        const lat = Number(o.value['lat'] ?? 0);
        const lon = Number(o.value['lon'] ?? 0);
        const radiusRaw = Number(o.value['captureRadiusNm']);
        const captureRadiusNm = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 0.001;
        value = { lat, lon, captureRadiusNm };
      }

      // Default: AT_WAYPOINT triggers are pending until the worker sees the
      // referenced WPT captured. AT_TIME stamps the order in ms.
      let triggerMs = TRIGGER_MS_PENDING;
      if (o.trigger.type === 'AT_TIME' && o.trigger.time) {
        // OrderTrigger.time is Unix seconds (matches engine convention
        // `nowUnix >= trigger.time`); the projection worker expects
        // millisecond timestamps for triggerMs. Without this conversion the
        // segment fires "in the past" (~1.7e9 vs currentMs ~1.7e12) and the
        // worker applies all CAP/TWA orders on the first iteration —
        // collapsing the projection to a straight line in the last heading.
        triggerMs = o.trigger.time * 1000;
      } else if (o.trigger.type === 'IMMEDIATE') {
        triggerMs = Date.now();
      }

      const seg: ProjectionSegment = { triggerMs, type: o.type as ProjectionSegment['type'], value };
      seg.id = o.id;
      if (o.trigger.type === 'AT_WAYPOINT' && o.trigger.waypointOrderId) {
        seg.waypointPredecessorId = o.trigger.waypointOrderId;
      }
      return seg;
    });
}

/**
 * Apply the editor preview (ghost order) to a draft snapshot before the
 * worker pipeline serializes it. The ghost replaces the order with id
 * `replacesId` if present (editing existing), or appends otherwise (NEW).
 *
 * Returns the same draft reference when there's nothing to apply — the
 * caller relies on referential identity to short-circuit equality checks.
 */
function applyEditorPreviewToDraft(
  draft: ProgDraft,
  preview: ProgEditorPreview | null,
): ProgDraft {
  if (!preview) return draft;
  if (preview.kind === 'cap') {
    const ghost = preview.ghostOrder as CapOrder;
    const next: CapOrder[] = preview.replacesId !== null
      ? draft.capOrders.map((o) => (o.id === preview.replacesId ? ghost : o))
      : [...draft.capOrders, ghost];
    return { ...draft, capOrders: next };
  }
  // sail
  const ghost = preview.ghostOrder as SailOrder;
  const next: SailOrder[] = preview.replacesId !== null
    ? draft.sailOrders.map((o) => (o.id === preview.replacesId ? ghost : o))
    : [...draft.sailOrders, ghost];
  return { ...draft, sailOrders: next };
}

/**
 * Find the projection point closest to a given target wall-clock time.
 * Buffer layout: [lat, lon, dtMs, bsp, tws, twd] × N — see PROJECTION_POINT_FIELDS.
 * `dtMs` is relative to `run.startMs`; we look for the index whose absolute
 * timestamp is nearest to `targetMs`. Linear scan: pointsCount is bounded by
 * the projection step count (~few hundred), well below where binary search
 * would matter and we only run this once per order per recompute.
 */
function findProjectionPointAtTime(
  run: ProjectionRun,
  targetMs: number,
): { lat: number; lon: number } | null {
  const buf = run.pointsBuf;
  const count = run.pointsCount;
  if (count === 0) return null;
  const targetDt = targetMs - run.startMs;
  // Negative target → before the projection starts: fall back to the first
  // point. Beyond the last point → fall back to the last.
  if (targetDt <= buf[2]!) return { lat: buf[0]!, lon: buf[1]! };
  const lastB = (count - 1) * 6;
  if (targetDt >= buf[lastB + 2]!) return { lat: buf[lastB]!, lon: buf[lastB + 1]! };
  // Find the first point whose dtMs >= targetDt — return whichever side is
  // closer in time.
  for (let i = 1; i < count; i++) {
    const b = i * 6;
    const dt = buf[b + 2]!;
    if (dt >= targetDt) {
      const prevB = (i - 1) * 6;
      const prevDt = buf[prevB + 2]!;
      const prevDist = targetDt - prevDt;
      const currDist = dt - targetDt;
      return prevDist <= currDist
        ? { lat: buf[prevB]!, lon: buf[prevB + 1]! }
        : { lat: buf[b]!, lon: buf[b + 1]! };
    }
  }
  return { lat: buf[lastB]!, lon: buf[lastB + 1]! };
}

/**
 * Build a FeatureCollection for the prog-order-markers source from the active
 * draft + projection run. Order trigger times (CapOrder.trigger.time and
 * SailOrder AT_TIME .time) are Unix SECONDS — matches engine convention and
 * the conversion already in `orderQueueToSegments`.
 */
function buildMarkerGeoJson(
  draft: ProgDraft,
  run: ProjectionRun,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  // Cap orders → predicted position at trigger.time
  for (const cap of draft.capOrders) {
    const pos = findProjectionPointAtTime(run, cap.trigger.time * 1000);
    if (!pos) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
      properties: { kind: 'cap', id: cap.id },
    });
  }

  // Sail orders: AT_TIME → projection lookup; AT_WAYPOINT → no inline marker
  // (the previous offset-east-of-WP placement cluttered the view). Sail-at-WP
  // information is surfaced on WP hover instead — see MapCanvas's hover popup
  // bound to the prog-order-markers-wp layer.
  for (const sail of draft.sailOrders) {
    if (sail.trigger.type === 'AT_TIME') {
      const pos = findProjectionPointAtTime(run, sail.trigger.time * 1000);
      if (!pos) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: { kind: 'sail', id: sail.id },
      });
    }
  }

  // WP orders: literal lat/lon
  for (const wp of draft.wpOrders) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [wp.lon, wp.lat] },
      properties: { kind: 'wp', id: wp.id },
    });
  }

  // Final cap: at the last WP (visually distinct from the WP marker)
  if (draft.finalCap) {
    const lastWp = draft.wpOrders[draft.wpOrders.length - 1];
    if (lastWp) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lastWp.lon, lastWp.lat] },
        properties: { kind: 'finalCap', id: draft.finalCap.id },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

export function useProjectionLine(map: maplibregl.Map | null): void {
  const workerRef = useRef<Worker | null>(null);
  const polarRef = useRef<{ twa: number[]; tws: number[]; speeds: Record<string, number[][]> } | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(map);
  const lastResultRef = useRef<ProjectionResult | null>(null);
  // Cache for packed wind data, keyed by DecodedWeatherGrid reference
  const packedWindRef = useRef<{
    decoded: DecodedWeatherGrid;
    packed: ReturnType<typeof packWindDataFromDecoded>;
  } | null>(null);
  // Tracks which packed grid has already been seeded to the worker — avoids
  // re-transferring 10-30 MB of wind data on every compute.
  const seededPackedRef = useRef<ReturnType<typeof packWindDataFromDecoded> | null>(null);
  // Coalescing instead of debounce: at most one compute in flight; if a
  // request arrives while busy we mark `pending` and re-fire on result with
  // the latest store state. Zero baseline latency on drag — no setTimeout.
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  // Forward-ref shims: requestCompute and updateMapSources are declared
  // further down. The worker onmessage closure (set up in the init effect)
  // needs to call requestCompute; updateMapSources self-references inside
  // an `m.once('idle', ...)` retry path. Calling through these refs avoids
  // TDZ access and keeps the captured handlers/callbacks pointed at the
  // latest useCallback identities at invocation time.
  const requestComputeRef = useRef<() => void>(() => {});
  const updateMapSourcesRef = useRef<(r: ProjectionResult) => void>(() => {});

  /**
   * Push a single ProjectionRun (committed or draft) into the matching MapLibre
   * source/layer set. `variant` selects the layer-id suffix:
   *   - 'committed' → projection-line-committed / -markers-time-committed / …
   *   - 'draft'     → projection-line-draft / …
   */
  const writeRunToMap = useCallback((
    map: maplibregl.Map,
    run: ProjectionRun,
    variant: 'committed' | 'draft',
  ): void => {
    const buf = run.pointsBuf;
    const count = run.pointsCount;

    const lineSrcId = `projection-line-${variant}`;
    const lineLayerId = `projection-line-${variant}-layer`;
    const timeSrcId = `projection-markers-time-${variant}`;
    const manSrcId = `projection-markers-maneuver-${variant}`;

    const lineSrc = map.getSource(lineSrcId) as maplibregl.GeoJSONSource | undefined;
    if (count < 2) {
      lineSrc?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
    } else {
      const coords: Array<[number, number]> = new Array(count);
      for (let i = 0; i < count; i++) {
        const b = i * 6;
        coords[i] = [buf[b + 1]!, buf[b]!]; // [lon, lat]
      }
      lineSrc?.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      });
      const gradient = buildLineGradient(buf, count, run.bspMax);
      if (gradient && map.getLayer(lineLayerId)) {
        map.setPaintProperty(lineLayerId, 'line-gradient', gradient);
      }
    }

    // Time markers
    const timeFeatures: GeoJSON.Feature[] = run.timeMarkers.map((m) => {
      const b = m.index * 6;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [buf[b + 1]!, buf[b]!] },
        properties: { label: m.label },
      };
    });
    const timeSrc = map.getSource(timeSrcId) as maplibregl.GeoJSONSource | undefined;
    timeSrc?.setData({ type: 'FeatureCollection', features: timeFeatures });

    // Maneuver markers — when explicit lat/lon present (WPT captures), use it.
    const manFeatures: GeoJSON.Feature[] = run.maneuverMarkers
      .map((m) => {
        if (m.index < 0 || m.index >= count) return null;
        const b = m.index * 6;
        const lat = m.lat ?? buf[b]!;
        const lon = m.lon ?? buf[b + 1]!;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            type: m.type,
            detail: m.detail,
            timestamp: run.startMs + buf[b + 2]!,
          },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[];
    const manSrc = map.getSource(manSrcId) as maplibregl.GeoJSONSource | undefined;
    manSrc?.setData({ type: 'FeatureCollection', features: manFeatures });
  }, []);

  /**
   * Empty out a variant's three sources. Used to clear the draft layers when
   * the user cancels edits / commits — without this the previous draft polyline
   * would linger on the map until the next compute clears it.
   */
  const clearVariant = useCallback((map: maplibregl.Map, variant: 'committed' | 'draft'): void => {
    const lineSrc = map.getSource(`projection-line-${variant}`) as maplibregl.GeoJSONSource | undefined;
    lineSrc?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
    const timeSrc = map.getSource(`projection-markers-time-${variant}`) as maplibregl.GeoJSONSource | undefined;
    timeSrc?.setData({ type: 'FeatureCollection', features: [] });
    const manSrc = map.getSource(`projection-markers-maneuver-${variant}`) as maplibregl.GeoJSONSource | undefined;
    manSrc?.setData({ type: 'FeatureCollection', features: [] });
  }, []);

  /**
   * Phase 2b Task 3: refresh the prog-order-markers source from the active
   * draft/committed slice + the matching projection run. AT_TIME orders are
   * placed at the projection point matching their trigger time; AT_WAYPOINT
   * sails are offset slightly east of the referenced WP so they don't sit
   * exactly on top; WPs and finalCap use literal lat/lon. */
  const refreshOrderMarkers = useCallback((map: maplibregl.Map, draft: ProgDraft, run: ProjectionRun): void => {
    const src = map.getSource('prog-order-markers') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildMarkerGeoJson(draft, run));
  }, []);

  /**
   * Live editor-preview marker — placed at the projection point matching the
   * ghost order's AT_TIME trigger. Reads from the active run (draft when
   * dirty, committed otherwise) so the marker tracks whatever line the user
   * is actively editing. Cleared when preview is null OR when the trigger is
   * AT_WAYPOINT (in which case the WP marker already shows the firing
   * point).
   */
  const refreshPreviewMarker = useCallback((
    map: maplibregl.Map,
    preview: ProgEditorPreview | null,
    run: ProjectionRun,
  ): void => {
    const src = map.getSource('prog-order-marker-preview') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const empty = (): void => {
      src.setData({ type: 'FeatureCollection', features: [] });
    };
    if (!preview) { empty(); return; }
    const trigger = preview.ghostOrder.trigger;
    if (trigger.type !== 'AT_TIME') { empty(); return; }
    const pos = findProjectionPointAtTime(run, trigger.time * 1000);
    if (!pos) { empty(); return; }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: {},
      }],
    });
  }, []);

  // Update MapLibre sources with projection result. Renders the committed run
  // into the *-committed source/layer set, and (when the worker found a
  // distinct draft) the draft run into the *-draft set. When draft is absent,
  // we explicitly clear the *-draft sources so a stale draft polyline from a
  // previous dirty cycle doesn't linger.
  const updateMapSources = useCallback((result: ProjectionResult) => {
    const m = mapRef.current;
    if (!m) return;
    // If sources aren't added yet, schedule a retry on next idle frame.
    // isStyleLoaded() is unreliable — relying on source presence instead.
    if (!m.getSource('projection-line-committed')) {
      m.once('idle', () => {
        if (lastResultRef.current) updateMapSourcesRef.current(lastResultRef.current);
      });
      return;
    }
    // Sanity log: if the map ever reports more than one layer for any of the
    // projection-* ids the duplicate render bug has reappeared. MapLibre's
    // public API only allows a single layer per id, so this should never
    // fire — but the log makes regressions visible immediately.
    if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
      const styleLayers = m.getStyle().layers ?? [];
      const counts: Record<string, number> = {};
      const watched = new Set<string>([
        'projection-line-committed-layer', 'projection-line-draft-layer',
        'projection-markers-time-committed-circle', 'projection-markers-time-committed-label',
        'projection-markers-time-draft-circle', 'projection-markers-time-draft-label',
        'projection-markers-maneuver-committed-icon', 'projection-markers-maneuver-draft-icon',
      ]);
      for (const layer of styleLayers) {
        if (watched.has(layer.id)) {
          counts[layer.id] = (counts[layer.id] ?? 0) + 1;
        }
      }
      for (const [id, n] of Object.entries(counts)) {
        if (n > 1) console.warn('[useProjectionLine] DUPLICATE projection layer detected:', id, '×', n);
      }
    }

    writeRunToMap(m, result, 'committed');

    // Drive the committed line opacity from `isDirty`. When draft is present,
    // the committed projection becomes a faint "ghost" reference at 25% so
    // the draft (full opacity) is unambiguously the line the user is editing;
    // when not, the committed line is the only one and stays at full opacity
    // (~0.85, the legacy value baked into the layer paint).
    if (m.getLayer('projection-line-committed-layer')) {
      m.setPaintProperty('projection-line-committed-layer', 'line-opacity', result.draft ? 0.25 : 0.85);
    }

    if (result.draft) {
      writeRunToMap(m, result.draft, 'draft');
    } else {
      clearVariant(m, 'draft');
    }

    // Phase 2b Task 3: refresh the per-order markers. Use draft when dirty
    // (so markers match what the user is editing), committed otherwise. The
    // active run (result.draft / result) is the matching projection — its
    // pointsBuf is what AT_TIME orders project against.
    const state = useGameStore.getState();
    const isDirty = !!result.draft;
    const activeDraft = isDirty ? state.prog.draft : state.prog.committed;
    const activeRun: ProjectionRun = result.draft ?? result;
    refreshOrderMarkers(m, activeDraft, activeRun);
    // Re-anchor the live editor-preview marker against the new run too —
    // when the projection geometry shifts (new tick / new draft), the
    // preview's interpolated position must follow.
    refreshPreviewMarker(m, state.prog.editorPreview, activeRun);
  }, [writeRunToMap, clearVariant, refreshOrderMarkers, refreshPreviewMarker]);

  // Keep mapRef in sync without re-running effects when map changes
  useEffect(() => {
    mapRef.current = map;
    // If we already have a result and the map just became ready, render it
    if (map && lastResultRef.current) {
      updateMapSources(lastResultRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Initialize Worker
  useEffect(() => {
    console.log('[Projection] hook mounted, map =', mapRef.current ? 'ready' : 'null');
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../workers/projection.worker.ts', import.meta.url),
        { type: 'module' },
      );
      console.log('[Projection] worker created');
    } catch (err) {
      console.error('[Projection] worker init failed:', err);
      return;
    }

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (e.data.type === 'result') {
        inFlightRef.current = false;
        lastResultRef.current = e.data.result;
        updateMapSources(e.data.result);
        // Publish a lat/lon/dtMs-only snapshot for downstream consumers
        // (timeline ghost boat). Drops bsp/tws/twd to keep the snapshot
        // small — the timeline only needs geometry for interpolation.
        const result = e.data.result;
        const buf = result.pointsBuf;
        const count = result.pointsCount;
        const points: { dtMs: number; lat: number; lon: number }[] = new Array(count);
        for (let i = 0; i < count; i++) {
          const b = i * 6;
          points[i] = { lat: buf[b]!, lon: buf[b + 1]!, dtMs: buf[b + 2]! };
        }
        useGameStore.getState().setProjectionSnapshot({ points });
        // If the user kept dragging while we were computing, fire a fresh
        // compute with the latest store state — no debounce, no stale frame.
        if (pendingRef.current) {
          pendingRef.current = false;
          requestComputeRef.current();
        }
      } else if (e.data.type === 'error') {
        inFlightRef.current = false;
        console.error('[Projection] worker error:', e.data.message);
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      console.error('[Projection] worker runtime error:', e.message, e.filename, e.lineno);
    };

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      // Clear snapshot so a stale future trajectory doesn't linger after the
      // hook unmounts (e.g. when leaving the play page).
      useGameStore.getState().setProjectionSnapshot(null);
    };
  }, [updateMapSources]);

  // Load polar data — reactive to boatClass so that when the first MyBoat
  // payload arrives and overrides the default INITIAL_HUD boat class, we
  // refetch the right polar (the default polar's sail set would otherwise
  // drive the projection's auto-switch into sails the boat doesn't carry).
  const boatClass = useGameStore((s) => s.hud.boatClass);
  useEffect(() => {
    if (!boatClass) return;
    const file = BOAT_CLASS_FILES[boatClass];
    if (!file) return;

    fetch(`/data/polars/${file}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((polar) => {
        polarRef.current = polar;
        requestComputeRef.current();
      })
      .catch((err) => console.error('[Projection] polar fetch failed:', err));
  }, [boatClass]);

  // Trigger recalculation. Coalescing: at most one compute in flight; while
  // busy, just mark pending and the result handler re-fires with latest state.
  const requestCompute = useCallback(() => {
    if (!workerRef.current) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    const state = useGameStore.getState();
    const { hud, sail, weather, preview, zones, prog } = state;
    const decoded = weather.decodedGrid;
    const snapshot = weather.gridData;
    if (!decoded && !snapshot) return;
    if (!hud.lat && !hud.lon) return;
    if (!hud.boatClass) return;
    if (!polarRef.current) return;

    // Preview overrides actual state (compass drag, sail hover, TWA lock)
    const effectiveHdg = preview.hdg ?? hud.hdg;
    const effectiveSail = preview.sail ?? sail.currentSail;
    let effectiveTwaLock = preview.twaLocked ? preview.lockedTwa : null;

    // Dragging compass while TWA locked: interpret the new heading as
    // a new locked TWA (relative to current wind direction).
    if (preview.twaLocked && preview.hdg !== null) {
      effectiveTwaLock = ((preview.hdg - hud.twd + 540) % 360) - 180;
      if (effectiveTwaLock === -180) effectiveTwaLock = 180;
    }

    // Pack wind data — prefer multi-hour decoded, fall back to single snapshot.
    // The packed buffer is kept on the main thread (cached in packedWindRef)
    // only so we can detect when the grid has changed and needs re-seeding.
    let packed: ReturnType<typeof packWindDataFromDecoded>;
    if (decoded) {
      if (!packedWindRef.current || packedWindRef.current.decoded !== decoded) {
        packedWindRef.current = { decoded, packed: packWindDataFromDecoded(decoded) };
        seededPackedRef.current = null; // grid changed — need to re-seed the worker
      }
      packed = packedWindRef.current.packed;
    } else {
      packed = packWindDataFromSnapshot(snapshot!);
    }

    // Seed the worker once per grid — subsequent `compute` messages carry
    // only boat state (~1 KB) instead of re-transferring 10-30 MB of wind.
    if (seededPackedRef.current !== packed) {
      const seed = new Float32Array(packed.data); // copy because we transfer
      const seedMsg: WorkerInMessage = {
        type: 'setWindGrid',
        windGrid: {
          bounds: packed.bounds,
          resolution: packed.resolution,
          cols: packed.cols,
          rows: packed.rows,
          timestamps: packed.timestamps,
        },
        windData: seed,
      };
      workerRef.current.postMessage(seedMsg, [seed.buffer]);
      seededPackedRef.current = packed;
    }

    const nowMs = Date.now();

    // Phase 2b Task 2: emit BOTH committed and draft segment lists. The worker
    // detects equality via referential identity — when prog.draft === prog.committed
    // (no edits), they serialize through the same path but are not the same
    // ARRAY reference, so we explicitly check structural equality here and pass
    // the SAME committed array as draftSegments. The cheap reference check
    // inside the worker then short-circuits the second simulation.
    //
    // Equality uses the typed `deepEqDraft` from `@/lib/prog/equality` so the
    // dirty signal is identical to ProgPanel's — no JSON.stringify ordering
    // fragility.
    //
    // Live editor preview: when CapEditor / SailEditor is open and publishing
    // a ghost order, splice it into the draft BEFORE serialization so the
    // worker sees the in-flight edit as part of the draft trajectory. Cancel
    // wipes the ghost on unmount; Confirmer adds the real order to the draft
    // (the ghost vanishes the same render cycle).
    const draftWithGhost = applyEditorPreviewToDraft(prog.draft, prog.editorPreview);
    const committedSegments = orderQueueToSegments(serializeDraft(prog.committed));
    const isDirty = !deepEqDraft(draftWithGhost, prog.committed);
    const draftSegments = isDirty
      ? orderQueueToSegments(serializeDraft(draftWithGhost))
      : committedSegments; // identical reference → worker skips the 2nd sim

    const input: ProjectionInput = {
      lat: hud.lat,
      lon: hud.lon,
      hdg: effectiveHdg,
      nowMs,
      boatClass: hud.boatClass,
      activeSail: effectiveSail,
      sailAuto: sail.sailAuto,
      twaLock: effectiveTwaLock,
      segments: committedSegments,
      draftSegments,
      polar: polarRef.current,
      // Real aggregated loadout effects from the engine — upgrade bonuses
      // and wear multipliers shape the predicted trajectory the same way
      // they shape the live tick.
      effects: hud.effects,
      condition: {
        hull: hud.wearDetail.hull,
        rig: hud.wearDetail.rig,
        sails: hud.wearDetail.sails,
        electronics: hud.wearDetail.electronics,
      },
      activeManeuver: sail.maneuverEndMs > Date.now()
        ? { endMs: sail.maneuverEndMs, speedFactor: 0.7 }
        : null,
      activeTransition: sail.transitionEndMs > Date.now()
        ? { endMs: sail.transitionEndMs, speedFactor: 0.7 }
        : null,
      prevTwa: hud.twa || null,
      referenceTwd: hud.twd,
      zones: zones.map(toProjectionZone).filter((z): z is ProjectionZone => z !== null),
    };

    const msg: WorkerInMessage = { type: 'compute', input };
    workerRef.current.postMessage(msg);
    inFlightRef.current = true;
  }, []);

  // Keep the forward-ref shims pointing at the current useCallback identities
  // so the worker.onmessage closure and the updateMapSources idle-retry path
  // always invoke the latest implementations.
  useEffect(() => {
    requestComputeRef.current = requestCompute;
  }, [requestCompute]);
  useEffect(() => {
    updateMapSourcesRef.current = updateMapSources;
  }, [updateMapSources]);

  // Subscribe to store changes that trigger recalculation
  useEffect(() => {
    let prevHdg = useGameStore.getState().hud.hdg;
    let prevSail = useGameStore.getState().sail.currentSail;
    let prevSailAuto = useGameStore.getState().sail.sailAuto;
    // Phase 2b Task 2: track BOTH prog.committed and prog.draft — committed
    // drives the persistent projection, draft drives the live preview overlay
    // when the user is editing the queue.
    let prevCommitted: unknown = useGameStore.getState().prog.committed;
    let prevDraft: unknown = useGameStore.getState().prog.draft;
    let prevTick = useGameStore.getState().lastTickUnix;
    let prevDecoded = useGameStore.getState().weather.decodedGrid;
    let prevSnapshot = useGameStore.getState().weather.gridData;
    let prevZones = useGameStore.getState().zones;
    let prevPreviewHdg = useGameStore.getState().preview.hdg;
    let prevPreviewSail = useGameStore.getState().preview.sail;
    let prevPreviewTwaLocked = useGameStore.getState().preview.twaLocked;
    let prevPreviewLockedTwa = useGameStore.getState().preview.lockedTwa;
    // Editor live preview: ghostOrder snapshot is spliced into the draft
    // by `applyEditorPreviewToDraft` before the worker simulates, so a
    // change here must trigger a recompute.
    let prevEditorPreview: unknown = useGameStore.getState().prog.editorPreview;

    const unsub = useGameStore.subscribe((s) => {
      const hdgChanged = s.hud.hdg !== prevHdg;
      const sailChanged = s.sail.currentSail !== prevSail;
      const autoChanged = s.sail.sailAuto !== prevSailAuto;
      const committedChanged = s.prog.committed !== prevCommitted;
      const draftChanged = s.prog.draft !== prevDraft;
      const tickChanged = s.lastTickUnix !== prevTick;
      const gridChanged = s.weather.decodedGrid !== prevDecoded || s.weather.gridData !== prevSnapshot;
      const zonesChanged = s.zones !== prevZones;
      const previewHdgChanged = s.preview.hdg !== prevPreviewHdg;
      const previewSailChanged = s.preview.sail !== prevPreviewSail;
      const previewTwaLockedChanged = s.preview.twaLocked !== prevPreviewTwaLocked;
      const previewLockedTwaChanged = s.preview.lockedTwa !== prevPreviewLockedTwa;
      const editorPreviewChanged = s.prog.editorPreview !== prevEditorPreview;

      prevHdg = s.hud.hdg;
      prevSail = s.sail.currentSail;
      prevSailAuto = s.sail.sailAuto;
      prevCommitted = s.prog.committed;
      prevDraft = s.prog.draft;
      prevTick = s.lastTickUnix;
      prevDecoded = s.weather.decodedGrid;
      prevSnapshot = s.weather.gridData;
      prevZones = s.zones;
      prevPreviewHdg = s.preview.hdg;
      prevPreviewSail = s.preview.sail;
      prevPreviewTwaLocked = s.preview.twaLocked;
      prevPreviewLockedTwa = s.preview.lockedTwa;
      prevEditorPreview = s.prog.editorPreview;

      // All state changes funnel through the same coalescing path —
      // backpressure is handled by inFlight/pending refs, not by debounce.
      if (
        previewHdgChanged || hdgChanged ||
        sailChanged || autoChanged || committedChanged || draftChanged ||
        tickChanged || gridChanged ||
        zonesChanged ||
        previewSailChanged || previewTwaLockedChanged || previewLockedTwaChanged ||
        editorPreviewChanged
      ) {
        requestCompute();
      }
    });

    // Initial computation
    requestCompute();

    return unsub;
  }, [requestCompute]);

}
