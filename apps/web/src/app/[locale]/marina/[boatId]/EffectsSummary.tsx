'use client';

import { useTranslations } from 'next-intl';
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

/** Identifiant de critère affiché dans la jauge — résolu via i18n côté UI. */
type CriterionKey =
  | 'upwind' | 'downwind' | 'lightWind' | 'mediumWind' | 'heavyWind'
  | 'maneuverDur' | 'maneuverSpeed'
  | 'hullWear' | 'rigWear' | 'sailWear' | 'elecWear';

interface Criterion {
  key: CriterionKey;
  /** Raw percentage change — positive = beneficial, negative = detrimental. */
  pct: number;
}

/** Détail neutre d'un effet — codes typés, sans string FR. UI résout via t(). */
type DetailLine =
  | { kind: 'speed'; metric: 'upwind' | 'downwind' | 'lightWind' | 'mediumWind' | 'heavyWind'; pct: number; tone: 'good' | 'bad'; passive?: boolean }
  | { kind: 'maneuverDur'; maneuver: 'tack' | 'gybe' | 'sailChange'; pct: number; tone: 'good' | 'bad'; passive?: boolean }
  | { kind: 'maneuverSpeed'; maneuver: 'tack' | 'gybe' | 'sailChange'; pct: number; tone: 'good' | 'bad'; passive?: boolean }
  | { kind: 'wear'; axis: 'hull' | 'rig' | 'sail' | 'elec'; pct: number; tone: 'good' | 'bad'; passive?: boolean };

/** Note métadonnée — codes typés, sans string FR. */
type ItemNote =
  | { kind: 'activeBetween'; minTws: number; maxTws: number }
  | { kind: 'activeAbove'; minTws: number }
  | { kind: 'activeBelow'; maxTws: number }
  | { kind: 'groundingMul'; mul: number }
  | { kind: 'polarTargets'; deg: number };

const MANEUVER_KEYS: ('tack' | 'gybe' | 'sailChange')[] = ['tack', 'gybe', 'sailChange'];
const WEAR_AXES: ('hull' | 'rig' | 'sail' | 'elec')[] = ['hull', 'rig', 'sail', 'elec'];

function pct(x: number): number {
  return Math.round(x * 100);
}

function tone(value: number, invert = false): 'good' | 'bad' {
  const beneficial = invert ? value < 0 : value > 0;
  return beneficial ? 'good' : 'bad';
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
  const durDeltas: number[] = [];
  const speedDeltas: number[] = [];
  for (const k of MANEUVER_KEYS) {
    const m = e.maneuverMul?.[k];
    if (!m) continue;
    durDeltas.push(1 - m.dur);
    speedDeltas.push(m.speed - 1);
  }
  const durAvg = durDeltas.length ? durDeltas.reduce((a, b) => a + b, 0) / durDeltas.length : 0;
  const speedAvg = speedDeltas.length ? speedDeltas.reduce((a, b) => a + b, 0) / speedDeltas.length : 0;

  return [
    { key: 'upwind',        pct: pct(upwind) },
    { key: 'downwind',      pct: pct(downwind) },
    { key: 'lightWind',     pct: pct(lightWind) },
    { key: 'mediumWind',    pct: pct(mediumWind) },
    { key: 'heavyWind',     pct: pct(heavyWind) },
    { key: 'maneuverDur',   pct: pct(durAvg) },
    { key: 'maneuverSpeed', pct: pct(speedAvg) },
    { key: 'hullWear',      pct: pct(hullWear) },
    { key: 'rigWear',       pct: pct(rigWear) },
    { key: 'sailWear',      pct: pct(sailWear) },
    { key: 'elecWear',      pct: pct(elecWear) },
  ];
}

/**
 * Détaille les effets sous forme de lignes structurées (codes + valeurs).
 * Pas de string FR : la résolution se fait dans le rendu via t().
 */
