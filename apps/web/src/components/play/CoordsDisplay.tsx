'use client';

import { useGameStore } from '@/lib/store';
import styles from './CoordsDisplay.module.css';

function formatDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(2);
  const dir = isLat
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'O');
  return `${deg}°${min}'${dir}`;
}

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
    </div>
  );
}
