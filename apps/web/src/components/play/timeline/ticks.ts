const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type TickFormat = 'HH:00' | 'HH:00 · J+N' | 'DD MMM';

export interface TickScale {
  stepMs: number;
  format: TickFormat;
}

/**
 * Densité adaptative des graduations selon la durée totale visible :
 *  ≤ 12h  → 1h
 *  12-72h → 6h
 *  3-14j  → 1 jour
 *  > 14j  → 7 jours
 */
export function computeTicks(i: { minMs: number; maxMs: number; nowMs: number }): TickScale {
  const span = i.maxMs - i.minMs;
  if (span <= 12 * HOUR) return { stepMs: HOUR, format: 'HH:00' };
  if (span <= 72 * HOUR) return { stepMs: 6 * HOUR, format: 'HH:00 · J+N' };
  if (span <= 14 * DAY) return { stepMs: DAY, format: 'DD MMM' };
  return { stepMs: 7 * DAY, format: 'DD MMM' };
}

export interface TickPosition {
  ts: number;
  /** Position 0..100 (en %) le long de la barre. */
  pctX: number;
  label: string;
}

/**
 * Génère les positions de graduations alignées sur les bornes step (le
 * premier tick est le multiple suivant `minMs`).
 */
export function buildTickPositions(
  scale: TickScale,
  bounds: { minMs: number; maxMs: number; nowMs: number },
  formatLabel: (ts: number, scale: TickScale, nowMs: number) => string,
): TickPosition[] {
  const out: TickPosition[] = [];
  const span = bounds.maxMs - bounds.minMs;
  if (span <= 0) return out;
  const start = Math.ceil(bounds.minMs / scale.stepMs) * scale.stepMs;
  for (let t = start; t <= bounds.maxMs; t += scale.stepMs) {
    out.push({
      ts: t,
      pctX: ((t - bounds.minMs) / span) * 100,
      label: formatLabel(t, scale, bounds.nowMs),
    });
  }
  return out;
}
