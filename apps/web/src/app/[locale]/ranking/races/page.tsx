import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Eyebrow } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import { fetchRaces, type RaceSummary } from '@/lib/api';
import { getBoatLabel } from '@/lib/boat-classes-i18n';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function RankingRacesPage(): Promise<React.ReactElement> {
  const t = await getTranslations('ranking');
  const tRaces = await getTranslations('ranking.races');
  const boatLabel = await getBoatLabel();
  const all = await fetchRaces().catch(() => []);
  const live = all.filter((r) => r.status === 'LIVE');
  const finished = all.filter((r) => r.status === 'FINISHED');

  return (
    <SiteShell>
      <section className={styles.hero}>
        <Eyebrow trailing={tRaces('eyebrowTrailing')}>{t('eyebrowSeason')}</Eyebrow>
        <h1 className={styles.title}>{t('title')}</h1>
      </section>

      <div className={styles.viewSwitch}>
        <Link
          href={'/ranking' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.season')}</Link>
        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`}>{t('viewSwitch.races')}</button>
        <Link
          href={'/ranking/teams' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >{t('viewSwitch.teams')}</Link>
      </div>

      {live.length > 0 && (
        <RaceSection
          eyebrow={tRaces('liveSection.eyebrow')}
          title={tRaces('liveSection.title')}
          races={live}
          tone="live"
          tRaces={tRaces}
          boatLabel={boatLabel}
        />
      )}

      {finished.length > 0 && (
        <RaceSection
          eyebrow={tRaces('pastSection.eyebrow')}
          title={tRaces('pastSection.title')}
          races={finished}
          tone="past"
          tRaces={tRaces}
          boatLabel={boatLabel}
        />
      )}

      {live.length === 0 && finished.length === 0 && (
        <p className={styles.empty}>{tRaces('empty')}</p>
      )}
    </SiteShell>
  );
}

function RaceSection({
  eyebrow, title, races, tone, tRaces, boatLabel,
}: {
  eyebrow: string;
  title: string;
  races: RaceSummary[];
  tone: 'live' | 'past';
  tRaces: Awaited<ReturnType<typeof getTranslations>>;
  boatLabel: Awaited<ReturnType<typeof getBoatLabel>>;
}): React.ReactElement {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <p className={styles.sectionEyebrow}>{eyebrow}</p>
        <h2 className={styles.sectionTitle}>
          {title} <span className={styles.count}>{String(races.length).padStart(2, '0')}</span>
        </h2>
      </header>
      <div className={styles.list}>
        {races.map((r) => (
          <Link
            key={r.id}
            href={`/ranking/${r.id}` as Parameters<typeof Link>[0]['href']}
            className={styles.row}
          >
            <div>
              <h3 className={styles.name}>{r.name}</h3>
              <p className={styles.meta}>
                {boatLabel(r.boatClass)} · {r.tierRequired === 'CAREER' ? tRaces('tier.career') : tRaces('tier.free')}
              </p>
            </div>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>{tRaces('skippers')}</span>
              <span className={styles.cellValue}>{r.participants}</span>
            </div>
            <span className={`${styles.statusChip} ${
              tone === 'live' ? styles.statusLive : styles.statusFinished
            }`}>
              {tone === 'live' && <span className={styles.liveDot} aria-hidden />}
              {tone === 'live' ? tRaces('chipLive') : tRaces('chipFinished')}
            </span>
            <span className={styles.arrow} aria-hidden>→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
