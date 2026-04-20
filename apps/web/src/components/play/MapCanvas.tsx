'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';
import {
  findOceanPreset,
  findLandPreset,
  DEFAULT_OCEAN_ID,
  DEFAULT_LAND_ID,
} from '@/lib/mapAppearance';
import styles from './MapCanvas.module.css';
import { useProjectionLine } from '@/hooks/useProjectionLine';

/* ── Country labels (French) rendered as lightweight GeoJSON symbols ── */
const COUNTRY_LABELS: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 46.8] }, properties: { name: 'France' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.7, 40.4] }, properties: { name: 'Espagne' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-8.0, 39.6] }, properties: { name: 'Portugal' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [12.5, 42.5] }, properties: { name: 'Italie' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-2.0, 54.0] }, properties: { name: 'Royaume-Uni' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [9.5, 51.0] }, properties: { name: 'Allemagne' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-8.5, 53.5] }, properties: { name: 'Irlande' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [4.5, 50.8] }, properties: { name: 'Belgique' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [5.7, 52.3] }, properties: { name: 'Pays-Bas' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [25.0, 35.5] }, properties: { name: 'Grèce' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [15.0, 65.0] }, properties: { name: 'Norvège' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [25.0, 62.0] }, properties: { name: 'Finlande' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [15.5, 63.0] }, properties: { name: 'Suède' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [10.0, 56.0] }, properties: { name: 'Danemark' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [20.0, 52.0] }, properties: { name: 'Pologne' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [9.0, 34.0] }, properties: { name: 'Tunisie' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [3.0, 28.0] }, properties: { name: 'Algérie' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-6.0, 32.0] }, properties: { name: 'Maroc' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-15.0, 14.0] }, properties: { name: 'Sénégal' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-55.0, -10.0] }, properties: { name: 'Brésil' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-100.0, 40.0] }, properties: { name: 'États-Unis' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-100.0, 60.0] }, properties: { name: 'Canada' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-18.0, 65.0] }, properties: { name: 'Islande' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [35.0, 39.0] }, properties: { name: 'Turquie' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [24.0, 9.0] }, properties: { name: 'Afrique' } },
  ],
};

function buildStyle(oceanColor: string, landTileUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'Nemo Ocean',
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [landTileUrl],
        tileSize: 256,
      },
      'country-labels': {
        type: 'geojson',
        data: COUNTRY_LABELS,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': oceanColor } },
      { id: 'dark-tiles', type: 'raster', source: 'osm-tiles', paint: { 'raster-opacity': 0.6 } },
      {
        id: 'country-names',
        type: 'symbol',
        source: 'country-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-letter-spacing': 0.15,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': 'rgba(180, 190, 210, 0.55)',
          'text-halo-color': 'rgba(10, 22, 40, 0.6)',
          'text-halo-width': 1,
        },
      },
    ],
  };
}


const BOAT_COLOR = '#c9a227';
const trailCoords: [number, number][] = [];

/** Expose the MapLibre map instance for other components (WindOverlay) */
export let mapInstance: maplibregl.Map | null = null;

/** Flag to avoid zoom feedback loop (map move → store → map zoom) */
let _syncingFromMap = false;

interface MapCanvasProps {
  /** Show the 7-day projection line for the player's own boat.
   *  Set to false in spectator mode (no own boat). */
  enableProjection?: boolean;
}

