'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { WpOrder } from '@/lib/prog/types';
import { useGameStore } from '@/lib/store';
import styles from './Editor.module.css';
import wpStyles from './WpEditor.module.css';

export interface WpEditorProps {
  /** null = creating a new WP — Phase 2b shows the click-on-map picker. */
  initialOrder: WpOrder | null;
  /** Index in the wpOrders chain (1-based) — null when creating */
  index: number | null;
  /** For the trigger label — the predecessor's index (1-based), or null for IMMEDIATE */
  predecessorIndex: number | null;
  /** Boat position — used to display the safety-radius hint. */
  boat: { lat: number; lon: number };
  /** Minimum required distance between boat and WP (NM). */
  minWpDistanceNm: number;
  onCancel: () => void;
  onSave: (order: WpOrder) => void;
}

export default function WpEditor({
  initialOrder, index, predecessorIndex, boat: _boat, minWpDistanceNm,
  onCancel, onSave,
}: WpEditorProps): ReactElement {
  const isNew = initialOrder === null;
  const pickingWp = useGameStore((s) => s.prog.pickingWp);
  const setPickingWp = useGameStore((s) => s.setPickingWp);

  const [captureRadiusNm, setCaptureRadiusNm] = useState<number>(initialOrder?.captureRadiusNm ?? 0.5);

  const triggerLabel = predecessorIndex === null ? 'AU DÉPART' : `APRÈS WP ${predecessorIndex}`;
  const title = isNew ? 'NOUVEAU WAYPOINT' : `MODIFIER WP ${index ?? ''}`;

  // If the user navigates away from the editor (Annuler) while picking is on,
  // make sure to clear the picking state so the cursor doesn't stay crosshair.
  useEffect(() => {
    return () => {
      // Cleanup on unmount — defensively reset picking flag.
      if (useGameStore.getState().prog.pickingWp) {
        useGameStore.getState().setPickingWp(false);
      }
    };
  }, []);

  const handleSave = (): void => {
    if (!initialOrder) return; // NEW path is auto-saved by MapCanvas on map click
    onSave({ ...initialOrder, captureRadiusNm });
  };

  const handleCancel = (): void => {
    setPickingWp(false);
    onCancel();
  };

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backBtn} onClick={handleCancel}>
          <ArrowLeft size={11} strokeWidth={2} /> Annuler
        </button>
        <h3 className={styles.title}>{title}</h3>
        <span style={{ width: 70 }} />
      </header>

      <div className={styles.body}>
        {isNew ? (
          <div>
            <p className={styles.fieldLabel}>POSITION</p>
            <button
              type="button"
              className={wpStyles.pickBtn}
              onClick={() => setPickingWp(true)}
              disabled={pickingWp}
            >
              {pickingWp
                ? 'Cliquer sur la carte…'
                : 'Cliquer sur la carte pour positionner'}
            </button>
            <p className={wpStyles.coordHint}>
              Distance min. requise du bateau : {minWpDistanceNm} NM (rayon de sécurité).
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className={styles.fieldLabel}>POSITION</p>
              <div className={wpStyles.coordReadout}>
                {initialOrder!.lat.toFixed(4)}° · {initialOrder!.lon.toFixed(4)}°
              </div>
              <p className={wpStyles.coordHint}>
                Glissez le marker sur la carte pour déplacer.
              </p>
            </div>

            <div>
              <p className={styles.fieldLabel}>RAYON DE CAPTURE (NM)</p>
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={captureRadiusNm}
                onChange={(e) => setCaptureRadiusNm(Number(e.target.value))}
                className={wpStyles.numInput}
              />
            </div>

            <div>
              <p className={styles.fieldLabel}>DÉCLENCHEUR</p>
              <div className={styles.triggerReadout}>{triggerLabel}</div>
            </div>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={handleCancel}>
          Annuler
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
          disabled={isNew}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;OK
        </button>
      </footer>
    </div>
  );
}
