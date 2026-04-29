import { haversinePosNM } from '@/lib/geo';

/**
 * True when the WP position is at least `minNm` nautical miles away from
 * the boat. Used by the WP editor (Phase 2b) to validate manual placement
 * and drag operations.
 *
 * Cf. spec docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md
 * (Rayon de sécurité section).
 */
export function validateWpDistance(
  boat: { lat: number; lon: number },
  wp: { lat: number; lon: number },
  minNm: number,
): boolean {
  return haversinePosNM(boat, wp) >= minNm;
}

/**
 * Distance between boat and proposed WP in nautical miles. Useful for
 * UI feedback (e.g., "Trop proche : 1.4 NM, minimum 3 NM").
 */
export function wpDistanceNm(
  boat: { lat: number; lon: number },
  wp: { lat: number; lon: number },
): number {
  return haversinePosNM(boat, wp);
}
