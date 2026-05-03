'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Flag } from '@/components/ui';
import type { PublicProfile } from '@/app/[locale]/ranking/data';
import { CLASS_LABEL } from '@/lib/boat-classes';
import baseStyles from '../page.module.css';
import styles from './page.module.css';

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

type FriendStatus = 'none' | 'pending' | 'friend';

export default function PublicProfileView({
  profile,
  isVisitor,
}: {
  profile: PublicProfile;
  isVisitor: boolean;
}): React.ReactElement {
  const [friendStatus, setFriendStatus] = useState<FriendStatus>(
    profile.isFriend ? 'friend' : 'none',
  );

  const handleAddFriend = (): void => {
    // TODO POST /api/v1/invitations (type FRIEND)
    setFriendStatus((prev) => prev === 'none' ? 'pending' : prev);
  };
  const handleCancelInvite = (): void => setFriendStatus('none');
  const handleRemoveFriend = (): void => setFriendStatus('none');

  const best = profile.seasonRank ? formatRank(profile.seasonRank) : null;

  return (
    <>
      <section className={baseStyles.hero}>
        <div className={baseStyles.heroMain}>
          <p className={baseStyles.eyebrow}>Skipper · Saison 2026</p>
          <h1 className={baseStyles.pseudo}>{profile.username}</h1>
          <div className={baseStyles.origin}>
            <Flag code={profile.country} className={styles.flag} />
            {profile.countryLabel}
            <span className={baseStyles.originCity}>· {profile.city}</span>
          </div>
        </div>

        <div className={baseStyles.side}>
          {profile.tagline ? (
            <blockquote className={baseStyles.tagline}>{profile.tagline}</blockquote>
          ) : (
            <p className={styles.noTagline}>Ce skipper n'a pas encore de devise publique.</p>
          )}
          <div className={baseStyles.meta}>
            <span>Inscrit depuis <strong>{profile.memberSince}</strong></span>
            {profile.team && (
              <span>
                Équipe{' '}
                <Link
                  href={`/team/${encodeURIComponent(teamSlug(profile.team))}` as Parameters<typeof Link>[0]['href']}
                  className={styles.teamLink}
                >
                  <strong>{profile.team}</strong>
                </Link>
              </span>
            )}
            <span>Bateau favori <strong>{profile.favoriteBoatName}</strong></span>
          </div>

          {!isVisitor && !profile.isMe && (
            <div className={baseStyles.actions}>
              {friendStatus === 'none' && (
                <Button variant="primary" icon onClick={handleAddFriend}>
                  Ajouter en ami
                </Button>
              )}
              {friendStatus === 'pending' && (
                <Button variant="secondary" icon onClick={handleCancelInvite}>
                  Invitation envoyée · Annuler
                </Button>
              )}
              {friendStatus === 'friend' && (
                <Button variant="secondary" icon onClick={handleRemoveFriend}>
                  Retirer des amis
                </Button>
              )}
              <Link href={'/profile/social' as Parameters<typeof Link>[0]['href']}>
                <Button variant="secondary" icon>Voir mes amis</Button>
              </Link>
            </div>
          )}
          {!isVisitor && profile.isMe && (
            <div className={baseStyles.actions}>
              <Link href={'/profile' as Parameters<typeof Link>[0]['href']}>
                <Button variant="primary" icon>Aller à mon profil</Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className={baseStyles.statsBand} aria-label="Statistiques">
        <div className={baseStyles.statsGrid}>
          <StatCell
            label="Rang saison"
            value={best ? best.main : '—'}
            suffix={best?.suffix}
            sub="Classement toutes classes"
            gold
          />
          <StatCell
            label="Courses"
            value={String(profile.totalRacesFinished).padStart(2, '0')}
            sub="Toutes classes confondues"
          />
          <StatCell
            label="Podiums"
            value={String(profile.totalPodiums).padStart(2, '0')}
            sub="Top 3 cumulé"
            gold
          />
          <StatCell
            label="Points saison"
            value={profile.totalRankingScore.toLocaleString('fr-FR')}
            sub="Score composite"
          />
        </div>
      </section>

      <section className={baseStyles.section} aria-label="Classement par classe">
        <header className={baseStyles.sectionHead}>
          <div>
            <p className={baseStyles.sectionEyebrow}>Performance par classe</p>
            <h2 className={baseStyles.sectionTitle}>Palmarès par flotte</h2>
          </div>
          <Link href={'/ranking' as Parameters<typeof Link>[0]['href']} className={baseStyles.sectionLink}>
            Voir le classement complet →
          </Link>
        </header>

        {profile.classes.length === 0 ? (
          <p className={styles.emptyClasses}>
            Ce skipper n'a encore disputé aucune course classée.
          </p>
        ) : (
          <div className={styles.classGrid}>
            {profile.classes.map((c) => {
              const rank = c.rank ? formatRank(c.rank) : null;
              return (
                <article key={c.boatClass} className={styles.classCard}>
                  <p className={styles.classLabel}>{CLASS_LABEL[c.boatClass]}</p>
                  <p className={styles.classRank}>
                    {rank ? <>{rank.main}<sup>{rank.suffix}</sup></> : '—'}
                  </p>
                  <p className={styles.classBoat}>{c.favoriteBoatName}</p>
                  <dl className={styles.classStats}>
                    <div>
                      <dt>Points</dt>
                      <dd>{c.rankingScore.toLocaleString('fr-FR')}</dd>
                    </div>
                    <div>
                      <dt>Courses</dt>
                      <dd>{c.racesFinished}</dd>
                    </div>
                    <div>
                      <dt>Podiums</dt>
                      <dd>{String(c.podiums).padStart(2, '0')}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function StatCell({
  label, value, unit, suffix, sub, gold,
}: {
  label: string;
  value: string;
  unit?: string;
  suffix?: string | undefined;
  sub: string;
  gold?: boolean;
}): React.ReactElement {
  return (
    <div className={baseStyles.statCell}>
      <p className={baseStyles.statLabel}>{label}</p>
      <p className={`${baseStyles.statValue} ${gold ? baseStyles.statValueGold : ''}`}>
        {value}
        {suffix && <sup>{suffix}</sup>}
        {unit && <small>{unit}</small>}
      </p>
      <p className={baseStyles.statSub}>{sub}</p>
    </div>
  );
}

/** Dérive un slug URL à partir du nom d'équipe (seed local — côté DB ce sera
 *  `teams.slug` directement). */
function teamSlug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
