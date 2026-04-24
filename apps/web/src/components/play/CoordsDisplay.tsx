'use client';

import { useGameStore } from '@/lib/store';
import { formatDMS } from './formatDMS';
import styles from './CoordsDisplay.module.css';

export default function CoordsDisplay(): React.ReactElement {
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);

  return (
    <div className={styles.coords} aria-label="Position">
      <div className={styles.row}>
        <span className={styles.value}>{formatDMS(lat, true)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.value}>{formatDMS(lon, false)}</span>
      </div>
      {/* Mobile : version compacte sur une ligne pour tenir à côté du FAB
          classement sans descendre sous lui. Masquée en desktop via CSS. */}
      <span className={styles.inline}>
        <span className={styles.value}>{formatDMS(lat, true)}</span>
        <span className={styles.inlineSep}>·</span>
        <span className={styles.value}>{formatDMS(lon, false)}</span>
      </span>
    </div>
  );
}
