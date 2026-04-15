'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eyebrow, Pagination } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import { ME_CONTEXT, getRanking, type BoatClass, type SkipperRanking } from './data';
import styles from './page.module.css';

const PAGE_SIZE = 10;

type ClassFilter = 'ALL' | BoatClass;
type ScopeFilter = 'GENERAL' | 'FRIENDS' | 'TEAM' | 'CITY' | 'DPT' | 'REGION' | 'COUNTRY';

const CLASS_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'FIGARO', label: 'Figaro III' },
  { value: 'CLASS40', label: 'Class40' },
  { value: 'OCEAN_FIFTY', label: 'Ocean Fifty' },
  { value: 'IMOCA60', label: 'IMOCA 60' },
  { value: 'ULTIM', label: 'Ultim' },
];

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: 'GENERAL', label: 'Général' },
  { value: 'FRIENDS', label: 'Amis' },
  { value: 'TEAM', label: 'Équipe' },
  { value: 'CITY', label: 'Ville' },
  { value: 'DPT', label: 'Département' },
  { value: 'REGION', label: 'Région' },
  { value: 'COUNTRY', label: 'Pays' },
];

function formatRank(n: number): { main: string; suffix: string } {
  const main = String(n).padStart(2, '0');
  const suffix = n === 1 ? 'er' : 'e';
  return { main, suffix };
}

function Flag({ code }: { code: SkipperRanking['country'] }): React.ReactElement {
  return <span className={`${styles.flag} ${styles[code] ?? ''}`} aria-label={`Drapeau ${code.toUpperCase()}`} />;
}

function Trend({ trend }: { trend: SkipperRanking['trend'] }): React.ReactElement {
  if (trend.dir === 'up') return <span className={`${styles.trend} ${styles.trendUp}`}>▲ {trend.delta}</span>;
  if (trend.dir === 'down') return <span className={`${styles.trend} ${styles.trendDown}`}>▼ {trend.delta}</span>;
  return <span className={styles.trend}>—</span>;
}

/** Renvoie le username affiché : si c'est la ligne "me", on remplace par
 *  celui de la session courante ; sinon on retourne le username du DTO. */
function displayUsername(r: SkipperRanking, meUsername: string | null): string {
  if (r.isMe && meUsername) return meUsername;
  return r.username;
}

export interface ClassementViewProps {
  totalSkippers: number;
}

