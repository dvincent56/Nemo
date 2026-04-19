// apps/web/src/hooks/useProjectionLine.ts
import { useEffect, useRef, useCallback } from 'react';
import type maplibregl from 'maplibre-gl';
import { useGameStore } from '@/lib/store';
import type {
  ProjectionInput,
  ProjectionSegment,
  WorkerInMessage,
  WorkerOutMessage,
  ProjectionResult,
} from '@/lib/projection/types';

const DEBOUNCE_HDG_MS = 100;
const FIELDS_PER_POINT = 5; // tws, twd, swh, swellDir, swellPeriod

const BOAT_CLASS_FILES: Record<string, string> = {
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

/**
 * Packs the WeatherGrid into a flat Float32Array for transfer to the Worker.
 */
function packWindData(grid: { points: Array<{ tws: number; twd: number; swellHeight: number; swellDir: number; swellPeriod: number }>; timestamps: number[] }): Float32Array {
  const numPoints = grid.points.length;
  const numTimestamps = grid.timestamps.length;
  const data = new Float32Array(numTimestamps * numPoints * FIELDS_PER_POINT);

  for (let t = 0; t < numTimestamps; t++) {
    const offset = t * numPoints * FIELDS_PER_POINT;
    for (let i = 0; i < numPoints; i++) {
      const p = grid.points[i]!;
      const base = offset + i * FIELDS_PER_POINT;
      data[base] = p.tws;
      data[base + 1] = p.twd;
      data[base + 2] = p.swellHeight;
      data[base + 3] = p.swellDir;
      data[base + 4] = p.swellPeriod;
    }
  }

  return data;
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
      else if (o.type === 'SAIL') value = String(o.value['sail'] ?? 'GEN');
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
    if (!m) {
      console.log('[Projection] render skipped: no map yet');
      return;
    }
    if (!m.isStyleLoaded()) {
      console.log('[Projection] render skipped: style not loaded');
      return;
    }
    const lineSrcExists = !!m.getSource('projection-line');
    if (!lineSrcExists) {
      console.log('[Projection] render skipped: projection-line source not added yet');
      return;
    }
    const map = m;
    const first = result.points[0];
    const last = result.points[result.points.length - 1];
    console.log('[Projection] render:', result.points.length, 'points, first:', first ? `${first.lat.toFixed(2)},${first.lon.toFixed(2)}` : '?', 'last:', last ? `${last.lat.toFixed(2)},${last.lon.toFixed(2)}` : '?');

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
          properties: { type: m.type, detail: m.detail },
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
      const { hud, sail, weather, prog, preview } = state;
      const grid = weather.gridData;
      if (!grid) {
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

      const nowMs = Date.now();
      console.log('[Projection] computing...', {
        lat: hud.lat, lon: hud.lon,
        hdg: effectiveHdg,
        twd: hud.twd,
        twaLock: effectiveTwaLock,
        sail: effectiveSail,
        grid_timestamps: grid.timestamps.length,
      });

      const windData = packWindData(grid);

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
        windGrid: {
          bounds: grid.bounds,
          resolution: grid.resolution,
          cols: grid.cols,
          rows: grid.rows,
          timestamps: grid.timestamps,
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
    let prevGrid = useGameStore.getState().weather.gridData;
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
      const gridChanged = s.weather.gridData !== prevGrid;
      const previewHdgChanged = s.preview.hdg !== prevPreviewHdg;
      const previewSailChanged = s.preview.sail !== prevPreviewSail;
      const previewTwaLockedChanged = s.preview.twaLocked !== prevPreviewTwaLocked;
      const previewLockedTwaChanged = s.preview.lockedTwa !== prevPreviewLockedTwa;

      prevHdg = s.hud.hdg;
      prevSail = s.sail.currentSail;
      prevSailAuto = s.sail.sailAuto;
      prevQueue = s.prog.orderQueue;
      prevTick = s.lastTickUnix;
      prevGrid = s.weather.gridData;
      prevPreviewHdg = s.preview.hdg;
      prevPreviewSail = s.preview.sail;
      prevPreviewTwaLocked = s.preview.twaLocked;
      prevPreviewLockedTwa = s.preview.lockedTwa;

      // Compass drag → debounced. Everything else → immediate.
      if (previewHdgChanged || hdgChanged) {
        requestCompute(false);
      } else if (
        sailChanged || autoChanged || queueChanged || tickChanged || gridChanged ||
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
