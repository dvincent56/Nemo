'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  fetchMyUpgrades, fetchCatalog, installUpgrade, uninstallUpgrade, buyAndInstall, purchaseUpgrade,
  type CatalogItem, type InventoryItem, type UpgradeSlot, type BoatClass,
} from '@/lib/marina-api';
import { SLOT_LABEL, TIER_LABEL } from '../data';
import styles from './SlotDrawer.module.css';

interface SlotDrawerProps {
  open: boolean;
  slot: UpgradeSlot;
  boatId: string;
  boatClass: string;
  /** Catalog id currently installed in this slot on this boat (to show badge + Retirer action). */
  installedCatalogId?: string | undefined;
  onClose: () => void;
  onChanged: () => void;
}

export function SlotDrawer({ open, slot, boatId, boatClass, installedCatalogId, onClose, onChanged }: SlotDrawerProps): React.ReactElement | null {
  const [tab, setTab] = useState<'install' | 'buy'>('install');
  // All inventory items for this slot+class (compatible), including the one installed on this boat
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchMyUpgrades(), fetchCatalog()])
      .then(([inv, cat]) => {
        const compatByCatalogId = new Map(cat.items.map((i) => [i.id, i.compat]));
        setInventory(inv.inventory.filter((i) => {
          if (i.slot !== slot) return false;
          const compat = compatByCatalogId.get(i.upgradeCatalogId);
          return compat?.includes(boatClass as BoatClass) ?? false;
        }));
        setCatalog(cat.items.filter((i) =>
          i.slot === slot
          && i.compat.includes(boatClass as BoatClass)
          && i.tier !== 'SERIE',
        ));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, slot, boatId, boatClass]);

  // How many copies of each catalog id the player owns that are NOT installed
  const availableByCatalogId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of inventory) {
      if (i.installedOn) continue;
      counts.set(i.upgradeCatalogId, (counts.get(i.upgradeCatalogId) ?? 0) + 1);
    }
    return counts;
  }, [inventory]);

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

  const handleUninstall = async () => {
    setBusy('uninstall');
    try {
      await uninstallUpgrade(boatId, slot);
      onChanged();
      onClose();
    } catch (err) {
      console.error('uninstall failed', err);
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

  const handlePurchaseOnly = async (itemId: string) => {
    setBusy(itemId);
    try {
      await purchaseUpgrade(itemId);
      onChanged();
      // Keep drawer open, switch to install tab so the user sees the new inventory item
      setTab('install');
      setBusy(null);
    } catch (err) {
      console.error('purchase failed', err);
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
                inventory.map((item) => {
                  const isInstalledHere =
                    item.installedOn?.boatId === boatId && item.installedOn.slot === slot;
                  const isInstalledElsewhere = !isInstalledHere && !!item.installedOn;
                  return (
                    <div key={item.id} className={styles.item}>
                      <div className={styles.itemInfo}>
                        <p className={styles.itemName}>{item.name}</p>
                        <span className={styles.itemTier}>{TIER_LABEL[item.tier ?? 'SERIE']}</span>
                        {isInstalledHere && (
                          <span className={styles.badgeInstalled}>Installé sur ce bateau</span>
                        )}
                        {isInstalledElsewhere && (
                          <span className={styles.badgeElsewhere}>Installé sur un autre bateau</span>
                        )}
                      </div>
                      {isInstalledHere ? (
                        <button
                          type="button"
                          className={styles.itemBtn}
                          onClick={handleUninstall}
                          disabled={busy !== null}
                        >
                          Retirer
                        </button>
                      ) : isInstalledElsewhere ? (
                        <button type="button" className={styles.itemBtn} disabled>
                          Indisponible
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.itemBtn}
                          onClick={() => handleInstall(item.id)}
                          disabled={busy !== null}
                        >
                          Installer
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </>
          ) : (
            <>
              {catalog.length === 0 ? (
                <p className={styles.empty}>Aucun item disponible à l'achat.</p>
              ) : (
                catalog.map((item) => {
                  const isInstalledOnThisBoat = item.id === installedCatalogId;
                  const copiesAvailable = availableByCatalogId.get(item.id) ?? 0;
                  return (
                    <div key={item.id} className={styles.item}>
                      <div className={styles.itemInfo}>
                        <p className={styles.itemName}>{item.name}</p>
                        <p className={styles.itemDesc}>{item.profile}</p>
                        <span className={styles.itemTier}>{TIER_LABEL[item.tier]}</span>
                        {isInstalledOnThisBoat && (
                          <span className={styles.badgeInstalled}>Installé sur ce bateau</span>
                        )}
                        {!isInstalledOnThisBoat && copiesAvailable > 0 && (
                          <span className={styles.badgeOwned}>
                            {copiesAvailable === 1 ? '1 en inventaire' : `${copiesAvailable} en inventaire`}
                          </span>
                        )}
                      </div>
                      <div className={styles.itemAction}>
                        <span className={styles.itemCost}>
                          {item.cost !== null ? `${item.cost.toLocaleString('fr-FR')} cr.` : 'Verrouillé'}
                        </span>
                        {item.cost !== null && (
                          isInstalledOnThisBoat || copiesAvailable > 0 ? (
                            <button
                              type="button"
                              className={styles.itemBtnGhost}
                              onClick={() => handlePurchaseOnly(item.id)}
                              disabled={busy !== null}
                              title="Ajouter une copie à ton inventaire"
                            >
                              Acheter (stock)
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.itemBtn}
                              onClick={() => handleBuyAndInstall(item.id)}
                              disabled={busy !== null}
                            >
                              Acheter et installer
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {installedCatalogId && (
          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.revertBtn}
              onClick={handleUninstall}
              disabled={busy !== null}
            >
              Revenir au stock (Série)
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
