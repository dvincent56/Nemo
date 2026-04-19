import type { CatalogEffects, InstalledUpgrade } from '@/lib/marina-api';
import styles from './EffectsSummary.module.css';

interface EffectsSummaryProps {
  effects: CatalogEffects | null;
  /** 'text' = inline deltas ("+3% au près"), 'bars' = labeled bars with percentages. */
  variant?: 'text' | 'bars';
}

interface Criterion {
  key: string;
  label: string;
  /** Raw percentage change — positive = better, negative = worse. */
  pct: number;
  detail: string;
}

/**
 * Derives 4 normalized criteria from raw engine effects:
 *  - Près = average speed gain on TWA bands 0-1 (<60° and 60-90°)
 *  - Portant = average gain on TWA bands 2-4 (90-120, 120-150, 150-180)
 *  - Gros temps = speed gain in the heavy-wind TWS band (>20 kt)
 *  - Durabilité = inverse of the worst wear multiplier (wear 1.4× → -40%)
 */
export function summarizeEffects(e: CatalogEffects): Criterion[] {
  const upwind = (e.speedByTwa[0] + e.speedByTwa[1]) / 2;
  const downwind = (e.speedByTwa[2] + e.speedByTwa[3] + e.speedByTwa[4]) / 3;
  const heavy = e.speedByTws[2];

  const wearValues = Object.values(e.wearMul ?? {}).filter((v): v is number => typeof v === 'number');
  const worstWear = wearValues.length ? Math.max(...wearValues) : 1;
  const wearDelta = -(worstWear - 1);

  const pct = (x: number) => Math.round(x * 100);
  const signed = (v: number) => `${v > 0 ? '+' : ''}${v}%`;

  return [
    { key: 'upwind',   label: 'Près',        pct: pct(upwind),    detail: `${signed(pct(upwind))} vitesse au près` },
    { key: 'downwind', label: 'Portant',     pct: pct(downwind),  detail: `${signed(pct(downwind))} vitesse au portant` },
    { key: 'heavy',    label: 'Gros temps',  pct: pct(heavy),     detail: `${signed(pct(heavy))} vitesse par grand vent` },
    { key: 'wear',     label: 'Durabilité',  pct: pct(wearDelta), detail: `${signed(pct(wearDelta))} usure` },
  ];
}

/**
 * Aggregates the effects of multiple installed upgrades into a single
 * synthetic CatalogEffects object. Matches the engine semantics:
 *  - speed deltas stack multiplicatively; for display we keep the linearized sum
 *    (upper bound accurate within 1% for typical values <±0.1)
 *  - wear multipliers multiply across items
 */
export function aggregateInstalledEffects(items: InstalledUpgrade[]): CatalogEffects {
  const out: CatalogEffects = {
    speedByTwa: [0, 0, 0, 0, 0],
    speedByTws: [0, 0, 0],
    wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
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
  const rows = summarizeEffects(effects);
  const significant = rows.filter((r) => r.pct !== 0);
  if (significant.length === 0) return null;

  if (variant === 'text') {
    return (
      <ul className={styles.textList} aria-label="Effets principaux">
        {significant.map((r) => (
          <li key={r.key} className={`${styles.textItem} ${r.pct > 0 ? styles.pctGood : styles.pctBad}`}>
            {r.detail}
          </li>
        ))}
      </ul>
    );
  }

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
