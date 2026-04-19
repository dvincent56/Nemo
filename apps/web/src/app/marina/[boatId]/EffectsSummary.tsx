import type { CatalogEffects, InstalledUpgrade } from '@/lib/marina-api';
import styles from './EffectsSummary.module.css';

interface EffectsSummaryProps {
  effects: CatalogEffects | null;
  /** 'text' = signed inline deltas, 'bars' = labeled gauges with percentages. */
  variant?: 'text' | 'bars';
}

interface Criterion {
  key: string;
  label: string;
  /** Raw percentage change — positive = beneficial, negative = detrimental. */
  pct: number;
}

const MANEUVER_LABEL = {
  tack: 'virement',
  gybe: 'empannage',
  sailChange: 'changement de voile',
} as const;

type ManeuverKey = keyof typeof MANEUVER_LABEL;

function pct(x: number): number {
  return Math.round(x * 100);
}

/**
 * Derives normalized criteria for gauge display.
 * Each criterion's pct is a signed % where positive = better for the player.
 */
export function summarizeEffects(e: CatalogEffects): Criterion[] {
  const upwind = (e.speedByTwa[0] + e.speedByTwa[1]) / 2;
  const downwind = (e.speedByTwa[2] + e.speedByTwa[3] + e.speedByTwa[4]) / 3;
  const lightWind = e.speedByTws[0];
  const mediumWind = e.speedByTws[1];
  const heavyWind = e.speedByTws[2];

  // Per-axis wear deltas. wearMul 1.20 = +20% usure = -20% durabilité.
  // wearMul 0.55 = -45% usure = +45% durabilité.
  const wearAxis = (v: number | undefined): number => (typeof v === 'number' ? -(v - 1) : 0);
  const hullWear = wearAxis(e.wearMul?.hull);
  const rigWear = wearAxis(e.wearMul?.rig);
  const sailWear = wearAxis(e.wearMul?.sail);
  const elecWear = wearAxis(e.wearMul?.elec);

  // Maneuvers: aggregate duration savings and speed retention across the 3 types
  const maneuverTypes: ManeuverKey[] = ['tack', 'gybe', 'sailChange'];
  const durDeltas: number[] = [];
  const speedDeltas: number[] = [];
  for (const k of maneuverTypes) {
    const m = e.maneuverMul?.[k];
    if (!m) continue;
    durDeltas.push(1 - m.dur);     // dur 0.85 → +15% (faster)
    speedDeltas.push(m.speed - 1); // speed 1.10 → +10% (retained)
  }
  const durAvg = durDeltas.length ? durDeltas.reduce((a, b) => a + b, 0) / durDeltas.length : 0;
  const speedAvg = speedDeltas.length ? speedDeltas.reduce((a, b) => a + b, 0) / speedDeltas.length : 0;

  return [
    { key: 'upwind',        label: 'Près',             pct: pct(upwind) },
    { key: 'downwind',      label: 'Portant',          pct: pct(downwind) },
    { key: 'lightWind',     label: 'Vent léger',       pct: pct(lightWind) },
    { key: 'mediumWind',    label: 'Vent moyen',       pct: pct(mediumWind) },
    { key: 'heavyWind',     label: 'Gros temps',       pct: pct(heavyWind) },
    { key: 'maneuverDur',   label: 'Temps manœuvres',  pct: pct(durAvg) },
    { key: 'maneuverSpeed', label: 'Vitesse manœuvres', pct: pct(speedAvg) },
    { key: 'hullWear',      label: 'Solidité coque',      pct: pct(hullWear) },
    { key: 'rigWear',       label: 'Solidité gréement',   pct: pct(rigWear) },
    { key: 'sailWear',      label: 'Solidité voiles',     pct: pct(sailWear) },
    { key: 'elecWear',      label: 'Solidité électro',    pct: pct(elecWear) },
  ];
}

