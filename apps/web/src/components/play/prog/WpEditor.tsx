'use client';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Check, AlertTriangle } from 'lucide-react';
import type { WpOrder } from '@/lib/prog/types';
import styles from './Editor.module.css';
import wpStyles from './WpEditor.module.css';

export interface WpEditorProps {
  /** null = creating a new WP (limited in Phase 2a) */
  initialOrder: WpOrder | null;
  /** Index in the wpOrders chain (1-based) — null when creating */
  index: number | null;
  /** For the trigger label — the predecessor's index (1-based), or null for IMMEDIATE */
  predecessorIndex: number | null;
  onCancel: () => void;
  onSave: (order: WpOrder) => void;
}

export default function WpEditor({
  initialOrder, index, predecessorIndex, onCancel, onSave,
}: WpEditorProps): ReactElement {
  const isNew = initialOrder === null;

  const [captureRadiusNm, setCaptureRadiusNm] = useState<number>(initialOrder?.captureRadiusNm ?? 0.5);

  const triggerLabel = predecessorIndex === null ? 'AU DÉPART' : `APRÈS WP ${predecessorIndex}`;
  const title = isNew ? 'NOUVEAU WAYPOINT' : `MODIFIER WP ${index ?? ''}`;

  const handleSave = (): void => {
    if (!initialOrder) return; // can't save NEW in Phase 2a
    onSave({ ...initialOrder, captureRadiusNm });
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
        {isNew ? (
          <div className={wpStyles.banner}>
            <AlertTriangle size={16} strokeWidth={2} />
            <div>
              <div className={wpStyles.bannerTitle}>AJOUT MANUEL INDISPONIBLE</div>
              <div className={wpStyles.bannerDesc}>
                Pour ajouter un waypoint, utilisez le router. Le placement manuel sur la carte arrive en Phase 2b.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div>
              <p className={styles.fieldLabel}>POSITION</p>
              <div className={wpStyles.coordReadout}>
                {initialOrder!.lat.toFixed(4)}° · {initialOrder!.lon.toFixed(4)}°
              </div>
              <p className={wpStyles.coordHint}>
                Édition de la position sur la carte arrive en Phase 2b.
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
              <div className={wpStyles.triggerReadout}>{triggerLabel}</div>
            </div>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onCancel}>
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
