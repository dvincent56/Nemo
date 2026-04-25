import type { TrackPoint } from './types';

export type RaceStatus = 'BRIEFING' | 'LIVE' | 'FINISHED' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface BoundsInput {
  raceStartMs: number | null;
  raceEndMs: number | null;
  forecastEndMs: number | null;
  status: RaceStatus;
  /** Injected for tests; defaults to Date.now() at call site. */
  nowMs?: number;
}

export interface TimelineBounds {
  minMs: number;
  maxMs: number;
}

/**
 * Bornes du curseur de timeline en fonction du statut de la course.
 * - BRIEFING : range = [now, J+7] (pas de zone passée)
 * - LIVE     : range = [raceStart, J+7]
 * - FINISHED : range = [raceStart, raceEnd]
 */
export function selectTimelineBounds(i: BoundsInput): TimelineBounds {
  const now = i.nowMs ?? Date.now();
  const minMs = i.status === 'BRIEFING' ? now : (i.raceStartMs ?? now);
  const maxMs =
    i.status === 'FINISHED'
      ? (i.raceEndMs ?? i.forecastEndMs ?? now)
      : (i.forecastEndMs ?? now);
  return { minMs, maxMs };
}

export interface ProjectionPoint {
  dtMs: number;
  lat: number;
  lon: number;
}

export interface GhostInput {
  currentTimeMs: number;
  isLive: boolean;
  nowMs: number;
  track: readonly TrackPoint[];
  projection: readonly ProjectionPoint[] | null;
}

export interface GhostPosition {
  lat: number;
  lon: number;
  hdg: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Cap relevé entre deux points GPS (route loxodromique simplifiée — la
 * formule grand-cercle reste précise pour les segments < quelques degrés).
 * Retourne 0..360 (0 = nord, 90 = est).
 */
function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Position interpolée du fantôme à `currentTimeMs`.
 * - isLive ⇒ null (fantôme caché)
 * - currentTime ≤ now ⇒ lerp dans `track` (clamp aux bornes)
 * - currentTime > now ⇒ lerp dans `projection` par dtMs (clamp aux bornes)
 *
 * Le heading est dérivé du bearing entre les 2 points encadrants. Aux
 * bornes (clamp), pas de neighbour disponible ⇒ hdg=0.
 */
export function selectGhostPosition(i: GhostInput): GhostPosition | null {
  if (i.isLive) return null;

  if (i.currentTimeMs <= i.nowMs) {
    if (i.track.length === 0) return null;
    if (i.currentTimeMs <= i.track[0]!.ts) {
      return { lat: i.track[0]!.lat, lon: i.track[0]!.lon, hdg: 0 };
    }
    if (i.currentTimeMs >= i.track[i.track.length - 1]!.ts) {
      const last = i.track[i.track.length - 1]!;
      return { lat: last.lat, lon: last.lon, hdg: 0 };
    }
    for (let k = 0; k < i.track.length - 1; k++) {
      const a = i.track[k]!;
      const b = i.track[k + 1]!;
      if (i.currentTimeMs >= a.ts && i.currentTimeMs <= b.ts) {
        const t = (i.currentTimeMs - a.ts) / (b.ts - a.ts);
        return {
          lat: lerp(a.lat, b.lat, t),
          lon: lerp(a.lon, b.lon, t),
          hdg: bearingDeg(a, b),
        };
      }
    }
    return null;
  }

  // future branch
  if (!i.projection || i.projection.length === 0) return null;
  const dt = i.currentTimeMs - i.nowMs;
  if (dt <= i.projection[0]!.dtMs) {
    return { lat: i.projection[0]!.lat, lon: i.projection[0]!.lon, hdg: 0 };
  }
  if (dt >= i.projection[i.projection.length - 1]!.dtMs) {
    const last = i.projection[i.projection.length - 1]!;
    return { lat: last.lat, lon: last.lon, hdg: 0 };
  }
  for (let k = 0; k < i.projection.length - 1; k++) {
    const a = i.projection[k]!;
    const b = i.projection[k + 1]!;
    if (dt >= a.dtMs && dt <= b.dtMs) {
      const t = (dt - a.dtMs) / (b.dtMs - a.dtMs);
      return {
        lat: lerp(a.lat, b.lat, t),
        lon: lerp(a.lon, b.lon, t),
        hdg: bearingDeg(a, b),
      };
    }
  }
  return null;
}

/**
 * La couche météo (vent + houle) reste visible au présent et au futur,
 * masquée en mode replay arrière (choix UX validé : pas de météo
 * rétrospective Phase 1).
 */
export function selectWeatherLayerVisible(i: { currentTimeMs: number; nowMs: number }): boolean {
  return i.currentTimeMs >= i.nowMs;
}

export interface SparklinePoint {
  ts: number;
  rank: number;
  /** 0..1 ; 1 = meilleur rang (rang 1), 0 = pire rang de la fenêtre. */
  yNorm: number;
}

/**
 * Normalise les points de rang de la trace en y∈[0,1] proportionnellement
 * à la plage observée (pas de log scale). yNorm est inversé : un meilleur
 * rang (faible chiffre) donne yNorm proche de 1, ce qui rend le tracé
 * "monte = mieux" lisible directement.
 */
export function selectRankSparklineNormalized(track: readonly TrackPoint[]): SparklinePoint[] {
  if (track.length < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of track) {
    if (p.rank < min) min = p.rank;
    if (p.rank > max) max = p.rank;
  }
  const span = max - min;
  return track.map((p) => ({
    ts: p.ts,
    rank: p.rank,
    yNorm: span === 0 ? 1 : 1 - (p.rank - min) / span,
  }));
}
