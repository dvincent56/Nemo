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
} from '@/lib/projection/types';

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
  let lastT = -1;
  for (let i = 0; i < count; i++) {
    let t = dist[i]! / total;
    // MapLibre requires strictly increasing stops. Nudge duplicates forward
    // by a tiny epsilon — degenerate cases (zero-distance segments) are rare
    // but possible when the projection records two points at the same spot.
    if (t <= lastT) t = lastT + 1e-7;
    if (t > 1) t = 1;
    lastT = t;
    const bsp = buf[i * 6 + 3]!;
    const ratio = bspMax > 0 ? bsp / bspMax : 0;
    expr.push(t, bspRatioToRgb(ratio));
  }
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
 * AT_WAYPOINT triggers don't carry a time — they cascade — so we record the
 * predecessor id and let the worker activate WPTs sequentially as they are
 * captured.
 */
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
        const captureRadiusNm = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 0.5;
        value = { lat, lon, captureRadiusNm };
      }

      let triggerMs = Date.now();
      if (o.trigger.type === 'AT_TIME' && o.trigger.time) {
        // OrderTrigger.time is Unix seconds (matches engine convention
        // `nowUnix >= trigger.time`); the projection worker expects
        // millisecond timestamps for triggerMs. Without this conversion the
        // segment fires "in the past" (~1.7e9 vs currentMs ~1.7e12) and the
        // worker applies all CAP/TWA orders on the first iteration —
        // collapsing the projection to a straight line in the last heading.
        triggerMs = o.trigger.time * 1000;
      }

      const seg: ProjectionSegment = { triggerMs, type: o.type as ProjectionSegment['type'], value };
      if (o.type === 'WPT') {
        seg.id = o.id;
        if (o.trigger.type === 'AT_WAYPOINT' && o.trigger.waypointOrderId) {
          seg.waypointPredecessorId = o.trigger.waypointOrderId;
        }
      }
      return seg;
    });
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

  // Keep mapRef in sync without re-running effects when map changes
  useEffect(() => {
    mapRef.current = map;
    // If we already have a result and the map just became ready, render it
    if (map && lastResultRef.current) {
      updateMapSources(lastResultRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update MapLibre sources with projection result
  const updateMapSources = useCallback((result: ProjectionResult) => {
    const m = mapRef.current;
    if (!m) return;
    // If sources aren't added yet, schedule a retry on next idle frame.
    // isStyleLoaded() is unreliable — relying on source presence instead.
    if (!m.getSource('projection-line')) {
      m.once('idle', () => {
        if (lastResultRef.current) updateMapSources(lastResultRef.current);
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
      for (const layer of styleLayers) {
        if (
          layer.id === 'projection-line-layer' ||
          layer.id === 'projection-markers-time-circle' ||
          layer.id === 'projection-markers-time-label' ||
          layer.id === 'projection-markers-maneuver-icon'
        ) {
          counts[layer.id] = (counts[layer.id] ?? 0) + 1;
        }
      }
      for (const [id, n] of Object.entries(counts)) {
        if (n > 1) console.warn('[useProjectionLine] DUPLICATE projection layer detected:', id, '×', n);
      }
    }
    const map = m;
    const buf = result.pointsBuf;
    const count = result.pointsCount;

    // Line source: one LineString covering all points. Color is applied via
    // a `line-gradient` paint expression keyed on `line-progress`, with a
    // stop per vertex placed at its normalised cumulative-distance position.
    // This replaces the old per-segment Feature approach (~500 features per
    // recompute), which was the main render-side bottleneck on mobile.
    const lineSrc = map.getSource('projection-line') as maplibregl.GeoJSONSource | undefined;
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
      const gradient = buildLineGradient(buf, count, result.bspMax);
      if (gradient) {
        map.setPaintProperty('projection-line-layer', 'line-gradient', gradient);
      }
    }

    // Time markers source
    const timeFeatures: GeoJSON.Feature[] = result.timeMarkers.map((m) => {
      const b = m.index * 6;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [buf[b + 1]!, buf[b]!] },
        properties: { label: m.label },
      };
    });

    const timeSrc = map.getSource('projection-markers-time') as maplibregl.GeoJSONSource | undefined;
    timeSrc?.setData({ type: 'FeatureCollection', features: timeFeatures });

    // Maneuver markers source
    const manFeatures: GeoJSON.Feature[] = result.maneuverMarkers
      .map((m) => {
        if (m.index < 0 || m.index >= count) return null;
        const b = m.index * 6;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [buf[b + 1]!, buf[b]!] },
          properties: {
            type: m.type,
            detail: m.detail,
            timestamp: result.startMs + buf[b + 2]!,
          },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[];

    const manSrc = map.getSource('projection-markers-maneuver') as maplibregl.GeoJSONSource | undefined;
    manSrc?.setData({ type: 'FeatureCollection', features: manFeatures });
  }, []);

  // Initialize Worker
  useEffect(() => {
    console.log('[Projection] hook mounted, map =', map ? 'ready' : 'null');
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
        // If the user kept dragging while we were computing, fire a fresh
        // compute with the latest store state — no debounce, no stale frame.
        if (pendingRef.current) {
          pendingRef.current = false;
          requestCompute();
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
        requestCompute();
      })
      .catch((err) => console.error('[Projection] polar fetch failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const { hud, sail, weather, prog, preview, zones } = state;
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

    const input: ProjectionInput = {
      lat: hud.lat,
      lon: hud.lon,
      hdg: effectiveHdg,
      nowMs,
      boatClass: hud.boatClass,
      activeSail: effectiveSail,
      sailAuto: sail.sailAuto,
      twaLock: effectiveTwaLock,
      segments: orderQueueToSegments(prog.orderQueue),
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

  // Subscribe to store changes that trigger recalculation
  useEffect(() => {
    let prevHdg = useGameStore.getState().hud.hdg;
    let prevSail = useGameStore.getState().sail.currentSail;
    let prevSailAuto = useGameStore.getState().sail.sailAuto;
    let prevQueue = useGameStore.getState().prog.orderQueue;
    let prevTick = useGameStore.getState().lastTickUnix;
    let prevDecoded = useGameStore.getState().weather.decodedGrid;
    let prevSnapshot = useGameStore.getState().weather.gridData;
    let prevZones = useGameStore.getState().zones;
    let prevPreviewHdg = useGameStore.getState().preview.hdg;
    let prevPreviewSail = useGameStore.getState().preview.sail;
    let prevPreviewTwaLocked = useGameStore.getState().preview.twaLocked;
    let prevPreviewLockedTwa = useGameStore.getState().preview.lockedTwa;

    const unsub = useGameStore.subscribe((s) => {
      const hdgChanged = s.hud.hdg !== prevHdg;
      const sailChanged = s.sail.currentSail !== prevSail;
      const autoChanged = s.sail.sailAuto !== prevSailAuto;
      const queueChanged = s.prog.orderQueue !== prevQueue;
      const tickChanged = s.lastTickUnix !== prevTick;
      const gridChanged = s.weather.decodedGrid !== prevDecoded || s.weather.gridData !== prevSnapshot;
      const zonesChanged = s.zones !== prevZones;
      const previewHdgChanged = s.preview.hdg !== prevPreviewHdg;
      const previewSailChanged = s.preview.sail !== prevPreviewSail;
      const previewTwaLockedChanged = s.preview.twaLocked !== prevPreviewTwaLocked;
      const previewLockedTwaChanged = s.preview.lockedTwa !== prevPreviewLockedTwa;

      prevHdg = s.hud.hdg;
      prevSail = s.sail.currentSail;
      prevSailAuto = s.sail.sailAuto;
      prevQueue = s.prog.orderQueue;
      prevTick = s.lastTickUnix;
      prevDecoded = s.weather.decodedGrid;
      prevSnapshot = s.weather.gridData;
      prevZones = s.zones;
      prevPreviewHdg = s.preview.hdg;
      prevPreviewSail = s.preview.sail;
      prevPreviewTwaLocked = s.preview.twaLocked;
      prevPreviewLockedTwa = s.preview.lockedTwa;

      // All state changes funnel through the same coalescing path —
      // backpressure is handled by inFlight/pending refs, not by debounce.
      if (
        previewHdgChanged || hdgChanged ||
        sailChanged || autoChanged || queueChanged || tickChanged || gridChanged ||
        zonesChanged ||
        previewSailChanged || previewTwaLockedChanged || previewLockedTwaChanged
      ) {
        requestCompute();
      }
    });

    // Initial computation
    requestCompute();

    return unsub;
  }, [requestCompute]);
}
