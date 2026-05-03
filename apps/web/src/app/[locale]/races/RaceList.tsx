'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { RaceSummary } from '@/lib/api';
import { Card, Chip } from '@/components/ui';
import { courseLengthNM, formatDistance, type DistanceUnit } from '@/lib/geo';
import { BOAT_CLASS_ORDER } from '@/lib/boat-classes';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import styles from './page.module.css';

const CLASSES: Array<RaceSummary['boatClass'] | 'ALL'> = ['ALL', ...BOAT_CLASS_ORDER];

const STATUSES: Array<RaceSummary['status'] | 'ALL'> = ['ALL', 'LIVE', 'PUBLISHED', 'FINISHED'];

type ChipStatus = 'live' | 'open' | 'gold';
function statusVariant(s: RaceSummary['status']): ChipStatus {
  if (s === 'LIVE') return 'live';
  if (s === 'PUBLISHED' || s === 'BRIEFING') return 'open';
  return 'gold';
}

function formatStart(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { day: '2-digit', timeZone: 'Europe/Paris' });
  const month = d
    .toLocaleDateString('fr-FR', { month: 'short', timeZone: 'Europe/Paris' })
    .replace('.', '');
  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Paris',
  });
  return `${day} ${month} · ${time}`;
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

const CLASS_VALUES = BOAT_CLASS_ORDER;
const STATUS_VALUES: RaceSummary['status'][] = ['DRAFT', 'PUBLISHED', 'BRIEFING', 'LIVE', 'FINISHED', 'ARCHIVED'];

function readParam<T extends string>(value: string | null, allowed: readonly T[]): T | 'ALL' {
  if (!value) return 'ALL';
  const up = value.toUpperCase();
  return (allowed as readonly string[]).includes(up) ? (up as T) : 'ALL';
}

export default function RaceList({
  races,
  distanceUnit = 'nm',
}: {
  races: RaceSummary[];
  distanceUnit?: DistanceUnit;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('races');
  const tStatus = useTranslations('races.status');
  const boatLabel = useBoatLabel();

  const classFilter = readParam(searchParams.get('class'), CLASS_VALUES);
  const rawStatus = readParam(searchParams.get('status'), STATUS_VALUES);
  const statusFilter = rawStatus === 'BRIEFING' ? 'PUBLISHED' : rawStatus;

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
      if (statusFilter === 'PUBLISHED') {
        if (r.status !== 'PUBLISHED' && r.status !== 'BRIEFING') return false;
      } else if (statusFilter !== 'ALL' && r.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [races, classFilter, statusFilter]);

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>{t('filters.classLabel')}</p>
          {CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.filterTab} ${c === classFilter ? styles.filterTabActive : ''}`}
              onClick={() => setClassFilter(c)}
            >
              {c === 'ALL' ? t('filters.classAll') : boatLabel(c)}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <p className={styles.filterLabel}>{t('filters.statusLabel')}</p>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.filterTab} ${s === statusFilter ? styles.filterTabActive : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'ALL' ? t('filters.statusAll') : tStatus(s as RaceSummary['status'])}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {visible.length === 0 ? (
          <p className={styles.empty}>{t('empty')}</p>
        ) : visible.map((r) => {
          const pts: [number, number][] = [r.course.start, ...r.course.waypoints, r.course.finish];
          const path = minify(pts);
          const distance = formatDistance(courseLengthNM(r.course), distanceUnit);
          return (
            <Card key={r.id} href={`/play/${r.id}`} accent className={styles.card}>
              <header className={styles.cardHead}>
                <div>
                  <h3 className={styles.cardTitle}>{r.name}</h3>
                  <p className={styles.cardMeta}>
                    <span>{boatLabel(r.boatClass)}</span>
                    <span className={styles.cardMetaSep} />
                    <span>{formatStart(r.startsAt)}</span>
                  </p>
                </div>
                <Chip variant={statusVariant(r.status)}>{tStatus(r.status)}</Chip>
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
                  <p className={styles.statLabel}>{t('card.registered')}</p>
                  <p className={styles.statValue}>
                    {r.participants.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div>
                  <p className={styles.statLabel}>{t('card.distance')}</p>
                  <p className={styles.statValue}>
                    {distance.value}<span className={styles.statValueSmall}> {distance.unit}</span>
                  </p>
                </div>
                <div>
                  <p className={styles.statLabel}>{t('card.reward')}</p>
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
