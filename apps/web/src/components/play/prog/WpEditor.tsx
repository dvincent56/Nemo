'use client';
import { useEffect, type ReactElement } from 'react';
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
  initialOrder, index, predecessorIndex: _predecessorIndex, boat: _boat, minWpDistanceNm,
  onCancel, onSave,
}: WpEditorProps): ReactElement {
  const isNew = initialOrder === null;
  const pickingWp = useGameStore((s) => s.prog.pickingWp);
  const setPickingWp = useGameStore((s) => s.setPickingWp);

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
    // captureRadiusNm is preserved from initialOrder — it's still part of the
    // engine model (default 0.5 NM) but is no longer player-editable from
    // this UI. The trigger field (IMMEDIATE / AT_WAYPOINT) is also a derived
    // chain property, not something the player picks — both fields were
    // removed from the editor surface.
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
          <div>
            <p className={styles.fieldLabel}>POSITION</p>
            <div className={wpStyles.coordReadout}>
              {initialOrder!.lat.toFixed(4)}° · {initialOrder!.lon.toFixed(4)}°
            </div>
            <p className={wpStyles.coordHint}>
              Glissez le marker sur la carte pour déplacer.
            </p>
          </div>
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
