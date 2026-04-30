'use client';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { CapOrder } from '@/lib/prog/types';
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
  nowSec,
  index,
  onCancel,
  onSave,
}: CapEditorProps): ReactElement {
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

  const isNew = initialOrder === null;
  const title = isNew
    ? 'NOUVEL ORDRE CAP'
    : `MODIFIER CAP${index !== null ? ` · N°${String(index).padStart(2, '0')}` : ''}`;

  const handleSave = (): void => {
    // When TWA-locked, the order's stored heading must be a TWA in [-180, 180]
    // — the serializer emits `{ twa: heading }` for TWA orders and the engine
    // expects a relative-to-wind angle. Convert from the absolute compass dial
    // value using the current windDir; mirrors Compass.tsx apply() L145-148.
    const storedHeading = twaLock
      ? Math.round(((heading - windDir + 540) % 360) - 180)
      : heading;
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
          <ArrowLeft size={11} strokeWidth={2} /> Annuler
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
            <div className={styles.optTitle}>Verrouiller TWA</div>
            <div className={styles.optSub}>Cap relatif au vent · suit les bascules</div>
          </div>
          <CompassLockToggle locked={twaLock} onToggle={() => setTwaLock(!twaLock)} />
        </div>

        <div>
          <p className={styles.fieldLabel}>HEURE D'EXÉCUTION</p>
          <TimeStepper
            value={time}
            onChange={(t) => setTime(t)}
            minValue={minValueSec}
            nowSec={nowSec}
          />
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;OK
        </button>
      </footer>
    </div>
  );
}
