'use client';
// Draws each boat's routed polyline in the boat's own color as a dashed
// line. Primary boat gets a slightly thicker line so it stands out at a
// glance. Colors and widths are re-applied on every render — otherwise the
// layer keeps whatever color was set when it was first added, so changing
// the primary boat mid-session wouldn't update the route look.
//
// GFS-freshness split: the polyline is cut in two at `nextGfsRunMs`. The
// portion up to that boundary is drawn with a thick dash pattern ([2, 2])
// because it's based on the current run — the forecast there is as firm
// as it gets. The portion *past* the boundary is drawn with a thin, wider-
// spaced dash ([1, 4]) signalling that a new run will arrive and may
// reshape it. When the store rotates a new run in, `nextGfsRunMs` jumps
// forward by 6 h, so previously-stale segments get repainted as fresh.

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan, RoutePolylinePoint } from '@nemo/routing';

interface Props {
  routes: Map<string, RoutePlan>;
  primaryId: string | null;
  colorFor: (boatId: string) => string;
  nextGfsRunMs: number;
}

// Split a polyline into (fresh, stale) halves at `boundaryMs`, inserting a
// linearly-interpolated boundary point into both sides so the lines meet
// seamlessly. If the polyline is fully on one side of the boundary the
// other side is empty.
function splitAtBoundary(
  polyline: RoutePolylinePoint[],
  boundaryMs: number,
): { fresh: RoutePolylinePoint[]; stale: RoutePolylinePoint[] } {
  if (polyline.length === 0) return { fresh: [], stale: [] };
  if (polyline[polyline.length - 1]!.timeMs <= boundaryMs) {
    return { fresh: polyline, stale: [] };
  }
  if (polyline[0]!.timeMs >= boundaryMs) {
    return { fresh: [], stale: polyline };
  }
  const fresh: RoutePolylinePoint[] = [];
  const stale: RoutePolylinePoint[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    if (a.timeMs <= boundaryMs) fresh.push(a);
    else stale.push(a);
    if (a.timeMs < boundaryMs && b.timeMs > boundaryMs) {
      const t = (boundaryMs - a.timeMs) / (b.timeMs - a.timeMs);
      const mid: RoutePolylinePoint = {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        timeMs: boundaryMs,
        twa: a.twa, tws: a.tws, bsp: a.bsp, sail: a.sail,
      };
      fresh.push(mid);
      stale.push(mid);
    }
  }
  const last = polyline[polyline.length - 1]!;
  if (last.timeMs <= boundaryMs) fresh.push(last);
  else stale.push(last);
  return { fresh, stale };
}

function lineFeature(points: RoutePolylinePoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
  };
}

export function RouteLayer({ routes, primaryId, colorFor, nextGfsRunMs }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    let cancelled = false;

    const install = () => {
      if (cancelled) return;
      // Match IsochroneLayer/RouterDestinationMarker: poll until style ready
      // instead of bailing silently. A single early `return` on
      // !isStyleLoaded() left the route invisible whenever the layer mounted
      // before the style hot-load completed (race observed when applying a
      // computed route on first panel open).
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }

      const seen = new Set<string>();
      for (const [id, plan] of routes) {
        seen.add(id);
        const color = colorFor(id);
        const freshWidth = id === primaryId ? 3.5 : 2;
        const staleWidth = id === primaryId ? 2.5 : 1.5;
        const { fresh, stale } = splitAtBoundary(plan.polyline, nextGfsRunMs);

        const variants: Array<{
          suffix: 'fresh' | 'stale';
          points: RoutePolylinePoint[];
          width: number;
          dash: [number, number];
        }> = [
          { suffix: 'fresh', points: fresh, width: freshWidth, dash: [2, 2] },
          { suffix: 'stale', points: stale, width: staleWidth, dash: [1, 4] },
        ];

        for (const v of variants) {
          const sourceId = `sim-route-${v.suffix}-${id}`;
          const layerId = `sim-route-line-${v.suffix}-${id}`;
          if (v.points.length < 2) {
            // Nothing to draw for this half — drop any stale layer left over
            // from a previous render where the boundary cut it differently.
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
            continue;
          }
          const feat = lineFeature(v.points);
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: feat });
            map.addLayer({
              id: layerId,
              type: 'line',
              source: sourceId,
              paint: {
                'line-color': color,
                'line-width': v.width,
                'line-opacity': v.suffix === 'fresh' ? 0.9 : 0.55,
                'line-dasharray': v.dash,
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
          } else {
            (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(feat);
            map.setPaintProperty(layerId, 'line-color', color);
            map.setPaintProperty(layerId, 'line-width', v.width);
          }
        }
      }

      // Remove routes that disappeared
      const layers = map.getStyle().layers ?? [];
      for (const layer of layers) {
        const m = layer.id.match(/^sim-route-line-(fresh|stale)-(.+)$/);
        if (!m) continue;
        const id = m[2]!;
        if (seen.has(id)) continue;
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        const srcId = `sim-route-${m[1]}-${id}`;
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    };

    install();

    return () => {
      cancelled = true;
      // Remove every sim-route layer/source we may have created. Without this
      // the layers persist on the map after the router panel closes (the
      // unmount only flipped the `cancelled` flag, leaving previously-installed
      // sources/layers in place).
      const m = mapInstance;
      if (!m) return;
      try {
        const layers = m.getStyle().layers ?? [];
        for (const layer of layers) {
          const match = layer.id.match(/^sim-route-line-(fresh|stale)-(.+)$/);
          if (!match) continue;
          if (m.getLayer(layer.id)) m.removeLayer(layer.id);
          const srcId = `sim-route-${match[1]}-${match[2]}`;
          if (m.getSource(srcId)) m.removeSource(srcId);
        }
      } catch { /* ignore teardown race */ }
    };
  }, [routes, primaryId, colorFor, nextGfsRunMs]);

  return null;
}
