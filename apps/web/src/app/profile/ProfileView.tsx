'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Flag, BoatSvg } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import { fetchMyBoats } from '@/lib/marina-api';
import { PROFILE_SEED, type FleetBoat, type PalmaresEntry, type ActivityEntry } from './data';
import styles from './page.module.css';

function formatRank(n: number): { main: string; suffix: string } {
  return {
    main: String(n).padStart(2, '0'),
    suffix: n === 1 ? 'er' : 'e',
  };
}

function FleetTile({ boat }: { boat: FleetBoat }): React.ReactElement {
  return (
    <Link
      href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']}
      className={styles.fleetTile}
    >
      <span className={styles.fleetClass}>
        {boat.class === 'FIGARO' ? 'Figaro III'
          : boat.class === 'OCEAN_FIFTY' ? 'Ocean Fifty'
          : boat.class === 'IMOCA60' ? 'IMOCA 60'
          : boat.class.charAt(0) + boat.class.slice(1).toLowerCase()}
      </span>
      <h3 className={styles.fleetName}>{boat.name}</h3>
      <BoatSvg className={styles.fleetSvg} hullColor={boat.hullColor} />
      <div className={styles.fleetMini}>
        <span>{String(boat.races).padStart(2, '0')} courses</span>
        {boat.bestRank ? (
          <span>
            <strong>{String(boat.bestRank).padStart(2, '0')}<sup>{boat.bestRank === 1 ? 'er' : 'e'}</sup></strong> meilleur
          </span>
        ) : <span>—</span>}
      </div>
    </Link>
  );
}

function PalmaresRow({ entry }: { entry: PalmaresEntry }): React.ReactElement {
  const { main, suffix } = formatRank(entry.position);
  const classLabel = entry.boatClass === 'FIGARO' ? 'Figaro III'
    : entry.boatClass === 'OCEAN_FIFTY' ? 'Ocean Fifty'
    : entry.boatClass === 'IMOCA60' ? 'IMOCA 60'
    : entry.boatClass === 'CLASS40' ? 'Class40' : 'Ultim';

  return (
    <div className={styles.listRow}>
      <span className={`${styles.listPos} ${entry.position <= 3 ? styles.listPosPodium : ''}`}>
        {main}<sup>{suffix}</sup>
      </span>
      <div>
        <p className={styles.listName}>{entry.raceName}</p>
        <p className={styles.listMeta}>
          {classLabel} · {entry.dateLabel} · {entry.distanceNm.toLocaleString('fr-FR')} NM
        </p>
      </div>
      <span className={styles.listBoat}>{entry.boat}</span>
      <span className={styles.listTime}>{entry.time}</span>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.ReactElement {
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

  // Pas de session lue côté client → skeleton muet en attendant l'hydratation
  // (ou la redirection /login). Pas de fallback texte : jamais afficher
  // "Skipper" ou "vous" à la place du vrai pseudo.
  if (!username) return null;

  const s = PROFILE_SEED.stats;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>Saison 2026 · Ta page</p>
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
            <span>Inscrit depuis <strong>{PROFILE_SEED.memberSince}</strong></span>
            <span>
              Équipe{' '}
              <Link
                href={'/team/la-rochelle-racing' as Parameters<typeof Link>[0]['href']}
                className={styles.teamLink}
              >
                <strong>{PROFILE_SEED.team}</strong>
              </Link>
            </span>
            <span>Bateau favori <strong>{PROFILE_SEED.favoriteBoat}</strong></span>
          </div>
          <div className={styles.actions}>
            <Link href={'/profile/settings' as Parameters<typeof Link>[0]['href']}>
              <Button variant="primary" icon>Modifier le profil</Button>
            </Link>
            <Link href={'/profile/social' as Parameters<typeof Link>[0]['href']}>
              <Button variant="secondary" icon>Amis & équipe</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.statsBand} aria-label="Statistiques">
        <div className={styles.statsGrid}>
          <StatCell label="Courses" value={String(s.races.total)} sub={`${s.races.finishes} finishes · ${s.races.retired} abandons`} />
          <StatCell label="Podiums" value={String(s.podiums.total).padStart(2, '0')} sub={`${s.podiums.wins} victoires · ${s.podiums.second} places d'honneur`} gold />
          <StatCell label="Distance parcourue" value={`${s.distanceNm.toLocaleString('fr-FR')}`} unit="NM" sub="Tous bateaux confondus" />
          <StatCell label="Heures en mer" value={s.seaHours.toLocaleString('fr-FR')} unit="h" sub={`${s.daysAtSea} jours de navigation`} />
          <StatCell
            label="Meilleur classement"
            value={String(s.bestRank.position).padStart(2, '0')}
            suffix={s.bestRank.position === 1 ? 'er' : 'e'}
            sub={`${s.bestRank.raceName} · ${s.bestRank.season}`}
            gold
          />
        </div>
      </section>

      <section className={styles.section} aria-label="Palmarès">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Faits d'armes</p>
            <h2 className={styles.sectionTitle}>Palmarès</h2>
          </div>
          <Link href={'/profile/history' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            Voir tout l'historique →
          </Link>
        </header>
        <div className={styles.list}>
          {PROFILE_SEED.palmares.map((p, i) => (
            <PalmaresRow key={`${p.raceName}-${i}`} entry={p} />
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionTop}`} aria-label="Flotte">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Écurie</p>
            <h2 className={styles.sectionTitle}>Flotte</h2>
          </div>
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            Aller à la marina →
          </Link>
        </header>
        <div className={styles.fleetGrid}>
          {fleet.map((b) => <FleetTile key={b.id} boat={b} />)}
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionTop}`} aria-label="Activité récente">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Dernières sorties</p>
            <h2 className={styles.sectionTitle}>Activité récente</h2>
          </div>
          <Link href={'/profile/history' as Parameters<typeof Link>[0]['href']} className={styles.sectionLink}>
            Tout l'historique →
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
