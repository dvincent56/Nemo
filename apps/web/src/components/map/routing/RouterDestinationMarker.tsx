'use client';
// Renders a gold pin marker at the router destination's lat/lon. Mounted by
// PlayClient when the router panel is active *and* a destination is set;
// toggling either off nulls out lat/lon, which removes the marker.
//
// Uses a maplibregl.Marker with a custom HTML element (SVG pin) anchored at
// the bottom tip. We previously used a circle source/layer (#dc4646) but
// that looked identical to the "collision avec la côte" projection marker —
// the pin shape is unambiguously the router destination.
//
// Returns null because all output is side-effect.

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';

interface Props {
  lat: number | null;
  lon: number | null;
}

const PIN_SVG = `
<svg viewBox="0 0 24 32" width="32" height="40" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
  <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20c0-6.627-5.373-12-12-12z" fill="#c9a227" stroke="#ffffff" stroke-width="2"/>
  <circle cx="12" cy="12" r="4" fill="#ffffff"/>
</svg>
`.trim();

export default function RouterDestinationMarker({ lat, lon }: Props): null {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    if (lat == null || lon == null) return;

    const el = document.createElement('div');
    el.innerHTML = PIN_SVG;
    el.style.cursor = 'pointer';
    el.style.pointerEvents = 'none';

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
