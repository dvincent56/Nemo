'use client';
import { useEffect } from 'react';
import styles from './Toast.module.css';

export type ToastType = 'info' | 'success' | 'warning';

export interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export default function Toast({
  message,
  type = 'info',
  duration = 5000,
  onClose,
}: ToastProps): React.ReactElement {
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [duration, onClose]);

  return (
    <div className={`${styles.toast} ${styles[type]}`} role="status" aria-live="polite">
      <span className={styles.message}>{message}</span>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer">
        ×
      </button>
    </div>
  );
}
