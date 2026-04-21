'use client';
// apps/web/src/app/dev/simulator/ProjectionLayer.tsx
// Renders the frozen projection polyline (gold dashed) on the MapLibre map.
// Mounts/unmounts the source+layer as a side effect; returns null (no DOM).

import { useEffect } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { ProjectionResult } from '@/lib/projection/types';

interface Props {
  projection: ProjectionResult | null;
}

const LAYER_ID = 'sim-projection';

export function ProjectionLayer({ projection }: Props) {
  // Update the GeoJSON source whenever the projection changes.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    function apply() {
      if (!map) return;
      if (!map.isStyleLoaded()) {
        setTimeout(apply, 200);
        return;
      }
      const coords = projection?.points.map((p) => [p.lon, p.lat]) ?? [];
      const geoJson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      if (!map.getSource(LAYER_ID)) {
        map.addSource(LAYER_ID, { type: 'geojson', data: geoJson });
        map.addLayer({
          id: LAYER_ID,
          type: 'line',
          source: LAYER_ID,
          paint: {
            'line-color': '#c9a557',
            'line-width': 2,
            'line-opacity': 0.75,
            'line-dasharray': [2, 2],
          },
        });
      } else {
        (map.getSource(LAYER_ID) as GeoJSONSource).setData(geoJson);
      }
    }

    apply();
  }, [projection]);

  // Clean up source and layer on unmount.
  useEffect(
    () => () => {
      const map = mapInstance;
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(LAYER_ID)) map.removeSource(LAYER_ID);
      } catch {
        // Map may already be destroyed — silently ignore.
      }
    },
    [],
  );

  return null;
}
