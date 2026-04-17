'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eyebrow, Flag, Pagination } from '@/components/ui';
import { profileHref } from '@/lib/routes';
import styles from './page.module.css';

const PAGE_SIZE = 10;

type Country = 'fr' | 'nl' | 'it' | 'uk' | 'no' | 'es' | 'ie' | 'pt' | 'cl';
type Trend = { dir: 'up' | 'down' | 'flat'; delta: number };
type Scope = 'GENERAL' | 'FRIENDS' | 'TEAM' | 'CITY' | 'DPT' | 'REGION' | 'COUNTRY';

interface RaceRow {
  rank: number;
  username: string;
  city: string;
  dpt: string;
  region: string;
  country: Country;
  dtfNm: number;
  bspKnots: number;
  gapToLeaderNm: number | null; // null pour le leader
  boat: string;
  trend: Trend;
  isFriend?: boolean;
  team?: string;
  isMe?: boolean;
}

const ME_CTX = {
  city: 'La Rochelle',
  dpt: '17',
  region: 'Nouvelle-Aquitaine',
  country: 'fr' as Country,
  team: 'La Rochelle Racing',
};

const RACE_SEED = {
  raceName: 'Vendée Express',
  raceClass: 'IMOCA 60',
  raceDistanceNm: 1850,
  raceDayLabel: 'J3 · 14h12',
  raceParticipants: 428,
  rows: [
    { rank: 1,  username: 'laperouse',  city: 'La Trinité',    dpt: '56', region: 'Bretagne',                  country: 'fr', dtfNm: 1524, bspKnots: 13.8, gapToLeaderNm: null, boat: 'Finisterre', trend: { dir: 'flat', delta: 0 }, isFriend: true, team: 'La Rochelle Racing' },
    { rank: 2,  username: 'northwind',  city: 'Amsterdam',     dpt: '—',  region: 'Hollande-Septentrionale',   country: 'nl', dtfNm: 1538, bspKnots: 12.6, gapToLeaderNm: 14,   boat: 'Noordster',  trend: { dir: 'up',   delta: 1 } },
    { rank: 3,  username: 'bora_c',     city: 'Trieste',       dpt: '—',  region: 'Frioul-Vénétie julienne',   country: 'it', dtfNm: 1552, bspKnots: 11.9, gapToLeaderNm: 28,   boat: 'Tramontana', trend: { dir: 'down', delta: 1 }, isFriend: true },
    { rank: 4,  username: 'finistère',  city: 'Brest',         dpt: '29', region: 'Bretagne',                  country: 'fr', dtfNm: 1561, bspKnots: 12.1, gapToLeaderNm: 37,   boat: 'Iroise',     trend: { dir: 'up',   delta: 2 }, team: 'La Rochelle Racing' },
    { rank: 5,  username: 'tradewind',  city: 'Cowes',         dpt: '—',  region: 'Île de Wight',              country: 'uk', dtfNm: 1574, bspKnots: 11.4, gapToLeaderNm: 50,   boat: 'Solent',     trend: { dir: 'flat', delta: 0 }, isFriend: true },
    { rank: 6,  username: 'mistral',    city: 'Marseille',     dpt: '13', region: "Provence-Alpes-Côte d'Azur", country: 'fr', dtfNm: 1588, bspKnots: 10.9, gapToLeaderNm: 64,   boat: 'Bandol',     trend: { dir: 'down', delta: 2 } },
    { rank: 7,  username: 'cap_horn',   city: 'Punta Arenas',  dpt: '—',  region: 'Magallanes',                country: 'cl', dtfNm: 1601, bspKnots: 10.4, gapToLeaderNm: 77,   boat: 'Magellan',   trend: { dir: 'up',   delta: 1 } },
    { rank: 8,  username: 'hebrides',   city: 'Stornoway',     dpt: '—',  region: 'Hébrides extérieures',      country: 'uk', dtfNm: 1612, bspKnots:  9.8, gapToLeaderNm: 88,   boat: 'Lewis',      trend: { dir: 'flat', delta: 0 } },
    { rank: 9,  username: 'galway_bay', city: 'Galway',        dpt: '—',  region: 'Connacht',                  country: 'ie', dtfNm: 1623, bspKnots: 10.1, gapToLeaderNm: 99,   boat: 'Claddagh',   trend: { dir: 'up',   delta: 1 } },
    { rank: 10, username: 'portofino',  city: 'Portofino',     dpt: '—',  region: 'Ligurie',                   country: 'it', dtfNm: 1635, bspKnots:  9.2, gapToLeaderNm: 111,  boat: 'Ligure',     trend: { dir: 'down', delta: 1 } },
    { rank: 11, username: 'cascais',    city: 'Cascais',       dpt: '—',  region: 'Lisbonne',                  country: 'pt', dtfNm: 1640, bspKnots: 10.7, gapToLeaderNm: 116,  boat: 'Atlantico',  trend: { dir: 'up',   delta: 3 } },
    { rank: 12, username: 'vous',       city: 'La Rochelle',   dpt: '17', region: 'Nouvelle-Aquitaine',        country: 'fr', dtfNm: 1642, bspKnots: 11.4, gapToLeaderNm: 118,  boat: 'Albatros',   trend: { dir: 'flat', delta: 0 }, isMe: true, team: 'La Rochelle Racing' },
    { rank: 13, username: 'narvik',     city: 'Narvik',        dpt: '—',  region: 'Nordland',                  country: 'no', dtfNm: 1655, bspKnots:  9.6, gapToLeaderNm: 131,  boat: 'Hurtig',     trend: { dir: 'down', delta: 2 } },
    { rank: 14, username: 'balearic',   city: 'Palma',         dpt: '—',  region: 'Îles Baléares',             country: 'es', dtfNm: 1668, bspKnots:  8.9, gapToLeaderNm: 144,  boat: 'Mediterra',  trend: { dir: 'flat', delta: 0 } },
    { rank: 15, username: 'donegal',    city: 'Letterkenny',   dpt: '—',  region: 'Ulster',                    country: 'ie', dtfNm: 1681, bspKnots:  9.4, gapToLeaderNm: 157,  boat: 'Swilly',     trend: { dir: 'up',   delta: 2 } },
  ] satisfies RaceRow[],
};

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'GENERAL', label: 'Général' },
  { value: 'FRIENDS', label: 'Amis' },
  { value: 'TEAM',    label: 'Équipe' },
  { value: 'CITY',    label: 'Ville' },
  { value: 'DPT',     label: 'Département' },
  { value: 'REGION',  label: 'Région' },
  { value: 'COUNTRY', label: 'Pays' },
];

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

