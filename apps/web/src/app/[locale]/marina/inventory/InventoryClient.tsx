'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eyebrow } from '@/components/ui';
import {
  fetchMyUpgrades, fetchMyBoats, sellUpgrade,
  type InventoryItem, type BoatRecord,
} from '@/lib/marina-api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import styles from './page.module.css';

interface Row {
  item: InventoryItem;
  installedOnBoatName: string | null;
}

export default function InventoryClient(): React.ReactElement {
  const t = useTranslations('marina.inventory');
  const tMarina = useTranslations('marina');
  const tSlot = useTranslations('marina.slots');
  const tTier = useTranslations('marina.tiers');
  const [rows, setRows] = useState<Row[]>([]);
  const [credits, setCredits] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingSell, setPendingSell] = useState<InventoryItem | null>(null);

  const load = useCallback(async () => {
    try {
      const [invData, boatsData] = await Promise.all([fetchMyUpgrades(), fetchMyBoats()]);
      const boatNameById = new Map<string, string>(boatsData.boats.map((b: BoatRecord) => [b.id, b.name]));
      setRows(invData.inventory.map((item) => ({
        item,
        installedOnBoatName: item.installedOn ? (boatNameById.get(item.installedOn.boatId) ?? null) : null,
      })));
      setCredits(invData.credits);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : tMarina('errorUnknown'));
    }
    setLoaded(true);
  }, [tMarina]);

  useEffect(() => { load(); }, [load]);

  const handleSell = async (upgradeId: string) => {
    setBusy(upgradeId);
    try {
      await sellUpgrade(upgradeId);
      await load();
    } catch (err) {
      console.error('sell upgrade failed', err);
    } finally {
      setBusy(null);
    }
  };

  const available = rows.filter((r) => !r.item.installedOn);
  const installed = rows.filter((r) => r.item.installedOn);

  return (
    <>
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label={t('ariaCrumbs')}>
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>{t('crumbBack')}</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>{t('crumbCurrent')}</span>
        </nav>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('eyebrowTrailing')}>{t('eyebrow')}</Eyebrow>
          <h1 className={styles.title}>{t('title')}</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>{t('heroLede')}</p>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>{t('counters.available')}</p>
              <p className={styles.counterValue}>{String(available.length).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>{t('counters.installed')}</p>
              <p className={styles.counterValue}>{String(installed.length).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>{t('counters.credits')}</p>
              <p className={styles.counterValue}>
                {credits.toLocaleString('fr-FR')}<small>{tMarina('counters.creditsUnit')}</small>
              </p>
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className={styles.errorBanner}>
          <strong>{t('errorBanner')}</strong> {loadError}.
        </div>
      )}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('available.title')}</h2>
          <p className={styles.sectionAside}>{t('available.aside')}</p>
        </header>
        {loaded && available.length === 0 ? (
          <p className={styles.empty}>{t('available.empty')}</p>
        ) : (
          <div className={styles.list}>
            {available.map(({ item }) => {
              const canSell = item.acquisitionSource === 'PURCHASE';
              return (
                <div key={item.id} className={styles.row}>
                  <div className={styles.rowInfo}>
                    <p className={styles.rowName}>{item.name}</p>
                    <p className={styles.rowMeta}>
                      {item.slot ? tSlot(item.slot) : t('noSlot')} · {item.tier ? tTier(item.tier) : tTier('SERIE')}
                      {t('available.metaSep')}{t('available.acquiredOn', { date: new Date(item.acquiredAt).toLocaleDateString('fr-FR') })}
                    </p>
                  </div>
                  <div className={styles.rowAction}>
                    {canSell ? (
                      <button
                        type="button"
                        className={styles.sellBtn}
                        onClick={() => setPendingSell(item)}
                        disabled={busy !== null}
                      >
                        {t('available.sell')}
                      </button>
                    ) : (
                      <span className={styles.adminTag}>{t('available.giftTag')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('installed.title')}</h2>
          <p className={styles.sectionAside}>{t('installed.aside')}</p>
        </header>
        {loaded && installed.length === 0 ? (
          <p className={styles.empty}>{t('installed.empty')}</p>
        ) : (
          <div className={styles.list}>
            {installed.map(({ item, installedOnBoatName }) => (
              <div key={item.id} className={`${styles.row} ${styles.rowMuted}`}>
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>{item.name}</p>
                  <p className={styles.rowMeta}>
                    {item.slot ? tSlot(item.slot) : t('noSlot')} · {item.tier ? tTier(item.tier) : tTier('SERIE')}
                    {t('installed.onBoat')}
                    {item.installedOn ? (
                      <Link href={`/marina/${item.installedOn.boatId}` as Parameters<typeof Link>[0]['href']}>
                        <strong>{installedOnBoatName ?? item.installedOn.boatId.slice(0, 8)}</strong>
                      </Link>
                    ) : t('noSlot')}
                  </p>
                </div>
                <div className={styles.rowAction}>
                  <span className={styles.installedTag}>{t('installed.tag')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pendingSell && (
        <ConfirmDialog
          open={!!pendingSell}
          title={t('confirmSell.title')}
          body={
            <>
              <strong>{pendingSell.name}</strong>{' '}({pendingSell.tier ? tTier(pendingSell.tier) : tTier('SERIE')}){t('confirmSell.bodyMid')}
              <strong>{t('confirmSell.bodyEm')}</strong>{t('confirmSell.bodyEnd')}
            </>
          }
          confirmLabel={t('available.sell')}
          tone="danger"
          disabled={busy !== null}
          onCancel={() => setPendingSell(null)}
          onConfirm={async () => {
            const id = pendingSell.id;
            setPendingSell(null);
            await handleSell(id);
          }}
        />
      )}
    </>
  );
}
