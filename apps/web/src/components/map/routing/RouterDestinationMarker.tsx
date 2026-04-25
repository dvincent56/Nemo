'use client';
// Renders the 📍 emoji at the router destination's lat/lon. Mounted by
// PlayClient when the router panel is active *and* a destination is set;
// toggling either off nulls out lat/lon, which removes the marker.
//
// Returns null because all output is side-effect.

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';

interface Props {
  lat: number | null;
  lon: number | null;
}

export default function RouterDestinationMarker({ lat, lon }: Props): null {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    if (lat == null || lon == null) return;

    const el = document.createElement('div');
    el.textContent = '📍';
    el.style.fontSize = '32px';
    el.style.lineHeight = '1';
    el.style.userSelect = 'none';
    el.style.pointerEvents = 'none';
    el.style.filter = 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))';

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .addTo(map);

    return () => {
      try {
        marker.remove();
      } catch {
        /* ignore teardown race */
      }
    };
  }, [lat, lon]);

  return null;
}
