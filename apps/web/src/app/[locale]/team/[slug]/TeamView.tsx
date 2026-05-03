'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eyebrow, Pagination } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import { profileHref } from '@/lib/routes';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import type { TeamMember, TeamProfile } from '../data';
import styles from './page.module.css';

const MEMBER_PAGE_SIZE = 12;

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

export default function TeamView({ team }: { team: TeamProfile }): React.ReactElement {
  const t = useTranslations('team');
  const boatLabel = useBoatLabel();
  const [page, setPage] = useState(1);
  const [meUsername, setMeUsername] = useState<string | null>(null);
  useEffect(() => {
    const s = readClientSession();
    setMeUsername(s.username);
  }, []);

  const totalPages = Math.max(1, Math.ceil(team.members.length / MEMBER_PAGE_SIZE));
  const visibleMembers = useMemo(
    () => team.members.slice((page - 1) * MEMBER_PAGE_SIZE, page * MEMBER_PAGE_SIZE),
    [team.members, page],
  );

  const bestRank = team.bestMemberRank ? formatRank(team.bestMemberRank) : null;
  const teamRank = team.teamRank ? formatRank(team.teamRank) : null;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('hero.trailing', { year: team.foundedYear })}>{t('hero.eyebrow')}</Eyebrow>
          <h1 className={styles.title}>{team.name}</h1>
          <p className={styles.meta}>
            {t('hero.metaPre')} <strong>{team.baseCity}</strong> · {team.countryLabel} ·
            {' '}{t('hero.metaSkippers', { n: team.totalMembers })}
          </p>
          <p className={styles.description}>{team.description}</p>

          {team.activeClasses.length > 0 && (
            <div className={styles.classTags}>
              {team.activeClasses.map((c) => (
                <span key={c} className={styles.classTag}>{boatLabel(c)}</span>
              ))}
            </div>
          )}
        </div>

        <aside className={styles.heroStats}>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>{t('hero.stats.teamRank')}</p>
            <p className={`${styles.heroStatValue} ${styles.gold}`}>
              {teamRank ? <>{teamRank.main}<sup>{teamRank.suffix}</sup></> : '—'}
            </p>
            <p className={styles.heroStatSub}>{t('hero.stats.teamRankSub')}</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>{t('hero.stats.bestMember')}</p>
            <p className={styles.heroStatValue}>
              {bestRank ? <>{bestRank.main}<sup>{bestRank.suffix}</sup></> : '—'}
            </p>
            <p className={styles.heroStatSub}>{t('hero.stats.bestMemberSub')}</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>{t('hero.stats.podiums')}</p>
            <p className={styles.heroStatValue}>
              {String(team.totalPodiums).padStart(2, '0')}
            </p>
            <p className={styles.heroStatSub}>{t('hero.stats.podiumsSub')}</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>{t('hero.stats.races')}</p>
            <p className={styles.heroStatValue}>{team.totalRacesFinished}</p>
            <p className={styles.heroStatSub}>{t('hero.stats.racesSub')}</p>
          </div>
        </aside>
      </section>

      <section className={styles.section} aria-label={t('roster.aria')}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('roster.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>
              {t('roster.title')}
              <span className={styles.count}>{String(team.totalMembers).padStart(2, '0')}</span>
            </h2>
          </div>
          <Link
            href={'/ranking/teams' as Parameters<typeof Link>[0]['href']}
            className={styles.sectionLink}
          >
            {t('roster.linkRanking')}
          </Link>
        </header>

        <div className={styles.memberGrid}>
          {visibleMembers.map((m) => (
            <MemberCard key={m.username} member={m} meUsername={meUsername} />
          ))}
        </div>

        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={team.members.length}
            pageSize={MEMBER_PAGE_SIZE}
            onChange={setPage}
            label={t('roster.paginationAria')}
          />
        )}
      </section>
    </>
  );
}

function MemberCard({
  member, meUsername,
}: { member: TeamMember; meUsername: string | null }): React.ReactElement {
  const t = useTranslations('team.member');
  const rank = member.seasonRank ? formatRank(member.seasonRank) : null;
  const isMe = meUsername !== null && member.username === meUsername;
  // Mockup-seed : le marqueur 'vous' fait office d'identifiant "moi"
  // tant que la session est absente. À retirer quand getTeamProfile lira
  // le username depuis la session côté serveur.
  const isMeMock = member.username === 'vous';
  const ownRow = isMe || isMeMock;
  const displayName = ownRow && meUsername ? meUsername : member.username;
  return (
    <Link
      href={profileHref(member.username, ownRow) as Parameters<typeof Link>[0]['href']}
      className={styles.memberCard}
    >
      <div className={styles.memberHead}>
        <p className={styles.memberName}>
          {displayName}
          {member.role !== 'MEMBER' && (
            <span className={`${styles.memberRole} ${member.role === 'CAPTAIN' ? styles.roleCaptain : ''}`}>
              {t(`roles.${member.role}`)}
            </span>
          )}
        </p>
        <p className={styles.memberMeta}>{member.city} · {member.country.toUpperCase()}</p>
      </div>

      <div className={styles.memberRankBlock}>
        <p className={styles.memberRankLabel}>{t('rankLabel')}</p>
        <p className={`${styles.memberRank} ${member.seasonRank && member.seasonRank <= 3 ? styles.gold : ''}`}>
          {rank ? <>{rank.main}<sup>{rank.suffix}</sup></> : '—'}
        </p>
      </div>

      <dl className={styles.memberStats}>
        <div>
          <dt>{t('points')}</dt>
          <dd>{member.rankingScore.toLocaleString('fr-FR')}</dd>
        </div>
        <div>
          <dt>{t('races')}</dt>
          <dd>{member.racesFinished}</dd>
        </div>
        <div>
          <dt>{t('podiums')}</dt>
          <dd>{String(member.podiums).padStart(2, '0')}</dd>
        </div>
      </dl>
    </Link>
  );
}
