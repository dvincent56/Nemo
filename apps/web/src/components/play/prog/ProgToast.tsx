'use client';
import type { ReactElement } from 'react';
import { Info, X } from 'lucide-react';
import styles from './ProgToast.module.css';

export interface ProgToastProps {
  message: string;
  onDismiss: () => void;
}

/**
 * Small transient toast shown at the top of the prog panel. Currently used
 * by the capture-detection desync flow (editor force-closed because its WP
 * was just captured) — but generic enough to surface any one-shot notice.
 * Auto-dismiss is handled by the consumer (ProgPanel).
 */
export default function ProgToast({ message, onDismiss }: ProgToastProps): ReactElement {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.icon}>
        <Info size={14} strokeWidth={2} />
      </span>
      <div className={styles.body}>{message}</div>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Fermer"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
