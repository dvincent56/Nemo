'use client';
import { useTranslations } from 'next-intl';
import styles from './ConfirmReplaceProgModal.module.css';

interface Props {
  isOpen: boolean;
  pendingCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmReplaceProgModal({
  isOpen, pendingCount, onConfirm, onCancel,
}: Props): React.ReactElement | null {
  const t = useTranslations('play.confirmReplaceProg');
  if (!isOpen) return null;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.title}>{t('title')}</h3>
        <p className={styles.body}>
          {t.rich('bodyMain', {
            n: pendingCount,
            bold: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p className={styles.body}>{t('bodyKeep')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>{t('cancel')}</button>
          <button type="button" className={styles.confirm} onClick={onConfirm}>{t('confirm')}</button>
        </div>
      </div>
    </div>
  );
}
