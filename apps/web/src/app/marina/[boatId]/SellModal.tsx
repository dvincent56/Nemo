'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sellBoat, type BoatRecord, type InstalledUpgrade } from '@/lib/marina-api';
import { TIER_LABEL } from '../data';
import styles from './SellModal.module.css';

interface SellModalProps {
  open: boolean;
  boat: BoatRecord;
  installedUpgrades: InstalledUpgrade[];
  onClose: () => void;
}

export function SellModal({ open, boat, installedUpgrades, onClose }: SellModalProps): React.ReactElement | null {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const estimatedMin = boat.wins * 500 + boat.podiums * 150 + boat.top10Finishes * 30;

  const handleSell = async () => {
    setBusy(true);
    try {
      await sellBoat(boat.id);
      router.push('/marina');
    } catch (err) {
      console.error('sell failed', err);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      <h2 className={styles.title}>Vendre {boat.name} ?</h2>
      <p className={styles.warning}>Cette action est irréversible.</p>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Palmarès du bateau</h3>
        <div className={styles.palmaresGrid}>
          <span>{boat.racesCount} courses</span>
          <span>{boat.wins} victoire{boat.wins !== 1 ? 's' : ''}</span>
          <span>{boat.podiums} podium{boat.podiums !== 1 ? 's' : ''}</span>
          <span>{boat.top10Finishes} top 10</span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Crédits estimés</h3>
        <p className={styles.price}>{estimatedMin > 0 ? `≥ ${estimatedMin.toLocaleString('fr-FR')} cr.` : '0 cr.'}</p>
        {estimatedMin === 0 && <p className={styles.priceNote}>Aucun palmarès — pas de gain.</p>}
      </div>

      {installedUpgrades.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Upgrades retournés en inventaire ({installedUpgrades.length})</h3>
          <ul className={styles.upgradeList}>
            {installedUpgrades.map((u) => (
              <li key={u.playerUpgradeId} className={styles.upgradeItem}>
                ▸ {u.name} ({TIER_LABEL[u.tier]})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onClose}>Annuler</button>
        <button
          type="button"
          className={styles.btnSell}
          onClick={handleSell}
          disabled={busy}
        >
          Vendre{estimatedMin > 0 ? ` (+${estimatedMin.toLocaleString('fr-FR')} cr.)` : ''}
        </button>
      </div>
    </dialog>
  );
}
