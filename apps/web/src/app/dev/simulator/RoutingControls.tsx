'use client';
import styles from './RoutingControls.module.css';
import type { Preset } from '@nemo/routing';

interface Props {
  preset: Preset;
  onSetPreset(p: Preset): void;
  canRoute: boolean;
  isComputing: boolean;
  onRoute(): void;
  boatIds: string[];
  isoVisibleBoatId: string | null;
  onSetIsoBoat(id: string | null): void;
  primaryColorFor(id: string): string;
}

const PRESETS_ORDER: Preset[] = ['FAST', 'BALANCED', 'HIGHRES'];

export function RoutingControls(p: Props) {
  return (
    <div className={styles.bar}>
      <span className={styles.label}>Preset :</span>
      <div className={styles.group}>
        {PRESETS_ORDER.map((name) => (
          <button
            key={name}
            className={name === p.preset ? styles.btnActive : styles.btn}
            onClick={() => p.onSetPreset(name)}
            disabled={p.isComputing}
          >{name}</button>
        ))}
      </div>

      <button
        className={styles.btnRoute}
        onClick={p.onRoute}
        disabled={!p.canRoute || p.isComputing}
      >
        {p.isComputing ? 'Calcul en cours…' : 'Router tous les bateaux'}
      </button>

      <span className={styles.spacer} />

      <span className={styles.label}>Isos :</span>
      <div className={styles.group}>
        <button
          className={p.isoVisibleBoatId === null ? styles.btnActive : styles.btn}
          onClick={() => p.onSetIsoBoat(null)}
        >Aucun</button>
        {p.boatIds.map((id, i) => (
          <button
            key={id}
            className={p.isoVisibleBoatId === id ? styles.btnActive : styles.btn}
            onClick={() => p.onSetIsoBoat(id)}
            style={{ borderLeft: `3px solid ${p.primaryColorFor(id)}` }}
          >B{i + 1}</button>
        ))}
      </div>
    </div>
  );
}
