'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eyebrow, Flag, Pagination } from '@/components/ui';
import { profileHref } from '@/lib/routes';
import { BOAT_CLASS_ORDER } from '@/lib/boat-classes';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import { ME_CONTEXT, getRanking, type BoatClass, type RankingConfig, type SkipperRanking } from './data';
import styles from './page.module.css';

const PAGE_SIZE = 10;

type ClassFilter = 'ALL' | BoatClass;
type ScopeFilter = 'GENERAL' | 'FRIENDS' | 'TEAM' | 'CITY' | 'DPT' | 'REGION' | 'COUNTRY';

const SCOPE_VALUES: ScopeFilter[] = ['GENERAL', 'FRIENDS', 'TEAM', 'CITY', 'DPT', 'REGION', 'COUNTRY'];
const CONFIG_VALUES: RankingConfig[] = ['all', 'series'];

function formatRank(n: number): { main: string; suffix: string } {
  const main = String(n).padStart(2, '0');
  const suffix = n === 1 ? 'er' : 'e';
  return { main, suffix };
}

function Trend({ trend }: { trend: SkipperRanking['trend'] }): React.ReactElement {
  if (trend.dir === 'up') return <span className={`${styles.trend} ${styles.trendUp}`}>▲ {trend.delta}</span>;
  if (trend.dir === 'down') return <span className={`${styles.trend} ${styles.trendDown}`}>▼ {trend.delta}</span>;
  return <span className={styles.trend}>—</span>;
}

function displayUsername(r: SkipperRanking, meUsername: string | null): string {
  if (r.isMe && meUsername) return meUsername;
  return r.username;
}

export interface RankingViewProps {
  totalSkippers: number;
  isVisitor: boolean;
  meUsername: string | null;
}

