'use client';

import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import styles from './WindLegend.module.css';

export default function WindLegend(): React.ReactElement | null {
  const t = useTranslations('play.windLegend');
  const windOn = useGameStore((s) => s.layers.wind);
  const swellOn = useGameStore((s) => s.layers.swell);

  if (!windOn && !swellOn) return null;

  return (
    <div className={styles.legend} aria-label={windOn ? t('ariaWind') : t('ariaSwell')}>
      <span className={styles.label}>{windOn ? t('labelWind') : t('labelSwell')}</span>
      <div className={`${styles.bar} ${windOn ? styles.windBar : styles.swellBar}`} />
      <span className={styles.ticks}>
        {windOn ? t('ticksWind') : t('ticksSwell')}
      </span>
    </div>
  );
}
