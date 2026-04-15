import { fetchRaces } from '@/lib/api';
import { Eyebrow, SiteShell } from '@/components/ui';
import RaceList from './RaceList';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function RacesPage(): Promise<React.ReactElement> {
  const races = await fetchRaces().catch(() => []);
  const liveCount = races.filter((r) => r.status === 'LIVE').length;
  const openCount = races.filter((r) => r.status === 'PUBLISHED').length;
  const soonCount = races.filter((r) => r.status === 'BRIEFING').length;

  return (
    <SiteShell>
      <header className={styles.masthead}>
        <div className={styles.mastheadMain}>
          <Eyebrow trailing="Saison 2026 · Circuit offshore">01 · Courses disponibles</Eyebrow>
          <h1 className={styles.title}>Courses</h1>
        </div>
        <aside className={styles.counters}>
          <Counter label="En direct" value={String(liveCount).padStart(2, '0')} tone="live" />
          <Counter label="Ouvertes" value={String(openCount).padStart(2, '0')} />
          <Counter label="Bientôt" value={String(soonCount).padStart(2, '0')} tone="gold" />
        </aside>
      </header>
      <RaceList races={races} />
    </SiteShell>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: 'live' | 'gold' }): React.ReactElement {
  const cls = [styles.counterValue, tone === 'live' ? styles.counterLive : '', tone === 'gold' ? styles.counterGold : '']
    .filter(Boolean).join(' ');
  return (
    <div className={styles.counter}>
      <p className={styles.counterLabel}>{label}</p>
      <p className={cls}>{value}</p>
    </div>
  );
}
