'use client';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { FinalCapOrder } from '@/lib/prog/types';
import CompassReadouts from '../compass/CompassReadouts';
import CompassDial from '../compass/CompassDial';
import CompassLockToggle from '../compass/CompassLockToggle';
import styles from './Editor.module.css';

export interface FinalCapEditorProps {
  initialOrder: FinalCapOrder | null;
  /** id of the last WP in the chain (used to set the trigger if creating new) */
  lastWpId: string;
  /** 1-based index of the last WP for the display label */
  lastWpIndex: number;
  /** Wind direction (TWD) for the compass tick */
  windDir: number;
  /** Heading default for new orders (current hud.hdg) */
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
  const [heading, setHeading] = useState<number>(initialOrder?.heading ?? defaultHeading);
  const [twaLock, setTwaLock] = useState<boolean>(initialOrder?.twaLock ?? false);

  const isNew = initialOrder === null;
  const title = isNew ? 'NOUVEAU CAP FINAL' : 'MODIFIER CAP FINAL';

  // TWA = signed angle from wind to heading, normalised to [-180, +180].
  const twa = ((heading - windDir + 540) % 360) - 180;

  const handleSave = (): void => {
    const order: FinalCapOrder = {
      id: initialOrder?.id ?? makeId(),
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: lastWpId },
      heading,
      twaLock,
    };
    onSave(order);
  };

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
          <p className={styles.fieldLabel}>DÉCLENCHEUR</p>
          <div style={{
            fontFamily: "'Space Mono', ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 700,
            color: '#c9a227',
            letterSpacing: '0.14em',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(245,240,232,0.12)',
            borderRadius: 4,
            textAlign: 'center',
          }}>
            APRÈS WP {lastWpIndex} (FINAL)
          </div>
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
