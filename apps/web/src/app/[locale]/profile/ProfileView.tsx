'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Flag, BoatSvg } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import { fetchMyBoats } from '@/lib/marina-api';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import { PROFILE_SEED, type FleetBoat, type PalmaresEntry, type ActivityEntry } from './data';
import styles from './page.module.css';

function formatRank(n: number): { main: string; suffix: string } {
  return {
    main: String(n).padStart(2, '0'),
    suffix: n === 1 ? 'er' : 'e',
  };
}

function FleetTile({ boat }: { boat: FleetBoat }): React.ReactElement {
  const t = useTranslations('profile.fleet.tile');
  const boatLabel = useBoatLabel();
  return (
    <Link
      href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']}
      className={styles.fleetTile}
    >
      <span className={styles.fleetClass}>{boatLabel(boat.class)}</span>
      <h3 className={styles.fleetName}>{boat.name}</h3>
      <BoatSvg className={styles.fleetSvg} hullColor={boat.hullColor} />
      <div className={styles.fleetMini}>
        <span>{t('races', { n: String(boat.races).padStart(2, '0') })}</span>
        {boat.bestRank ? (
          <span>
            <strong>{String(boat.bestRank).padStart(2, '0')}<sup>{boat.bestRank === 1 ? 'er' : 'e'}</sup></strong> {t('best')}
          </span>
        ) : <span>—</span>}
      </div>
    </Link>
  );
}

