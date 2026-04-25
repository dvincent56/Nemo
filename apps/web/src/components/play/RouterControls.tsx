'use client';
import { useGameStore } from '@/lib/store';
import styles from './RouterControls.module.css';

const PRESETS: Array<{ value: 'FAST' | 'BALANCED' | 'HIGHRES'; label: string }> = [
  { value: 'FAST', label: 'FAST' },
  { value: 'BALANCED', label: 'EQUIL.' },
  { value: 'HIGHRES', label: 'HI-RES' },
];

interface Props {
  disabled: boolean;
}

export default function RouterControls({ disabled }: Props): React.ReactElement {
  const preset = useGameStore((s) => s.router.preset);
  const coast = useGameStore((s) => s.router.coastDetection);
  const cone = useGameStore((s) => s.router.coneHalfDeg);
  const setPreset = useGameStore((s) => s.setRouterPreset);
  const setCoast = useGameStore((s) => s.setRouterCoastDetection);
  const setCone = useGameStore((s) => s.setRouterConeHalfDeg);

  return (
    <div className={styles.controls} aria-disabled={disabled}>
      <div className={styles.label}>Configuration</div>

      <div className={styles.presetRow}>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            className={`${styles.presetBtn} ${preset === p.value ? styles.presetActive : ''}`}
            onClick={() => setPreset(p.value)}
          >{p.label}</button>
        ))}
      </div>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={coast}
          onChange={(e) => setCoast(e.target.checked)}
        />
        <span>Détection des côtes</span>
      </label>

      <div className={styles.coneRow}>
        <span>Cône <strong>{cone}°</strong> (demi-angle)</span>
        <input
          type="range"
          min={30}
          max={180}
          step={5}
          disabled={disabled}
          value={cone}
          onChange={(e) => setCone(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
