'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchMyUpgrades, fetchCatalog, installUpgrade, uninstallUpgrade, buyAndInstall, purchaseUpgrade,
  type CatalogItem, type InventoryItem, type UpgradeSlot, type BoatClass, type PlayerStats,
} from '@/lib/marina-api';
import { SLOT_LABEL, TIER_LABEL } from '../data';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import Tooltip from '@/components/ui/Tooltip';
import { EffectsSummary } from './EffectsSummary';
import styles from './SlotDrawer.module.css';

type PendingPurchase = { item: CatalogItem; mode: 'buy-and-install' | 'buy-stock' } | null;

interface CriterionRow {
  label: string;
  met: boolean;
  currentLabel: string;
}

function renderUnlockRows(
  criteria: NonNullable<CatalogItem['unlockCriteria']>,
  stats: PlayerStats | null,
): CriterionRow[] {
  const rows: CriterionRow[] = [];
  if (criteria.racesFinished !== undefined) {
    const current = stats?.racesFinished ?? 0;
    rows.push({
      label: `${criteria.racesFinished} courses finies`,
      met: current >= criteria.racesFinished,
      currentLabel: `${current}`,
    });
  }
  if (criteria.top10Finishes !== undefined) {
    const current = stats?.top10Finishes ?? 0;
    rows.push({
      label: `${criteria.top10Finishes} top 10`,
      met: current >= criteria.top10Finishes,
      currentLabel: `${current}`,
    });
  }
  if (criteria.avgRankPctMax !== undefined) {
    const current = stats?.avgRankPct ?? 1;
    rows.push({
      label: `Classement moyen ≤ ${Math.round(criteria.avgRankPctMax * 100)}%`,
      met: current <= criteria.avgRankPctMax,
      currentLabel: `${Math.round(current * 100)}%`,
    });
  }
  if (criteria.currentStreak !== undefined) {
    const current = stats?.currentStreak ?? 0;
    rows.push({
      label: `Série en cours ≥ ${criteria.currentStreak}`,
      met: current >= criteria.currentStreak,
      currentLabel: `${current}`,
    });
  }
  return rows;
}

interface SlotDrawerProps {
  open: boolean;
  slot: UpgradeSlot;
  boatId: string;
  boatClass: string;
  /** Catalog id currently installed in this slot on this boat (to show badge + Retirer action). */
  installedCatalogId?: string | undefined;
  /** Player credits, shown in the Buy tab as a budget reminder. */
  credits: number;
  onClose: () => void;
  onChanged: () => void;
}

