'use client';
// Draws each boat's routed polyline in the boat's own color as a dashed
// line. Primary boat gets a slightly thicker line so it stands out at
// a glance. Colors and widths are re-applied on every render — otherwise
// the layer keeps whatever color was set when it was first added, so
// changing the primary boat mid-session wouldn't update the route look.

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  routes: Map<string, RoutePlan>;
  primaryId: string | null;
  colorFor: (boatId: string) => string;
}

export function RouteLayer({ routes, primaryId, colorFor }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map || !map.isStyleLoaded()) return;

    const seen = new Set<string>();
    for (const [id, plan] of routes) {
      seen.add(id);
      const sourceId = `sim-route-${id}`;
      const layerId = `sim-route-line-${id}`;
      const color = colorFor(id);
      const width = id === primaryId ? 3.5 : 2;
      const feat: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature', properties: {},
        geometry: {
          type: 'LineString',
          coordinates: plan.polyline.map((p) => [p.lon, p.lat]),
        },
      };
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: feat });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': 0.9,
            'line-dasharray': [2, 2],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(feat);
        // Re-apply color + width so primary toggle updates the look.
        map.setPaintProperty(layerId, 'line-color', color);
        map.setPaintProperty(layerId, 'line-width', width);
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
  }, [routes, primaryId, colorFor]);

  return null;
}
