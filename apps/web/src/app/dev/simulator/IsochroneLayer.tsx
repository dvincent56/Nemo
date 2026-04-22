'use client';
// Draws the isochrones of a single boat as a translucent point cloud.
//
// Past implementations tried to draw each isochrone as a closed LineString
// sorted by bearing from the start — but sparse, fan-shaped isos produced
// zig-zag polygons with long wrap-around edges. Rendering as dots is
// unambiguous, fast (MapLibre handles 60k+ points), and makes the front
// propagation visually obvious.

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  plan: RoutePlan | null;
  color: string;
}

const SOURCE_ID = 'sim-iso';
const LAYER_ID = 'sim-iso-points';

export function IsochroneLayer({ plan, color }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const install = () => {
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }
      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      if (plan) {
        for (let i = 1; i < plan.isochrones.length; i++) {  // skip step 0 (start point)
          const iso = plan.isochrones[i];
          if (!iso) continue;
          for (const p of iso) {
            features.push({
              type: 'Feature',
              properties: { step: i },
              geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            });
          }
        }
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID, type: 'circle', source: SOURCE_ID,
          paint: {
            'circle-radius': 1.5,
            'circle-color': color,
            'circle-opacity': 0.6,
          },
        });
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
        map.setPaintProperty(LAYER_ID, 'circle-color', color);
      }
    };
    install();
    return () => {
      const m = mapInstance;
      if (!m) return;
      try {
        if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch { /* ignore teardown race */ }
    };
  }, [plan, color]);

  return null;
}