/**
 * Detailed text lines for the drawer — breaks down maneuver effects per type
 * so the user sees every concrete bonus ('-15% temps virement', etc.).
 */
export function detailLines(e: CatalogEffects): { text: string; tone: 'good' | 'bad' }[] {
  const lines: { text: string; tone: 'good' | 'bad' }[] = [];
  const push = (v: number, label: string, invert = false): void => {
    if (v === 0) return;
    const beneficial = invert ? v < 0 : v > 0;
    // For dur: we feed the raw delta (dur - 1), so negative raw = less time = good → display with minus sign
    const tone: 'good' | 'bad' = beneficial ? 'good' : 'bad';
    const sign = v > 0 ? '+' : '';
    lines.push({ text: `${sign}${v}% ${label}`, tone });
  };

  push(pct((e.speedByTwa[0] + e.speedByTwa[1]) / 2), 'vitesse au près');
  push(pct((e.speedByTwa[2] + e.speedByTwa[3] + e.speedByTwa[4]) / 3), 'vitesse au portant');
  push(pct(e.speedByTws[0]), 'vitesse par vent léger');
  push(pct(e.speedByTws[1]), 'vitesse par vent moyen');
  push(pct(e.speedByTws[2]), 'vitesse par grand vent');

  // Maneuvers: per-type so the user sees exactly which is improved
  const maneuverTypes: ManeuverKey[] = ['tack', 'gybe', 'sailChange'];
  for (const k of maneuverTypes) {
    const m = e.maneuverMul?.[k];
    if (!m) continue;
    const label = MANEUVER_LABEL[k];
    const durPct = pct(m.dur - 1);    // raw delta (-15% = -15% temps = better)
    const speedPct = pct(m.speed - 1);
    push(durPct, `temps ${label}`, true); // invert: negative raw = good
    push(speedPct, `vitesse pendant ${label}`);
  }

  // Wear: surface every affected axis separately so bonuses and maluses both show
  const wearLabels: Record<'hull' | 'rig' | 'sail' | 'elec', string> = {
    hull: 'usure coque',
    rig:  'usure gréement',
    sail: 'usure voiles',
    elec: 'usure électro',
  };
  for (const axis of ['hull', 'rig', 'sail', 'elec'] as const) {
    const v = e.wearMul?.[axis];
    if (typeof v !== 'number' || v === 1) continue;
    push(pct(v - 1), wearLabels[axis], true);
  }

  return lines;
}

/** Extra info about the item (activation thresholds, grounding, etc). Always shown as neutral. */
export function itemNotes(e: CatalogEffects): string[] {
  const notes: string[] = [];
  const { minTws, maxTws } = e.activation ?? {};
  if (minTws !== undefined && maxTws !== undefined) {
    notes.push(`Actif entre ${minTws} et ${maxTws} nœuds de vent`);
  } else if (minTws !== undefined) {
    notes.push(`Actif au-dessus de ${minTws} nœuds de vent`);
  } else if (maxTws !== undefined) {
    notes.push(`Actif en dessous de ${maxTws} nœuds de vent`);
  }
  if (e.groundingLossMul !== null && e.groundingLossMul < 1) {
    notes.push(`Réduit la pénalité d'échouage (×${e.groundingLossMul})`);
  }
  if (e.polarTargetsDeg !== null && e.polarTargetsDeg > 0) {
    notes.push(`Assistance polaire ±${e.polarTargetsDeg}°`);
  }
  return notes;
}

/**
 * Aggregates the effects of multiple installed upgrades into a single
 * synthetic CatalogEffects object. Matches the engine semantics:
 *  - speed deltas stack multiplicatively; for display we keep the linearized sum
 *    (upper bound accurate within 1% for typical values <±0.1)
 *  - wear and maneuver multipliers multiply across items
 */
