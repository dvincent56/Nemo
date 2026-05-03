'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pagination, BoatSvg } from '@/components/ui';
import Tooltip from '@/components/ui/Tooltip';
import {
  fetchBoatDetail, fetchCatalog,
  type BoatRecord, type InstalledUpgrade, type UpgradeSlot, type SlotAvailability,
} from '@/lib/marina-api';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import { type BoatRaceHistoryEntry } from '../data';
import { SlotCard } from './SlotCard';
import { SlotDrawer } from './SlotDrawer';
import { SellModal } from './SellModal';
import { EffectsSummary, aggregateInstalledEffects } from './EffectsSummary';
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
  const t = useTranslations('marina.boatDetail');
  const tMarina = useTranslations('marina');
  const boatLabel = useBoatLabel();
  const [boat, setBoat] = useState<BoatRecord | null>(null);
  const [installed, setInstalled] = useState<InstalledUpgrade[]>([]);
  const [credits, setCredits] = useState(0);
  const [slotsByClass, setSlotsByClass] = useState<Record<UpgradeSlot, SlotAvailability> | null>(null);
  const [history, setHistory] = useState<BoatRaceHistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drawerSlot, setDrawerSlot] = useState<UpgradeSlot | null>(null);
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
      const cls = detail.boat.boatClass;
      if (catalog.slotsByClass[cls]) {
        setSlotsByClass(catalog.slotsByClass[cls] as Record<UpgradeSlot, SlotAvailability>);
      }
      setHistory([]);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : tMarina('errorUnknown');
      setLoadError(msg);
    }
  }, [boatId, tMarina]);

  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return (
      <div className={styles.loading}>
        {t('loadingError', { error: loadError })}<br />
        {t('loadingErrorHelp')}<Link href="/login">/login</Link>{t('loadingErrorHelpEnd')}
      </div>
    );
  }

  if (!boat) {
    return <p className={styles.loading}>{t('loadingState')}</p>;
  }

  const inRace = !!boat.activeRaceId;
  const stateLabel = inRace
    ? t('stateInRace', { raceId: boat.activeRaceId ?? '' })
    : t('stateIdle');
  const stateCls = inRace ? styles.stateInRace : styles.stateIdle;
  const classLabel = boatLabel(boat.boatClass);

  const avgCondition = Math.round(
    (boat.hullCondition + boat.rigCondition + boat.sailCondition + boat.elecCondition) / 4,
  );

  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const visibleHistory = history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  const installedBySlot = new Map(installed.map((u) => [u.slot, u]));

  return (
    <>
      {/* Breadcrumb */}
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label={t('ariaCrumbs')}>
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>{t('crumbBack')}</Link>
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
              <Tooltip text={t('actions.lockedTooltip')} position="bottom">
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled
                >
                  {t('actions.customize')}
                </button>
              </Tooltip>
            ) : (
              <Link
                href={`/marina/${boat.id}/customize` as Parameters<typeof Link>[0]['href']}
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                {t('actions.customize')}
              </Link>
            )}
            <Tooltip
              text={inRace ? t('actions.lockedTooltip') : t('actions.sellTooltip')}
              position="bottom"
            >
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setShowSell(true)}
                disabled={inRace}
              >
                {t('actions.sell')}
              </button>
            </Tooltip>
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className={styles.statsBand}>
        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>{t('stats.races')}</p>
            <p className={styles.statCellValue}>{String(boat.racesCount).padStart(2, '0')}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>{t('stats.podiums')}</p>
            <p className={`${styles.statCellValue} ${styles.statCellValueGold}`}>{boat.podiums}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>{t('stats.avgCondition')}</p>
            <p className={styles.statCellValue}>{avgCondition}%</p>
            <p className={styles.statCellSub}>
              {t('stats.avgConditionDetail', {
                hull: boat.hullCondition,
                rig: boat.rigCondition,
                sails: boat.sailCondition,
                elec: boat.elecCondition,
              })}
            </p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>{t('stats.upgradesInstalled')}</p>
            <p className={styles.statCellValue}>{installed.length}<small>/7</small></p>
          </div>
        </div>
      </section>

      {/* Aggregated effects */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('perfSection.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('perfSection.title')}</h2>
          </div>
          <p className={styles.sectionAside}>{t('perfSection.aside')}</p>
        </div>
        <div className={styles.effectsWrap}>
          <EffectsSummary effects={aggregateInstalledEffects(installed)} variant="bars" />
        </div>
      </section>

      <div className={styles.autoRepairWrap}>
        <aside className={styles.autoRepairNotice} aria-label={t('autoRepair.aria')}>
          <span className={styles.autoRepairIcon} aria-hidden>✦</span>
          <p className={styles.autoRepairText}>
            {t.rich('autoRepair.text', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </aside>
      </div>

      {/* Slot section */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('equipmentSection.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('equipmentSection.title')}</h2>
          </div>
          <p className={styles.sectionAside}>
            {inRace ? t('equipmentSection.asideLocked') : t('equipmentSection.asideOpen')}
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
            <p className={styles.sectionEyebrow}>{t('historySection.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('historySection.title')}</h2>
          </div>
          <p className={styles.sectionAside}>
            {history.length > 0
              ? t('historySection.asideCount', { n: history.length })
              : t('historySection.asideEmpty')}
          </p>
        </div>
        {history.length === 0 ? (
          <p className={styles.historyEmpty}>
            {t('historySection.emptyPre')}<strong>{classLabel}</strong>{t('historySection.emptyPost')}
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
                    {h.creditsEarned > 0
                      ? t('historySection.creditsGain', { amount: h.creditsEarned.toLocaleString('fr-FR') })
                      : t('historySection.creditsNone')}
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
                label={t('historySection.paginationLabel')}
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
      <SellModal
        open={showSell}
        boat={boat}
        installedUpgrades={installed}
        onClose={() => setShowSell(false)}
      />
    </>
  );
}