function PalmaresRow({ entry }: { entry: PalmaresEntry }): React.ReactElement {
  const boatLabel = useBoatLabel();
  const { main, suffix } = formatRank(entry.position);

  return (
    <div className={styles.listRow}>
      <span className={`${styles.listPos} ${entry.position <= 3 ? styles.listPosPodium : ''}`}>
        {main}<sup>{suffix}</sup>
      </span>
      <div>
        <p className={styles.listName}>{entry.raceName}</p>
        <p className={styles.listMeta}>
          {boatLabel(entry.boatClass)} · {entry.dateLabel} · {entry.distanceNm.toLocaleString('fr-FR')} NM
        </p>
      </div>
      <span className={styles.listBoat}>{entry.boat}</span>
      <span className={styles.listTime}>{entry.time}</span>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.ReactElement {
  // boatClass est ici une string libre (cf. data.ts) — pré-rendue, pas
  // un enum BoatClass. Pas de useBoatLabel ici.
  const { main, suffix } = formatRank(entry.position);
  return (
    <div className={styles.listRow}>
      <span className={`${styles.listPos} ${entry.position <= 3 ? styles.listPosPodium : ''}`}>
        {main}<sup>{suffix}</sup>
      </span>
      <div>
        <p className={styles.listName}>{entry.raceName}</p>
        <p className={styles.listMeta}>
          {entry.boatClass} · {entry.status}
        </p>
      </div>
      <span className={styles.listBoat}>{entry.boat}</span>
      <span className={styles.listDate}>{entry.dateLabel}</span>
    </div>
  );
}

export default function ProfileView(): React.ReactElement | null {
  const router = useRouter();
  const t = useTranslations('profile');
  const [username, setUsername] = useState<string | null>(null);
  const [fleet, setFleet] = useState<FleetBoat[]>([]);

  useEffect(() => {
    const s = readClientSession();
    if (s.username) {
      setUsername(s.username);
      fetchMyBoats().then(({ boats }) => {
        setFleet(boats.map((b) => ({
          id: b.id,
          class: b.boatClass as FleetBoat['class'],
          name: b.name,
          races: b.racesCount,
          bestRank: null,
          hullColor: b.hullColor ?? '#1a2840',
        })));
      }).catch(() => { /* fleet reste vide */ });
    } else {
      router.replace('/login');
    }
  }, [router]);

  if (!username) return null;

  const s = PROFILE_SEED.stats;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>{t('eyebrow')}</p>
          <h1 className={styles.pseudo}>{username}</h1>
          <div className={styles.origin}>
            <Flag code={PROFILE_SEED.country} className={styles.flag} />
            {PROFILE_SEED.countryLabel}
            <span className={styles.originCity}>· {PROFILE_SEED.city}</span>
          </div>
        </div>

        <div className={styles.side}>
          <blockquote className={styles.tagline}>{PROFILE_SEED.tagline}</blockquote>
          <div className={styles.meta}>
            <span>{t('memberSince')} <strong>{PROFILE_SEED.memberSince}</strong></span>
            <span>
              {t('teamLabel')}{' '}
              <Link
                href={'/team/la-rochelle-racing' as Parameters<typeof Link>[0]['href']}
                className={styles.teamLink}
              >
                <strong>{PROFILE_SEED.team}</strong>
              </Link>
            </span>
            <span>{t('favoriteBoat')} <strong>{PROFILE_SEED.favoriteBoat}</strong></span>
          </div>
          <div className={styles.actions}>
            <Link href={'/profile/settings' as Parameters<typeof Link>[0]['href']}>
              <Button variant="primary" icon>{t('actions.editProfile')}</Button>
            </Link>
            <Link href={'/profile/social' as Parameters<typeof Link>[0]['href']}>
              <Button variant="secondary" icon>{t('actions.friendsAndTeam')}</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.statsBand} aria-label={t('ariaStats')}>
        <div className={styles.statsGrid}>
          <StatCell
            label={t('stats.races')}
            value={String(s.races.total)}
            sub={t('stats.racesSub', { finishes: s.races.finishes, retired: s.races.retired })}
          />
          <StatCell
            label={t('stats.podiums')}
            value={String(s.podiums.total).padStart(2, '0')}
            sub={t('stats.podiumsSub', { wins: s.podiums.wins, second: s.podiums.second })}
            gold
          />
          <StatCell
            label={t('stats.distance')}
            value={`${s.distanceNm.toLocaleString('fr-FR')}`}
            unit="NM"
            sub={t('stats.distanceSub')}
          />
          <StatCell
            label={t('stats.seaHours')}
            value={s.seaHours.toLocaleString('fr-FR')}
            unit="h"
            sub={t('stats.seaHoursSub', { days: s.daysAtSea })}
          />
          <StatCell
            label={t('stats.bestRank')}
            value={String(s.bestRank.position).padStart(2, '0')}
            suffix={s.bestRank.position === 1 ? 'er' : 'e'}
            sub={t('stats.bestRankSub', { race: s.bestRank.raceName, season: s.bestRank.season })}
            gold
          />
        </div>
      </section>

      <section className={styles.section} aria-label={t('palmares.aria')}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('palmares.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('palmares.title')}</h2>
          </div>
          <Link href={'/profile/history' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            {t('palmares.link')}
          </Link>
        </header>
        <div className={styles.list}>
          {PROFILE_SEED.palmares.map((p, i) => (
            <PalmaresRow key={`${p.raceName}-${i}`} entry={p} />
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionTop}`} aria-label={t('fleet.aria')}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('fleet.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('fleet.title')}</h2>
          </div>
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            {t('fleet.link')}
          </Link>
        </header>
        <div className={styles.fleetGrid}>
          {fleet.map((b) => <FleetTile key={b.id} boat={b} />)}
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionTop}`} aria-label={t('activity.aria')}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>{t('activity.eyebrow')}</p>
            <h2 className={styles.sectionTitle}>{t('activity.title')}</h2>
          </div>
          <Link href={'/profile/history' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            {t('activity.link')}
          </Link>
        </header>
        <div className={styles.list}>
          {PROFILE_SEED.activity.map((a, i) => (
            <ActivityRow key={`${a.raceName}-${i}`} entry={a} />
          ))}
        </div>
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
  suffix?: string;
  sub: string;
  gold?: boolean;
}): React.ReactElement {
  return (
    <div className={styles.statCell}>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${gold ? styles.statValueGold : ''}`}>
        {value}
        {suffix && <sup>{suffix}</sup>}
        {unit && <small>{unit}</small>}
      </p>
      <p className={styles.statSub}>{sub}</p>
    </div>
  );
}
