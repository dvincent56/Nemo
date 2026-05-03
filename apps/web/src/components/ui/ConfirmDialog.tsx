'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small reusable confirmation dialog built on top of <dialog>.
 * Clicking the backdrop cancels, Escape cancels (native dialog behavior).
 */
export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel,
  tone = 'primary', disabled = false,
  onConfirm, onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const t = useTranslations('common.actions');
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = cancelLabel ?? t('cancel');

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onCancel}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <h2 className={styles.title}>{title}</h2>
      {body && <div className={styles.body}>{body}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onCancel}>{cancel}</button>
        <button
          type="button"
          className={tone === 'danger' ? styles.btnDanger : styles.btnConfirm}
          onClick={onConfirm}
          disabled={disabled}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
