'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';
import {
  findOceanPreset,
  DEFAULT_OCEAN_ID,
} from '@/lib/mapAppearance';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';
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

function buildStyle(oceanColor: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'Nemo Ocean',
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png'],
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

const PROJECTION_LAYER_IDS = [
  'projection-line-layer',
  'projection-markers-time-circle',
  'projection-markers-time-label',
  'projection-markers-maneuver-icon',
] as const;
const PROJECTION_SOURCE_IDS = [
  'projection-line',
  'projection-markers-time',
  'projection-markers-maneuver',
] as const;

/**
 * Idempotent (un)installer for the projection-* sources + layers. Removes
 * any pre-existing instance of each id (layers before sources, since layers
 * hold references to sources) before re-adding. Safe to call repeatedly on
 * the same map: the result is always exactly one projection-* set.
 *
 * The earlier "bail if already installed" guard didn't survive in practice —
 * something we couldn't reliably reproduce was leaving stale layers behind
 * (StrictMode double-mount, style hot-swap, sibling code re-adding via a
 * cached `mapInstance` reference). Sweeping unconditionally is the only
 * defensible fix; it costs ~6 getLayer calls + 0 add calls when a clean
 * install just happened, and a full sweep + re-add when something was
 * stale — both cheap.
 */
function installProjectionLayers(map: maplibregl.Map): void {
  // Detect-and-log duplicates so we can confirm the fix in dev console. If
  // a layer/source already exists, we know SOMETHING re-entered the install
  // path — the sweep below will neutralise it but the log makes it visible.
  for (const id of PROJECTION_LAYER_IDS) {
    if (map.getLayer(id)) {
      console.warn('[MapCanvas] projection layer already exists, sweeping:', id);
    }
  }
  for (const id of PROJECTION_SOURCE_IDS) {
    if (map.getSource(id)) {
      console.warn('[MapCanvas] projection source already exists, sweeping:', id);
    }
  }

  // Layers first — removing a source while a layer references it throws.
  for (const id of PROJECTION_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of PROJECTION_SOURCE_IDS) {
    if (map.getSource(id)) map.removeSource(id);
  }

  map.addSource('projection-line', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
    lineMetrics: true,
  });
  map.addLayer({
    id: 'projection-line-layer',
    type: 'line',
    source: 'projection-line',
    layout: {
      // `round` joins/caps prevent miter-overflow spikes at sharp bends —
      // observed at WPT captures where the heading flips from "toward wpt_i"
      // to "toward wpt_{i+1}" across a single vertex, producing a visible
      // spur with the default `miter` join. Round bends look cleaner and
      // are imperceptible at non-sharp angles.
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      // Initial fallback gradient — the hook overwrites it on first compute
      // with a per-vertex color ramp keyed on bspRatio along line-progress.
      'line-gradient': [
        'interpolate', ['linear'], ['line-progress'],
        0, '#27ae60', 1, '#27ae60',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 3, 12, 4],
      'line-opacity': 0.85,
    },
  });

  map.addSource('projection-markers-time', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'projection-markers-time-circle',
    type: 'circle',
    source: 'projection-markers-time',
    paint: {
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
}

/**
 * Public sweep — used by `useProjectionLine` if it ever observes that a
 * projection-* source has somehow disappeared (post-style-reload, etc.) so
 * the sweep+install can re-run from outside the load handler. Currently
 * unused but kept ready for the recovery path.
 */
export function sweepAndReinstallProjectionLayers(map: maplibregl.Map): void {
  installProjectionLayers(map);
}

/** Flag to avoid zoom feedback loop (map move → store → map zoom) */
let _syncingFromMap = false;

interface MapCanvasProps {
  /** Show the 7-day projection line for the player's own boat.
   *  Set to false in spectator mode (no own boat). */
  enableProjection?: boolean;
  /** Override the wall-clock time used to sample weather overlays.
   *  When undefined (default), overlays sample at Date.now() — zero regression.
   *  When set (e.g. by the dev simulator), overlays show weather at that timestamp. */
  simTimeMs?: number;
}

export default function MapCanvas({ enableProjection = true, simTimeMs }: MapCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [readyMap, setReadyMap] = useState<maplibregl.Map | null>(null);
  // Bookkeeping ref: tracks which map instance owns the currently-installed
  // projection-* layers. The install function itself sweeps unconditionally
  // (so it doesn't need this ref to stay correct), but cleanup uses it to
  // distinguish "never installed" from "installed on this map instance"
  // — and the `useProjectionLine` recovery path could read it to decide
  // whether a reinstall is needed.
  const projectionInstalledRef = useRef<maplibregl.Map | null>(null);
  useProjectionLine(enableProjection ? readyMap : null);

  /* ── simTimeMs: override weather grid time for dev simulator ── */
  useEffect(() => {
    if (simTimeMs === undefined) return;
    const decoded = useGameStore.getState().weather.decodedGrid;
    if (!decoded) return;
    const grid = decodedGridToWeatherGridAtNow(decoded, simTimeMs);
    useGameStore.getState().setWeatherGrid(grid, new Date(simTimeMs + 6 * 3600 * 1000));
  }, [simTimeMs]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initAppearance = useGameStore.getState().mapAppearance;
    const initOcean = findOceanPreset(initAppearance.oceanPresetId)?.color
      ?? findOceanPreset(DEFAULT_OCEAN_ID)!.color;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(initOcean),
      center: [-3.0, 47.0],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    mapInstance = map;

    // Dev-only debug helper: dump the live MapLibre style state. Lets the
     // user run `__debugMap()` in the browser console to enumerate every
     // source + layer currently installed on the map. We need this to confirm
     // whether the "two projection lines + duplicated markers" report is a
     // duplicate-layer issue (multiple layer ids), a multiple-source issue,
     // or something else (e.g. the fallback green gradient never overwritten,
     // a stale RouteLayer leak, an IsochroneLayer leak, etc.).
    if (typeof window !== 'undefined') {
      (window as unknown as { __debugMap?: () => void }).__debugMap = () => {
        const m = mapRef.current;
        if (!m) { console.warn('[__debugMap] no map instance'); return; }
        const style = m.getStyle();
        const sources = style.sources ?? {};
        const layers = style.layers ?? [];
        console.group('[__debugMap] sources (' + Object.keys(sources).length + ')');
        for (const id of Object.keys(sources)) {
          const src = (sources as Record<string, unknown>)[id];
          console.log(id, src);
        }
        console.groupEnd();
        console.group('[__debugMap] layers (' + layers.length + ')');
        for (const layer of layers) {
          const src = (layer as { source?: string }).source;
          const paint = (layer as { paint?: unknown }).paint;
          console.log(layer.id + ' (type=' + layer.type + ', source=' + (src ?? '<none>') + ')', paint);
        }
        console.groupEnd();
        const projLayers = layers.filter((l) => {
          const src = (l as { source?: string }).source ?? '';
          return l.id.startsWith('projection') || src.startsWith('projection');
        });
        const simLayers = layers.filter((l) => {
          const src = (l as { source?: string }).source ?? '';
          return l.id.startsWith('sim-') || src.startsWith('sim-');
        });
        const greenLayers = layers.filter((l) => {
          const paint = JSON.stringify((l as { paint?: unknown }).paint ?? {});
          return /#?27ae60|#?2ecc71|#?5cc88c|#?5fc|"green"/i.test(paint);
        });
        console.log('[__debugMap] projection layers count:', projLayers.length, projLayers.map((l) => l.id));
        console.log('[__debugMap] sim-* layers count:', simLayers.length, simLayers.map((l) => l.id));
        console.log('[__debugMap] layers with GREEN paint:', greenLayers.length, greenLayers.map((l) => l.id));
        // Also report current paint of the projection-line-layer so we can
        // tell whether the gradient was ever overwritten by useProjectionLine.
        if (m.getLayer('projection-line-layer')) {
          const grad = m.getPaintProperty('projection-line-layer', 'line-gradient');
          console.log('[__debugMap] projection-line-layer line-gradient:', grad);
        }
      };
    }

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
      // Single LineString + line-gradient: MapLibre rasterises one strip with
      // a 256-sample 1D color texture, much cheaper than rendering N segment
      // features. The gradient expression is set per-recompute by the hook
      // via map.setPaintProperty(... 'line-gradient', ...).
      //
      // Paranoid install: ALWAYS sweep the projection-* ids first (layers
      // before sources, since layers reference sources), THEN add. Earlier
      // attempts used a bail-on-already-installed guard, but that left
      // duplicates whenever a stale layer/source slipped past the guard
      // (style hot-swap, sibling code, future refactor adding another
      // installer). Sweeping unconditionally guarantees "exactly one
      // projection-* source + layer set" no matter the entry conditions.
      installProjectionLayers(map);
      projectionInstalledRef.current = map;

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
      // fr-FR inserts a comma between date and time ("dim. 26 avr., 18:49");
      // we want "dim. 26 avr. 18:49" to match the ProgPanel formatting.
      const formatDate = (d: Date): string => DATE_FMT.format(d).replace(', ', ' ');

      const maneuverHtml = (type: string, detail: string, timestamp: number | undefined): string => {
        const label = MANEUVER_LABEL[type] ?? type;
        const accent = type === 'grounding' ? '#c0392b' : '#c9a84c';
        const when = timestamp ? formatDate(new Date(timestamp)) : '';
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
      // Clear the install guard so the NEXT map instance (StrictMode
      // remount, HMR re-creation) installs its own projection layers cleanly.
      projectionInstalledRef.current = null;
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

  /* ── Router placing mode: capture next map click as the destination ── */
  const routerPhase = useGameStore((s) => s.router.phase);
  const setRouterDestination = useGameStore((s) => s.setRouterDestination);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routerPhase !== 'placing') return;

    // MapLibre dynamically writes its own cursor on the canvas element (e.g.
    // 'grab' / 'pointer'), overriding the wrapper's `cursor: crosshair`. Set
    // the cursor directly on the canvas via the API for placing-mode.
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const handleMapClick = (e: maplibregl.MapMouseEvent): void => {
      setRouterDestination(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
      canvas.style.cursor = prevCursor;
    };
  }, [routerPhase, setRouterDestination]);

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
