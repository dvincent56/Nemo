'use client';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import styles from './RouterControls.module.css';

const PRESET_VALUES: Array<'FAST' | 'BALANCED' | 'HIGHRES'> = ['FAST', 'BALANCED', 'HIGHRES'];

interface Props {
  disabled: boolean;
}

export default function RouterControls({ disabled }: Props): React.ReactElement {
  const t = useTranslations('play.routerControls');
  const preset = useGameStore((s) => s.router.preset);
  const coast = useGameStore((s) => s.router.coastDetection);
  const cone = useGameStore((s) => s.router.coneHalfDeg);
  const setPreset = useGameStore((s) => s.setRouterPreset);
  const setCoast = useGameStore((s) => s.setRouterCoastDetection);
  const setCone = useGameStore((s) => s.setRouterConeHalfDeg);

  const presetLabel = (v: typeof PRESET_VALUES[number]): string => {
    if (v === 'FAST') return t('presetFast');
    if (v === 'BALANCED') return t('presetBalanced');
    return t('presetHires');
  };

  return (
    <div className={styles.controls} aria-disabled={disabled}>
      <div className={styles.fieldLabel}>{t('configLabel')}</div>

      <div className={styles.segToggle} role="tablist" aria-label={t('presetAria')}>
        {PRESET_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            className={`${styles.segBtn} ${preset === v ? styles.segBtnActive : ''}`}
            onClick={() => setPreset(v)}
          >
            {presetLabel(v)}
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
        <span>{t('coastDetection')}</span>
      </label>

      <div className={styles.coneRow}>
        <div className={styles.coneHead}>
          <span>{t('cone')}</span>
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