export default function MapCanvas({ enableProjection = true }: MapCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [readyMap, setReadyMap] = useState<maplibregl.Map | null>(null);
  useProjectionLine(enableProjection ? readyMap : null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initAppearance = useGameStore.getState().mapAppearance;
    const initOcean = findOceanPreset(initAppearance.oceanPresetId)?.color
      ?? findOceanPreset(DEFAULT_OCEAN_ID)!.color;
    const initLand = findLandPreset(initAppearance.landPresetId)?.tileUrl
      ?? findLandPreset(DEFAULT_LAND_ID)!.tileUrl;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(initOcean, initLand),
      center: [-3.0, 47.0],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    mapInstance = map;

    map.once('load', () => {
      // ── Exclusion zones (filled polygons + borders) ──
      const initZones = useGameStore.getState().zones;
      const initZonesVisible = useGameStore.getState().layers.zones;
      const initZonesFC: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: initZones.map((z) => ({
          type: 'Feature',
          geometry: z.geometry,
          properties: {
            id: z.id,
            name: z.name,
            category: z.category ?? '',
            reason: z.reason,
            speedMultiplier: z.speedMultiplier ?? 1,
            color: z.color,
          },
        })),
      };
      map.addSource('exclusion-zones', { type: 'geojson', data: initZonesFC });
      map.addLayer({
        id: 'exclusion-zones-fill',
        type: 'fill',
        source: 'exclusion-zones',
        layout: { visibility: initZonesVisible ? 'visible' : 'none' },
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.15,
        },
      });
      map.addLayer({
        id: 'exclusion-zones-outline',
        type: 'line',
        source: 'exclusion-zones',
        layout: { visibility: initZonesVisible ? 'visible' : 'none' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.7,
          'line-dasharray': [3, 2],
        },
      });

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

      // ── Projection line ──
      map.addSource('projection-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-line-layer',
        type: 'line',
        source: 'projection-line',
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'bspRatio'],
            0.0, '#c0392b',
            0.2, '#c0392b',
            0.35, '#e67e22',
            0.5, '#f1c40f',
            0.75, '#27ae60',
            1.0, '#27ae60',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 3, 12, 4],
          'line-opacity': 0.85,
        },
      });

      // ── Projection time markers ──
      map.addSource('projection-markers-time', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-markers-time-circle',
        type: 'circle',
        source: 'projection-markers-time',
        paint: {
          // Major markers (with a label) are bigger; minor (unlabelled) dots
          // give density between major checkpoints so curves are readable.
          'circle-radius': [
            'case', ['==', ['get', 'label'], ''], 2, 4,
          ],
          'circle-color': '#f5f0e8',
          'circle-stroke-color': '#1a2744',
          'circle-stroke-width': [
            'case', ['==', ['get', 'label'], ''], 0.5, 1.5,
          ],
          'circle-opacity': [
            'case', ['==', ['get', 'label'], ''], 0.6, 1,
          ],
        },
      });
      map.addLayer({
        id: 'projection-markers-time-label',
        type: 'symbol',
        source: 'projection-markers-time',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, -1.2],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#f5f0e8',
          'text-halo-color': 'rgba(10, 22, 40, 0.8)',
          'text-halo-width': 1,
        },
      });

      // ── Projection maneuver markers ──
      map.addSource('projection-markers-maneuver', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-markers-maneuver-icon',
        type: 'circle',
        source: 'projection-markers-maneuver',
        paint: {
          'circle-radius': [
            'case', ['==', ['get', 'type'], 'grounding'], 7, 5,
          ],
          'circle-color': [
            'case', ['==', ['get', 'type'], 'grounding'], '#c0392b', '#c9a84c',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });

      // ── Maneuver marker tooltip ──
      const maneuverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        offset: 10,
        className: 'projection-maneuver-popup',
      });

      const MANEUVER_LABEL: Record<string, string> = {
        tack: 'Virement',
        gybe: 'Empannage',
        sail_change: 'Changement de voile',
        cap_change: 'Changement de cap',
        twa_change: 'Verrouillage TWA',
        grounding: 'Échouage',
        zone_entry: 'Entrée en zone',
      };

      const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });

      const maneuverHtml = (type: string, detail: string, timestamp: number | undefined): string => {
        const label = MANEUVER_LABEL[type] ?? type;
        const accent = type === 'grounding' ? '#c0392b' : '#c9a84c';
        const when = timestamp ? DATE_FMT.format(new Date(timestamp)) : '';
        const whenLine = when ? `<div style="color:#aab2c0;font-size:11px;margin-top:2px;">${when}</div>` : '';
        return `<div style="font-size:12px;color:#f5f0e8;"><strong style="color:${accent};">${label}</strong><br/>${detail}${whenLine}</div>`;
      };

      map.on('mouseenter', 'projection-markers-maneuver-icon', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const coords = feature.geometry.coordinates as [number, number];
        const detail = feature.properties?.detail ?? '';
        const type = feature.properties?.type ?? '';
        const timestamp = feature.properties?.timestamp as number | undefined;
        maneuverPopup
          .setLngLat(coords)
          .setHTML(maneuverHtml(type, detail, timestamp))
          .addTo(map);
      });

      map.on('mouseleave', 'projection-markers-maneuver-icon', () => {
        map.getCanvas().style.cursor = '';
        maneuverPopup.remove();
      });

      map.on('click', 'projection-markers-maneuver-icon', (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const coords = feature.geometry.coordinates as [number, number];
        const detail = feature.properties?.detail ?? '';
        const type = feature.properties?.type ?? '';
        const timestamp = feature.properties?.timestamp as number | undefined;

        if (maneuverPopup.isOpen()) {
          maneuverPopup.remove();
        } else {
          maneuverPopup
            .setLngLat(coords)
            .setHTML(maneuverHtml(type, detail, timestamp))
            .addTo(map);
        }
      });

      // ── Exclusion zone tooltip ──
      const ZONE_CATEGORY_LABEL: Record<string, string> = {
        DST: 'Dispositif de Séparation du Trafic',
        ZEA: 'Zone d\'Exclusion Arctique/Antarctique',
        ZPC: 'Zone de Protection des Cétacés',
        ZES: 'Zone Interdite Spéciale',
      };

      const zonePopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        offset: 10,
        className: 'projection-maneuver-popup',
      });

      const zoneHtml = (props: Record<string, unknown>): string => {
        const category = String(props['category'] ?? '');
        const name = String(props['name'] ?? '');
        const reason = String(props['reason'] ?? '');
        const mult = Number(props['speedMultiplier'] ?? 1);
        const color = String(props['color'] ?? '#c9a84c');
        const penaltyPct = Math.round((1 - mult) * 100);
        const catLabel = ZONE_CATEGORY_LABEL[category] ?? category;
        return `<div style="font-size:12px;color:#f5f0e8;max-width:260px;">
          <strong style="color:${color};">${name}</strong>
          <div style="color:#aab2c0;font-size:11px;margin-top:2px;">${catLabel}</div>
          <div style="margin-top:6px;line-height:1.4;">${reason}</div>
          <div style="margin-top:6px;color:${color};"><strong>Pénalité : −${penaltyPct} % de vitesse</strong></div>
        </div>`;
      };

      map.on('mouseenter', 'exclusion-zones-fill', (e) => {
        map.getCanvas().style.cursor = 'help';
        const f = e.features?.[0];
        if (!f) return;
        zonePopup.setLngLat(e.lngLat).setHTML(zoneHtml(f.properties ?? {})).addTo(map);
      });
      map.on('mousemove', 'exclusion-zones-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        zonePopup.setLngLat(e.lngLat).setHTML(zoneHtml(f.properties ?? {}));
      });
      map.on('mouseleave', 'exclusion-zones-fill', () => {
        map.getCanvas().style.cursor = '';
        zonePopup.remove();
      });
      map.on('click', 'exclusion-zones-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (zonePopup.isOpen()) zonePopup.remove();
        else zonePopup.setLngLat(e.lngLat).setHTML(zoneHtml(f.properties ?? {})).addTo(map);
      });

      // Seed boat source with current store position immediately
      const initHud = useGameStore.getState().hud;
      const hasPos = !!(initHud.lat || initHud.lon);
      map.addSource('my-boat', {
        type: 'geojson',
        data: hasPos
          ? {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [initHud.lon, initHud.lat] },
                properties: { hdg: initHud.hdg },
              }],
            }
          : { type: 'FeatureCollection', features: [] },
      });
      if (hasPos) {
        map.easeTo({ center: [initHud.lon, initHud.lat], duration: 0 });
      }

      // Load IMOCA silhouette as map icon
      const boatImg = new Image(60, 18);
      boatImg.onload = () => {
        if (!map.hasImage('imoca')) {
          map.addImage('imoca', boatImg, { sdf: false });
        }
        map.addLayer({
          id: 'my-boat-icon',
          type: 'symbol',
          source: 'my-boat',
          layout: {
            'icon-image': 'imoca',
            'icon-size': 0.6,
            'icon-rotate': ['-', ['get', 'hdg'], 90],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
          },
        });
      };
      // Render SVG to canvas for MapLibre (it needs raster images)
      const svgBlob = new Blob([
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 611 188" width="60" height="18">
          <path fill="${BOAT_COLOR}"
            d="M89.62 0.00 L84.78 0.93 L68.78 0.94 L32.11 3.00 L18.73 3.26 L0.00 80.71 L0.00 103.30 L2.80 111.69 L14.24 153.84 L17.40 166.90 L18.32 175.45 L25.85 176.86 L51.53 178.03 L60.95 178.02 L73.13 179.02 L97.07 179.19 L98.62 179.34 L99.65 180.00 L210.37 180.00 L215.52 179.04 L233.38 179.06 L243.05 178.12 L264.43 177.00 L271.73 177.04 L283.24 175.39 L299.16 174.28 L302.12 174.51 L336.55 171.65 L382.22 166.14 L417.19 160.27 L444.90 154.36 L472.32 147.28 L499.36 138.92 L525.97 129.17 L553.80 117.15 L588.07 99.45 L603.00 89.93 L603.00 92.93 L603.00 89.26 L600.20 87.99 L577.71 74.58 L549.21 60.42 L520.01 48.24 L494.37 39.23 L468.48 31.48 L442.36 24.91 L407.19 17.75 L371.69 12.20 L326.93 7.11 L272.77 3.02 L236.84 0.99 L223.36 0.89 L219.33 0.00 L89.62 0.00 Z"/>
        </svg>`
      ], { type: 'image/svg+xml' });
      boatImg.src = URL.createObjectURL(svgBlob);

      // Signal that map + all sources/layers are ready — triggers useProjectionLine
      setReadyMap(map);
    });

    map.on('dragstart', () => {
      useGameStore.getState().setFollowBoat(false);
    });

    const syncMapState = () => {
      _syncingFromMap = true;
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
      _syncingFromMap = false;
    };
    map.on('moveend', syncMapState);
    map.once('load', syncMapState);

    return () => {
      map.remove();
      mapRef.current = null;
      mapInstance = null;
    };
  }, []);

  /* React to programmatic zoom/center changes from the store (e.g. zoom buttons) */
  useEffect(() => {
    let prevZoom = useGameStore.getState().map.zoom;
    return useGameStore.subscribe((s) => {
      const map = mapRef.current;
      if (!map || _syncingFromMap) return;
      const storeZoom = s.map.zoom;
      if (storeZoom !== prevZoom) {
        prevZoom = storeZoom;
        map.easeTo({ zoom: storeZoom, duration: 200 });
      }
    });
  }, []);

  useEffect(() => {
    const syncBoat = (s: ReturnType<typeof useGameStore.getState>) => {
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
    };

    // Apply current state immediately + subscribe for future changes
    const unsub = useGameStore.subscribe(syncBoat);
    syncBoat(useGameStore.getState());
    return unsub;
  }, []);

  /* ── Apparence : couleur d'océan ── */
  useEffect(() => {
    const apply = (oceanPresetId: string): void => {
      const map = mapRef.current;
      if (!map || !map.getLayer('background')) return;
      const preset = findOceanPreset(oceanPresetId);
      if (!preset) return;
      map.setPaintProperty('background', 'background-color', preset.color);
    };
    apply(useGameStore.getState().mapAppearance.oceanPresetId);
    let prev = useGameStore.getState().mapAppearance.oceanPresetId;
    return useGameStore.subscribe((s) => {
      if (s.mapAppearance.oceanPresetId !== prev) {
        prev = s.mapAppearance.oceanPresetId;
        apply(prev);
      }
    });
  }, []);

  /* ── Apparence : style de terre (swap source raster) ── */
  useEffect(() => {
    const apply = (landPresetId: string): void => {
      const map = mapRef.current;
      if (!map || !map.getSource('osm-tiles')) return;
      const preset = findLandPreset(landPresetId);
      if (!preset) return;
      map.removeLayer('dark-tiles');
      map.removeSource('osm-tiles');
      map.addSource('osm-tiles', {
        type: 'raster',
        tiles: [preset.tileUrl],
        tileSize: 256,
      });
      map.addLayer(
        {
          id: 'dark-tiles',
          type: 'raster',
          source: 'osm-tiles',
          paint: { 'raster-opacity': 0.6 },
        },
        'country-names',
      );
    };
    let prev = useGameStore.getState().mapAppearance.landPresetId;
    return useGameStore.subscribe((s) => {
      if (s.mapAppearance.landPresetId !== prev) {
        prev = s.mapAppearance.landPresetId;
        apply(prev);
      }
    });
  }, []);

  /* ── Exclusion zones: sync source when store.zones changes ── */
  useEffect(() => {
    type StoreZones = ReturnType<typeof useGameStore.getState>['zones'];
    const applyZones = (zones: StoreZones): void => {
      const map = mapRef.current;
      if (!map) return;
      const src = map.getSource('exclusion-zones') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features: GeoJSON.Feature[] = zones.map((z) => ({
        type: 'Feature',
        geometry: z.geometry,
        properties: {
          id: z.id,
          name: z.name,
          category: z.category ?? '',
          reason: z.reason,
          speedMultiplier: z.speedMultiplier ?? 1,
          color: z.color,
        },
      }));
      src.setData({ type: 'FeatureCollection', features });
    };
    applyZones(useGameStore.getState().zones);
    let prev = useGameStore.getState().zones;
    return useGameStore.subscribe((s) => {
      if (s.zones !== prev) {
        prev = s.zones;
        applyZones(s.zones);
      }
    });
  }, []);

  /* ── Exclusion zones visibility toggle ── */
  const zonesVisible = useGameStore((s) => s.layers.zones);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = zonesVisible ? 'visible' : 'none';
    if (map.getLayer('exclusion-zones-fill')) {
      map.setLayoutProperty('exclusion-zones-fill', 'visibility', vis);
    }
    if (map.getLayer('exclusion-zones-outline')) {
      map.setLayoutProperty('exclusion-zones-outline', 'visibility', vis);
    }
  }, [zonesVisible]);

  /* ── Coastline layer: lazy-load GeoJSON on first toggle, then show/hide ── */
  const coastlineVisible = useGameStore((s) => s.layers.coastline);
  const coastFetchedRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Already added → just toggle visibility
    if (map.getLayer('coastline-line')) {
      map.setLayoutProperty('coastline-line', 'visibility', coastlineVisible ? 'visible' : 'none');
      return;
    }

    // Need to fetch + add (once)
    if (!coastlineVisible || coastFetchedRef.current) return;
    coastFetchedRef.current = true;

    fetch('/data/coastline.geojson')
      .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then((geojson: GeoJSON.FeatureCollection) => {
        if (map.getSource('coastline')) return;
        map.addSource('coastline', { type: 'geojson', data: geojson });
        const beforeId = map.getLayer('country-names') ? 'country-names' : undefined;
        map.addLayer({
          id: 'coastline-line',
          type: 'line',
          source: 'coastline',
          layout: { visibility: 'visible' },
          paint: {
            'line-color': 'rgba(180, 200, 220, 0.45)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.4],
          },
        }, beforeId);
      })
      .catch(() => { coastFetchedRef.current = false; });
  }, [coastlineVisible]);

  return <div ref={containerRef} className={styles.container} />;
}