export function aggregateInstalledEffects(items: InstalledUpgrade[]): CatalogEffects {
  const out: CatalogEffects = {
    speedByTwa: [0, 0, 0, 0, 0],
    speedByTws: [0, 0, 0],
    wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
    maneuverMul: {
      tack: { dur: 1, speed: 1 },
      gybe: { dur: 1, speed: 1 },
      sailChange: { dur: 1, speed: 1 },
    },
    polarTargetsDeg: null,
    groundingLossMul: null,
  };
  for (const it of items) {
    const e = it.effects;
    if (!e) continue;
    for (let i = 0; i < 5; i++) out.speedByTwa[i] = (out.speedByTwa[i] ?? 0) + (e.speedByTwa[i] ?? 0);
    for (let i = 0; i < 3; i++) out.speedByTws[i] = (out.speedByTws[i] ?? 0) + (e.speedByTws[i] ?? 0);
    if (e.wearMul && out.wearMul) {
      if (typeof e.wearMul.hull === 'number') out.wearMul.hull = (out.wearMul.hull ?? 1) * e.wearMul.hull;
      if (typeof e.wearMul.rig  === 'number') out.wearMul.rig  = (out.wearMul.rig  ?? 1) * e.wearMul.rig;
      if (typeof e.wearMul.sail === 'number') out.wearMul.sail = (out.wearMul.sail ?? 1) * e.wearMul.sail;
      if (typeof e.wearMul.elec === 'number') out.wearMul.elec = (out.wearMul.elec ?? 1) * e.wearMul.elec;
    }
    if (e.maneuverMul && out.maneuverMul) {
      for (const k of ['tack', 'gybe', 'sailChange'] as const) {
        const src = e.maneuverMul[k];
        const dst = out.maneuverMul[k];
        if (src && dst) {
          dst.dur *= src.dur;
          dst.speed *= src.speed;
        }
      }
    }
  }
  return out;
}

function Bar({ pct }: { pct: number }): React.ReactElement {
  // Clamp raw delta to ±50 for visual, then map to 0..100 with 50 = neutral.
  const clamped = Math.max(-50, Math.min(50, pct));
  const tone = pct > 0 ? styles.fillGood : pct < 0 ? styles.fillBad : styles.fillNeutre;
  const fillWidth = Math.abs(clamped);
  const fillLeft = pct >= 0 ? 50 : 50 - fillWidth;
  return (
    <div className={styles.track} role="presentation">
      <span className={styles.midline} aria-hidden />
      <span
        className={`${styles.fill} ${tone}`}
        style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
      />
    </div>
  );
}

export function EffectsSummary({ effects, variant = 'bars' }: EffectsSummaryProps): React.ReactElement | null {
  if (!effects) return null;

  if (variant === 'text') {
    const lines = detailLines(effects);
    const notes = itemNotes(effects);
    if (lines.length === 0 && notes.length === 0) return null;
    return (
      <ul className={styles.textList} aria-label="Effets principaux">
        {lines.map((l, i) => (
          <li key={`eff-${i}`} className={`${styles.textItem} ${l.tone === 'good' ? styles.pctGood : styles.pctBad}`}>
            {l.text}
          </li>
        ))}
        {notes.map((n, i) => (
          <li key={`note-${i}`} className={`${styles.textItem} ${styles.textNote}`}>
            {n}
          </li>
        ))}
      </ul>
    );
  }

  const rows = summarizeEffects(effects);
  const significant = rows.filter((r) => r.pct !== 0);
  if (significant.length === 0) return null;

  return (
    <div className={styles.wrapper} aria-label="Profil d'effet">
      {rows.map((r) => (
        <div key={r.key} className={styles.row}>
          <span className={styles.label}>{r.label}</span>
          <Bar pct={r.pct} />
          <span className={`${styles.pct} ${r.pct > 0 ? styles.pctGood : r.pct < 0 ? styles.pctBad : ''}`}>
            {r.pct > 0 ? '+' : ''}{r.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}
