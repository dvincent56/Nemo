import Link from 'next/link';
import { Eyebrow } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import { fetchRaces, type RaceSummary } from '@/lib/api';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const CLASS_LABEL: Record<RaceSummary['boatClass'], string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

export default async function ClassementCoursesPage(): Promise<React.ReactElement> {
  const all = await fetchRaces().catch(() => []);
  // Seules les courses en cours et terminées ont un classement consultable.
  // Les courses à venir (PUBLISHED, BRIEFING) sont exclues.
  const live = all.filter((r) => r.status === 'LIVE');
  const finished = all.filter((r) => r.status === 'FINISHED');

  return (
    <SiteShell>
      <section className={styles.hero}>
        <Eyebrow trailing="Classement par course">Saison 2026</Eyebrow>
        <h1 className={styles.title}>Classement</h1>
      </section>

      <div className={styles.viewSwitch}>
        <Link
          href={'/classement' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Saison</Link>
        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`}>Par course</button>
        <Link
          href={'/classement/equipes' as Parameters<typeof Link>[0]['href']}
          className={styles.viewBtn}
        >Équipes</Link>
      </div>

      {live.length > 0 && (
        <RaceSection
          eyebrow="Mises à jour en temps réel"
          title="En cours"
          races={live}
          tone="live"
        />
      )}

      {finished.length > 0 && (
        <RaceSection
          eyebrow="Replays disponibles"
          title="Terminées"
          races={finished}
          tone="past"
        />
      )}

      {live.length === 0 && finished.length === 0 && (
        <p className={styles.empty}>Aucune course consultable pour le moment.</p>
      )}
    </SiteShell>
  );
}

function RaceSection({
  eyebrow, title, races, tone,
}: {
  eyebrow: string;
  title: string;
  races: RaceSummary[];
  tone: 'live' | 'past';
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
            href={`/classement/${r.id}` as Parameters<typeof Link>[0]['href']}
            className={styles.row}
          >
            <div>
              <h3 className={styles.name}>{r.name}</h3>
              <p className={styles.meta}>
                {CLASS_LABEL[r.boatClass]} · {r.tierRequired === 'CAREER' ? 'Carrière' : 'Libre'}
              </p>
            </div>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>Skippers</span>
              <span className={styles.cellValue}>{r.participants}</span>
            </div>
            <span className={`${styles.statusChip} ${
              tone === 'live' ? styles.statusLive : styles.statusFinished
            }`}>
              {tone === 'live' && <span className={styles.liveDot} aria-hidden />}
              {tone === 'live' ? 'En direct' : 'Terminée'}
            </span>
            <span className={styles.arrow} aria-hidden>→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
