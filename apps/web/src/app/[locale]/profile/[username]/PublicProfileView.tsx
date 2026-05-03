'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Flag } from '@/components/ui';
import type { PublicProfile } from '@/app/[locale]/ranking/data';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
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
  const t = useTranslations('profile');
  const tPub = useTranslations('profile.public');
  const boatLabel = useBoatLabel();
  const [friendStatus, setFriendStatus] = useState<FriendStatus>(
    profile.isFriend ? 'friend' : 'none',
  );

  const handleAddFriend = (): void => {
    setFriendStatus((prev) => prev === 'none' ? 'pending' : prev);
  };
  const handleCancelInvite = (): void => setFriendStatus('none');
  const handleRemoveFriend = (): void => setFriendStatus('none');

  const best = profile.seasonRank ? formatRank(profile.seasonRank) : null;

  return (
    <>
      <section className={baseStyles.hero}>
        <div className={baseStyles.heroMain}>
          <p className={baseStyles.eyebrow}>{tPub('eyebrow')}</p>
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
            <p className={styles.noTagline}>{tPub('noTagline')}</p>
          )}
          <div className={baseStyles.meta}>
            <span>{t('memberSince')} <strong>{profile.memberSince}</strong></span>
            {profile.team && (
              <span>
                {t('teamLabel')}{' '}
                <Link
                  href={`/team/${encodeURIComponent(teamSlug(profile.team))}` as Parameters<typeof Link>[0]['href']}
                  className={styles.teamLink}
                >
                  <strong>{profile.team}</strong>
                </Link>
              </span>
            )}
            <span>{t('favoriteBoat')} <strong>{profile.favoriteBoatName}</strong></span>
          </div>

          {!isVisitor && !profile.isMe && (
            <div className={baseStyles.actions}>
              {friendStatus === 'none' && (
                <Button variant="primary" icon onClick={handleAddFriend}>
                  {tPub('actions.addFriend')}
                </Button>
              )}
              {friendStatus === 'pending' && (
                <Button variant="secondary" icon onClick={handleCancelInvite}>
                  {tPub('actions.invitationSent')}
                </Button>
              )}
              {friendStatus === 'friend' && (
                <Button variant="secondary" icon onClick={handleRemoveFriend}>
                  {tPub('actions.removeFriend')}
                </Button>
              )}
              <Link href={'/profile/social' as Parameters<typeof Link>[0]['href']}>
                <Button variant="secondary" icon>{tPub('actions.viewMyFriends')}</Button>
              </Link>
            </div>
          )}
          {!isVisitor && profile.isMe && (
            <div className={baseStyles.actions}>
              <Link href={'/profile' as Parameters<typeof Link>[0]['href']}>
                <Button variant="primary" icon>{tPub('actions.goToProfile')}</Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className={baseStyles.statsBand} aria-label={t('ariaStats')}>
        <div className={baseStyles.statsGrid}>
          <StatCell
            label={tPub('stats.seasonRank')}
            value={best ? best.main : '—'}
            suffix={best?.suffix}
            sub={tPub('stats.seasonRankSub')}
            gold
          />
          <StatCell
            label={tPub('stats.races')}
            value={String(profile.totalRacesFinished).padStart(2, '0')}
            sub={tPub('stats.racesSub')}
          />
          <StatCell
            label={tPub('stats.podiums')}
            value={String(profile.totalPodiums).padStart(2, '0')}
            sub={tPub('stats.podiumsSub')}
            gold
          />
          <StatCell
            label={tPub('stats.seasonPoints')}
            value={profile.totalRankingScore.toLocaleString('fr-FR')}
            sub={tPub('stats.seasonPointsSub')}
          />
        </div>
      </section>

      <section className={baseStyles.section} aria-label={tPub('classRanking.aria')}>
        <header className={baseStyles.sectionHead}>
          <div>
            <p className={baseStyles.sectionEyebrow}>{tPub('classRanking.eyebrow')}</p>
            <h2 className={baseStyles.sectionTitle}>{tPub('classRanking.title')}</h2>
          </div>
          <Link href={'/ranking' as Parameters<typeof Link>[0]['href']} className={baseStyles.sectionLink}>
            {tPub('classRanking.link')}
          </Link>
        </header>

        {profile.classes.length === 0 ? (
          <p className={styles.emptyClasses}>{tPub('classRanking.empty')}</p>
        ) : (
          <div className={styles.classGrid}>
            {profile.classes.map((c) => {
              const rank = c.rank ? formatRank(c.rank) : null;
              return (
                <article key={c.boatClass} className={styles.classCard}>
                  <p className={styles.classLabel}>{boatLabel(c.boatClass)}</p>
                  <p className={styles.classRank}>
                    {rank ? <>{rank.main}<sup>{rank.suffix}</sup></> : '—'}
                  </p>
                  <p className={styles.classBoat}>{c.favoriteBoatName}</p>
                  <dl className={styles.classStats}>
                    <div>
                      <dt>{tPub('classRanking.points')}</dt>
                      <dd>{c.rankingScore.toLocaleString('fr-FR')}</dd>
                    </div>
                    <div>
                      <dt>{tPub('classRanking.races')}</dt>
                      <dd>{c.racesFinished}</dd>
                    </div>
                    <div>
                      <dt>{tPub('classRanking.podiums')}</dt>
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

function teamSlug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
