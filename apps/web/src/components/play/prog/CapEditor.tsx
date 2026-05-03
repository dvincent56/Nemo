'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CapOrder } from '@/lib/prog/types';
import { useGameStore } from '@/lib/store';
import { useThrottledEffect } from '@/hooks/useThrottledEffect';
import CompassReadouts from '../compass/CompassReadouts';
import CompassDial from '../compass/CompassDial';
import CompassLockToggle from '../compass/CompassLockToggle';
import TimeStepper from '../TimeStepper';
import styles from './Editor.module.css';

export interface CapEditorProps {
  /** null = creating a new order */
  initialOrder: CapOrder | null;
  /** Wind direction (TWD) for the compass tick */
  windDir: number;
  /** Heading default for new orders (current hud.hdg) */
  defaultHeading: number;
  /** Default trigger time for new orders (from defaultCapAnchor) */
  defaultTime: number;
  /** Floor for the TimeStepper minValue (now+5min) */
  minValueSec: number;
  /** Ceiling for the TimeStepper maxValue (now+J+5). Optional — when omitted
   *  the stepper has no upper bound. */
  maxValueSec?: number;
  /** Reference time for the relative offset display */
  nowSec: number;
  /** Index in the queue (1-based for display) — null when creating */
  index: number | null;
  onCancel: () => void;
  onSave: (order: CapOrder) => void;
}

function makeId(): string {
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CapEditor({
  initialOrder,
  windDir,
  defaultHeading,
  defaultTime,
  minValueSec,
  maxValueSec,
  nowSec,
  index,
  onCancel,
  onSave,
}: CapEditorProps): ReactElement {
  const t = useTranslations('play.progEditor');
  // When TWA-locked, the stored heading is a TWA in [-180, 180] (so the
  // serializer can emit `{ twa }` and the engine consumes a relative-to-wind
  // angle). The compass dial works in absolute 0..359, so on open we convert
  // back: absHdg = (twa + windDir + 360) % 360. Double `% 360` is required
  // for negative TWA values (e.g. -30 → ((-30 + 220) % 360 + 360) % 360 = 190).
  const initialHeading = (() => {
    if (initialOrder && initialOrder.twaLock) {
      return (((initialOrder.heading + windDir) % 360) + 360) % 360;
    }
    return initialOrder?.heading ?? defaultHeading;
  })();
  const [heading, setHeading] = useState<number>(initialHeading);
  const [twaLock, setTwaLock] = useState<boolean>(initialOrder?.twaLock ?? false);
  const [time, setTime] = useState<number>(initialOrder?.trigger.time ?? defaultTime);

  // The CapOrder is stored with `heading` in TWA frame when twaLock=true (so
  // the engine reads it as relative-to-wind). Mirror handleSave's conversion
  // here so the ghost matches what would be saved on Confirmer.
  const storedHeading = twaLock
    ? Math.round(((heading - windDir + 540) % 360) - 180)
    : heading;

  // Publish a live editor preview to the store. The projection worker splices
  // this ghost into the draft segments so the polyline re-simulates with the
  // in-flight edit; the prog-order-marker-preview layer also slides a
  // distinct marker at trigger.time.
  //
  // Throttled: fire once on the first change, then at most every 100ms. A
  // plain debounce never fired during a fast TimeStepper hold (each pulse
  // cancelled the previous timer). Throttle gives live feedback (immediate
  // first publish) plus a steady ~10 Hz rate during a hold — the worker
  // can keep up and the polyline doesn't flicker.
  const setEditorPreview = useGameStore((s) => s.setEditorPreview);
  useThrottledEffect(() => {
    const ghost: CapOrder = {
      id: initialOrder?.id ?? 'editor-ghost-cap',
      trigger: { type: 'AT_TIME', time },
      heading: storedHeading,
      twaLock,
    };
    setEditorPreview({
      kind: 'cap',
      ghostOrder: ghost,
      replacesId: initialOrder?.id ?? null,
    });
  }, [storedHeading, twaLock, time, initialOrder?.id, setEditorPreview], 100);

  // Unmount-only cleanup: drop the ghost so the projection reverts to the
  // pre-edit draft. Separate from the throttled publisher above so its
  // pending trailing fire is cancelled cleanly when the editor closes.
  useEffect(() => () => setEditorPreview(null), [setEditorPreview]);

  const isNew = initialOrder === null;
  const title = isNew
    ? t('cap.titleNew')
    : index !== null
      ? t('cap.titleEdit', { n: String(index).padStart(2, '0') })
      : t('cap.titleEditNoIndex');

  const handleSave = (): void => {
    // `storedHeading` already encodes the TWA-frame conversion (see the
    // const declaration above) — the serializer emits `{ twa: heading }`
    // when twaLock is true.
    const order: CapOrder = {
      id: initialOrder?.id ?? makeId(),
      trigger: { type: 'AT_TIME', time },
      heading: storedHeading,
      twaLock,
    };
    onSave(order);
  };

  // TWA = signed angle from wind to heading, normalised to [-180, +180].
  const twa = ((heading - windDir + 540) % 360) - 180;

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
          <p className={styles.fieldLabel}>{t('cap.executionTime')}</p>
          <TimeStepper
            value={time}
            onChange={(t) => setTime(t)}
            minValue={minValueSec}
            {...(maxValueSec !== undefined ? { maxValue: maxValueSec } : {})}
            nowSec={nowSec}
          />
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
