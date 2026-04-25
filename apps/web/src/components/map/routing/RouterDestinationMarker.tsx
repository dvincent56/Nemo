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

    let cancelled = false;

    const install = () => {
      if (cancelled) return;
      // Same retry pattern as IsochroneLayer: a single styledata listener
      // misses the case where the style loaded before this effect ran AND
      // isStyleLoaded() momentarily reports false (e.g. during a tile fetch).
      // Polling 200ms until ready is robust and bounded by the consumer
      // unmounting (cancelled flag).
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }
      if (lat == null || lon == null) {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        return;
      }
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {},
        }],
      };
      const src = map.getSource(SOURCE_ID);
      if (src && 'setData' in src) {
        (src as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(data);
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
      // Ensure the marker draws on top of any layers added after it
      // (route/iso lines, projection line, zone overlays).
      if (map.getLayer(LAYER_ID)) {
        try { map.moveLayer(LAYER_ID); } catch { /* ignore */ }
      }
    };

    install();

    return () => {
      cancelled = true;
      const m = mapInstance;
      if (!m) return;
      try {
        if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch { /* ignore teardown race */ }
    };
  }, [lat, lon]);

  return null;
}
