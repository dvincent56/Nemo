// apps/web/src/hooks/useProjectionLine.ts
import { useEffect, useRef, useCallback } from 'react';
import type maplibregl from 'maplibre-gl';
import { useGameStore } from '@/lib/store';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';
import type { ExclusionZone } from '@nemo/shared-types';
import type {
  ProjectionInput,
  ProjectionSegment,
  ProjectionZone,
  WorkerInMessage,
  WorkerOutMessage,
  ProjectionResult,
} from '@/lib/projection/types';

const ZONE_DEFAULT_MULTIPLIER = { WARN: 0.8, PENALTY: 0.5 };

const DEBOUNCE_HDG_MS = 100;
const FIELDS_PER_POINT = 5; // tws, twd, swh, swellDir, swellPeriod
const MS_TO_KTS = 1.94384;

/**
 * Convert the multi-hour decoded GRIB grid (u/v/swh/mwdSin/mwdCos/mwp per hour)
 * into a packed Float32Array of (tws/twd/swh/swellDir/swellPeriod) for the worker.
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

  for (let h = 0; h < numHours; h++) {
    timestamps.push((header.runTimestamp + h * 3600) * 1000);
    const srcHour = h * pointsPerHour * 6;
    const outHour = h * pointsPerHour * FIELDS_PER_POINT;
    for (let i = 0; i < pointsPerHour; i++) {
      const sb = srcHour + i * 6;
      const u = src[sb]!;
      const v = src[sb + 1]!;
      const swh = src[sb + 2]!;
      const mwdSin = src[sb + 3]!;
      const mwdCos = src[sb + 4]!;
      const mwp = src[sb + 5]!;
      const tws = Math.sqrt(u * u + v * v) * MS_TO_KTS;
      const twd = ((Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360;
      const swellDir = Number.isFinite(mwdSin) && Number.isFinite(mwdCos)
        ? ((Math.atan2(mwdSin, mwdCos) * 180 / Math.PI) + 360) % 360
        : 0;
      const ob = outHour + i * FIELDS_PER_POINT;
      out[ob] = tws;
      out[ob + 1] = twd;
      out[ob + 2] = Number.isFinite(swh) ? Math.max(0, swh) : 0;
      out[ob + 3] = swellDir;
      out[ob + 4] = Number.isFinite(mwp) ? mwp : 0;
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

const BOAT_CLASS_FILES: Record<string, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

/**
 * Single-snapshot fallback: pack a WeatherGrid (already tws/twd) when the
 * decoded multi-hour binary isn't available yet.
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
  for (let i = 0; i < n; i++) {
    const p = grid.points[i]!;
    const b = i * FIELDS_PER_POINT;
    data[b] = p.tws;
    data[b + 1] = p.twd;
    data[b + 2] = p.swellHeight;
    data[b + 3] = p.swellDir;
    data[b + 4] = p.swellPeriod;
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
 * Convert store's orderQueue to ProjectionSegments.
 */
function orderQueueToSegments(queue: Array<{ type: string; trigger: { type: string; time?: number }; value: Record<string, unknown> }>): ProjectionSegment[] {
  return queue
    .filter((o) => o.type === 'CAP' || o.type === 'TWA' || o.type === 'SAIL' || o.type === 'MODE')
    .map((o) => {
      let value: number | string | boolean;
      if (o.type === 'CAP') value = Number(o.value['heading'] ?? o.value['cap'] ?? 0);
      else if (o.type === 'TWA') value = Number(o.value['twa'] ?? 0);
      else if (o.type === 'SAIL') value = String(o.value['sail'] ?? 'JIB');
      else value = Boolean(o.value['auto'] ?? false);

      let triggerMs = Date.now();
      if (o.trigger.type === 'AT_TIME' && o.trigger.time) {
        triggerMs = o.trigger.time;
      }

      return { triggerMs, type: o.type as ProjectionSegment['type'], value };
    });
}

