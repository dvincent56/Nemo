'use client';

import { useState, useEffect } from 'react';
import {
  fetchMyUpgrades, fetchCatalog, installUpgrade, uninstallUpgrade, buyAndInstall,
  type CatalogItem, type InventoryItem, type UpgradeSlot, type BoatClass,
} from '@/lib/marina-api';
import { SLOT_LABEL, TIER_LABEL } from '../data';
import styles from './SlotDrawer.module.css';

interface SlotDrawerProps {
  open: boolean;
  slot: UpgradeSlot;
  boatId: string;
  boatClass: string;
  onClose: () => void;
  onChanged: () => void;
}

export function SlotDrawer({ open, slot, boatId, boatClass, onClose, onChanged }: SlotDrawerProps): React.ReactElement | null {
  const [tab, setTab] = useState<'install' | 'buy'>('install');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchMyUpgrades(), fetchCatalog(boatClass)])
      .then(([inv, cat]) => {
        setInventory(inv.inventory.filter((i) =>
          i.slot === slot && !i.installedOn,
        ));
        setCatalog(cat.items.filter((i) =>
          i.slot === slot && i.compat.includes(boatClass as BoatClass) && i.tier !== 'SERIE',
        ));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, slot, boatId, boatClass]);

  if (!open) return null;

  const handleInstall = async (playerUpgradeId: string) => {
    setBusy(playerUpgradeId);
    try {
      await installUpgrade(boatId, playerUpgradeId);
      onChanged();
      onClose();
    } catch (err) {
      console.error('install failed', err);
      setBusy(null);
    }
  };

  const handleBuyAndInstall = async (itemId: string) => {
    setBusy(itemId);
    try {
      await buyAndInstall(itemId, boatId);
      onChanged();
      onClose();
    } catch (err) {
      console.error('buy-and-install failed', err);
      setBusy(null);
    }
  };

  const handleRevertToSerie = async () => {
    setBusy('serie');
    try {
      await uninstallUpgrade(boatId, slot);
      onChanged();
      onClose();
    } catch (err) {
      console.error('uninstall failed', err);
      setBusy(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3 className={styles.title}>Changer — {SLOT_LABEL[slot]}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <nav className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'install' ? styles.tabActive : ''}`}
            onClick={() => setTab('install')}
          >
            Installer ({inventory.length})
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'buy' ? styles.tabActive : ''}`}
            onClick={() => setTab('buy')}
          >
            Acheter
          </button>
        </nav>

        <div className={styles.content}>
          {loading ? (
            <p className={styles.loading}>Chargement…</p>
          ) : tab === 'install' ? (
            <>
              {inventory.length === 0 ? (
                <p className={styles.empty}>Aucun item compatible en inventaire.</p>
              ) : (
                inventory.map((item) => (
                  <div key={item.id} className={styles.item}>
                    <div className={styles.itemInfo}>
                      <p className={styles.itemName}>{item.name}</p>
                      <span className={styles.itemTier}>{TIER_LABEL[item.tier ?? 'SERIE']}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.itemBtn}
                      onClick={() => handleInstall(item.id)}
                      disabled={busy !== null}
                    >
                      Installer
                    </button>
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              {catalog.length === 0 ? (
                <p className={styles.empty}>Aucun item disponible à l'achat.</p>
              ) : (
                catalog.map((item) => (
                  <div key={item.id} className={styles.item}>
                    <div className={styles.itemInfo}>
                      <p className={styles.itemName}>{item.name}</p>
                      <p className={styles.itemDesc}>{item.profile}</p>
                      <span className={styles.itemTier}>{TIER_LABEL[item.tier]}</span>
                    </div>
                    <div className={styles.itemAction}>
                      <span className={styles.itemCost}>
                        {item.cost !== null ? `${item.cost.toLocaleString('fr-FR')} cr.` : 'Verrouillé'}
                      </span>
                      {item.cost !== null && (
                        <button
                          type="button"
                          className={styles.itemBtn}
                          onClick={() => handleBuyAndInstall(item.id)}
                          disabled={busy !== null}
                        >
                          Acheter et installer
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.revertBtn}
            onClick={handleRevertToSerie}
            disabled={busy !== null}
          >
            Revenir au stock (Série)
          </button>
        </footer>
      </aside>
    </div>
  );
}
