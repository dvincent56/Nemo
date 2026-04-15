'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { RaceSummary } from '@/lib/api';
import { Card, Chip } from '@/components/ui';
import styles from './page.module.css';

const CLASSES: Array<RaceSummary['boatClass'] | 'ALL'> = ['ALL', 'FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM'];

const CLASS_LABEL: Record<RaceSummary['boatClass'], string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

const STATUSES: Array<RaceSummary['status'] | 'ALL'> = ['ALL', 'LIVE', 'PUBLISHED', 'BRIEFING', 'FINISHED'];

const STATUS_LABEL: Record<RaceSummary['status'], string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Ouvert',
  BRIEFING: 'Bientôt',
  LIVE: 'En direct',
  FINISHED: 'Terminée',
  ARCHIVED: 'Archivée',
};

type ChipStatus = 'live' | 'open' | 'soon' | 'past';
function statusVariant(s: RaceSummary['status']): ChipStatus {
  if (s === 'LIVE') return 'live';
  if (s === 'PUBLISHED') return 'open';
  if (s === 'BRIEFING') return 'soon';
  return 'past';
}

function minify(points: [number, number][]): string {
  if (points.length === 0) return '';
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const w = Math.max(0.01, maxLon - minLon);
  const h = Math.max(0.01, maxLat - minLat);
  return points
    .map((p, i) => {
      const x = ((p[0] - minLon) / w) * 280 + 20;
      const y = 140 - ((p[1] - minLat) / h) * 100;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const CLASS_VALUES: RaceSummary['boatClass'][] = ['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM'];
const STATUS_VALUES: RaceSummary['status'][] = ['DRAFT', 'PUBLISHED', 'BRIEFING', 'LIVE', 'FINISHED', 'ARCHIVED'];

function readParam<T extends string>(value: string | null, allowed: readonly T[]): T | 'ALL' {
  if (!value) return 'ALL';
  const up = value.toUpperCase();
  return (allowed as readonly string[]).includes(up) ? (up as T) : 'ALL';
}

export default function RaceList({ races }: { races: RaceSummary[] }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Source de vérité : URL (?class=...&status=...). Permet les liens profonds
  // depuis /marina (« Voir les courses Ultim » → /races?class=ULTIM).
  const classFilter = readParam(searchParams.get('class'), CLASS_VALUES);
  const statusFilter = readParam(searchParams.get('status'), STATUS_VALUES);

  const setClassFilter = useCallback((next: string): void => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === 'ALL') sp.delete('class'); else sp.set('class', next);
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}` as Parameters<typeof router.replace>[0], { scroll: false });
  }, [router, pathname, searchParams]);

  const setStatusFilter = useCallback((next: string): void => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === 'ALL') sp.delete('status'); else sp.set('status', next);
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}` as Parameters<typeof router.replace>[0], { scroll: false });
  }, [router, pathname, searchParams]);

  const visible = useMemo(() => {
    return races.filter((r) => {
      if (classFilter !== 'ALL' && r.boatClass !== classFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      return true;
    });
  }, [races, classFilter, statusFilter]);

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>Classe</p>
          {CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.filterTab} ${c === classFilter ? styles.filterTabActive : ''}`}
              onClick={() => setClassFilter(c)}
            >
              {c === 'ALL' ? 'Toutes' : CLASS_LABEL[c]}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>Statut</p>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.filterTab} ${s === statusFilter ? styles.filterTabActive : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'ALL' ? 'Tous' : STATUS_LABEL[s as RaceSummary['status']]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {visible.length === 0 ? (
          <p className={styles.empty}>Aucune course ne correspond — retire un filtre.</p>
        ) : visible.map((r) => {
          const pts: [number, number][] = [r.course.start, ...r.course.waypoints, r.course.finish];
          const path = minify(pts);
          return (
            <Card key={r.id} href={`/play/${r.id}`} accent className={styles.card}>
              <header className={styles.cardHead}>
                <div>
                  <h3 className={styles.cardTitle}>{r.name}</h3>
                  <p className={styles.cardMeta}>
                    <span>{CLASS_LABEL[r.boatClass]}</span>
                    <span className={styles.cardMetaSep} />
                    <span className={r.tierRequired === 'CAREER' ? styles.tierCareer : styles.tierFree}>
                      {r.tierRequired === 'CAREER' ? 'Carrière' : 'Libre'}
                    </span>
                  </p>
                </div>
                <Chip variant={statusVariant(r.status)}>{STATUS_LABEL[r.status]}</Chip>
              </header>

              <div className={styles.mini}>
                <svg className={styles.miniSvg} viewBox="0 0 320 160" preserveAspectRatio="none">
                  <path d={path} stroke="#1a2840" strokeWidth="1.5" fill="none"
                        strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
                  {pts.map((_, i) => {
                    const segs = path.split(' ');
                    const seg = segs[i];
                    if (!seg) return null;
                    const m = /[ML]([-\d.]+),([-\d.]+)/.exec(seg);
                    if (!m) return null;
                    const isStart = i === 0;
                    const isFinish = i === pts.length - 1;
                    const fill = isStart ? '#2d8a4e' : isFinish ? '#c9a227' : '#c9a227';
                    return (
                      <circle key={i} cx={m[1]} cy={m[2]}
                              r={isStart || isFinish ? 3 : 2} fill={fill} />
                    );
                  })}
                </svg>
              </div>

              <div className={styles.stats}>
                <div>
                  <p className={styles.statLabel}>Inscrits</p>
                  <p className={styles.statValue}>
                    {r.participants}<span className={styles.statValueSmall}> / {r.maxParticipants}</span>
                  </p>
                </div>
                <div>
                  <p className={styles.statLabel}>Durée est.</p>
                  <p className={styles.statValue}>
                    {r.estimatedDurationHours}<span className={styles.statValueSmall}> h</span>
                  </p>
                </div>
                <div>
                  <p className={styles.statLabel}>Dotation</p>
                  <p className={`${styles.statValue} ${styles.statValueGold}`}>
                    {r.rewardMaxCredits.toLocaleString('fr-FR')}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
