'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Eyebrow } from '@/components/ui';
import {
  fetchMyUpgrades, fetchMyBoats, sellUpgrade,
  type InventoryItem, type BoatRecord,
} from '@/lib/marina-api';
import { SLOT_LABEL, TIER_LABEL } from '../data';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import styles from './page.module.css';

interface Row {
  item: InventoryItem;
  installedOnBoatName: string | null;
}

export default function InventoryClient(): React.ReactElement {
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
      setLoadError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
    setLoaded(true);
  }, []);

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

  // Split: installed (read-only), available (sellable)
  const available = rows.filter((r) => !r.item.installedOn);
  const installed = rows.filter((r) => r.item.installedOn);

  return (
    <>
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>Inventaire</span>
        </nav>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Ta carrière">Upgrades</Eyebrow>
          <h1 className={styles.title}>Inventaire</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            Tes upgrades en stock. Les items non installés peuvent être revendus
            contre des crédits. Les items installés doivent être retirés d'un
            bateau avant d'être revendus.
          </p>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Disponibles</p>
              <p className={styles.counterValue}>{String(available.length).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Installés</p>
              <p className={styles.counterValue}>{String(installed.length).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Crédits</p>
              <p className={styles.counterValue}>
                {credits.toLocaleString('fr-FR')}<small>cr.</small>
              </p>
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className={styles.errorBanner}>
          <strong>Impossible de charger l'inventaire.</strong> {loadError}.
        </div>
      )}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Disponibles</h2>
          <p className={styles.sectionAside}>
            Revends un item pour récupérer 70% du prix payé. Achats administrateur non remboursés.
          </p>
        </header>
        {loaded && available.length === 0 ? (
          <p className={styles.empty}>Aucun upgrade disponible en stock.</p>
        ) : (
          <div className={styles.list}>
            {available.map(({ item }) => {
              const canSell = item.acquisitionSource === 'PURCHASE';
              return (
                <div key={item.id} className={styles.row}>
                  <div className={styles.rowInfo}>
                    <p className={styles.rowName}>{item.name}</p>
                    <p className={styles.rowMeta}>
                      {item.slot ? SLOT_LABEL[item.slot] : '—'} · {item.tier ? TIER_LABEL[item.tier] : 'Série'}
                      {' · '}Acquis le {new Date(item.acquiredAt).toLocaleDateString('fr-FR')}
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
                        Vendre
                      </button>
                    ) : (
                      <span className={styles.adminTag}>Cadeau</span>
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
          <h2 className={styles.sectionTitle}>Installés</h2>
          <p className={styles.sectionAside}>
            Items actuellement montés sur tes bateaux. Retire-les depuis la marina pour les revendre.
          </p>
        </header>
        {loaded && installed.length === 0 ? (
          <p className={styles.empty}>Aucun upgrade installé sur tes bateaux.</p>
        ) : (
          <div className={styles.list}>
            {installed.map(({ item, installedOnBoatName }) => (
              <div key={item.id} className={`${styles.row} ${styles.rowMuted}`}>
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>{item.name}</p>
                  <p className={styles.rowMeta}>
                    {item.slot ? SLOT_LABEL[item.slot] : '—'} · {item.tier ? TIER_LABEL[item.tier] : 'Série'}
                    {' · Sur '}
                    {item.installedOn ? (
                      <Link href={`/marina/${item.installedOn.boatId}` as Parameters<typeof Link>[0]['href']}>
                        <strong>{installedOnBoatName ?? item.installedOn.boatId.slice(0, 8)}</strong>
                      </Link>
                    ) : '—'}
                  </p>
                </div>
                <div className={styles.rowAction}>
                  <span className={styles.installedTag}>Équipé</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pendingSell && (
        <ConfirmDialog
          open={!!pendingSell}
          title="Vendre cet upgrade ?"
          body={
            <>
              <strong>{pendingSell.name}</strong>{' '}({pendingSell.tier ? TIER_LABEL[pendingSell.tier] : 'Série'}) —
              tu récupères <strong>70% du prix payé</strong>. Action irréversible.
            </>
          }
          confirmLabel="Vendre"
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
