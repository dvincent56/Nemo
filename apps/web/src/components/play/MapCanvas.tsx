'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';
import styles from './MapCanvas.module.css';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Nemo Dark Ocean',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'ocean-background',
      type: 'background',
      paint: { 'background-color': '#060b18' },
    },
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm-tiles',
      paint: {
        'raster-opacity': 0.25,
        'raster-saturation': -0.8,
        'raster-brightness-max': 0.3,
      },
    },
  ],
};

const BOAT_COLOR = '#c9a227';
const trailCoords: [number, number][] = [];

export default function MapCanvas(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [-3.0, 47.0],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.once('load', () => {
      // Trail source + layer
      map.addSource('my-trail', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: 'my-trail-line',
        type: 'line',
        source: 'my-trail',
        paint: {
          'line-color': BOAT_COLOR,
          'line-width': 2,
          'line-opacity': 0.85,
        },
      });

      // My boat source + layer
      map.addSource('my-boat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'my-boat-point',
        type: 'circle',
        source: 'my-boat',
        paint: {
          'circle-radius': 7,
          'circle-color': BOAT_COLOR,
          'circle-stroke-color': '#1a2840',
          'circle-stroke-width': 2,
        },
      });
    });

    // Disable follow on user pan
    map.on('dragstart', () => {
      useGameStore.getState().setFollowBoat(false);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Subscribe to store updates
  useEffect(() => {
    return useGameStore.subscribe((s) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const { lat, lon } = s.hud;
      if (!lat && !lon) return;

      // Update boat position
      const boatSrc = map.getSource('my-boat') as maplibregl.GeoJSONSource | undefined;
      boatSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { hdg: s.hud.hdg },
        }],
      });

      // Update trail
      trailCoords.push([lon, lat]);
      if (trailCoords.length > 1) {
        const trailSrc = map.getSource('my-trail') as maplibregl.GeoJSONSource | undefined;
        trailSrc?.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [...trailCoords] },
          properties: {},
        });
      }

      // Follow boat
      if (s.map.isFollowingBoat) {
        map.easeTo({ center: [lon, lat], duration: 500 });
      }
    });
  }, []);

  return <div ref={containerRef} className={styles.container} />;
}
