'use client';
import type { ReactElement } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import styles from './ProgBanner.module.css';

export interface ProgBannerProps {
  obsoleteCount: number;
  onDismiss: () => void;
}

export default function ProgBanner({ obsoleteCount, onDismiss }: ProgBannerProps): ReactElement | null {
  if (obsoleteCount <= 0) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.icon}>
        <AlertTriangle size={16} strokeWidth={2} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>
          {obsoleteCount} ORDRE{obsoleteCount > 1 ? 'S' : ''} OBSOLÈTE{obsoleteCount > 1 ? 'S' : ''}
        </div>
        <div className={styles.desc}>
          Heure passée sous le seuil de <b>now + 5min</b>. Sera{obsoleteCount > 1 ? 'nt' : ''} retiré{obsoleteCount > 1 ? 's' : ''} à la confirmation.
        </div>
      </div>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="Fermer l'alerte">
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
