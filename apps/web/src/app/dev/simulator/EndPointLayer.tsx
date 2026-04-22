'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { Position } from '@nemo/shared-types';
import type { SimStatus } from '@/hooks/useSimulatorWorker';

interface Props {
  endPos: Position | null;
  status: SimStatus;
  onChange(pos: Position): void;
}

const SOURCE_ID = 'sim-end-point';
const LAYER_ID = 'sim-end-point-layer';
const RING_ID = 'sim-end-point-ring';

export function EndPointLayer({ endPos, status, onChange }: Props) {
  const clickHandlerRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const install = () => {
      if (cancelled) return;
      const map = mapInstance;
      if (!map || !map.isStyleLoaded()) { setTimeout(install, 200); return; }
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: RING_ID, type: 'circle', source: SOURCE_ID,
          paint: { 'circle-radius': 18, 'circle-color': '#d97070', 'circle-opacity': 0.2 },
        });
        map.addLayer({
          id: LAYER_ID, type: 'circle', source: SOURCE_ID,
          paint: {
            'circle-radius': 7, 'circle-color': '#d97070',
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
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
      } catch { /* teardown race */ }
    };
  }, []);

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: endPos ? [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [endPos.lon, endPos.lat] },
        properties: {},
      }] : [],
    });
  }, [endPos]);

  // Shift+click places the end-point — plain click is used by StartPointLayer.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      clickHandlerRef.current = null;
    }
    if (status !== 'idle') return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      if (!e.originalEvent.shiftKey) return;
      onChange({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    };
    map.on('click', handler);
    clickHandlerRef.current = handler;
    return () => {
      map.off('click', handler);
      clickHandlerRef.current = null;
    };
  }, [status, onChange]);

  return null;
}