function display(r: RaceRow, meUsername: string | null): string {
  return r.isMe && meUsername ? meUsername : r.username;
}

function TrendCell({ trend }: { trend: Trend }): React.ReactElement {
  if (trend.dir === 'up')   return <span className={`${styles.trend} ${styles.trendUp}`}>▲ {trend.delta}</span>;
  if (trend.dir === 'down') return <span className={`${styles.trend} ${styles.trendDown}`}>▼ {trend.delta}</span>;
  return <span className={styles.trend}>—</span>;
}

export interface ClassementRaceViewProps {
  raceId: string;
  isVisitor: boolean;
  meUsername: string | null;
}

export default function ClassementRaceView({
  raceId: _raceId,
  isVisitor,
  meUsername,
}: ClassementRaceViewProps): React.ReactElement {
  const [scope, setScope] = useState<Scope>('GENERAL');

  const scopeOptions = useMemo(
    () => (isVisitor ? SCOPE_OPTIONS.filter((s) => s.value === 'GENERAL') : SCOPE_OPTIONS),
    [isVisitor],
  );

  const allRows = RACE_SEED.rows;

  // Sous-classement : on filtre par Périmètre puis on **recalcule un rang
  // local** (1er, 2e, …). Le filtre n'est pas un masque sur le ranking
  // général, c'est un classement à part entière (1er entre amis, 1er
  // de l'équipe, …). Les rows seed sont déjà triées par rang général,
  // donc l'ordre relatif reste correct après filtre.
  const rows = useMemo(() => {
    return allRows
      .filter((r) => {
        switch (scope) {
          case 'GENERAL': return true;
          case 'FRIENDS': return r.isFriend === true || r.isMe === true;
          case 'TEAM':    return r.team === ME_CTX.team;
          case 'CITY':    return r.city === ME_CTX.city;
          case 'DPT':     return r.dpt === ME_CTX.dpt && r.dpt !== '—';
          case 'REGION':  return r.region === ME_CTX.region;
          case 'COUNTRY': return r.country === ME_CTX.country;
        }
      })
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [allRows, scope]);

  // Podium et "ma position" reflètent le sous-classement courant.
  // En mode visiteur, on masque le bloc perso — pas d'identité.
  const me = isVisitor ? undefined : rows.find((r) => r.isMe);
  const [p1, p2, p3] = rows;

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [scope]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  );

  return (
    <>
      <section className={styles.hero}>
        <Eyebrow trailing="Classement par course">Saison 2026</Eyebrow>
        <h1 className={styles.title}>Classement</h1>
      </section>

      <div className={styles.viewSwitch}>
        <Link
          href={'/classement' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Saison</Link>
        <Link
          href={'/classement/courses' as Parameters<typeof Link>[0]['href']}
          className={`${styles.viewBtn} ${styles.viewBtnActive}`}
        >Par course</Link>
      </div>

      <div className={styles.pickerWrap}>
        <article className={styles.picker}>
          <div>
            <p className={styles.pickerLabel}>Course sélectionnée</p>
            <h2 className={styles.pickerName}>{RACE_SEED.raceName}</h2>
            <p className={styles.pickerMeta}>
              <span>{RACE_SEED.raceClass}</span>
              <span>{RACE_SEED.raceDistanceNm.toLocaleString('fr-FR')} <strong>NM</strong></span>
              <span>{RACE_SEED.raceDayLabel}</span>
              <span>{RACE_SEED.raceParticipants} skippers</span>
            </p>
          </div>
          <div className={styles.pickerSide}>
            <span className={styles.chip}>
              <span className={styles.chipDot} aria-hidden />
              En cours
            </span>
            <Link
              href={'/classement/courses' as Parameters<typeof Link>[0]['href']}
              className={styles.pickerChange}
            >
              Changer de course →
            </Link>
          </div>
        </article>

        {me && (
          <div className={styles.me}>
            <span className={styles.meRank}>
              {formatRank(me.rank).main}<sup>{formatRank(me.rank).suffix}</sup>
            </span>
            <div className={styles.meInfo}>
              <p className={styles.meLabel}>Ta position</p>
              <p className={styles.mePseudo}>{display(me, meUsername)}</p>
              <p className={styles.meStats}>
                DTF {me.dtfNm.toLocaleString('fr-FR')} NM · BSP {me.bspKnots.toFixed(1)} nds
              </p>
            </div>
          </div>
        )}
      </div>

      {p1 && p2 && p3 && (
        <section className={styles.podiumWrap} aria-label="Podium course">
          <div className={styles.podium}>
            {[
              { p: p2, position: 2 as const, tone: 'p2' as const },
              { p: p1, position: 1 as const, tone: 'p1' as const },
              { p: p3, position: 3 as const, tone: 'p3' as const },
            ].map(({ p, position, tone }) => {
              const { main, suffix } = formatRank(position);
              const isMeRow = !isVisitor && p.isMe;
              return (
                <article key={p.username} className={`${styles.podiumCard} ${styles[tone]}`}>
                  <span className={styles.podiumBadge}>{main}<sup>{suffix}</sup></span>
                  <h3 className={styles.podiumName}>
                    <Link
                      href={profileHref(p.username, isMeRow) as Parameters<typeof Link>[0]['href']}
                      className={styles.skLink}
                    >
                      {display(p, meUsername)}
                    </Link>
                  </h3>
                  <div className={styles.podiumLoc}>
                    <Flag code={p.country} className={styles.flag} />
                    {p.city}
                  </div>
                  <p className={styles.podiumDtf}>
                    {p.dtfNm.toLocaleString('fr-FR')}<small>NM restants</small>
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>Périmètre</p>
          {scopeOptions.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`${styles.filterTab} ${s.value === scope ? styles.filterTabActive : ''}`}
              onClick={() => setScope(s.value)}
            >{s.label}</button>
          ))}
        </div>
      </div>

      <section className={styles.rankingWrap}>
        <div className={styles.ranking}>
          <div className={styles.rankingHead}>
            <span className={styles.num}>Rang</span>
            <span>Skipper</span>
            <span className={styles.num}>DTF</span>
            <span className={`${styles.num} ${styles.colBsp}`}>BSP</span>
            <span className={`${styles.num} ${styles.colEta}`}>Écart leader</span>
            <span className={`${styles.num} ${styles.colBoat} ${styles.boat}`}>Bateau</span>
            <span className={styles.num}>Tendance</span>
          </div>
          {visibleRows.map((r) => {
            const { main, suffix } = formatRank(r.rank);
            const isMeRow = !isVisitor && r.isMe;
            const cls = [
              styles.row,
              r.rank <= 3 ? styles.rowPodium : '',
              isMeRow ? styles.rowMe : '',
            ].filter(Boolean).join(' ');
            return (
              <div key={`${r.rank}-${r.username}`} className={cls}>
                <span className={styles.pos}>{main}<sup>{suffix}</sup></span>
                <div className={styles.skipper}>
                  <Flag code={r.country} className={styles.flag} />
                  <div>
                    <p className={styles.skName}>
                      <Link
                        href={profileHref(r.username, isMeRow) as Parameters<typeof Link>[0]['href']}
                        className={styles.skLink}
                      >
                        {display(r, meUsername)}
                      </Link>
                      {isMeRow && <span className={styles.meBadge}>Moi</span>}
                    </p>
                    <p className={styles.skCity}>{r.city} · {r.country.toUpperCase()}</p>
                  </div>
                </div>
                <span className={`${styles.rankingNum} ${r.rank <= 3 ? styles.rankingNumGold : ''}`}>
                  {r.dtfNm.toLocaleString('fr-FR')}<small>NM</small>
                </span>
                <span className={`${styles.rankingNum} ${styles.rankingNumLive} ${styles.colBsp}`}>
                  {r.bspKnots.toFixed(1)}<small>nds</small>
                </span>
                <span className={`${styles.rankingNum} ${styles.colEta}`}>
                  {r.gapToLeaderNm === null ? '—' : <>+ {r.gapToLeaderNm}<small>NM</small></>}
                </span>
                <span className={`${styles.boat} ${styles.colBoat}`}>{r.boat}</span>
                <TrendCell trend={r.trend} />
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
          label="Pagination classement course"
        />
      </section>
    </>
  );
}
