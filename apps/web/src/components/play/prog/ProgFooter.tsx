'use client';
import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import styles from './ProgFooter.module.css';

export interface ProgFooterProps {
  isDirty: boolean;
  obsoleteCount: number;
  onCancelAll: () => void;
  onConfirm: () => void;
}

export default function ProgFooter({ isDirty, obsoleteCount, onCancelAll, onConfirm }: ProgFooterProps): ReactElement {
  return (
    <footer className={`${styles.footer} ${isDirty ? styles.dirty : ''}`}>
      <div className={styles.status}>
        {isDirty ? (
          <>
            <span className={styles.dot} />
            <span>
              Modifications non enregistrées
              {obsoleteCount > 0 ? ` · ${obsoleteCount} obsolète(s)` : ''}
            </span>
          </>
        ) : (
          <>
            <Check size={14} strokeWidth={2.5} />
            <span>Programmation à jour</span>
          </>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.cancel}`}
          onClick={onCancelAll}
          disabled={!isDirty}
        >
          Annuler
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.confirm}`}
          onClick={onConfirm}
          disabled={!isDirty}
        >
          <Check size={14} strokeWidth={2.5} />
          &nbsp;CONFIRMER
        </button>
      </div>
    </footer>
  );
}
