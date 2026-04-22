'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  routes: Map<string, RoutePlan>;      // boatId -> plan
  colorFor: (boatId: string) => string;
}

export function RouteLayer({ routes, colorFor }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map || !map.isStyleLoaded()) return;

    const seen = new Set<string>();
    for (const [id, plan] of routes) {
      seen.add(id);
      const sourceId = `sim-route-${id}`;
      const layerId  = `sim-route-line-${id}`;
      const color = colorFor(id);
      const feat: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: plan.polyline.map((p) => [p.lon, p.lat]) },
      };
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: feat });
        map.addLayer({
          id: layerId, type: 'line', source: sourceId,
          paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [2, 2] },
        });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(feat);
      }
    }

    // Remove routes that disappeared
    const layers = map.getStyle().layers ?? [];
    for (const layer of layers) {
      if (!layer.id.startsWith('sim-route-line-')) continue;
      const id = layer.id.replace('sim-route-line-', '');
      if (seen.has(id)) continue;
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      const srcId = `sim-route-${id}`;
      if (map.getSource(srcId)) map.removeSource(srcId);
    }
  }, [routes, colorFor]);

  return null;
}
