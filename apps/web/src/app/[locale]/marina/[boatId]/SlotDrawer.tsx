'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchMyUpgrades, fetchCatalog, installUpgrade, uninstallUpgrade, buyAndInstall, purchaseUpgrade,
  type CatalogItem, type InventoryItem, type UpgradeSlot, type BoatClass, type PlayerStats,
} from '@/lib/marina-api';
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

function useUnlockRowsBuilder(): (
  criteria: NonNullable<CatalogItem['unlockCriteria']>,
  stats: PlayerStats | null,
) => CriterionRow[] {
  const t = useTranslations('marina.slotDrawer.unlock');
  return (criteria, stats) => {
    const rows: CriterionRow[] = [];
    if (criteria.racesFinished !== undefined) {
      const current = stats?.racesFinished ?? 0;
      rows.push({
        label: t('racesFinished', { n: criteria.racesFinished }),
        met: current >= criteria.racesFinished,
        currentLabel: `${current}`,
      });
    }
    if (criteria.top10Finishes !== undefined) {
      const current = stats?.top10Finishes ?? 0;
      rows.push({
        label: t('top10', { n: criteria.top10Finishes }),
        met: current >= criteria.top10Finishes,
        currentLabel: `${current}`,
      });
    }
    if (criteria.avgRankPctMax !== undefined) {
      const current = stats?.avgRankPct ?? 1;
      rows.push({
        label: t('avgRankPctMax', { pct: Math.round(criteria.avgRankPctMax * 100) }),
        met: current <= criteria.avgRankPctMax,
        currentLabel: `${Math.round(current * 100)}%`,
      });
    }
    if (criteria.currentStreak !== undefined) {
      const current = stats?.currentStreak ?? 0;
      rows.push({
        label: t('currentStreak', { n: criteria.currentStreak }),
        met: current >= criteria.currentStreak,
        currentLabel: `${current}`,
      });
    }
    return rows;
  };
}

interface SlotDrawerProps {
  open: boolean;
  slot: UpgradeSlot;
  boatId: string;
  boatClass: BoatClass;
  installedCatalogId?: string | undefined;
  credits: number;
  onClose: () => void;
  onChanged: () => void;
}

