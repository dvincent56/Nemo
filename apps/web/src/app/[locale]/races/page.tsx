import { getTranslations } from 'next-intl/server';
import { fetchRaces } from '@/lib/api';
import { Eyebrow } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import RaceList from './RaceList';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function RacesPage(): Promise<React.ReactElement> {
  const t = await getTranslations('races');
  const races = await fetchRaces().catch(() => []);
  const liveCount = races.filter((r) => r.status === 'LIVE').length;
  const openCount = races.filter((r) => r.status === 'PUBLISHED' || r.status === 'BRIEFING').length;
  const finishedCount = races.filter((r) => r.status === 'FINISHED').length;

  return (
    <SiteShell>
      <header className={styles.masthead}>
        <div className={styles.mastheadMain}>
          <Eyebrow trailing={t('eyebrowSeason')}>{t('eyebrowNum')}</Eyebrow>
          <h1 className={styles.title}>{t('title')}</h1>
        </div>
        <aside className={styles.counters}>
          <Counter label={t('counters.live')} value={String(liveCount).padStart(2, '0')} tone="live" />
          <Counter label={t('counters.open')} value={String(openCount).padStart(2, '0')} />
          <Counter label={t('counters.finished')} value={String(finishedCount).padStart(2, '0')} tone="gold" />
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
