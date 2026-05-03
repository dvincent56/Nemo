'use client';
import { useEffect, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WpOrder } from '@/lib/prog/types';
import { useGameStore } from '@/lib/store';
import styles from './Editor.module.css';
import wpStyles from './WpEditor.module.css';

export interface WpEditorProps {
  initialOrder: WpOrder | null;
  index: number | null;
  predecessorIndex: number | null;
  boat: { lat: number; lon: number };
  minWpDistanceNm: number;
  onCancel: () => void;
  onSave: (order: WpOrder) => void;
}

export default function WpEditor({
  initialOrder, index, predecessorIndex: _predecessorIndex, boat: _boat, minWpDistanceNm,
  onCancel, onSave,
}: WpEditorProps): ReactElement {
  const t = useTranslations('play.progEditor');
  const isNew = initialOrder === null;
  const pickingWp = useGameStore((s) => s.prog.pickingWp);
  const setPickingWp = useGameStore((s) => s.setPickingWp);

  const title = isNew ? t('wp.titleNew') : t('wp.titleEdit', { n: index ?? '' });

  useEffect(() => {
    return () => {
      if (useGameStore.getState().prog.pickingWp) {
        useGameStore.getState().setPickingWp(false);
      }
    };
  }, []);

  const handleSave = (): void => {
    if (!initialOrder) return;
    onSave({ ...initialOrder });
  };

  const handleCancel = (): void => {
    setPickingWp(false);
    onCancel();
  };

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backBtn} onClick={handleCancel}>
          <ArrowLeft size={11} strokeWidth={2} /> {t('back')}
        </button>
        <h3 className={styles.title}>{title}</h3>
        <span style={{ width: 70 }} />
      </header>

      <div className={styles.body}>
        {isNew ? (
          <div>
            <p className={styles.fieldLabel}>{t('wp.position')}</p>
            <button
              type="button"
              className={wpStyles.pickBtn}
              onClick={() => setPickingWp(true)}
              disabled={pickingWp}
            >
              {pickingWp ? t('wp.pickInProgress') : t('wp.pickStart')}
            </button>
            <p className={wpStyles.coordHint}>
              {t('wp.minDistance', { n: minWpDistanceNm })}
            </p>
          </div>
        ) : (
          <div>
            <p className={styles.fieldLabel}>{t('wp.position')}</p>
            <div className={wpStyles.coordReadout}>
              {initialOrder!.lat.toFixed(4)}° · {initialOrder!.lon.toFixed(4)}°
            </div>
            <p className={wpStyles.coordHint}>
              {t('wp.dragHint')}
            </p>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={handleCancel}>
          {t('back')}
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
          disabled={isNew}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;{t('ok')}
        </button>
      </footer>
    </div>
  );
}
