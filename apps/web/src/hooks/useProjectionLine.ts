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
  const polarRef = useRef<{ twa: number[]; tws: number[]; speeds: number[][] } | null>(null);

  // Update MapLibre sources with projection result
  const updateMapSources = useCallback((result: ProjectionResult) => {
    if (!map || !map.isStyleLoaded()) return;

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
  }, [map]);

  // Initialize Worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/projection.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (e.data.type === 'result') {
        updateMapSources(e.data.result);
      }
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
      .then((polar) => { polarRef.current = polar; })
      .catch(() => {});
  }, []);

  // Trigger recalculation
  const requestCompute = useCallback((immediate = false) => {
    if (!workerRef.current) return;

    const doCompute = () => {
      const state = useGameStore.getState();
      const { hud, sail, weather, prog } = state;
      const grid = weather.gridData;
      if (!grid || (!hud.lat && !hud.lon)) return;
      if (!polarRef.current) return;

      const windData = packWindData(grid);

      const input: ProjectionInput = {
        lat: hud.lat,
        lon: hud.lon,
        hdg: hud.hdg,
        nowMs: Date.now(),
        boatClass: hud.boatClass,
        activeSail: sail.currentSail,
        sailAuto: sail.sailAuto,
        twaLock: null,
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

    const unsub = useGameStore.subscribe((s) => {
      const hdgChanged = s.hud.hdg !== prevHdg;
      const sailChanged = s.sail.currentSail !== prevSail;
      const autoChanged = s.sail.sailAuto !== prevSailAuto;
      const queueChanged = s.prog.orderQueue !== prevQueue;
      const tickChanged = s.lastTickUnix !== prevTick;
      const gridChanged = s.weather.gridData !== prevGrid;

      prevHdg = s.hud.hdg;
      prevSail = s.sail.currentSail;
      prevSailAuto = s.sail.sailAuto;
      prevQueue = s.prog.orderQueue;
      prevTick = s.lastTickUnix;
      prevGrid = s.weather.gridData;

      if (hdgChanged) {
        requestCompute(false); // debounced
      } else if (sailChanged || autoChanged || queueChanged || tickChanged || gridChanged) {
        requestCompute(true); // immediate
      }
    });

    // Initial computation
    requestCompute(true);

    return unsub;
  }, [requestCompute]);
}
