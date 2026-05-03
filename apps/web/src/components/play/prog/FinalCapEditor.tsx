'use client';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FinalCapOrder } from '@/lib/prog/types';
import CompassReadouts from '../compass/CompassReadouts';
import CompassDial from '../compass/CompassDial';
import CompassLockToggle from '../compass/CompassLockToggle';
import styles from './Editor.module.css';

export interface FinalCapEditorProps {
  initialOrder: FinalCapOrder | null;
  lastWpId: string;
  lastWpIndex: number;
  windDir: number;
  defaultHeading: number;
  onCancel: () => void;
  onSave: (order: FinalCapOrder) => void;
}

function makeId(): string {
  return `fcap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function FinalCapEditor({
  initialOrder, lastWpId, lastWpIndex, windDir, defaultHeading, onCancel, onSave,
}: FinalCapEditorProps): ReactElement {
  const t = useTranslations('play.progEditor');
  const initialHeading = (() => {
    if (initialOrder && initialOrder.twaLock) {
      return (((initialOrder.heading + windDir) % 360) + 360) % 360;
    }
    return initialOrder?.heading ?? defaultHeading;
  })();
  const [heading, setHeading] = useState<number>(initialHeading);
  const [twaLock, setTwaLock] = useState<boolean>(initialOrder?.twaLock ?? false);

  const isNew = initialOrder === null;
  const title = isNew ? t('finalCap.titleNew') : t('finalCap.titleEdit');

  const twa = ((heading - windDir + 540) % 360) - 180;

  const handleSave = (): void => {
    const storedHeading = twaLock
      ? Math.round(((heading - windDir + 540) % 360) - 180)
      : heading;
    const order: FinalCapOrder = {
      id: initialOrder?.id ?? makeId(),
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: lastWpId },
      heading: storedHeading,
      twaLock,
    };
    onSave(order);
  };

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backBtn} onClick={onCancel}>
          <ArrowLeft size={11} strokeWidth={2} /> {t('back')}
        </button>
        <h3 className={styles.title}>{title}</h3>
        <span style={{ width: 70 }} />
      </header>

      <div className={styles.body}>
        <CompassReadouts
          headingDeg={heading}
          twaDeg={twa}
          vmgGlow={false}
          pendingHint={undefined}
        />

        <div className={styles.compassFrame}>
          <CompassDial
            value={heading}
            onChange={(h) => setHeading(h)}
            windDir={windDir}
            showWindWaves={false}
            showBoat={true}
          />
        </div>

        <div className={styles.optRow}>
          <div className={styles.optLabel}>
            <div className={styles.optTitle}>{t('common.twaLockTitle')}</div>
            <div className={styles.optSub}>{t('common.twaLockSub')}</div>
          </div>
          <CompassLockToggle locked={twaLock} onToggle={() => setTwaLock(!twaLock)} />
        </div>

        <div>
          <p className={styles.fieldLabel}>{t('finalCap.trigger')}</p>
          <div className={styles.triggerReadout}>
            {t('finalCap.afterWpFinal', { n: lastWpIndex })}
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onCancel}>
          {t('back')}
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;{t('ok')}
        </button>
      </footer>
    </div>
  );
}
