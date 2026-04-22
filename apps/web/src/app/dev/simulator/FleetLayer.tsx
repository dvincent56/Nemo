'use client';
// apps/web/src/app/dev/simulator/FleetLayer.tsx

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { SimFleetState } from '@/lib/simulator/types';
import type { SimStatus } from '@/hooks/useSimulatorWorker';
import type { Position } from '@nemo/shared-types';
import { boatColor, PRIMARY_COLOR } from './colors';

interface FleetLayerProps {
  fleet: Record<string, SimFleetState>;
  primaryId: string | null;
  boatIds: string[];   // stable ordering for color assignment
  trails: Map<string, Position[]>;
  simStatus: SimStatus;
}

function emptyLineString(): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
    properties: {},
  };
}

function emptyPoint(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: 'FeatureCollection', features: [] };
}

export function FleetLayer({ fleet, primaryId, boatIds, trails }: FleetLayerProps) {
  // We track which boat ids have had sources/layers added so we can clean up
  const addedIds = useRef<Set<string>>(new Set());
  // mapReady flips to true once the map instance reports its style is loaded
  // — fleet/trails effects gate on this so they don't silently no-op when
  // fleet updates arrive before the map is mounted.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      const map = mapInstance;
      if (map && map.isStyleLoaded()) setMapReady(true);
      else setTimeout(poll, 200);
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const tryInit = () => {
      const map = mapInstance;
      if (!map || !map.isStyleLoaded()) return;

      // Add sources/layers for any new boat id
      for (const id of boatIds) {
        if (addedIds.current.has(id)) continue;

        const isPrimary = id === primaryId;
        const color = boatColor(id, primaryId, boatIds);
        const dotSourceId = `sim-boat-${id}`;
        const dotLayerId = `sim-boat-dot-${id}`;
        const haloLayerId = `sim-boat-halo-${id}`;
        const trailSourceId = `sim-trail-${id}`;
        const trailLayerId = `sim-trail-line-${id}`;

        // Trail source + layer
        if (!map.getSource(trailSourceId)) {
          map.addSource(trailSourceId, { type: 'geojson', data: emptyLineString() });
          map.addLayer({
            id: trailLayerId,
            type: 'line',
            source: trailSourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': color,
              'line-width': isPrimary ? 2.5 : 2,
              'line-opacity': 0.8,
            },
          });
        }

        // Primary halo layer (rendered before the dot)
        if (isPrimary && !map.getSource(dotSourceId)) {
          map.addSource(dotSourceId, { type: 'geojson', data: emptyPoint() });
          map.addLayer({
            id: haloLayerId,
            type: 'circle',
            source: dotSourceId,
            paint: {
              'circle-radius': 14,
              'circle-color': PRIMARY_COLOR,
              'circle-opacity': 0.3,
            },
          });
          map.addLayer({
            id: dotLayerId,
            type: 'circle',
            source: dotSourceId,
            paint: {
              'circle-radius': 9,
              'circle-color': PRIMARY_COLOR,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });
        } else if (!isPrimary && !map.getSource(dotSourceId)) {
          map.addSource(dotSourceId, { type: 'geojson', data: emptyPoint() });
          map.addLayer({
            id: dotLayerId,
            type: 'circle',
            source: dotSourceId,
            paint: {
              'circle-radius': 7,
              'circle-color': color,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
            },
          });
        }

        addedIds.current.add(id);
      }

      // Remove sources/layers for boat ids no longer in boatIds
      for (const id of addedIds.current) {
        if (boatIds.includes(id)) continue;
        const dotLayerId = `sim-boat-dot-${id}`;
        const haloLayerId = `sim-boat-halo-${id}`;
        const dotSourceId = `sim-boat-${id}`;
        const trailLayerId = `sim-trail-line-${id}`;
        const trailSourceId = `sim-trail-${id}`;

        if (map.getLayer(haloLayerId)) map.removeLayer(haloLayerId);
        if (map.getLayer(dotLayerId)) map.removeLayer(dotLayerId);
        if (map.getSource(dotSourceId)) map.removeSource(dotSourceId);
        if (map.getLayer(trailLayerId)) map.removeLayer(trailLayerId);
        if (map.getSource(trailSourceId)) map.removeSource(trailSourceId);
        addedIds.current.delete(id);
      }
    };

    tryInit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boatIds, primaryId, mapReady]);

  // Update boat positions
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstance;
    if (!map) return;

    for (const [id, state] of Object.entries(fleet)) {
      const dotSourceId = `sim-boat-${id}`;
      const src = map.getSource(dotSourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;

      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [state.position.lon, state.position.lat] },
          properties: {},
        }],
      });
    }
  }, [fleet, mapReady]);

  // Update trails
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstance;
    if (!map) return;

    for (const [id, coords] of trails.entries()) {
      const trailSourceId = `sim-trail-${id}`;
      const src = map.getSource(trailSourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;

      src.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords.map(p => [p.lon, p.lat]),
        },
        properties: {},
      });
    }
  }, [trails, mapReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const map = mapInstance;
      if (!map) return;
      for (const id of addedIds.current) {
        const dotLayerId = `sim-boat-dot-${id}`;
        const haloLayerId = `sim-boat-halo-${id}`;
        const dotSourceId = `sim-boat-${id}`;
        const trailLayerId = `sim-trail-line-${id}`;
        const trailSourceId = `sim-trail-${id}`;
        try {
          if (map.getLayer(haloLayerId)) map.removeLayer(haloLayerId);
          if (map.getLayer(dotLayerId)) map.removeLayer(dotLayerId);
          if (map.getSource(dotSourceId)) map.removeSource(dotSourceId);
          if (map.getLayer(trailLayerId)) map.removeLayer(trailLayerId);
          if (map.getSource(trailSourceId)) map.removeSource(trailSourceId);
        } catch {
          // Map may already be removing; ignore
        }
      }
      addedIds.current.clear();
    };
  }, []);

  // This component renders nothing — it's a side-effect-only layer manager
  return null;
}
