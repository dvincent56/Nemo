'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Pagination, BoatSvg } from '@/components/ui';
import {
  CLASS_LABEL,
  type BoatDetail,
  type UpgradeCategory,
  type UpgradeVariant,
  type UpgradeEffect,
  type BoatRaceHistoryEntry,
} from '../data';
import styles from './page.module.css';

const HISTORY_PAGE_SIZE = 5;

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

function HeroRender({ boat }: { boat: BoatDetail }): React.ReactElement {
  return (
    <div className={styles.heroRender}>
      <BoatSvg
        className={styles.heroRenderSvg}
        hullColor={boat.hullColor}
        deckColor={boat.deckColor}
        hullNumber={boat.hullNumber}
        name={boat.name}
        showText
      />
    </div>
  );
}

function EffectPill({ effect }: { effect: UpgradeEffect }): React.ReactElement {
  const toneCls =
    effect.tone === 'gain' ? styles.pillGain
    : effect.tone === 'malus' ? styles.pillMalus
    : effect.tone === 'risk' ? styles.pillRisk
    : styles.pillNeutre;
  return <span className={`${styles.effectPill} ${toneCls}`}>{effect.label}</span>;
}

function MetricBars({ v }: { v: UpgradeVariant }): React.ReactElement {
  const rows: Array<{ key: keyof UpgradeVariant['metrics']; label: string; bad?: boolean }> = [
    { key: 'upwind',   label: 'Près' },
    { key: 'downwind', label: 'Portant' },
    { key: 'heavy',    label: 'Gros temps' },
    { key: 'wear',     label: 'Usure', bad: true },
  ];
  return (
    <div className={styles.metrics} aria-label="Profil de performance">
      {rows.map((row) => {
        const value = v.metrics[row.key];
        return (
          <div key={row.key} className={styles.metric}>
            <span className={styles.metricLabel}>{row.label}</span>
            <div className={styles.metricBar}>
              <div
                className={`${styles.metricFill} ${row.bad ? styles.metricFillBad : ''}`}
                style={{ width: `${value}%` }}
              />
            </div>
            <span className={styles.metricValue}>{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function VariantCard({
  variant, isEquipped, onEquip,
}: {
  variant: UpgradeVariant;
  isEquipped: boolean;
  onEquip: (id: string) => void;
}): React.ReactElement {
  const cardCls = [
    styles.variant,
    isEquipped ? styles.variantEquipped : '',
  ].filter(Boolean).join(' ');
  return (
    <article className={cardCls}>
      <div className={styles.variantHead}>
        <h4 className={styles.variantName}>{variant.name}</h4>
        {isEquipped
          ? <span className={`${styles.variantStatus} ${styles.statusEquipped}`}>Équipé</span>
          : variant.status === 'research'
            ? <span className={`${styles.variantStatus} ${styles.statusResearch}`}>R&amp;D</span>
            : null}
      </div>
      <p className={styles.variantDesc}>{variant.description}</p>
      <div className={styles.variantEffects}>
        {variant.effects.map((e, i) => <EffectPill key={`${e.tone}-${i}`} effect={e} />)}
      </div>
      <MetricBars v={variant} />
      <div className={styles.variantFoot}>
        <span className={`${styles.variantCost} ${variant.costCredits === null ? styles.variantCostFree : ''}`}>
          {variant.costCredits === null
            ? 'Inclus'
            : <>{variant.costCredits.toLocaleString('fr-FR')}<small>cr.</small></>}
        </span>
        {!isEquipped && (
          <button type="button" className={styles.variantCta} onClick={() => onEquip(variant.id)}>
            Équiper
          </button>
        )}
      </div>
    </article>
  );
}

export default function BoatDetailView({ boat }: { boat: BoatDetail }): React.ReactElement {
  // State local des variantes équipées — simule la persistance backend. À
  // remplacer par PATCH /api/v1/boats/:id/upgrades quand disponible.
  const [equipped, setEquipped] = useState<Record<string, string>>(
    () => Object.fromEntries(boat.upgrades.map((c) => [c.key, c.equippedVariantId])),
  );

  // Catégorie sélectionnée pour la vue détaillée (défaut : première "tuned"
  // ou la première catégorie).
  const [selectedKey, setSelectedKey] = useState(() => {
    const firstTuned = boat.upgrades.find((c) => c.variants.length > 1);
    return firstTuned?.key ?? boat.upgrades[0]!.key;
  });

  const selected = useMemo(
    () => boat.upgrades.find((c) => c.key === selectedKey)!,
    [boat.upgrades, selectedKey],
  );

  const handleEquip = (categoryKey: UpgradeCategory['key'], variantId: string): void => {
    setEquipped((prev) => ({ ...prev, [categoryKey]: variantId }));
  };

  // Pagination historique
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(boat.history.length / HISTORY_PAGE_SIZE));
  const visibleHistory = boat.history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  const stateCls =
    boat.stateTone === 'inRace' ? styles.stateInRace
    : boat.stateTone === 'new'  ? styles.stateNew
    : styles.stateIdle;

  return (
    <>
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>{boat.name}</span>
        </nav>
      </div>

      <section className={styles.hero}>
        <HeroRender boat={boat} />
        <div className={styles.heroSide}>
          <p className={styles.heroClass}>
            {CLASS_LABEL[boat.boatClass]} · FRA-{boat.hullNumber}
          </p>
          <h1 className={styles.heroName}>{boat.name}</h1>
          <span className={`${styles.heroState} ${stateCls}`}>
            <span className={styles.heroStateDot} aria-hidden />
            {boat.stateLabel}
          </span>
          <p className={styles.heroMetaLine}>{boat.tagline}</p>
          <div className={styles.heroActions}>
            <Link
              href={`/marina/${boat.id}/customize` as Parameters<typeof Link>[0]['href']}
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              Personnaliser →
            </Link>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => { /* TODO modale de confirmation + API vente */ }}
            >
              Vendre
            </button>
          </div>
        </div>
      </section>

      <section className={styles.statsBand}>
        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Courses</p>
            <p className={styles.statCellValue}>{String(boat.racesCount).padStart(2, '0')}</p>
            <p className={styles.statCellSub}>Saison 2026</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Meilleur classement</p>
            {boat.bestRank ? (
              <>
                <p className={`${styles.statCellValue} ${styles.statCellValueGold}`}>
                  {formatRank(boat.bestRank.position).main}<sup>{formatRank(boat.bestRank.position).suffix}</sup>
                </p>
                <p className={styles.statCellSub}>{boat.bestRank.raceName} · {boat.bestRank.season}</p>
              </>
            ) : (
              <>
                <p className={styles.statCellValue}>—</p>
                <p className={styles.statCellSub}>Aucune course</p>
              </>
            )}
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Distance parcourue</p>
            <p className={styles.statCellValue}>
              {boat.totalNm.toLocaleString('fr-FR')}<small>NM</small>
            </p>
            <p className={styles.statCellSub}>Depuis l'acquisition</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Modules optimisés</p>
            <p className={styles.statCellValue}>
              {String(boat.upgradesTuned).padStart(2, '0')}<small>/06</small>
            </p>
            <p className={styles.statCellSub}>Sur six catégories</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Performance</p>
            <h2 className={styles.sectionTitle}>Configuration</h2>
          </div>
          <p className={styles.sectionAside}>
            Six modules à arbitrer. Chaque variante a son profil de performance
            sur quatre axes : près, portant, gros temps, usure.
          </p>
        </div>

        <div className={styles.cats}>
          {boat.upgrades.map((cat) => {
            const equippedId = equipped[cat.key] ?? cat.equippedVariantId;
            const equippedVariant = cat.variants.find((v) => v.id === equippedId) ?? cat.variants[0]!;
            const isTuned = equippedVariant.costCredits !== null;
            const isSelected = cat.key === selectedKey;
            const catCls = [
              styles.cat,
              isTuned ? styles.catTuned : '',
              isSelected ? styles.catSelected : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={cat.key}
                type="button"
                className={catCls}
                onClick={() => setSelectedKey(cat.key)}
                aria-pressed={isSelected}
              >
                <p className={styles.catLabel}>{cat.label}</p>
                <p className={styles.catVariant}>{equippedVariant.name}</p>
                <div className={styles.catPills}>
                  {cat.summaryEffects.map((e, i) => <EffectPill key={`${cat.key}-${i}`} effect={e} />)}
                </div>
                <div className={styles.catFoot}>
                  <span>{cat.variants.length} {cat.variants.length > 1 ? 'variantes' : 'variante'}</span>
                  <span>{isSelected ? 'Sélectionné' : 'Modifier →'}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className={styles.compareHead}>
          <div>
            <p className={styles.compareEyebrow}>Vue détaillée — {selected.label}</p>
            <h3 className={styles.compareTitle}>Choix disponibles</h3>
          </div>
          <p className={styles.compareAside}>
            Compare les profils sur les quatre axes de performance.
            Le contour or = configuration équipée.
          </p>
        </div>

        <div className={styles.variants}>
          {selected.variants.map((v) => (
            <VariantCard
              key={v.id}
              variant={v}
              isEquipped={(equipped[selected.key] ?? selected.equippedVariantId) === v.id}
              onEquip={(id) => handleEquip(selected.key, id)}
            />
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionTop0}`}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Palmarès</p>
            <h2 className={styles.sectionTitle}>Historique</h2>
          </div>
          <p className={styles.sectionAside}>
            {boat.history.length > 0
              ? `${boat.history.length} course${boat.history.length > 1 ? 's' : ''} bouclée${boat.history.length > 1 ? 's' : ''} avec ce bateau depuis son acquisition.`
              : 'Aucune course disputée avec ce bateau pour le moment.'}
          </p>
        </div>

        {boat.history.length === 0 ? (
          <p className={styles.historyEmpty}>
            Inscris-toi à une course <strong>{CLASS_LABEL[boat.boatClass]}</strong> pour démarrer son historique.
          </p>
        ) : (
          <>
            <div className={styles.history}>
              {visibleHistory.map((h) => <HistoryRow key={h.raceId} entry={h} />)}
            </div>
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={boat.history.length}
                pageSize={HISTORY_PAGE_SIZE}
                onChange={setPage}
                label="Pagination historique du bateau"
              />
            )}
          </>
        )}
      </section>
    </>
  );
}

function HistoryRow({ entry }: { entry: BoatRaceHistoryEntry }): React.ReactElement {
  const isPodium = entry.finalRank <= 3;
  const { main, suffix } = formatRank(entry.finalRank);
  const date = new Date(entry.raceDate).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return (
    <Link
      href={`/classement/${entry.raceId}` as Parameters<typeof Link>[0]['href']}
      className={styles.historyRow}
    >
      <span className={`${styles.historyPos} ${isPodium ? styles.historyPosPodium : ''}`}>
        {main}<sup>{suffix}</sup>
      </span>
      <div className={styles.historyCell}>
        <p className={styles.historyName}>{entry.raceName}</p>
        <p className={styles.historyMeta}>
          {CLASS_LABEL[entry.raceBoatClass]} · {date} · {entry.raceDistanceNm.toLocaleString('fr-FR')} NM
        </p>
      </div>
      <span className={styles.historyTime}>{entry.durationLabel}</span>
      <span className={styles.historyCredits}>
        {entry.creditsEarned > 0 ? `+ ${entry.creditsEarned.toLocaleString('fr-FR')} cr.` : '—'}
      </span>
    </Link>
  );
}
