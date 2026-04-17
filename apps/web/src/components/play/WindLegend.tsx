'use client';

import { useGameStore } from '@/lib/store';
import styles from './WindLegend.module.css';

export default function WindLegend(): React.ReactElement | null {
  const windOn = useGameStore((s) => s.layers.wind);
  const swellOn = useGameStore((s) => s.layers.swell);

  if (!windOn && !swellOn) return null;

  return (
    <div className={styles.legend} aria-label={windOn ? 'Échelle vent' : 'Échelle houle'}>
      <span className={styles.label}>{windOn ? 'Vent' : 'Houle'}</span>
      <div className={`${styles.bar} ${windOn ? styles.windBar : styles.swellBar}`} />
      <span className={styles.ticks}>
        {windOn ? '0 · 40 nds' : '0 · 6 m'}
      </span>
    </div>
  );
}
