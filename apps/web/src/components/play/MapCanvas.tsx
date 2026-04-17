'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';
import styles from './MapCanvas.module.css';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Nemo Ocean',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
    },
    'osm-labels': {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0a1628' } },
    { id: 'dark-tiles', type: 'raster', source: 'osm-tiles', paint: { 'raster-opacity': 0.6 } },
    { id: 'labels', type: 'raster', source: 'osm-labels', paint: { 'raster-opacity': 0.5 } },
  ],
};

const BOAT_COLOR = '#c9a227';
const trailCoords: [number, number][] = [];

/** Expose the MapLibre map instance for other components (WindOverlay) */
export let mapInstance: maplibregl.Map | null = null;

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
    mapInstance = map;

    map.once('load', () => {
      map.addSource('my-trail', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: 'my-trail-line',
        type: 'line',
        source: 'my-trail',
        paint: { 'line-color': BOAT_COLOR, 'line-width': 2, 'line-opacity': 0.85 },
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
          'circle-radius': 7,
          'circle-color': BOAT_COLOR,
          'circle-stroke-color': '#1a2840',
          'circle-stroke-width': 2,
        },
      });
    });

    map.on('dragstart', () => {
      useGameStore.getState().setFollowBoat(false);
    });

    const syncMapState = () => {
      const store = useGameStore.getState();
      const center = map.getCenter();
      const zoom = map.getZoom();
      const b = map.getBounds();
      store.setMapView([center.lng, center.lat], zoom);
      store.setMapBounds({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    };
    map.on('move', syncMapState);
    map.once('load', syncMapState);

    return () => {
      map.remove();
      mapRef.current = null;
      mapInstance = null;
    };
  }, []);

  useEffect(() => {
    return useGameStore.subscribe((s) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const { lat, lon } = s.hud;
      if (!lat && !lon) return;

      const boatSrc = map.getSource('my-boat') as maplibregl.GeoJSONSource | undefined;
      boatSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { hdg: s.hud.hdg },
        }],
      });

      trailCoords.push([lon, lat]);
      if (trailCoords.length > 1) {
        const trailSrc = map.getSource('my-trail') as maplibregl.GeoJSONSource | undefined;
        trailSrc?.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [...trailCoords] },
          properties: {},
        });
      }

      if (s.map.isFollowingBoat) {
        map.easeTo({ center: [lon, lat], duration: 500 });
      }
    });
  }, []);

  return <div ref={containerRef} className={styles.container} />;
}