export function detailLines(e: CatalogEffects): DetailLine[] {
  const lines: DetailLine[] = [];

  const addSpeed = (raw: number, metric: 'upwind' | 'downwind' | 'lightWind' | 'mediumWind' | 'heavyWind', passive?: boolean): void => {
    const v = pct(raw);
    if (v === 0) return;
    lines.push({ kind: 'speed', metric, pct: v, tone: tone(v), ...(passive ? { passive } : {}) });
  };
  const addManeuverDur = (raw: number, maneuver: 'tack' | 'gybe' | 'sailChange', passive?: boolean): void => {
    const v = pct(raw);
    if (v === 0) return;
    // dur < 1 = faster = beneficial → invert tone
    lines.push({ kind: 'maneuverDur', maneuver, pct: v, tone: tone(v, true), ...(passive ? { passive } : {}) });
  };
  const addManeuverSpeed = (raw: number, maneuver: 'tack' | 'gybe' | 'sailChange', passive?: boolean): void => {
    const v = pct(raw);
    if (v === 0) return;
    lines.push({ kind: 'maneuverSpeed', maneuver, pct: v, tone: tone(v), ...(passive ? { passive } : {}) });
  };
  const addWear = (raw: number, axis: 'hull' | 'rig' | 'sail' | 'elec', passive?: boolean): void => {
    const v = pct(raw);
    if (v === 0) return;
    // wear positive = bad (more wear) → invert tone
    lines.push({ kind: 'wear', axis, pct: v, tone: tone(v, true), ...(passive ? { passive } : {}) });
  };

  // Active speed effects
  addSpeed((e.speedByTwa[0] + e.speedByTwa[1]) / 2, 'upwind');
  addSpeed((e.speedByTwa[2] + e.speedByTwa[3] + e.speedByTwa[4]) / 3, 'downwind');
  addSpeed(e.speedByTws[0], 'lightWind');
  addSpeed(e.speedByTws[1], 'mediumWind');
  addSpeed(e.speedByTws[2], 'heavyWind');

  // Active maneuvers per type
  for (const k of MANEUVER_KEYS) {
    const m = e.maneuverMul?.[k];
    if (!m) continue;
    addManeuverDur(m.dur - 1, k);
    addManeuverSpeed(m.speed - 1, k);
  }

  // Active wear (axis by axis)
  for (const axis of WEAR_AXES) {
    const v = e.wearMul?.[axis];
    if (typeof v !== 'number' || v === 1) continue;
    addWear(v - 1, axis);
  }

  // Passive effects
  const p = e.passiveEffects;
  if (p) {
    if (p.speedByTwa) {
      addSpeed((p.speedByTwa[0] + p.speedByTwa[1]) / 2, 'upwind', true);
      addSpeed((p.speedByTwa[2] + p.speedByTwa[3] + p.speedByTwa[4]) / 3, 'downwind', true);
    }
    if (p.speedByTws) {
      addSpeed(p.speedByTws[0], 'lightWind', true);
      addSpeed(p.speedByTws[1], 'mediumWind', true);
      addSpeed(p.speedByTws[2], 'heavyWind', true);
    }
    for (const axis of WEAR_AXES) {
      const v = p.wearMul?.[axis];
      if (typeof v !== 'number' || v === 1) continue;
      addWear(v - 1, axis, true);
    }
  }

  return lines;
}