export function useProjectionLine(map: maplibregl.Map | null): void {
  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polarRef = useRef<{ twa: number[]; tws: number[]; speeds: Record<string, number[][]> } | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(map);
  const lastResultRef = useRef<ProjectionResult | null>(null);
  // Cache for packed wind data, keyed by DecodedWeatherGrid reference
  const packedWindRef = useRef<{
    decoded: DecodedWeatherGrid;
    packed: ReturnType<typeof packWindDataFromDecoded>;
  } | null>(null);

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
    const map = m;

    // Line source: one LineString segment per pair of points with bspRatio property
    const lineFeatures: GeoJSON.Feature[] = [];
    for (let i = 0; i < result.points.length - 1; i++) {
      const p0 = result.points[i]!;
      const p1 = result.points[i + 1]!;
      lineFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[p0.lon, p0.lat], [p1.lon, p1.lat]],
        },
        properties: {
          bsp: p0.bsp,
          bspRatio: result.bspMax > 0 ? p0.bsp / result.bspMax : 0,
        },
      });
    }

    const lineSrc = map.getSource('projection-line') as maplibregl.GeoJSONSource | undefined;
    lineSrc?.setData({ type: 'FeatureCollection', features: lineFeatures });

    // Time markers source
    const timeFeatures: GeoJSON.Feature[] = result.timeMarkers.map((m) => {
      const p = result.points[m.index]!;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { label: m.label },
      };
    });

    const timeSrc = map.getSource('projection-markers-time') as maplibregl.GeoJSONSource | undefined;
    timeSrc?.setData({ type: 'FeatureCollection', features: timeFeatures });

    // Maneuver markers source
    const manFeatures: GeoJSON.Feature[] = result.maneuverMarkers
      .map((m) => {
        const p = result.points[m.index];
        if (!p) return null;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { type: m.type, detail: m.detail, timestamp: p.timestamp },
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
        console.log('[Projection] result:', {
          points: e.data.result.points.length,
          timeMarkers: e.data.result.timeMarkers.length,
          maneuverMarkers: e.data.result.maneuverMarkers.length,
          bspMax: e.data.result.bspMax,
        });
        lastResultRef.current = e.data.result;
        updateMapSources(e.data.result);
      } else if (e.data.type === 'error') {
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

  // Load polar data
  useEffect(() => {
    const boatClass = useGameStore.getState().hud.boatClass;
    if (!boatClass) return;
    const file = BOAT_CLASS_FILES[boatClass];
    if (!file) return;

    fetch(`/data/polars/${file}`)
      .then((r) => r.json())
      .then((polar) => {
        polarRef.current = polar;
        console.log('[Projection] polar loaded:', boatClass);
        // Polar may have loaded after the initial compute attempt was skipped
        requestCompute(true);
      })
      .catch((err) => console.error('[Projection] polar fetch failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger recalculation
  const requestCompute = useCallback((immediate = false) => {
    if (!workerRef.current) return;

    const doCompute = () => {
      const state = useGameStore.getState();
      const { hud, sail, weather, prog, preview, zones } = state;
      const decoded = weather.decodedGrid;
      const snapshot = weather.gridData;
      if (!decoded && !snapshot) {
        console.log('[Projection] skip: no weather grid');
        return;
      }
      if (!hud.lat && !hud.lon) {
        console.log('[Projection] skip: no boat position');
        return;
      }
      if (!polarRef.current) {
        console.log('[Projection] skip: polar not loaded yet');
        return;
      }

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
      let packed: ReturnType<typeof packWindDataFromDecoded>;
      if (decoded) {
        if (!packedWindRef.current || packedWindRef.current.decoded !== decoded) {
          console.log('[Projection] packing wind data from', decoded.header.numHours, 'hours');
          packedWindRef.current = { decoded, packed: packWindDataFromDecoded(decoded) };
        }
        packed = packedWindRef.current.packed;
      } else {
        packed = packWindDataFromSnapshot(snapshot!);
      }

      const nowMs = Date.now();
      console.log('[Projection] computing...', {
        lat: hud.lat, lon: hud.lon,
        hdg: effectiveHdg,
        twd: hud.twd,
        twaLock: effectiveTwaLock,
        sail: effectiveSail,
        grid_hours: packed.timestamps.length,
      });

      // Transfer a copy of the packed data so the cached buffer survives
      const windData = new Float32Array(packed.data);

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
        polar: polarRef.current!,
        effects: {
          speedByTwa: [1, 1, 1, 1, 1],
          speedByTws: [1, 1, 1],
          wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
          maneuverMul: {
            tack: { dur: 1, speed: 1 },
            gybe: { dur: 1, speed: 1 },
            sailChange: { dur: 1, speed: 1 },
          },
        },
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
        windGrid: {
          bounds: packed.bounds,
          resolution: packed.resolution,
          cols: packed.cols,
          rows: packed.rows,
          timestamps: packed.timestamps,
        },
        windData,
      };

      const msg: WorkerInMessage = { type: 'compute', input };
      workerRef.current!.postMessage(msg, [windData.buffer]);
    };

    if (immediate) {
      doCompute();
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doCompute, DEBOUNCE_HDG_MS);
    }
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

      // Compass drag → debounced. Everything else → immediate.
      if (previewHdgChanged || hdgChanged) {
        requestCompute(false);
      } else if (
        sailChanged || autoChanged || queueChanged || tickChanged || gridChanged ||
        zonesChanged ||
        previewSailChanged || previewTwaLockedChanged || previewLockedTwaChanged
      ) {
        requestCompute(true);
      }
    });

    // Initial computation
    requestCompute(true);

    return unsub;
  }, [requestCompute]);
}
