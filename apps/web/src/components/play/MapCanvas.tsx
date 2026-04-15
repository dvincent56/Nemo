'use client';

import { useEffect, useRef } from 'react';
import maplibregl, { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';

/**
 * MapLibre canvas plein écran — Phase 3.
 * - Style nautique minimal (vecteur OSM public dans les tiles démos).
 * - Plein écran : la carte occupe toujours 100% de l'écran de jeu (§2.1).
 * - Trajectoire courante mise à jour via un layer `line` + data dynamique.
 * - windgl-js (vent animé) sera branché en Phase 4 quand une texture vent
 *   réelle sera disponible — pour l'instant on charge en dynamic import
 *   seulement si process.env.NEXT_PUBLIC_WINDGL_URL est défini.
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export default function MapCanvas(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [-3.0, 47.0],
      zoom: 5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.once('load', () => {
      map.addSource('my-trail', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'my-trail-line',
        type: 'line',
        source: 'my-trail',
        paint: {
          'line-color': '#00d4ff',
          'line-width': 2,
          'line-opacity': 0.85,
        },
      });
      map.addSource('my-boat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'my-boat-point',
        type: 'circle',
        source: 'my-boat',
        paint: {
          'circle-radius': 6,
          'circle-color': '#00d4ff',
          'circle-stroke-color': '#060a0f',
          'circle-stroke-width': 2,
        },
      });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Follow the boat position from the store.
  useEffect(() => {
    return useGameStore.subscribe((s) => {
      const map = mapRef.current;
      if (!map || !s.hud.lat || !s.hud.lon) return;
      const src = map.getSource('my-boat') as maplibregl.GeoJSONSource | undefined;
      src?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.hud.lon, s.hud.lat] },
          properties: {},
        }],
      });
    });
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-map)' as React.CSSProperties['zIndex'] }}
    />
  );
}
