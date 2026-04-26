'use client';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import styles from './TimelineControls.module.css';

const HOUR = 3_600_000;

export function TimelineControls(): React.ReactElement {
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const isPlaying = useGameStore((s) => s.timeline.isPlaying);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const setTime = useGameStore((s) => s.setTime);
  const goLive = useGameStore((s) => s.goLive);
  const setIsPlaying = useGameStore((s) => s.setIsPlaying);
  const setPlaybackSpeed = useGameStore((s) => s.setPlaybackSpeed);

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={`${styles.btn} ${styles.step}`}
        onClick={() => setTime(new Date(currentTime.getTime() - 6 * HOUR))}
        aria-label="reculer 6 heures"
        title="Reculer de 6h"
      >−6h</button>
      <button
        type="button"
        className={`${styles.btn} ${styles.play} ${isPlaying ? styles.btnActive : ''}`}
        onClick={() => setIsPlaying(!isPlaying)}
        aria-label={isPlaying ? 'pause' : 'lecture'}
        title={isPlaying ? 'Pause' : 'Lecture'}
      >{isPlaying ? '❚❚' : '▶'}</button>
      <div className={styles.speedGroup} role="group" aria-label="Vitesse de lecture">
        {[60, 120, 240].map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.speedBtn} ${playbackSpeed === s ? styles.speedBtnActive : ''}`}
            onClick={() => setPlaybackSpeed(s as 60 | 120 | 240)}
            title={`Vitesse ×${s}`}
          >{s}×</button>
        ))}
      </div>
      <button
        type="button"
        className={`${styles.btn} ${styles.step}`}
        onClick={() => setTime(new Date(currentTime.getTime() + 6 * HOUR))}
        aria-label="avancer 6 heures"
        title="Avancer de 6h"
      >+6h</button>
      <button
        type="button"
        className={`${styles.live} ${isLive ? styles.liveActive : ''}`}
        onClick={() => goLive()}
        title="Revenir au présent"
      >LIVE</button>
    </div>
  );
}
