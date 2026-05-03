'use client';
import { useEffect, useState } from 'react';
import styles from './RoutingControls.module.css';
import type { Preset } from '@nemo/routing';

interface Props {
  preset: Preset;
  onSetPreset(p: Preset): void;
  coastDetection: boolean;
  onSetCoastDetection(v: boolean): void;
  coneHalfDeg: number;
  onSetConeHalfDeg(v: number): void;
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
  // Local string state so the user can type freely (including intermediate
  // values like "6" on the way to "60"). We only push a validated number up
  // to the parent on blur / Enter; clamping on every keystroke prevented
  // typing any value that started below the min.
  const [coneInput, setConeInput] = useState(String(p.coneHalfDeg));
  useEffect(() => { setConeInput(String(p.coneHalfDeg)); }, [p.coneHalfDeg]);
  const commitCone = () => {
    const n = Number(coneInput);
    if (Number.isFinite(n)) {
      const clamped = Math.min(180, Math.max(30, Math.round(n)));
      p.onSetConeHalfDeg(clamped);
      setConeInput(String(clamped));
    } else {
      setConeInput(String(p.coneHalfDeg));
    }
  };

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

      <div className={styles.expert}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={p.coastDetection}
            onChange={(e) => p.onSetCoastDetection(e.target.checked)}
            disabled={p.isComputing}
          />
          Côtes
        </label>
        <label className={styles.toggle}>
          Cône
          <input
            type="number"
            className={styles.coneInput}
            value={coneInput}
            min={30}
            max={180}
            step={5}
            onChange={(e) => setConeInput(e.target.value)}
            onBlur={commitCone}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            disabled={p.isComputing}
          />
          °
        </label>
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
