'use client';
import { useGameStore } from '@/lib/store';
import styles from './RouterControls.module.css';

const PRESETS: Array<{ value: 'FAST' | 'BALANCED' | 'HIGHRES'; label: string }> = [
  { value: 'FAST', label: 'Fast' },
  { value: 'BALANCED', label: 'Équilibré' },
  { value: 'HIGHRES', label: 'Hi-Res' },
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
      <div className={styles.fieldLabel}>Configuration</div>

      <div className={styles.segToggle} role="tablist" aria-label="Préréglage du routeur">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            className={`${styles.segBtn} ${preset === p.value ? styles.segBtnActive : ''}`}
            onClick={() => setPreset(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={coast}
          onChange={(e) => setCoast(e.target.checked)}
        />
        <span className={styles.checkBox} />
        <span>Détection des côtes</span>
      </label>

      <div className={styles.coneRow}>
        <div className={styles.coneHead}>
          <span>Cône</span>
          <strong className={styles.coneValue}>{cone}°</strong>
        </div>
        <input
          className={styles.coneSlider}
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
