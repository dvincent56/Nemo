import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Eyebrow, Flag } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import { getTeamsRanking, type TeamRankingEntry } from '@/app/[locale]/team/data';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

export default async function RankingTeamsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('ranking');
  const tTeams = await getTranslations('ranking.teams');
  const tUnits = await getTranslations('common.units');
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  const teams = getTeamsRanking(session.username);
  const myTeam = isVisitor ? undefined : teams.find((tm) => tm.isMyTeam);
  const [p1, p2, p3] = teams;

  return (
    <SiteShell>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('eyebrowTrailing')}>{t('eyebrowSeason')}</Eyebrow>
          <h1 className={styles.title}>{t('title')}</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            {tTeams('lede')}
            <strong>{tTeams('ledeCount', { n: teams.length })}</strong>
            {tTeams('ledeEnd')}
          </p>
          {myTeam && (
            <div className={styles.me}>
              <span className={styles.meRank}>
                {formatRank(myTeam.rank).main}
                <sup>{formatRank(myTeam.rank).suffix}</sup>
              </span>
              <div className={styles.meInfo}>
                <p className={styles.meLabel}>{tTeams('myTeamLabel')}</p>
                <p className={styles.meTeam}>{myTeam.name}</p>
                <p className={styles.meStats}>
                  {tTeams('myTeamStats', {
                    points: myTeam.totalRankingScore.toLocaleString('fr-FR'),
                    members: myTeam.totalMembers,
                    podiums: String(myTeam.totalPodiums).padStart(2, '0'),
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {p1 && p2 && p3 && (
        <section className={styles.podiumWrap} aria-label={tTeams('ariaPodium')}>
          <div className={styles.podium}>
            <TeamPodiumCard team={p2} position={2} tone="p2" pointsUnit={tUnits('points')} />
            <TeamPodiumCard team={p1} position={1} tone="p1" pointsUnit={tUnits('points')} />
            <TeamPodiumCard team={p3} position={3} tone="p3" pointsUnit={tUnits('points')} />
          </div>
        </section>
      )}

      <div className={styles.viewSwitch}>
        <Link
          href={'/ranking' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.season')}</Link>
        <Link
          href={'/ranking/races' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.races')}</Link>
        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`}>{t('viewSwitch.teams')}</button>
      </div>

      <section className={styles.rankingWrap}>
        <div className={styles.ranking}>
          <div className={styles.rankingHead}>
            <span className={styles.num}>{tTeams('table.rank')}</span>
            <span>{tTeams('table.team')}</span>
            <span className={styles.colCaptain}>{tTeams('table.captain')}</span>
            <span className={`${styles.num} ${styles.colMembers}`}>{tTeams('table.members')}</span>
            <span className={`${styles.num} ${styles.colPoints}`}>{tTeams('table.points')}</span>
            <span className={`${styles.num} ${styles.colPodiums}`}>{tTeams('table.podiums')}</span>
            <span className={styles.num}>{tTeams('table.trend')}</span>
          </div>

          {teams.map((tm) => {
            const { main, suffix } = formatRank(tm.rank);
            const isMyTeamRow = !isVisitor && tm.isMyTeam;
            const rowCls = [
              styles.row,
              tm.rank <= 3 ? styles.rowPodium : '',
              isMyTeamRow ? styles.rowMyTeam : '',
            ].filter(Boolean).join(' ');
            return (
              <Link
                key={tm.slug}
                href={`/team/${encodeURIComponent(tm.slug)}` as Parameters<typeof Link>[0]['href']}
                className={rowCls}
              >
                <span className={styles.pos}>{main}<sup>{suffix}</sup></span>
                <div className={styles.team}>
                  <Flag code={tm.country} className={styles.flag} />
                  <div className={styles.teamInfo}>
                    <p className={styles.teamName}>
                      {tm.name}
                      {isMyTeamRow && <span className={styles.myBadge}>{tTeams('myBadge')}</span>}
                    </p>
                    <p className={styles.teamCity}>{tm.baseCity} · {tm.countryLabel}</p>
                  </div>
                </div>
                <span className={`${styles.captain} ${styles.colCaptain}`}>
                  <span className={styles.captainLabel}>{tTeams('captainLabel')}</span>
                  @{tm.captainUsername}
                </span>
                <span className={`${styles.cellNum} ${styles.colMembers}`}>
                  {tm.totalMembers}
                </span>
                <span className={`${styles.cellNum} ${styles.colPoints} ${tm.rank <= 3 ? styles.gold : ''}`}>
                  {tm.totalRankingScore.toLocaleString('fr-FR')}
                </span>
                <span className={`${styles.cellNum} ${styles.colPodiums}`}>
                  {String(tm.totalPodiums).padStart(2, '0')}
                </span>
                <TrendCell trend={tm.trend} />
              </Link>
            );
          })}
        </div>
      </section>
    </SiteShell>
  );
}

function TeamPodiumCard({
  team, position, tone, pointsUnit,
}: {
  team: TeamRankingEntry;
  position: 1 | 2 | 3;
  tone: 'p1' | 'p2' | 'p3';
  pointsUnit: string;
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
        {team.totalRankingScore.toLocaleString('fr-FR')}<small>{pointsUnit}</small>
      </p>
    </Link>
  );
}

function TrendCell({ trend }: { trend: TeamRankingEntry['trend'] }): React.ReactElement {
  if (trend.dir === 'up')   return <span className={`${styles.trend} ${styles.trendUp}`}>▲ {trend.delta}</span>;
  if (trend.dir === 'down') return <span className={`${styles.trend} ${styles.trendDown}`}>▼ {trend.delta}</span>;
  return <span className={styles.trend}>—</span>;
}
