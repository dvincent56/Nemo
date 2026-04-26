'use client';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import styles from './TimelineHeader.module.css';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONTHS_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

/**
 * Étiquette d'offset relatif à NOW (pas à race-start). N'affiche jamais "AUJ"
 * quand l'utilisateur scrub — c'est l'instant présent qui définit AUJ.
 *  - isLive  → "LIVE"
 *  - |Δ| < 1h → "ICI"     (au plus près de NOW)
 *  - 1h ≤ |Δ| < 24h → "T-3h" / "T+6h"
 *  - 1d ≤ |Δ|       → "J-2" / "J+3"
 */
function relativeLabel(currentMs: number, nowMs: number, isLive: boolean): string {
  if (isLive) return 'LIVE';
  const dt = currentMs - nowMs;
  const abs = Math.abs(dt);
  if (abs < HOUR) return 'NOW';
  if (abs < DAY) {
    const h = Math.round(dt / HOUR);
    return h >= 0 ? `T+${h}h` : `T${h}h`;
  }
  const d = Math.round(dt / DAY);
  return d >= 0 ? `J+${d}` : `J${d}`;
}

export function TimelineHeader(): React.ReactElement {
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);

  // Re-render every second so the absolute time/date stays current in LIVE.
  // (the relative label changes at coarser granularity so this is enough)
  const currentMs = currentTime.getTime();
  // Use a stable nowMs at render — it gets refreshed by other store updates
  // (useTimelinePlayback ticks goLive every 5s).
  const nowMs = isLive ? currentMs : Date.now();

  const hh = String(currentTime.getHours()).padStart(2, '0');
  const mm = String(currentTime.getMinutes()).padStart(2, '0');
  const day = currentTime.getDate();
  const monthLabel = MONTHS_FR[currentTime.getMonth()] ?? '';

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
