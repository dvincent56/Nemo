'use client';
import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './ProgFooter.module.css';

export interface ProgFooterProps {
  isDirty: boolean;
  obsoleteCount: number;
  onCancelAll: () => void;
  onConfirm: () => void;
}

export default function ProgFooter({ isDirty, obsoleteCount, onCancelAll, onConfirm }: ProgFooterProps): ReactElement {
  const t = useTranslations('play.progFooter');
  return (
    <footer className={`${styles.footer} ${isDirty ? styles.dirty : ''}`}>
      <div className={styles.status}>
        {isDirty ? (
          <>
            <span className={styles.dot} />
            <span>
              {t('dirtyMain')}
              {obsoleteCount > 0 ? t('dirtyExtra', { n: obsoleteCount }) : ''}
            </span>
          </>
        ) : (
          <>
            <Check size={14} strokeWidth={2.5} />
            <span>{t('clean')}</span>
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
          {t('cancel')}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.confirm}`}
          onClick={onConfirm}
          disabled={!isDirty}
        >
          <Check size={14} strokeWidth={2.5} />
          &nbsp;{t('confirm')}
        </button>
      </div>
    </footer>
  );
}
