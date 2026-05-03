'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import { OCEAN_PRESETS } from '@/lib/mapAppearance';
import styles from './MapAppearanceModal.module.css';

interface MapAppearanceModalProps {
  open: boolean;
  onClose: () => void;
}

export default function MapAppearanceModal({ open, onClose }: MapAppearanceModalProps): React.ReactElement | null {
  const t = useTranslations('play.mapAppearance');
  const oceanPresetId = useGameStore((s) => s.mapAppearance.oceanPresetId);
  const setOceanPreset = useGameStore((s) => s.setOceanPreset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.veil} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('ariaLabel')}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{t('title')}</h2>
          <button className={styles.close} onClick={onClose} aria-label={t('ariaClose')}>✕</button>
        </header>

        <section className={styles.section}>
          <p className={styles.sectionTitle}>{t('section')}</p>
          <div className={styles.swatches}>
            {OCEAN_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.swatch} ${p.id === oceanPresetId ? styles.swatchActive : ''}`}
                style={{ background: p.color }}
                onClick={() => setOceanPreset(p.id)}
                aria-label={p.label}
                title={p.label}
              />
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {t('close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