export default function RankingView({
  totalSkippers,
  isVisitor,
  meUsername,
}: RankingViewProps): React.ReactElement {
  const t = useTranslations('ranking');
  const tScope = useTranslations('ranking.filters.scope');
  const tConfig = useTranslations('ranking.filters.config');
  const boatLabel = useBoatLabel();

  const [classFilter, setClassFilter] = useState<ClassFilter>('ALL');
  const [scope, setScope] = useState<ScopeFilter>('GENERAL');
  const [config, setConfig] = useState<RankingConfig>('all');

  const scopeOptions = useMemo(
    () => (isVisitor ? (['GENERAL'] as ScopeFilter[]) : SCOPE_VALUES),
    [isVisitor],
  );

  const rows = useMemo(() => {
    const base = getRanking(classFilter, config);
    const filtered = base.filter((r) => {
      switch (scope) {
        case 'GENERAL': return true;
        case 'FRIENDS': return r.isFriend === true || r.isMe === true;
        case 'TEAM':    return r.team === ME_CONTEXT.team;
        case 'CITY':    return r.city === ME_CONTEXT.city;
        case 'DPT':     return r.dpt === ME_CONTEXT.dpt && r.dpt !== '—';
        case 'REGION':  return r.region === ME_CONTEXT.region;
        case 'COUNTRY': return r.country === ME_CONTEXT.country;
      }
    });
    return filtered.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [classFilter, scope, config]);

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [classFilter, scope, config]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  );

  const me = isVisitor ? undefined : rows.find((r) => r.isMe);
  const [p1, p2, p3] = rows;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('eyebrowTrailing')}>{t('eyebrowSeason')}</Eyebrow>
          <h1 className={styles.title}>{t('title')}</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            {config === 'series' ? (
              <>
                {t('lede.seriesPre')}<strong>{t('lede.seriesEm')}</strong>{t('lede.seriesMid')}
                <strong>{t('lede.seriesCount', { n: rows.length.toLocaleString('fr-FR') })}</strong>
                {t('lede.seriesEnd')}
              </>
            ) : (
              <>
                {t('lede.allPre')}
                <strong>{t('lede.allCount', { n: totalSkippers.toLocaleString('fr-FR') })}</strong>
                {t('lede.allEnd')}
              </>
            )}
          </p>
          {me && (
            <div className={styles.me}>
              <span className={styles.meRank}>
                {formatRank(me.rank).main}
                <sup>{formatRank(me.rank).suffix}</sup>
              </span>
              <div className={styles.meInfo}>
                <p className={styles.meLabel}>{t('me.label')}</p>
                <p className={styles.mePseudo}>{displayUsername(me, meUsername)}</p>
                <p className={styles.meStats}>
                  {t('me.stats', {
                    points: me.rankingScore.toLocaleString('fr-FR'),
                    races: me.racesFinished,
                    podiums: String(me.podiums).padStart(2, '0'),
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {p1 && p2 && p3 && (
        <section className={styles.podiumWrap} aria-label={t('ariaPodium')}>
          <div className={styles.podium}>
            <PodiumCard skipper={p2} position={2} tone="p2" meUsername={meUsername} isVisitor={isVisitor} />
            <PodiumCard skipper={p1} position={1} tone="p1" meUsername={meUsername} isVisitor={isVisitor} />
            <PodiumCard skipper={p3} position={3} tone="p3" meUsername={meUsername} isVisitor={isVisitor} />
          </div>
        </section>
      )}

      <div className={styles.viewSwitch}>
        <button type="button" className={`${styles.viewBtn} ${styles.active}`}>{t('viewSwitch.season')}</button>
        <Link
          href={'/ranking/races' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.races')}</Link>
        <Link
          href={'/ranking/teams' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.teams')}</Link>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>{t('filters.classLabel')}</p>
          {(['ALL', ...BOAT_CLASS_ORDER.filter((c) => c !== 'CRUISER_RACER' && c !== 'MINI650')] as ClassFilter[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.filterTab} ${c === classFilter ? styles.filterTabActive : ''}`}
              onClick={() => setClassFilter(c)}
            >
              {c === 'ALL' ? t('filters.classAll') : boatLabel(c)}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>{t('filters.scopeLabel')}</p>
          {scopeOptions.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.filterTab} ${s === scope ? styles.filterTabActive : ''}`}
              onClick={() => setScope(s)}
            >
              {tScope(s.toLowerCase() as 'general' | 'friends' | 'team' | 'city' | 'dpt' | 'region' | 'country')}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>{t('filters.configLabel')}</p>
          {CONFIG_VALUES.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.filterTab} ${c === config ? styles.filterTabActive : ''}`}
              onClick={() => setConfig(c)}
            >
              {tConfig(c)}
            </button>
          ))}
        </div>
      </div>

      <section className={styles.rankingWrap}>
        <div className={styles.ranking}>
          <div className={styles.rankingHead}>
            <span className={styles.num}>{t('table.rank')}</span>
            <span>{t('table.skipper')}</span>
            <span className={styles.num}>{t('table.points')}</span>
            <span className={`${styles.num} ${styles.colCourses}`}>{t('table.races')}</span>
            <span className={`${styles.num} ${styles.colPodiums}`}>{t('table.podiums')}</span>
            <span className={`${styles.num} ${styles.boat}`}>{t('table.favoriteBoat')}</span>
            <span className={styles.num}>{t('table.trend')}</span>
          </div>
          {visibleRows.map((r) => {
            const { main, suffix } = formatRank(r.rank);
            const isMeRow = !isVisitor && r.isMe;
            const rowCls = [
              styles.row,
              r.rank <= 3 ? styles.rowPodium : '',
              isMeRow ? styles.rowMe : '',
            ].filter(Boolean).join(' ');
            return (
              <div key={`${r.rank}-${r.username}`} className={rowCls}>
                <span className={styles.pos}>{main}<sup>{suffix}</sup></span>
                <div className={styles.skipper}>
                  <Flag code={r.country} className={styles.flag} />
                  <div>
                    <p className={styles.skName}>
                      <Link
                        href={profileHref(r.username, isMeRow) as Parameters<typeof Link>[0]['href']}
                        className={styles.skLink}
                      >
                        {displayUsername(r, meUsername)}
                      </Link>
                      {isMeRow && <span className={styles.meBadge}>{t('meBadge')}</span>}
                    </p>
                    <p className={styles.skCity}>{r.city} · {r.country.toUpperCase()}</p>
                  </div>
                </div>
                <span className={`${styles.rankingNum} ${r.rank <= 3 ? styles.rankingNumGold : ''}`}>
                  {r.rankingScore.toLocaleString('fr-FR')}
                </span>
                <span className={`${styles.rankingNum} ${styles.colCourses}`}>{r.racesFinished}</span>
                <span className={`${styles.rankingNum} ${styles.colPodiums}`}>
                  {String(r.podiums).padStart(2, '0')}
                </span>
                <span className={styles.boat}>{r.favoriteBoatName}</span>
                <Trend trend={r.trend} />
              </div>
            );
          })}
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={rows.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
          label={t('paginationLabel')}
        />
      </section>
    </>
  );
}

function PodiumCard({
  skipper, position, tone, meUsername, isVisitor,
}: {
  skipper: SkipperRanking;
  position: 1 | 2 | 3;
  tone: 'p1' | 'p2' | 'p3';
  meUsername: string | null;
  isVisitor: boolean;
}): React.ReactElement {
  const tCommon = useTranslations('common.units');
  const { main, suffix } = formatRank(position);
  const isMeRow = !isVisitor && skipper.isMe;
  return (
    <article className={`${styles.podiumCard} ${styles[tone]}`}>
      <span className={styles.podiumBadge}>{main}<sup>{suffix}</sup></span>
      <h3 className={styles.podiumName}>
        <Link
          href={profileHref(skipper.username, isMeRow) as Parameters<typeof Link>[0]['href']}
          className={styles.skLink}
        >
          {displayUsername(skipper, meUsername)}
        </Link>
      </h3>
      <div className={styles.podiumLoc}>
        <Flag code={skipper.country} className={styles.flag} />
        {skipper.city}
      </div>
      <p className={styles.podiumPoints}>
        {skipper.rankingScore.toLocaleString('fr-FR')}<small>{tCommon('points')}</small>
      </p>
    </article>
  );
}
