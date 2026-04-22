'use client';
// Draws the isochrones of a single boat as connected lines. Points inside an
// isochrone are already in bearing-from-origin order (the sector-pruning in
// @nemo/routing writes them into sector bins 0..N-1 which are then iterated
// in order). We connect adjacent points; when the bearing-gap between two
// consecutive survivors is large (a missing sector), we split the line so
// we don't draw a long straight segment across empty space.
//
// Rendered translucent so multiple isos stacked around the start produce the
// classical "expanding front" look.

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan, IsochronePoint } from '@nemo/routing';

interface Props {
  plan: RoutePlan | null;
  color: string;
}

const SOURCE_ID = 'sim-iso';
const LAYER_ID = 'sim-iso-lines';

// Maximum allowed gap between two consecutive iso points (nautical miles).
// Above this we split the line — the sector in between had no survivor, so
// connecting them would draw through land or empty space.
const MAX_SEGMENT_NM = 120;

function haversineNm(a: IsochronePoint, b: IsochronePoint): number {
  const R = 3440.065;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// One Chaikin corner-cutting pass: for each segment (p, q) generate two new
// points at 1/4 and 3/4 along it. Two iterations produce a visibly smooth
// curve while keeping cost low.
function chaikin(coords: [number, number][], iterations: number): [number, number][] {
  let pts = coords;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const next: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

// Median-filter the radial distances of iso points to kill sector-winner
// spikes (one lucky heading producing a far-out point next to an unlucky
// heading close in). The angle from origin is preserved; only the radial
// distance is smoothed. Window of 5 neighbours works well without losing
// the overall expanding-front shape.
function smoothRadially(
  points: [number, number][],
  origin: { lat: number; lon: number },
  window: number,
): [number, number][] {
  if (points.length < window) return points;
  const DEG = Math.PI / 180;
  const R = 3440.065;

  // Great-circle distance + bearing from origin to each point.
  const radii: number[] = [];
  const bearings: number[] = [];
  for (const [lon, lat] of points) {
    const dLat = (lat - origin.lat) * DEG;
    const dLon = (lon - origin.lon) * DEG;
    const lat1 = origin.lat * DEG;
    const lat2 = lat * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    radii.push(2 * R * Math.asin(Math.sqrt(h)));
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    bearings.push((Math.atan2(y, x) / DEG + 360) % 360);
  }

  const half = Math.floor(window / 2);
  const smoothed: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(points.length, i + half + 1);
    const slice = radii.slice(from, to).sort((a, b) => a - b);
    const median = slice[Math.floor(slice.length / 2)]!;
    // Reproject the point at `median` distance along its original bearing.
    const brg = bearings[i]! * DEG;
    const lat1 = origin.lat * DEG;
    const d = median / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = origin.lon * DEG + Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    smoothed.push([lon2 / DEG, lat2 / DEG]);
  }
  return smoothed;
}

function isoToFeatures(
  iso: IsochronePoint[],
  step: number,
  origin: { lat: number; lon: number },
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  if (iso.length < 2) return out;

  const segments: [number, number][][] = [];
  let current: [number, number][] = [[iso[0]!.lon, iso[0]!.lat]];
  for (let i = 1; i < iso.length; i++) {
    const prev = iso[i - 1]!;
    const p = iso[i]!;
    if (haversineNm(prev, p) > MAX_SEGMENT_NM) {
      if (current.length >= 2) segments.push(current);
      current = [[p.lon, p.lat]];
    } else {
      current.push([p.lon, p.lat]);
    }
  }
  if (current.length >= 2) segments.push(current);

  for (const seg of segments) {
    // 1) Radial median-filter: kill sector-winner spikes (one heading
    //    catches a puff and jumps 30 NM further than its neighbours).
    // 2) Chaikin: smooth the remaining corners. More passes when the
    //    segment has few points (early isos have 24-48 survivors and
    //    stay jagged with only 2 passes).
    const denoised = smoothRadially(seg, origin, 5);
    const passes = denoised.length < 30 ? 4 : denoised.length < 80 ? 3 : 2;
    const smooth = chaikin(denoised, passes);
    out.push({
      type: 'Feature', properties: { step },
      geometry: { type: 'LineString', coordinates: smooth },
    });
  }
  return out;
}

export function IsochroneLayer({ plan, color }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const install = () => {
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (plan) {
        const origin = { lat: plan.polyline[0]!.lat, lon: plan.polyline[0]!.lon };
        for (let i = 1; i < plan.isochrones.length; i++) {  // skip step 0 (start)
          const iso = plan.isochrones[i];
          if (!iso) continue;
          features.push(...isoToFeatures(iso, i, origin));
        }
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.35 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
        map.setPaintProperty(LAYER_ID, 'line-color', color);
      }
    };
    install();
    return () => {
      const m = mapInstance;
      if (!m) return;
      try {
        if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch { /* ignore teardown race */ }
    };
  }, [plan, color]);

  return null;
}
