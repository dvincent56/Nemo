'use client';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import styles from './TimelineHeader.module.css';

const HOUR = 3_600_000;

export function TimelineHeader(): React.ReactElement {
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const isPlaying = useGameStore((s) => s.timeline.isPlaying);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const setTime = useGameStore((s) => s.setTime);
  const goLive = useGameStore((s) => s.goLive);
  const setIsPlaying = useGameStore((s) => s.setIsPlaying);
  const setPlaybackSpeed = useGameStore((s) => s.setPlaybackSpeed);

  const dayOffset =
    raceStartMs !== null
      ? Math.floor((currentTime.getTime() - raceStartMs) / (24 * HOUR))
      : null;

  const hh = String(currentTime.getHours()).padStart(2, '0');
  const mm = String(currentTime.getMinutes()).padStart(2, '0');
  const day = currentTime.getDate();
  const months = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  const monthLabel = months[currentTime.getMonth()] ?? '';
  const dayLabel =
    dayOffset === null
      ? ''
      : dayOffset === 0
        ? 'Auj.'
        : dayOffset > 0
          ? `J+${dayOffset}`
          : `J${dayOffset}`;

  return (
    <div className={styles.header}>
      <div className={styles.time}>
        {dayLabel && <span className={styles.timeMain}>{dayLabel}</span>}
        <span className={styles.timeSub}>{hh}h{mm} · {day} {monthLabel}</span>
      </div>
      <div className={styles.spacer} />
      <button
        type="button"
        className={`${styles.btn} ${styles.stepBtn}`}
        onClick={() => setTime(new Date(currentTime.getTime() - 6 * HOUR))}
        aria-label="reculer 6 heures"
      >◀ 6h</button>
      <button
        type="button"
        className={`${styles.btn} ${isPlaying ? styles.active : ''}`}
        onClick={() => setIsPlaying(!isPlaying)}
        disabled={isLive}
        aria-label={isPlaying ? 'pause' : 'lecture'}
      >{isPlaying ? '❚❚' : '▶'}</button>
      <button
        type="button"
        className={`${styles.btn} ${playbackSpeed === 1 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(1)}
      >1x</button>
      <button
        type="button"
        className={`${styles.btn} ${playbackSpeed === 6 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(6)}
      >6x</button>
      <button
        type="button"
        className={`${styles.btn} ${playbackSpeed === 24 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(24)}
      >24x</button>
      <button
        type="button"
        className={`${styles.btn} ${styles.stepBtn}`}
        onClick={() => setTime(new Date(currentTime.getTime() + 6 * HOUR))}
        aria-label="avancer 6 heures"
      >6h ▶</button>
      <button
        type="button"
        className={`${styles.live} ${isLive ? styles.liveActive : ''}`}
        onClick={() => goLive()}
      >● LIVE</button>
    </div>
  );
}