export default function ClassementView({
  totalSkippers,
}: ClassementViewProps): React.ReactElement {
  const [classFilter, setClassFilter] = useState<ClassFilter>('ALL');
  const [scope, setScope] = useState<ScopeFilter>('GENERAL');

  // Hydrate le pseudo depuis le cookie côté client uniquement (évite le
  // mismatch SSR/CSR : le cookie n'est pas déterministe sur le serveur).
  const [meUsername, setMeUsername] = useState<string | null>(null);
  useEffect(() => {
    const s = readClientSession();
    setMeUsername(s.username);
  }, []);

  // Classement par classe (ou cumul ALL), dérivé du modèle joueurs +
  // résultats par classe. Chaque jeu de données est déjà rangé localement
  // (1er, 2e, …). On applique ensuite le filtre Périmètre et on **re-rang**
  // dans le sous-classement (1er entre amis, 1er du département, …).
  const rows = useMemo(() => {
    const base = getRanking(classFilter);
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
  }, [classFilter, scope]);

  // Pagination de la table — reset à la page 1 si le filtre change
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [classFilter, scope]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  );

  // Podium et "ma position" se calculent sur le sous-classement courant.
  const me = rows.find((r) => r.isMe);
  const [p1, p2, p3] = rows;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Circuit Nemo">Saison 2026</Eyebrow>
          <h1 className={styles.title}>Classement</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            Rang cumulé sur l'ensemble des courses de la saison, toutes classes
            confondues. <strong>{totalSkippers.toLocaleString('fr-FR')} skippers</strong> actifs
            sur le circuit.
          </p>
          {me && (
            <div className={styles.me}>
              <span className={styles.meRank}>
                {formatRank(me.rank).main}
                <sup>{formatRank(me.rank).suffix}</sup>
              </span>
              <div className={styles.meInfo}>
                <p className={styles.meLabel}>Ta position</p>
                <p className={styles.mePseudo}>{displayUsername(me, meUsername)}</p>
                <p className={styles.meStats}>
                  {me.rankingScore.toLocaleString('fr-FR')} pts · {me.racesFinished} courses · {String(me.podiums).padStart(2, '0')} podiums
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {p1 && p2 && p3 && (
        <section className={styles.podiumWrap} aria-label="Podium saison">
          <div className={styles.podium}>
            <PodiumCard skipper={p2} position={2} tone="p2" meUsername={meUsername} />
            <PodiumCard skipper={p1} position={1} tone="p1" meUsername={meUsername} />
            <PodiumCard skipper={p3} position={3} tone="p3" meUsername={meUsername} />
          </div>
        </section>
      )}

      <div className={styles.viewSwitch}>
        <button type="button" className={`${styles.viewBtn} ${styles.active}`}>Saison</button>
        <Link
          href={'/classement/courses' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Par course</Link>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>Classe</p>
          {CLASS_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`${styles.filterTab} ${c.value === classFilter ? styles.filterTabActive : ''}`}
              onClick={() => setClassFilter(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>Périmètre</p>
          {SCOPE_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`${styles.filterTab} ${s.value === scope ? styles.filterTabActive : ''}`}
              onClick={() => setScope(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className={styles.rankingWrap}>
        <div className={styles.ranking}>
          <div className={styles.rankingHead}>
            <span className={styles.num}>Rang</span>
            <span>Skipper</span>
            <span className={styles.num}>Points</span>
            <span className={`${styles.num} ${styles.colCourses}`}>Courses</span>
            <span className={`${styles.num} ${styles.colPodiums}`}>Podiums</span>
            <span className={`${styles.num} ${styles.boat}`}>Bateau favori</span>
            <span className={styles.num}>Tendance</span>
          </div>
          {visibleRows.map((r) => {
            const { main, suffix } = formatRank(r.rank);
            const rowCls = [
              styles.row,
              r.rank <= 3 ? styles.rowPodium : '',
              r.isMe ? styles.rowMe : '',
            ].filter(Boolean).join(' ');
            return (
              <div key={`${r.rank}-${r.username}`} className={rowCls}>
                <span className={styles.pos}>{main}<sup>{suffix}</sup></span>
                <div className={styles.skipper}>
                  <Flag code={r.country} />
                  <div>
                    <p className={styles.skName}>
                      <Link
                        href={`/profile/${encodeURIComponent(r.username)}` as Parameters<typeof Link>[0]['href']}
                        className={styles.skLink}
                      >
                        {displayUsername(r, meUsername)}
                      </Link>
                      {r.isMe && <span className={styles.meBadge}>Vous</span>}
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
          label="Pagination classement saison"
        />
      </section>
    </>
  );
}

function PodiumCard({
  skipper, position, tone, meUsername,
}: {
  skipper: SkipperRanking;
  position: 1 | 2 | 3;
  tone: 'p1' | 'p2' | 'p3';
  meUsername: string | null;
}): React.ReactElement {
  const { main, suffix } = formatRank(position);
  return (
    <article className={`${styles.podiumCard} ${styles[tone]}`}>
      <span className={styles.podiumBadge}>{main}<sup>{suffix}</sup></span>
      <h3 className={styles.podiumName}>
        <Link
          href={`/profile/${encodeURIComponent(skipper.username)}` as Parameters<typeof Link>[0]['href']}
          className={styles.skLink}
        >
          {displayUsername(skipper, meUsername)}
        </Link>
      </h3>
      <div className={styles.podiumLoc}>
        <Flag code={skipper.country} />
        {skipper.city}
      </div>
      <p className={styles.podiumPoints}>
        {skipper.rankingScore.toLocaleString('fr-FR')}<small>pts</small>
      </p>
    </article>
  );
}
