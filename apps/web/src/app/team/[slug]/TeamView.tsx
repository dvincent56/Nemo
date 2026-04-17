'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eyebrow, Pagination } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import { profileHref } from '@/lib/routes';
import type { BoatClass } from '@/app/classement/data';
import type { TeamMember, TeamProfile } from '../data';
import styles from './page.module.css';

const MEMBER_PAGE_SIZE = 12;

const CLASS_LABEL: Record<BoatClass, string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  CAPTAIN: 'Capitaine',
  MODERATOR: 'Modérateur',
  MEMBER: 'Membre',
};

export default function TeamView({ team }: { team: TeamProfile }): React.ReactElement {
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
          <Eyebrow trailing={`Équipe · ${team.foundedYear}`}>Circuit Nemo</Eyebrow>
          <h1 className={styles.title}>{team.name}</h1>
          <p className={styles.meta}>
            Basée à <strong>{team.baseCity}</strong> · {team.countryLabel} ·
            {' '}{team.totalMembers} {team.totalMembers > 1 ? 'skippers' : 'skipper'}
          </p>
          <p className={styles.description}>{team.description}</p>

          {team.activeClasses.length > 0 && (
            <div className={styles.classTags}>
              {team.activeClasses.map((c) => (
                <span key={c} className={styles.classTag}>{CLASS_LABEL[c]}</span>
              ))}
            </div>
          )}
        </div>

        <aside className={styles.heroStats}>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>Rang équipe</p>
            <p className={`${styles.heroStatValue} ${styles.gold}`}>
              {teamRank ? <>{teamRank.main}<sup>{teamRank.suffix}</sup></> : '—'}
            </p>
            <p className={styles.heroStatSub}>Classement inter-équipes</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>Meilleur membre</p>
            <p className={styles.heroStatValue}>
              {bestRank ? <>{bestRank.main}<sup>{bestRank.suffix}</sup></> : '—'}
            </p>
            <p className={styles.heroStatSub}>Rang saison toutes classes</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>Podiums cumulés</p>
            <p className={styles.heroStatValue}>
              {String(team.totalPodiums).padStart(2, '0')}
            </p>
            <p className={styles.heroStatSub}>Tous membres confondus</p>
          </div>
          <div className={styles.heroStat}>
            <p className={styles.heroStatLabel}>Courses saison</p>
            <p className={styles.heroStatValue}>{team.totalRacesFinished}</p>
            <p className={styles.heroStatSub}>Agrégé</p>
          </div>
        </aside>
      </section>

      <section className={styles.section} aria-label="Roster">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Roster</p>
            <h2 className={styles.sectionTitle}>
              Skippers
              <span className={styles.count}>{String(team.totalMembers).padStart(2, '0')}</span>
            </h2>
          </div>
          <Link
            href={'/classement/equipes' as Parameters<typeof Link>[0]['href']}
            className={styles.sectionLink}
          >
            Classement des équipes →
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
            label="Pagination membres de l'équipe"
          />
        )}
      </section>
    </>
  );
}

function MemberCard({
  member, meUsername,
}: { member: TeamMember; meUsername: string | null }): React.ReactElement {
  const rank = member.seasonRank ? formatRank(member.seasonRank) : null;
  const isMe = meUsername !== null && member.username === meUsername;
  // Mockup-seed : le marqueur mock `'vous'` sert aussi d'identifiant "moi"
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
              {ROLE_LABEL[member.role]}
            </span>
          )}
        </p>
        <p className={styles.memberMeta}>{member.city} · {member.country.toUpperCase()}</p>
      </div>

      <div className={styles.memberRankBlock}>
        <p className={styles.memberRankLabel}>Rang saison</p>
        <p className={`${styles.memberRank} ${member.seasonRank && member.seasonRank <= 3 ? styles.gold : ''}`}>
          {rank ? <>{rank.main}<sup>{rank.suffix}</sup></> : '—'}
        </p>
      </div>

      <dl className={styles.memberStats}>
        <div>
          <dt>Points</dt>
          <dd>{member.rankingScore.toLocaleString('fr-FR')}</dd>
        </div>
        <div>
          <dt>Courses</dt>
          <dd>{member.racesFinished}</dd>
        </div>
        <div>
          <dt>Podiums</dt>
          <dd>{String(member.podiums).padStart(2, '0')}</dd>
        </div>
      </dl>
    </Link>
  );
}
