'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Pagination, BoatSvg } from '@/components/ui';
import Tooltip from '@/components/ui/Tooltip';
import {
  fetchBoatDetail, fetchCatalog,
  type BoatRecord, type InstalledUpgrade, type UpgradeSlot, type SlotAvailability,
} from '@/lib/marina-api';
import {
  CLASS_LABEL,
  type BoatRaceHistoryEntry,
} from '../data';
import { SlotCard } from './SlotCard';
import { SlotDrawer } from './SlotDrawer';
import { RepairModal } from './RepairModal';
import { SellModal } from './SellModal';
import styles from './page.module.css';

const HISTORY_PAGE_SIZE = 5;
const ALL_SLOTS: UpgradeSlot[] = ['HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT'];

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

interface BoatDetailViewProps {
  boatId: string;
}

export default function BoatDetailView({ boatId }: BoatDetailViewProps): React.ReactElement {
  const [boat, setBoat] = useState<BoatRecord | null>(null);
  const [installed, setInstalled] = useState<InstalledUpgrade[]>([]);
  const [credits, setCredits] = useState(0);
  const [slotsByClass, setSlotsByClass] = useState<Record<UpgradeSlot, SlotAvailability> | null>(null);
  const [history, setHistory] = useState<BoatRaceHistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // UI state
  const [drawerSlot, setDrawerSlot] = useState<UpgradeSlot | null>(null);
  const [showRepair, setShowRepair] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [detail, catalog] = await Promise.all([
        fetchBoatDetail(boatId),
        fetchCatalog(),
      ]);
      setBoat(detail.boat);
      setInstalled(detail.installedUpgrades);
      setCredits(detail.credits);
      const cls = detail.boat.boatClass as string;
      if (catalog.slotsByClass[cls]) {
        setSlotsByClass(catalog.slotsByClass[cls] as Record<UpgradeSlot, SlotAvailability>);
      }
      // Race history will come from a dedicated endpoint later
      setHistory([]);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setLoadError(msg);
    }
  }, [boatId]);

  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return (
      <div className={styles.loading}>
        Impossible de charger ce bateau : {loadError}.<br />
        Vérifie que tu es connecté (<a href="/login">/login</a>) et que le game-engine tourne.
      </div>
    );
  }

  if (!boat) {
    return <p className={styles.loading}>Chargement…</p>;
  }

  const inRace = !!boat.activeRaceId;
  const stateLabel = inRace ? `En course · ${boat.activeRaceId}` : 'Au port';
  const stateCls = inRace ? styles.stateInRace : styles.stateIdle;
  const classLabel = CLASS_LABEL[boat.boatClass] ?? boat.boatClass;

  // Stats
  const avgCondition = Math.round(
    (boat.hullCondition + boat.rigCondition + boat.sailCondition + boat.elecCondition) / 4,
  );
  const needsRepair = avgCondition < 100;

  // History pagination
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const visibleHistory = history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  // Installed lookup
  const installedBySlot = new Map(installed.map((u) => [u.slot, u]));

  return (
    <>
      {/* Breadcrumb */}
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>{boat.name}</span>
        </nav>
      </div>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroRender}>
          <BoatSvg
            className={styles.heroRenderSvg}
            hullColor={boat.hullColor ?? '#1a2840'}
            deckColor={boat.deckColor ?? undefined}
            name={boat.name}
            showText
          />
        </div>
        <div className={styles.heroSide}>
          <p className={styles.heroClass}>{classLabel}</p>
          <h1 className={styles.heroName}>{boat.name}</h1>
          <span className={`${styles.heroState} ${stateCls}`}>
            <span className={styles.heroStateDot} aria-hidden />
            {stateLabel}
          </span>

          {/* Action bar */}
          <div className={styles.heroActions}>
            {inRace ? (
              <Tooltip text="Impossible pendant la course" position="top">
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled
                >
                  Personnaliser →
                </button>
              </Tooltip>
            ) : (
              <Link
                href={`/marina/${boat.id}/customize` as Parameters<typeof Link>[0]['href']}
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                Personnaliser →
              </Link>
            )}
            <Tooltip
              text={inRace ? 'Impossible pendant la course' : !needsRepair ? 'Bateau en parfait état' : 'Réparer'}
              position="top"
            >
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setShowRepair(true)}
                disabled={inRace || !needsRepair}
              >
                Réparer
              </button>
            </Tooltip>
            <Tooltip
              text={inRace ? 'Impossible pendant la course' : 'Vendre ce bateau'}
              position="top"
            >
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setShowSell(true)}
                disabled={inRace}
              >
                Vendre
              </button>
            </Tooltip>
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className={styles.statsBand}>
        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Courses</p>
            <p className={styles.statCellValue}>{String(boat.racesCount).padStart(2, '0')}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Podiums</p>
            <p className={`${styles.statCellValue} ${styles.statCellValueGold}`}>{boat.podiums}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Condition moyenne</p>
            <p className={styles.statCellValue}>{avgCondition}%</p>
            <p className={styles.statCellSub}>
              C:{boat.hullCondition} G:{boat.rigCondition} V:{boat.sailCondition} E:{boat.elecCondition}
            </p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Upgrades installés</p>
            <p className={styles.statCellValue}>{installed.length}<small>/7</small></p>
          </div>
        </div>
      </section>

      {/* Slot section */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Performance</p>
            <h2 className={styles.sectionTitle}>Équipement</h2>
          </div>
          <p className={styles.sectionAside}>
            Sept emplacements à configurer. {inRace ? 'Modifications bloquées pendant la course.' : 'Clique « Changer » pour modifier un slot.'}
          </p>
        </div>

        <div className={styles.slotsGrid}>
          {ALL_SLOTS.map((slot) => {
            const availability = slotsByClass?.[slot] ?? 'open';
            return (
              <SlotCard
                key={slot}
                slot={slot}
                availability={availability}
                installed={installedBySlot.get(slot)}
                locked={inRace}
                onChangeSlot={(s) => setDrawerSlot(s)}
              />
            );
          })}
        </div>
      </section>

      {/* History section */}
      <section className={`${styles.section} ${styles.sectionTop0}`}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Palmarès</p>
            <h2 className={styles.sectionTitle}>Historique</h2>
          </div>
          <p className={styles.sectionAside}>
            {history.length > 0
              ? `${history.length} course${history.length > 1 ? 's' : ''} bouclée${history.length > 1 ? 's' : ''} avec ce bateau.`
              : 'Aucune course disputée avec ce bateau.'}
          </p>
        </div>
        {history.length === 0 ? (
          <p className={styles.historyEmpty}>
            Inscris-toi à une course <strong>{classLabel}</strong> pour démarrer son historique.
          </p>
        ) : (
          <>
            <div className={styles.history}>
              {visibleHistory.map((h) => (
                <Link
                  key={h.raceId}
                  href={`/ranking/${h.raceId}` as Parameters<typeof Link>[0]['href']}
                  className={styles.historyRow}
                >
                  <span className={`${styles.historyPos} ${h.finalRank <= 3 ? styles.historyPosPodium : ''}`}>
                    {formatRank(h.finalRank).main}<sup>{formatRank(h.finalRank).suffix}</sup>
                  </span>
                  <div className={styles.historyCell}>
                    <p className={styles.historyName}>{h.raceName}</p>
                    <p className={styles.historyMeta}>
                      {classLabel} · {new Date(h.raceDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} · {h.raceDistanceNm.toLocaleString('fr-FR')} NM
                    </p>
                  </div>
                  <span className={styles.historyTime}>{h.durationLabel}</span>
                  <span className={styles.historyCredits}>
                    {h.creditsEarned > 0 ? `+ ${h.creditsEarned.toLocaleString('fr-FR')} cr.` : '—'}
                  </span>
                </Link>
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={history.length}
                pageSize={HISTORY_PAGE_SIZE}
                onChange={setPage}
                label="Pagination historique du bateau"
              />
            )}
          </>
        )}
      </section>

      {/* Drawer */}
      {drawerSlot && (
        <SlotDrawer
          open={!!drawerSlot}
          slot={drawerSlot}
          boatId={boat.id}
          boatClass={boat.boatClass}
          installedCatalogId={installedBySlot.get(drawerSlot)?.catalogId}
          credits={credits}
          onClose={() => setDrawerSlot(null)}
          onChanged={load}
        />
      )}

      {/* Modals */}
      <RepairModal
        open={showRepair}
        boat={boat}
        credits={credits}
        onClose={() => setShowRepair(false)}
        onRepaired={load}
      />
      <SellModal
        open={showSell}
        boat={boat}
        installedUpgrades={installed}
        onClose={() => setShowSell(false)}
      />
    </>
  );
}
