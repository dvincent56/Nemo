'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/lib/store';
import type { PlaybackSpeed } from '@/lib/store';
import styles from './WeatherTimeline.module.css';

/** Stable placeholder for SSR — avoids hydration mismatch */
const SSR_PLACEHOLDER = { day: '—', time: '—' };

/** Format a Date for display */
function formatTime(date: Date): { day: string; time: string } {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const dayLabel = diffDays === 0 ? "Auj." : diffDays > 0 ? `J+${diffDays}` : `J${diffDays}`;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const day = date.getDate();
  const months = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  const mon = months[date.getMonth()] ?? '';
  return { day: dayLabel, time: `${hh}h${mm} · ${day} ${mon}` };
}

export default function WeatherTimeline(): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const grid = useGameStore((s) => s.weather.gridData);

  // Determine timeline range — use stable defaults during SSR
  const timestamps = grid?.timestamps ?? [];
  const rangeStart = timestamps.length > 0 ? timestamps[0]! : (mounted ? Date.now() - 86400000 : 0);
  const rangeEnd = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : (mounted ? Date.now() + 7 * 86400000 : 1);
  const totalRange = rangeEnd - rangeStart || 1;
  const nowMs = mounted ? Date.now() : 0;

  // Position of "now" marker on the track (percentage)
  const nowPercent = mounted ? Math.max(0, Math.min(100, ((nowMs - rangeStart) / totalRange) * 100)) : 50;

  // Position of current scrubber
  const currentMs = currentTime.getTime();
  const scrubPercent = mounted ? Math.max(0, Math.min(100, ((currentMs - rangeStart) / totalRange) * 100)) : 50;

  const { day, time } = mounted ? formatTime(currentTime) : SSR_PLACEHOLDER;

  // Scrub via click/drag on track
  const scrubFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ms = rangeStart + pct * totalRange;
    useGameStore.getState().setTime(new Date(ms));
  }, [rangeStart, totalRange]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => scrubFromEvent(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, scrubFromEvent]);

  // Step forward/backward (6 hours)
  const stepHours = 6;
  const stepBack = () => {
    const newMs = Math.max(rangeStart, currentMs - stepHours * 3600000);
    useGameStore.getState().setTime(new Date(newMs));
  };
  const stepForward = () => {
    const newMs = Math.min(rangeEnd, currentMs + stepHours * 3600000);
    useGameStore.getState().setTime(new Date(newMs));
  };

  const speeds: PlaybackSpeed[] = [1, 6, 24];

  return (
    <div className={styles.timeline} aria-label="Timeline météo">
      {/* Current date/time */}
      <div className={styles.now}>
        <span className={styles.nowDay}>{day}</span>
        <span>{time}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={(e) => {
          setDragging(true);
          scrubFromEvent(e.clientX);
        }}
      >
        <div className={styles.trackBar} />
        <div className={styles.trackProgress} style={{ width: `${scrubPercent}%` }} />
        <div className={styles.trackNowMark} style={{ left: `${nowPercent}%` }} />
        <div className={styles.thumb} style={{ left: `${scrubPercent}%` }} />
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button type="button" className={styles.btn} onClick={stepBack} title="Reculer 6h">◀</button>
        <button type="button" className={styles.btn} onClick={stepForward} title="Avancer 6h">▶</button>

        {/* Speed buttons */}
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.speedBtn} ${playbackSpeed === s && !isLive ? styles.btnActive : ''}`}
            onClick={() => useGameStore.getState().setPlaybackSpeed(s)}
          >
            {s}×
          </button>
        ))}

        {/* Live button */}
        <button
          type="button"
          className={`${styles.liveBtn} ${isLive ? styles.liveBtnActive : ''}`}
          onClick={() => useGameStore.getState().goLive()}
          title="Revenir en direct (L)"
        >
          Live
        </button>
      </div>
    </div>
  );
}
