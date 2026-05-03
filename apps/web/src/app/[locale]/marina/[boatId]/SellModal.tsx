'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { sellBoat, type BoatRecord, type InstalledUpgrade } from '@/lib/marina-api';
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
  const t = useTranslations('marina.sellModal');
  const tCommon = useTranslations('common.actions');
  const tTier = useTranslations('marina.tiers');
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
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <h2 className={styles.title}>{t('title', { name: boat.name })}</h2>
      <p className={styles.warning}>{t('warning')}</p>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('palmaresTitle')}</h3>
        <div className={styles.palmaresGrid}>
          <span>{t('races', { n: boat.racesCount })}</span>
          <span>{t('wins', { n: boat.wins })}</span>
          <span>{t('podiums', { n: boat.podiums })}</span>
          <span>{t('top10', { n: boat.top10Finishes })}</span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('creditsTitle')}</h3>
        <p className={styles.price}>
          {estimatedMin > 0
            ? t('creditsValue', { amount: estimatedMin.toLocaleString('fr-FR') })
            : t('creditsZero')}
        </p>
        {estimatedMin === 0 && <p className={styles.priceNote}>{t('creditsZeroNote')}</p>}
      </div>

      {installedUpgrades.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('upgradesTitle', { n: installedUpgrades.length })}</h3>
          <ul className={styles.upgradeList}>
            {installedUpgrades.map((u) => (
              <li key={u.playerUpgradeId} className={styles.upgradeItem}>
                ▸ {u.name} ({tTier(u.tier)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onClose}>{tCommon('cancel')}</button>
        <button
          type="button"
          className={styles.btnSell}
          onClick={handleSell}
          disabled={busy}
        >
          {estimatedMin > 0
            ? t('sellButtonGain', { amount: estimatedMin.toLocaleString('fr-FR') })
            : t('sellButton')}
        </button>
      </div>
    </dialog>
  );
}