/** Notes métadonnées (codes), résolues côté UI via t(). */
export function itemNotes(e: CatalogEffects): ItemNote[] {
  const notes: ItemNote[] = [];
  const { minTws, maxTws } = e.activation ?? {};
  if (minTws !== undefined && maxTws !== undefined) {
    notes.push({ kind: 'activeBetween', minTws, maxTws });
  } else if (minTws !== undefined) {
    notes.push({ kind: 'activeAbove', minTws });
  } else if (maxTws !== undefined) {
    notes.push({ kind: 'activeBelow', maxTws });
  }
  if (e.groundingLossMul !== null && e.groundingLossMul < 1) {
    notes.push({ kind: 'groundingMul', mul: e.groundingLossMul });
  }
  if (e.polarTargetsDeg !== null && e.polarTargetsDeg > 0) {
    notes.push({ kind: 'polarTargets', deg: e.polarTargetsDeg });
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
    for (let i = 0; i < 5; i++) out.speedByTwa[i] = (out.speedByTwa[i] ?? 0) + (e.speedByTwa[i] ?? 0);
    for (let i = 0; i < 3; i++) out.speedByTws[i] = (out.speedByTws[i] ?? 0) + (e.speedByTws[i] ?? 0);
    if (e.wearMul && out.wearMul) {
      if (typeof e.wearMul.hull === 'number') out.wearMul.hull = (out.wearMul.hull ?? 1) * e.wearMul.hull;
      if (typeof e.wearMul.rig  === 'number') out.wearMul.rig  = (out.wearMul.rig  ?? 1) * e.wearMul.rig;
      if (typeof e.wearMul.sail === 'number') out.wearMul.sail = (out.wearMul.sail ?? 1) * e.wearMul.sail;
      if (typeof e.wearMul.elec === 'number') out.wearMul.elec = (out.wearMul.elec ?? 1) * e.wearMul.elec;
    }
    if (e.maneuverMul && out.maneuverMul) {
      for (const k of MANEUVER_KEYS) {
        const src = e.maneuverMul[k];
        const dst = out.maneuverMul[k];
        if (src && dst) {
          dst.dur *= src.dur;
          dst.speed *= src.speed;
        }
      }
    }
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
  const toneClass = pct > 0 ? styles.fillGood : pct < 0 ? styles.fillBad : styles.fillNeutre;
  const fillWidth = Math.abs(clamped);
  const fillLeft = pct >= 0 ? 50 : 50 - fillWidth;
  return (
    <div className={styles.track} role="presentation">
      <span className={styles.midline} aria-hidden />
      <span
        className={`${styles.fill} ${toneClass}`}
        style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
      />
    </div>
  );
}

/** Rend une DetailLine en string traduit. Composé par le composant. */
function renderDetailLine(
  line: DetailLine,
  tEffect: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const sign = line.pct > 0 ? '+' : '';
  const fmt = `${sign}${line.pct}%`;
  if (line.kind === 'speed') {
    return `${fmt} ${tEffect(`speed.${line.metric}`)}`;
  }
  if (line.kind === 'maneuverDur') {
    return `${fmt} ${tEffect(`maneuverDur.${line.maneuver}`)}`;
  }
  if (line.kind === 'maneuverSpeed') {
    return `${fmt} ${tEffect(`maneuverSpeed.${line.maneuver}`)}`;
  }
  return `${fmt} ${tEffect(`wear.${line.axis}`)}`;
}

function renderItemNote(
  note: ItemNote,
  tNote: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (note.kind === 'activeBetween') return tNote('activeBetween', { min: note.minTws, max: note.maxTws });
  if (note.kind === 'activeAbove')   return tNote('activeAbove',   { min: note.minTws });
  if (note.kind === 'activeBelow')   return tNote('activeBelow',   { max: note.maxTws });
  if (note.kind === 'groundingMul')  return tNote('groundingMul',  { mul: note.mul });
  return tNote('polarTargets', { deg: note.deg });
}

export function EffectsSummary({ effects, variant = 'bars' }: EffectsSummaryProps): React.ReactElement | null {
  const t = useTranslations('marina.effects');

  if (!effects) return null;

  if (variant === 'text') {
    const lines = detailLines(effects);
    const notes = itemNotes(effects);
    if (lines.length === 0 && notes.length === 0) return null;
    const activeLines = lines.filter((l) => !l.passive);
    const passiveLines = lines.filter((l) => l.passive);
    return (
      <ul className={styles.textList} aria-label={t('ariaText')}>
        {activeLines.map((l, i) => (
          <li key={`eff-${i}`} className={`${styles.textItem} ${l.tone === 'good' ? styles.pctGood : styles.pctBad}`}>
            {renderDetailLine(l, (k, v) => t(`detail.${k}`, v))}
          </li>
        ))}
        {passiveLines.length > 0 && (
          <li className={`${styles.textItem} ${styles.textSectionLabel}`}>{t('alwaysActive')}</li>
        )}
        {passiveLines.map((l, i) => (
          <li key={`pass-${i}`} className={`${styles.textItem} ${styles.textPassive} ${l.tone === 'good' ? styles.pctGood : styles.pctBad}`}>
            {renderDetailLine(l, (k, v) => t(`detail.${k}`, v))}
          </li>
        ))}
        {notes.map((n, i) => (
          <li key={`note-${i}`} className={`${styles.textItem} ${styles.textNote}`}>
            {renderItemNote(n, (k, v) => t(`note.${k}`, v))}
          </li>
        ))}
      </ul>
    );
  }

  const rows = summarizeEffects(effects);
  const significant = rows.filter((r) => r.pct !== 0);
  if (significant.length === 0) return null;

  return (
    <div className={styles.wrapper} aria-label={t('ariaBars')}>
      {rows.map((r) => (
        <div key={r.key} className={styles.row}>
          <span className={styles.label}>{t(`criterion.${r.key}`)}</span>
          <Bar pct={r.pct} />
          <span className={`${styles.pct} ${r.pct > 0 ? styles.pctGood : r.pct < 0 ? styles.pctBad : ''}`}>
            {r.pct > 0 ? '+' : ''}{r.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}
