const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type TickKind = 'past' | 'future' | 'now';

export interface Tick {
  ts: number;
  /** Position 0..100 (en %) le long de la barre. */
  pctX: number;
  label: string;
  kind: TickKind;
}

interface BoundsInput {
  minMs: number;
  maxMs: number;
  nowMs: number;
  /** When true, past dates are formatted as "DD/M" instead of "DD mois". */
  compactPast?: boolean;
}

/** Paliers tactiques journaliers, capés à J+5 (au-delà la prévi GFS perd
 *  de sa précision). Les sub-day offsets ont été retirés car ils
 *  s'écrasaient mutuellement près de NOW sur des spans longs. */
const FUTURE_OFFSETS_MS: { off: number; label: string }[] = [
  { off: 24 * HOUR, label: 'J+1' },
  { off: 48 * HOUR, label: 'J+2' },
  { off: 72 * HOUR, label: 'J+3' },
  { off: 5 * DAY,   label: 'J+5' },
];

const MONTHS_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

function formatDate(ts: number, compact: boolean): string {
  const d = new Date(ts);
  if (compact) return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()] ?? ''}`;
}

/**
 * Compose les graduations de la timeline :
 *  - côté futur : offsets relatifs à NOW (+1h, +3h, … J+7)
 *  - côté passé : dates absolues, espacées selon la durée passée
 *  - NOW : marqueur central
 *
 * Toutes les graduations sont clampées entre minMs et maxMs.
 */
export function buildTicks(b: BoundsInput): Tick[] {
  const span = b.maxMs - b.minMs;
  if (span <= 0) return [];
  const out: Tick[] = [];

  // Future ticks (offsets fixes, relatifs à NOW).
  for (const { off, label } of FUTURE_OFFSETS_MS) {
    const t = b.nowMs + off;
    if (t > b.maxMs) break;
    out.push({ ts: t, pctX: ((t - b.minMs) / span) * 100, label, kind: 'future' });
  }

  // NOW marker.
  if (b.nowMs >= b.minMs && b.nowMs <= b.maxMs) {
    out.push({
      ts: b.nowMs,
      pctX: ((b.nowMs - b.minMs) / span) * 100,
      label: 'NOW',
      kind: 'now',
    });
  }

  // Past ticks: density adapts to the past duration.
  const pastSpanMs = b.nowMs - b.minMs;
  if (pastSpanMs > 0) {
    let stepMs = 0;
    if (pastSpanMs <= 12 * HOUR) stepMs = 3 * HOUR;
    else if (pastSpanMs <= 3 * DAY) stepMs = DAY;
    else if (pastSpanMs <= 14 * DAY) stepMs = 2 * DAY;
    else if (pastSpanMs <= 60 * DAY) stepMs = 7 * DAY;
    else stepMs = 14 * DAY;

    // Skip the slot too close to NOW (collision with NOW label).
    const minGapMs = Math.max(stepMs * 0.4, 6 * HOUR);
    for (let t = b.nowMs - stepMs; t >= b.minMs; t -= stepMs) {
      if (b.nowMs - t < minGapMs) continue;
      out.push({
        ts: t,
        pctX: ((t - b.minMs) / span) * 100,
        label: formatDate(t, b.compactPast === true),
        kind: 'past',
      });
    }
  }

  // Sort chronologically for stable React key order.
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
