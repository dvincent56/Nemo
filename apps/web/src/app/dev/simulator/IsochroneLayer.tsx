'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  plan: RoutePlan | null;
  color: string;
}

const SOURCE_ID = 'sim-iso';
const LAYER_ID = 'sim-iso-line';

export function IsochroneLayer({ plan, color }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const install = () => {
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (plan) {
        for (let i = 1; i < plan.isochrones.length; i++) {  // skip step 0 (single point)
          const iso = plan.isochrones[i];
          if (!iso || iso.length < 3) continue;
          const start = plan.polyline[0]!;
          const sorted = [...iso].sort((a, b) => {
            const bearingA = Math.atan2(a.lon - start.lon, a.lat - start.lat);
            const bearingB = Math.atan2(b.lon - start.lon, b.lat - start.lat);
            return bearingA - bearingB;
          });
          const coords: [number, number][] = sorted.map((p) => [p.lon, p.lat]);
          coords.push(coords[0]!);  // close the loop
          features.push({
            type: 'Feature', properties: { step: i },
            geometry: { type: 'LineString', coordinates: coords },
          });
        }
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.25 },
        });
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
        map.setPaintProperty(LAYER_ID, 'line-color', color);
      }
    };
    install();
  }, [plan, color]);

  return null;
}
