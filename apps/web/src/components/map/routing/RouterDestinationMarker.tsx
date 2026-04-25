'use client';
// Renders a small red circle at the router destination's lat/lon. The
// component is mounted by PlayClient when the router panel is active *and*
// a destination is set; toggling either off nulls out lat/lon, which removes
// the marker. Returns null because all output is side-effect: it adds a
// MapLibre source + layer directly via the shared `mapInstance`.
//
// We follow the same `mapInstance` import pattern as RouteLayer and
// IsochroneLayer in this directory.

import { useEffect } from 'react';
import { mapInstance } from '@/components/play/MapCanvas';

const SOURCE_ID = 'router-destination';
const LAYER_ID = 'router-destination-circle';

interface Props {
  lat: number | null;
  lon: number | null;
}

export default function RouterDestinationMarker({ lat, lon }: Props): null {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    const ensure = () => {
      if (lat == null || lon == null) {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        return;
      }
      const data = {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lon, lat] },
          properties: {},
        }],
      };
      const src = map.getSource(SOURCE_ID);
      if (src && 'setData' in src) {
        (src as { setData: (d: typeof data) => void }).setData(data);
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID,
          source: SOURCE_ID,
          type: 'circle',
          paint: {
            'circle-radius': 8,
            'circle-color': '#dc4646',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    };

    if (map.isStyleLoaded()) ensure();
    else map.once('styledata', ensure);

    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [lat, lon]);

  return null;
}
