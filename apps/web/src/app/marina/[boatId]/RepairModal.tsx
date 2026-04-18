'use client';

import { useRef, useEffect, useState } from 'react';
import { repairBoat, type BoatRecord } from '@/lib/marina-api';
import styles from './RepairModal.module.css';

interface RepairModalProps {
  open: boolean;
  boat: BoatRecord;
  credits: number;
  onClose: () => void;
  onRepaired: () => void;
}

function estimateAxisCost(condition: number, costPer10: number, tierMul: number): number {
  if (condition >= 100) return 0;
  return (100 - condition) / 10 * costPer10 * tierMul;
}

export function RepairModal({ open, boat, credits, onClose, onRepaired }: RepairModalProps): React.ReactElement | null {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const axes = [
    { label: 'Coque', condition: boat.hullCondition, costPer10: 80 },
    { label: 'Gréement', condition: boat.rigCondition, costPer10: 50 },
    { label: 'Voiles', condition: boat.sailCondition, costPer10: 120 },
    { label: 'Électronique', condition: boat.elecCondition, costPer10: 30 },
  ];
  const total = axes.reduce((sum, a) => sum + estimateAxisCost(a.condition, a.costPer10, 1.0), 0);
  const canAfford = credits >= total;

  const handleRepair = async () => {
    setBusy(true);
    try {
      await repairBoat(boat.id);
      onRepaired();
      onClose();
    } catch (err) {
      console.error('repair failed', err);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      <h2 className={styles.title}>Réparer {boat.name}</h2>

      <div className={styles.axes}>
        {axes.map((a) => {
          const cost = estimateAxisCost(a.condition, a.costPer10, 1.0);
          return (
            <div key={a.label} className={styles.axisRow}>
              <span className={styles.axisLabel}>{a.label} ({a.condition}%)</span>
              <span className={styles.axisCost}>
                {cost > 0 ? `${Math.round(cost).toLocaleString('fr-FR')} cr.` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Total à débiter</span>
          <span className={styles.summaryValue}>{Math.round(total).toLocaleString('fr-FR')} cr.</span>
        </div>
        <div className={styles.summaryRow}>
          <span>Solde après</span>
          <span className={styles.summaryValue}>{(credits - Math.round(total)).toLocaleString('fr-FR')} cr.</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onClose}>Annuler</button>
        <button
          type="button"
          className={styles.btnRepair}
          onClick={handleRepair}
          disabled={busy || !canAfford || total === 0}
        >
          {total === 0 ? 'Déjà en parfait état' : `Réparer (${Math.round(total).toLocaleString('fr-FR')} cr.)`}
        </button>
      </div>
    </dialog>
  );
}
