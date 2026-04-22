'use client';
// Draws a draggable start-point marker on the map and lets the user click
// anywhere on the map to move it. Only active while the simulation is idle —
// once it's running/paused the start is frozen and clicks are ignored.

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { Position } from '@nemo/shared-types';
import type { SimStatus } from '@/hooks/useSimulatorWorker';

interface Props {
  startPos: Position;
  status: SimStatus;
  onChange(pos: Position): void;
}

const SOURCE_ID = 'sim-start-point';
const LAYER_ID = 'sim-start-point-layer';
const RING_ID = 'sim-start-point-ring';

export function StartPointLayer({ startPos, status, onChange }: Props) {
  const clickHandlerRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null);

  // Mount source + layer once
  useEffect(() => {
    let cancelled = false;
    const install = () => {
      if (cancelled) return;
      const map = mapInstance;
      if (!map || !map.isStyleLoaded()) { setTimeout(install, 200); return; }
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [startPos.lon, startPos.lat] }, properties: {} },
        });
        map.addLayer({
          id: RING_ID, type: 'circle', source: SOURCE_ID,
          paint: { 'circle-radius': 18, 'circle-color': '#c9a557', 'circle-opacity': 0.2 },
        });
        map.addLayer({
          id: LAYER_ID, type: 'circle', source: SOURCE_ID,
          paint: {
            'circle-radius': 7,
            'circle-color': '#c9a557',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    };
    install();
    return () => {
      cancelled = true;
      const map = mapInstance;
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getLayer(RING_ID)) map.removeLayer(RING_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* ignore teardown during navigation */ }
    };
  }, []);

  // Keep the source geometry in sync with startPos
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [startPos.lon, startPos.lat] }, properties: {} });
  }, [startPos]);

  // Click-to-move handler, only active while idle
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      map.getCanvas().style.cursor = '';
      clickHandlerRef.current = null;
    }

    if (status !== 'idle') return;

    const handler = (e: maplibregl.MapMouseEvent) => {
      // Shift+click is reserved for the end-point marker (see EndPointLayer).
      if (e.originalEvent.shiftKey) return;
      onChange({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    };
    map.on('click', handler);
    map.getCanvas().style.cursor = 'crosshair';
    clickHandlerRef.current = handler;

    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
      clickHandlerRef.current = null;
    };
  }, [status, onChange]);

  return null;
}
