'use client';
import type { ReactElement } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './ProgBanner.module.css';

export interface ProgBannerProps {
  obsoleteCount: number;
  onDismiss: () => void;
}

export default function ProgBanner({ obsoleteCount, onDismiss }: ProgBannerProps): ReactElement | null {
  const t = useTranslations('play.progBanner');
  if (obsoleteCount <= 0) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.icon}>
        <AlertTriangle size={16} strokeWidth={2} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>
          {t('title', { n: obsoleteCount })}
        </div>
        <div className={styles.desc}>
          {t.rich('desc', {
            n: obsoleteCount,
            bold: (chunks) => <b>{chunks}</b>,
          })}
        </div>
      </div>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label={t('ariaClose')}>
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
