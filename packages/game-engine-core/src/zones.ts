import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bbox from '@turf/bbox';
import { point, polygon } from '@turf/helpers';
import type { ExclusionZone, ExclusionZoneType } from '@nemo/shared-types';

type TurfPolygon = ReturnType<typeof polygon>;

export interface ZoneBBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface IndexedZone {
  zone: ExclusionZone;
  bbox: ZoneBBox;
  feature: TurfPolygon;
  activeFromUnix: number | null;
  activeToUnix: number | null;
}

export function buildZoneIndex(zones: ExclusionZone[]): IndexedZone[] {
  return zones.map((z) => {
    const feature = polygon(z.geometry.coordinates);
    const [minLon, minLat, maxLon, maxLat] = bbox(feature);
    return {
      zone: z,
      feature,
      bbox: { minLat, maxLat, minLon, maxLon },
      activeFromUnix: z.activeFrom ? Math.floor(Date.parse(z.activeFrom) / 1000) : null,
      activeToUnix: z.activeTo ? Math.floor(Date.parse(z.activeTo) / 1000) : null,
    };
  });
}

function isTemporallyActive(z: IndexedZone, nowUnix: number): boolean {
  if (z.activeFromUnix !== null && nowUnix < z.activeFromUnix) return false;
  if (z.activeToUnix !== null && nowUnix > z.activeToUnix) return false;
  return true;
}

function isInBBox(lat: number, lon: number, b: ZoneBBox): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/**
 * Pre-filter par bbox puis PIP Turf. Turf attend [lon, lat].
 * Appelé à chaque tick pour chaque bateau actif → le bbox filter coupe ~90%
 * des checks réels selon la spec (10k bateaux × 5 zones).
 */
export function getZonesAtPosition(
  lat: number,
  lon: number,
  index: IndexedZone[],
  nowUnix: number,
): ExclusionZone[] {
  const pt = point([lon, lat]);
  const hits: ExclusionZone[] = [];
  for (const z of index) {
    if (!isInBBox(lat, lon, z.bbox)) continue;
    if (!isTemporallyActive(z, nowUnix)) continue;
    if (booleanPointInPolygon(pt, z.feature)) hits.push(z.zone);
  }
  return hits;
}

/**
 * Applique les effets des zones actives au BSP calculé + aux alertes bateau.
 * Décision UX 2026-04-15 : 2 types seulement, tous ralentissent.
 *   WARN    : default 0.8 (configurable par zone via speedMultiplier)
 *   PENALTY : default 0.5 (configurable par zone via speedMultiplier)
 */
export interface ZoneApplication {
  bsp: number;
  newAlerts: { zoneId: string; type: ExclusionZoneType; reason: string }[];
  clearedAlerts: string[];
}

import { GameBalance } from '@nemo/game-balance/browser';

function resolveMultiplier(z: ExclusionZone): number {
  if (z.speedMultiplier !== undefined) return z.speedMultiplier;
  return z.type === 'WARN'
    ? GameBalance.zones.warnDefaultMultiplier
    : GameBalance.zones.penaltyDefaultMultiplier;
}

export function applyZones(
  bspIn: number,
  zones: ExclusionZone[],
  previouslyAlerted: ReadonlySet<string>,
): ZoneApplication {
  let bsp = bspIn;
  const newAlerts: ZoneApplication['newAlerts'] = [];

  const hitIds = new Set<string>();
  for (const z of zones) {
    hitIds.add(z.id);
    bsp *= resolveMultiplier(z);
    if (!previouslyAlerted.has(z.id)) {
      newAlerts.push({ zoneId: z.id, type: z.type, reason: z.reason });
    }
  }

  const clearedAlerts: string[] = [];
  for (const prev of previouslyAlerted) {
    if (!hitIds.has(prev)) clearedAlerts.push(prev);
  }

  return { bsp, newAlerts, clearedAlerts };
}