export function SlotDrawer({ open, slot, boatId, boatClass, installedCatalogId, credits, onClose, onChanged }: SlotDrawerProps): React.ReactElement | null {
  const [tab, setTab] = useState<'install' | 'buy'>('install');
  // All inventory items for this slot+class (compatible), including the one installed on this boat
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPurchase>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);

  const loadDrawerData = useCallback(async () => {
    try {
      const [inv, cat] = await Promise.all([fetchMyUpgrades(), fetchCatalog()]);
      setStats(inv.stats);
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
    } finally {
      setLoading(false);
    }
  }, [slot, boatClass]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadDrawerData().catch((err) => console.error('drawer load failed', err));
  }, [open, loadDrawerData]);

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
      await loadDrawerData();
    } catch (err) {
      console.error('install failed', err);
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async () => {
    setBusy('uninstall');
    try {
      await uninstallUpgrade(boatId, slot);
      onChanged();
      await loadDrawerData();
    } catch (err) {
      console.error('uninstall failed', err);
    } finally {
      setBusy(null);
    }
  };

  const handleBuyAndInstall = async (itemId: string) => {
    setBusy(itemId);
    try {
      await buyAndInstall(itemId, boatId);
      onChanged();
      await loadDrawerData();
    } catch (err) {
      console.error('buy-and-install failed', err);
    } finally {
      setBusy(null);
    }
  };

  const handlePurchaseOnly = async (itemId: string) => {
    setBusy(itemId);
    try {
      await purchaseUpgrade(itemId);
      onChanged();
      await loadDrawerData();
      setTab('install');
    } catch (err) {
      console.error('purchase failed', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
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

        {tab === 'buy' && (
          <div className={styles.creditsBar}>
            <span className={styles.creditsLabel}>Crédits disponibles</span>
            <span className={styles.creditsValue}>{credits.toLocaleString('fr-FR')} cr.</span>
          </div>
        )}

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
                  const catalogMatch = catalog.find((c) => c.id === item.upgradeCatalogId);
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
                        <EffectsSummary effects={catalogMatch?.effects ?? null} variant="text" />
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
                  const canAfford = item.cost === null || credits >= item.cost;
                  const isLocked = item.cost === null;
                  const unlockRows = isLocked && item.unlockCriteria
                    ? renderUnlockRows(item.unlockCriteria, stats)
                    : [];
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
                        <EffectsSummary effects={item.effects} variant="text" />
                        {unlockRows.length > 0 && (
                          <ul className={styles.unlockList} aria-label="Critères de déblocage">
                            <li className={styles.unlockHeader}>Nécessite :</li>
                            {unlockRows.map((row, i) => (
                              <li
                                key={`unlock-${i}`}
                                className={`${styles.unlockRow} ${row.met ? styles.unlockMet : styles.unlockPending}`}
                              >
                                <span>{row.label}</span>
                                <span className={styles.unlockCurrent}>{row.currentLabel}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className={styles.itemAction}>
                        <span className={`${styles.itemCost} ${!canAfford ? styles.itemCostUnafford : ''}`}>
                          {item.cost !== null ? `${item.cost.toLocaleString('fr-FR')} cr.` : 'Verrouillé'}
                        </span>
                        {item.cost !== null && (
                          isInstalledOnThisBoat || copiesAvailable > 0 ? (
                            <Tooltip
                              text={!canAfford ? 'Crédits insuffisants' : 'Ajouter une copie à ton inventaire'}
                              position="bottom"
                            >
                              <button
                                type="button"
                                className={styles.itemBtnGhost}
                                onClick={() => setPending({ item, mode: 'buy-stock' })}
                                disabled={busy !== null || !canAfford}
                              >
                                Acheter (stock)
                              </button>
                            </Tooltip>
                          ) : !canAfford ? (
                            <Tooltip text="Crédits insuffisants" position="bottom">
                              <button
                                type="button"
                                className={styles.itemBtn}
                                disabled
                              >
                                Acheter et installer
                              </button>
                            </Tooltip>
                          ) : (
                            <button
                              type="button"
                              className={styles.itemBtn}
                              onClick={() => setPending({ item, mode: 'buy-and-install' })}
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

      </aside>
    </div>

    {pending && (
      <ConfirmDialog
        open={!!pending}
        title={pending.mode === 'buy-and-install'
          ? `Acheter et installer ?`
          : `Acheter et ajouter à l'inventaire ?`}
        body={
          <>
            <strong>{pending.item.name}</strong>{' '}({TIER_LABEL[pending.item.tier]}) pour{' '}
            <strong>{pending.item.cost?.toLocaleString('fr-FR')} cr.</strong>
            {pending.mode === 'buy-and-install'
              ? ' — l\'item sera installé immédiatement sur ce bateau.'
              : ' — l\'item partira dans ton inventaire.'}
          </>
        }
        confirmLabel={pending.mode === 'buy-and-install' ? 'Acheter et installer' : 'Acheter'}
        disabled={busy !== null}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const { item, mode } = pending;
          setPending(null);
          if (mode === 'buy-and-install') await handleBuyAndInstall(item.id);
          else await handlePurchaseOnly(item.id);
        }}
      />
    )}
    </>
  );
}
