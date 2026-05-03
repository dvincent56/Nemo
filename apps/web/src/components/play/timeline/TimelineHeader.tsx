'use client';
import type * as React from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import styles from './TimelineHeader.module.css';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function TimelineHeader(): React.ReactElement {
  const t = useTranslations('play.timeline.header');
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);

  const months = t('months').split(',');

  function relativeLabel(currentMs: number, nowMs: number, live: boolean): string {
    if (live) return t('live');
    const dt = currentMs - nowMs;
    const abs = Math.abs(dt);
    if (abs < HOUR) return t('now');
    if (abs < DAY) {
      const h = Math.round(dt / HOUR);
      return h >= 0 ? t('tPlus', { h }) : t('tMinus', { h });
    }
    const d = Math.round(dt / DAY);
    return d >= 0 ? t('jPlus', { d }) : t('jMinus', { d });
  }

  const currentMs = currentTime.getTime();
  const nowMs = isLive ? currentMs : Date.now();

  const hh = String(currentTime.getHours()).padStart(2, '0');
  const mm = String(currentTime.getMinutes()).padStart(2, '0');
  const day = currentTime.getDate();
  const monthLabel = months[currentTime.getMonth()] ?? '';

  const offsetLabel = relativeLabel(currentMs, nowMs, isLive);

  return (
    <div className={styles.header}>
      <span className={`${styles.offset} ${isLive ? styles.offsetLive : ''}`}>
        {isLive && <span className={styles.dot} />}
        {offsetLabel}
      </span>
      <span className={styles.timestamp}>
        {hh}h{mm}<span className={styles.sep}>·</span>{day} {monthLabel}
      </span>
    </div>
  );
}
