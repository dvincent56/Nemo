/**
 * Pure geometry helpers + constants for the Compass primitives.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx` so the
 * SVG-rendering primitive (`<CompassDial>`) and any future preview consumer
 * (Phase 2 ProgPanel cap-order editor) share the same coordinate system
 * and IMOCA silhouette.
 *
 * No React, no DOM, no store.
 *
 * Layout — "double bezel marine compass":
 *   r ∈ [R_BEZEL_INNER, R_BEZEL_OUTER]   navy bezel ring (gold tick marks)
 *   r ∈ [R_DIAL, R_BEZEL_INNER]          ivory ring (chiffres + cardinaux navy)
 *   r ∈ [0, R_DIAL]                       ivory dial (boat + cap line + waves)
 */

/** SVG viewBox size (square). Bumped from 220 → 240 to make room for the bezel. */
export const VB = 240;

/** Original viewBox of the IMOCA silhouette path (from a stock SVG asset). */
export const IMOCA_VB = { w: 611, h: 188 };

/**
 * IMOCA silhouette path. Originally points RIGHT — consumers rotate -90° to
 * make it point UP, then rotate by heading.
 */
export const IMOCA_PATH = 'M89.62 0.00 L84.78 0.93 L68.78 0.94 L32.11 3.00 L18.73 3.26 L0.00 80.71 L0.00 103.30 L2.80 111.69 L14.24 153.84 L17.40 166.90 L18.32 175.45 L25.85 176.86 L51.53 178.03 L60.95 178.02 L73.13 179.02 L97.07 179.19 L98.62 179.34 L99.65 180.00 L210.37 180.00 L215.52 179.04 L233.38 179.06 L243.05 178.12 L264.43 177.00 L271.73 177.04 L283.24 175.39 L299.16 174.28 L302.12 174.51 L336.55 171.65 L382.22 166.14 L417.19 160.27 L444.90 154.36 L472.32 147.28 L499.36 138.92 L525.97 129.17 L553.80 117.15 L588.07 99.45 L603.00 89.93 L603.00 92.93 L603.00 89.26 L600.20 87.99 L577.71 74.58 L549.21 60.42 L520.01 48.24 L494.37 39.23 L468.48 31.48 L442.36 24.91 L407.19 17.75 L371.69 12.20 L326.93 7.11 L272.77 3.02 L236.84 0.99 L219.33 0.00 L89.62 0.00 Z';

/** Cadran center coordinates (square viewBox). */
export const CX = VB / 2;
export const CY = VB / 2;

/**
 * Outer edge of the navy bezel ring. Sized so that <WindWaves> (which streams
 * from `r + 22` to `r + 4` toward the centre) keeps the same ~8 units of
 * top-overflow it had with the old geometry, avoiding waves bleeding into
 * the readouts row above.
 */
export const R_BEZEL_OUTER = 106;
/** Inner edge of the navy bezel ring (= outer edge of the ivory ring). */
export const R_BEZEL_INNER = 93;
/** Outer edge of the central ivory dial (= inner edge of the ivory ring). */
export const R_DIAL = 76;

/**
 * Legacy aliases kept so `<Compass>` (and the WindWaves overlay) can keep
 * referring to "the outer ring radius" without leaking the bezel structure.
 * R_OUTER = the visual outside of the whole compass, R_INNER = inside of the
 * bezel where the ivory dial begins.
 */
export const R_OUTER = R_BEZEL_OUTER;
export const R_INNER = R_DIAL;

/** Scale factor that fits the IMOCA silhouette inside the (smaller) ivory dial. */
export const IMOCA_SCALE = 46 / IMOCA_VB.w;

/**
 * Polar → cartesian, rounded to 0.01.
 * 0° = North (top), 90° = East (right). Matches the cadran layout.
 */
export function pt(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: Math.round((CX + r * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + r * Math.sin(rad)) * 100) / 100,
  };
}

/** True when |TWA| sits in either VMG-upwind (38..54°) or VMG-downwind (140..162°) bands. */
export function isInVmgZone(twa: number): boolean {
  const a = Math.abs(twa);
  return (a >= 38 && a <= 54) || (a >= 140 && a <= 162);
}
