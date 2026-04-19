import type { CatalogEffects, InstalledUpgrade, PassiveEffects } from '@/lib/marina-api';
import styles from './EffectsSummary.module.css';

/** Merge passiveEffects into a synthetic effects view — used for displaying a
 * worst-case / total impact regardless of activation state. */
function mergePassive(e: CatalogEffects): CatalogEffects {
  const p = e.passiveEffects;
  if (!p) return e;
  return {
    ...e,
    speedByTwa: [0, 1, 2, 3, 4].map((i) =>
      (e.speedByTwa[i] ?? 0) + (p.speedByTwa?.[i] ?? 0),
    ) as CatalogEffects['speedByTwa'],
    speedByTws: [0, 1, 2].map((i) =>
      (e.speedByTws[i] ?? 0) + (p.speedByTws?.[i] ?? 0),
    ) as CatalogEffects['speedByTws'],
    wearMul: {
      hull: (e.wearMul?.hull ?? 1) * (p.wearMul?.hull ?? 1),
      rig:  (e.wearMul?.rig  ?? 1) * (p.wearMul?.rig  ?? 1),
      sail: (e.wearMul?.sail ?? 1) * (p.wearMul?.sail ?? 1),
      elec: (e.wearMul?.elec ?? 1) * (p.wearMul?.elec ?? 1),
    },
  };
}

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
 * Lines from passiveEffects are flagged `passive: true` so the UI can mark
 * them as "toujours appliqué" (vs active = only when activation is met).
 */
export function detailLines(e: CatalogEffects): { text: string; tone: 'good' | 'bad'; passive?: boolean }[] {
  const lines: { text: string; tone: 'good' | 'bad'; passive?: boolean }[] = [];
  const push = (v: number, label: string, options: { invert?: boolean; passive?: boolean } = {}): void => {
    if (v === 0) return;
    const beneficial = options.invert ? v < 0 : v > 0;
    const tone: 'good' | 'bad' = beneficial ? 'good' : 'bad';
    const sign = v > 0 ? '+' : '';
    const passive = options.passive ?? false;
    lines.push(passive ? { text: `${sign}${v}% ${label}`, tone, passive } : { text: `${sign}${v}% ${label}`, tone });
  };

  const wearLabels = {
    hull: 'usure coque',
    rig:  'usure gréement',
    sail: 'usure voiles',
    elec: 'usure électro',
  } as const;

  // Active speed effects
  push(pct((e.speedByTwa[0] + e.speedByTwa[1]) / 2), 'vitesse au près');
  push(pct((e.speedByTwa[2] + e.speedByTwa[3] + e.speedByTwa[4]) / 3), 'vitesse au portant');
  push(pct(e.speedByTws[0]), 'vitesse par vent léger');
  push(pct(e.speedByTws[1]), 'vitesse par vent moyen');
  push(pct(e.speedByTws[2]), 'vitesse par grand vent');

  // Active maneuvers per type
  const maneuverTypes: ManeuverKey[] = ['tack', 'gybe', 'sailChange'];
  for (const k of maneuverTypes) {
    const m = e.maneuverMul?.[k];
    if (!m) continue;
    const label = MANEUVER_LABEL[k];
    push(pct(m.dur - 1), `temps ${label}`, { invert: true });
    push(pct(m.speed - 1), `vitesse pendant ${label}`);
  }

  // Active wear (axis by axis so bonuses show too)
  for (const axis of ['hull', 'rig', 'sail', 'elec'] as const) {
    const v = e.wearMul?.[axis];
    if (typeof v !== 'number' || v === 1) continue;
    push(pct(v - 1), wearLabels[axis], { invert: true });
  }

  // Passive effects (always on, regardless of activation window)
  const p = e.passiveEffects;
  if (p) {
    if (p.speedByTwa) {
      push(pct((p.speedByTwa[0] + p.speedByTwa[1]) / 2), 'vitesse au près', { passive: true });
      push(pct((p.speedByTwa[2] + p.speedByTwa[3] + p.speedByTwa[4]) / 3), 'vitesse au portant', { passive: true });
    }
    if (p.speedByTws) {
      push(pct(p.speedByTws[0]), 'vitesse par vent léger', { passive: true });
      push(pct(p.speedByTws[1]), 'vitesse par vent moyen', { passive: true });
      push(pct(p.speedByTws[2]), 'vitesse par grand vent', { passive: true });
    }
    for (const axis of ['hull', 'rig', 'sail', 'elec'] as const) {
      const v = p.wearMul?.[axis];
      if (typeof v !== 'number' || v === 1) continue;
      push(pct(v - 1), wearLabels[axis], { invert: true, passive: true });
    }
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
  const addPassive = (p: PassiveEffects | undefined): void => {
    if (!p) return;
    if (p.speedByTwa) {
      for (let i = 0; i < 5; i++) out.speedByTwa[i] = (out.speedByTwa[i] ?? 0) + (p.speedByTwa[i] ?? 0);
    }
    if (p.speedByTws) {
      for (let i = 0; i < 3; i++) out.speedByTws[i] = (out.speedByTws[i] ?? 0) + (p.speedByTws[i] ?? 0);
    }
    if (p.wearMul && out.wearMul) {
      if (typeof p.wearMul.hull === 'number') out.wearMul.hull = (out.wearMul.hull ?? 1) * p.wearMul.hull;
      if (typeof p.wearMul.rig  === 'number') out.wearMul.rig  = (out.wearMul.rig  ?? 1) * p.wearMul.rig;
      if (typeof p.wearMul.sail === 'number') out.wearMul.sail = (out.wearMul.sail ?? 1) * p.wearMul.sail;
      if (typeof p.wearMul.elec === 'number') out.wearMul.elec = (out.wearMul.elec ?? 1) * p.wearMul.elec;
    }
  };

  for (const it of items) {
    const e = it.effects;
    if (!e) continue;
    // Active effects (we display worst-case: as if always active)
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
    // Passive drag / wear are always on — stack on top of active
    addPassive(e.passiveEffects);
  }
  return out;
}

/** Bars shown on boat detail use effective (active + passive) values. */
export function effectiveForDisplay(e: CatalogEffects): CatalogEffects {
  return mergePassive(e);
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
    const activeLines = lines.filter((l) => !l.passive);
    const passiveLines = lines.filter((l) => l.passive);
    return (
      <ul className={styles.textList} aria-label="Effets principaux">
        {activeLines.map((l, i) => (
          <li key={`eff-${i}`} className={`${styles.textItem} ${l.tone === 'good' ? styles.pctGood : styles.pctBad}`}>
            {l.text}
          </li>
        ))}
        {passiveLines.length > 0 && (
          <li className={`${styles.textItem} ${styles.textSectionLabel}`}>Toujours actif :</li>
        )}
        {passiveLines.map((l, i) => (
          <li key={`pass-${i}`} className={`${styles.textItem} ${styles.textPassive} ${l.tone === 'good' ? styles.pctGood : styles.pctBad}`}>
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