export function SlotDrawer({ open, slot, boatId, boatClass, installedCatalogId, credits, onClose, onChanged }: SlotDrawerProps): React.ReactElement | null {
  const t = useTranslations('marina.slotDrawer');
  const tSlot = useTranslations('marina.slots');
  const tTier = useTranslations('marina.tiers');
  const buildUnlockRows = useUnlockRowsBuilder();

  const [tab, setTab] = useState<'install' | 'buy'>('install');
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
        return compat?.includes(boatClass) ?? false;
      }));
      setCatalog(cat.items.filter((i) =>
        i.slot === slot
        && i.compat.includes(boatClass)
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
          <h3 className={styles.title}>{t('title', { slot: tSlot(slot) })}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('ariaClose')}>✕</button>
        </header>

        <nav className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'install' ? styles.tabActive : ''}`}
            onClick={() => setTab('install')}
          >
            {t('tabInstall', { n: inventory.length })}
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'buy' ? styles.tabActive : ''}`}
            onClick={() => setTab('buy')}
          >
            {t('tabBuy')}
          </button>
        </nav>

        {tab === 'buy' && (
          <div className={styles.creditsBar}>
            <span className={styles.creditsLabel}>{t('creditsAvailable')}</span>
            <span className={styles.creditsValue}>{t('creditsValue', { amount: credits.toLocaleString('fr-FR') })}</span>
          </div>
        )}

        <div className={styles.content}>
          {loading ? (
            <p className={styles.loading}>{t('loading')}</p>
          ) : tab === 'install' ? (
            <>
              {inventory.length === 0 ? (
                <p className={styles.empty}>{t('emptyInstall')}</p>
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
                        <span className={styles.itemTier}>{tTier(item.tier ?? 'SERIE')}</span>
                        {isInstalledHere && (
                          <span className={styles.badgeInstalled}>{t('badgeInstalledHere')}</span>
                        )}
                        {isInstalledElsewhere && (
                          <span className={styles.badgeElsewhere}>{t('badgeInstalledElsewhere')}</span>
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
                          {t('actions.uninstall')}
                        </button>
                      ) : isInstalledElsewhere ? (
                        <button type="button" className={styles.itemBtn} disabled>
                          {t('actions.unavailable')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.itemBtn}
                          onClick={() => handleInstall(item.id)}
                          disabled={busy !== null}
                        >
                          {t('actions.install')}
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
                <p className={styles.empty}>{t('emptyBuy')}</p>
              ) : (
                catalog.map((item) => {
                  const isInstalledOnThisBoat = item.id === installedCatalogId;
                  const copiesAvailable = availableByCatalogId.get(item.id) ?? 0;
                  const canAfford = item.cost === null || credits >= item.cost;
                  const isLocked = item.cost === null;
                  const unlockRows = isLocked && item.unlockCriteria
                    ? buildUnlockRows(item.unlockCriteria, stats)
                    : [];
                  return (
                    <div key={item.id} className={styles.item}>
                      <div className={styles.itemInfo}>
                        <p className={styles.itemName}>{item.name}</p>
                        <p className={styles.itemDesc}>{item.profile}</p>
                        <span className={styles.itemTier}>{tTier(item.tier)}</span>
                        {isInstalledOnThisBoat && (
                          <span className={styles.badgeInstalled}>{t('badgeInstalledHere')}</span>
                        )}
                        {!isInstalledOnThisBoat && copiesAvailable > 0 && (
                          <span className={styles.badgeOwned}>
                            {t('badgeOwned', { n: copiesAvailable })}
                          </span>
                        )}
                        <EffectsSummary effects={item.effects} variant="text" />
                        {unlockRows.length > 0 && (
                          <ul className={styles.unlockList} aria-label={t('ariaUnlock')}>
                            <li className={styles.unlockHeader}>{t('unlockHeader')}</li>
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
                          {item.cost !== null
                            ? t('creditsValue', { amount: item.cost.toLocaleString('fr-FR') })
                            : t('locked')}
                        </span>
                        {item.cost !== null && (
                          isInstalledOnThisBoat || copiesAvailable > 0 ? (
                            <Tooltip
                              text={!canAfford ? t('tooltips.noCredits') : t('tooltips.addToInventory')}
                              position="bottom"
                            >
                              <button
                                type="button"
                                className={styles.itemBtnGhost}
                                onClick={() => setPending({ item, mode: 'buy-stock' })}
                                disabled={busy !== null || !canAfford}
                              >
                                {t('actions.buyStock')}
                              </button>
                            </Tooltip>
                          ) : !canAfford ? (
                            <Tooltip text={t('tooltips.noCredits')} position="bottom">
                              <button
                                type="button"
                                className={styles.itemBtn}
                                disabled
                              >
                                {t('actions.buyAndInstall')}
                              </button>
                            </Tooltip>
                          ) : (
                            <button
                              type="button"
                              className={styles.itemBtn}
                              onClick={() => setPending({ item, mode: 'buy-and-install' })}
                              disabled={busy !== null}
                            >
                              {t('actions.buyAndInstall')}
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
          ? t('confirm.titleBuyInstall')
          : t('confirm.titleBuyStock')}
        body={
          <>
            <strong>{pending.item.name}</strong>{' '}({tTier(pending.item.tier)}){t('confirm.bodyMid')}
            <strong>{t('creditsValue', { amount: pending.item.cost?.toLocaleString('fr-FR') ?? '—' })}</strong>
            {pending.mode === 'buy-and-install'
              ? t('confirm.bodyEndInstall')
              : t('confirm.bodyEndStock')}
          </>
        }
        confirmLabel={pending.mode === 'buy-and-install' ? t('confirm.confirmInstall') : t('confirm.confirmStock')}
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
