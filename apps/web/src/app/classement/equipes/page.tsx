import { cookies } from 'next/headers';
import Link from 'next/link';
import { Eyebrow, Flag } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import { getTeamsRanking, type TeamRankingEntry } from '@/app/team/data';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

export default async function ClassementEquipesPage(): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  const teams = getTeamsRanking(session.username);
  const myTeam = isVisitor ? undefined : teams.find((t) => t.isMyTeam);
  const [p1, p2, p3] = teams;

  return (
    <SiteShell>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Circuit Nemo">Saison 2026</Eyebrow>
          <h1 className={styles.title}>Classement</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            Rang cumulé des écuries, agrégé sur les résultats de tous leurs
            membres toutes classes confondues. <strong>{teams.length} équipes</strong>{' '}
            actives sur le circuit.
          </p>
          {myTeam && (
            <div className={styles.me}>
              <span className={styles.meRank}>
                {formatRank(myTeam.rank).main}
                <sup>{formatRank(myTeam.rank).suffix}</sup>
              </span>
              <div className={styles.meInfo}>
                <p className={styles.meLabel}>Ton équipe</p>
                <p className={styles.meTeam}>{myTeam.name}</p>
                <p className={styles.meStats}>
                  {myTeam.totalRankingScore.toLocaleString('fr-FR')} pts · {myTeam.totalMembers} membres · {String(myTeam.totalPodiums).padStart(2, '0')} podiums
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {p1 && p2 && p3 && (
        <section className={styles.podiumWrap} aria-label="Podium équipes">
          <div className={styles.podium}>
            <TeamPodiumCard team={p2} position={2} tone="p2" />
            <TeamPodiumCard team={p1} position={1} tone="p1" />
            <TeamPodiumCard team={p3} position={3} tone="p3" />
          </div>
        </section>
      )}

      <div className={styles.viewSwitch}>
        <Link
          href={'/classement' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Saison</Link>
        <Link
          href={'/classement/courses' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Par course</Link>
        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`}>Équipes</button>
      </div>

      <section className={styles.rankingWrap}>
        <div className={styles.ranking}>
          <div className={styles.rankingHead}>
            <span className={styles.num}>Rang</span>
            <span>Équipe</span>
            <span className={styles.colCaptain}>Capitaine</span>
            <span className={`${styles.num} ${styles.colMembers}`}>Membres</span>
            <span className={`${styles.num} ${styles.colPoints}`}>Points</span>
            <span className={`${styles.num} ${styles.colPodiums}`}>Podiums</span>
            <span className={styles.num}>Tendance</span>
          </div>

          {teams.map((t) => {
            const { main, suffix } = formatRank(t.rank);
            const isMyTeamRow = !isVisitor && t.isMyTeam;
            const rowCls = [
              styles.row,
              t.rank <= 3 ? styles.rowPodium : '',
              isMyTeamRow ? styles.rowMyTeam : '',
            ].filter(Boolean).join(' ');
            return (
              <Link
                key={t.slug}
                href={`/team/${encodeURIComponent(t.slug)}` as Parameters<typeof Link>[0]['href']}
                className={rowCls}
              >
                <span className={styles.pos}>{main}<sup>{suffix}</sup></span>
                <div className={styles.team}>
                  <Flag code={t.country} className={styles.flag} />
                  <div className={styles.teamInfo}>
                    <p className={styles.teamName}>
                      {t.name}
                      {isMyTeamRow && <span className={styles.myBadge}>Mon équipe</span>}
                    </p>
                    <p className={styles.teamCity}>{t.baseCity} · {t.countryLabel}</p>
                  </div>
                </div>
                <span className={`${styles.captain} ${styles.colCaptain}`}>
                  <span className={styles.captainLabel}>Capitaine</span>
                  @{t.captainUsername}
                </span>
                <span className={`${styles.cellNum} ${styles.colMembers}`}>
                  {t.totalMembers}
                </span>
                <span className={`${styles.cellNum} ${styles.colPoints} ${t.rank <= 3 ? styles.gold : ''}`}>
                  {t.totalRankingScore.toLocaleString('fr-FR')}
                </span>
                <span className={`${styles.cellNum} ${styles.colPodiums}`}>
                  {String(t.totalPodiums).padStart(2, '0')}
                </span>
                <TrendCell trend={t.trend} />
              </Link>
            );
          })}
        </div>
      </section>
    </SiteShell>
  );
}

function TeamPodiumCard({
  team, position, tone,
}: {
  team: TeamRankingEntry;
  position: 1 | 2 | 3;
  tone: 'p1' | 'p2' | 'p3';
}): React.ReactElement {
  const { main, suffix } = formatRank(position);
  return (
    <Link
      href={`/team/${encodeURIComponent(team.slug)}` as Parameters<typeof Link>[0]['href']}
      className={`${styles.podiumCard} ${styles[tone]}`}
    >
      <span className={styles.podiumBadge}>{main}<sup>{suffix}</sup></span>
      <h3 className={styles.podiumName}>{team.name}</h3>
      <div className={styles.podiumLoc}>
        <Flag code={team.country} className={styles.flag} />
        {team.baseCity}
      </div>
      <p className={styles.podiumPoints}>
        {team.totalRankingScore.toLocaleString('fr-FR')}<small>pts</small>
      </p>
    </Link>
  );
}

function TrendCell({ trend }: { trend: TeamRankingEntry['trend'] }): React.ReactElement {
  if (trend.dir === 'up')   return <span className={`${styles.trend} ${styles.trendUp}`}>▲ {trend.delta}</span>;
  if (trend.dir === 'down') return <span className={`${styles.trend} ${styles.trendDown}`}>▼ {trend.delta}</span>;
  return <span className={styles.trend}>—</span>;
}
