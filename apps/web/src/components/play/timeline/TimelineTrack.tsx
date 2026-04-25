'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import { selectTimelineBounds, type RaceStatus } from '@/lib/store/timeline-selectors';
import { computeTicks, buildTickPositions, type TickScale } from './ticks';
import styles from './TimelineTrack.module.css';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function formatLabel(ts: number, scale: TickScale, nowMs: number): string {
  const d = new Date(ts);
  if (scale.format === 'HH:00') {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  if (scale.format === 'DD MMM') {
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  // 'HH:00 · J+N'
  const dayOffset = Math.floor((ts - nowMs) / DAY);
  const offsetLabel =
    dayOffset === 0 ? 'Auj.' : dayOffset > 0 ? `J+${dayOffset}` : `J${dayOffset}`;
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${time} · ${offsetLabel}`;
}

function formatBookend(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function TimelineTrack({ raceStatus }: { raceStatus: RaceStatus }): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const raceEndMs = useGameStore((s) => s.timeline.raceEndMs);
  const forecastEndMs = useGameStore((s) => s.timeline.forecastEndMs);
  const setTime = useGameStore((s) => s.setTime);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const bounds = selectTimelineBounds({ raceStartMs, raceEndMs, forecastEndMs, status: raceStatus, nowMs });
  const span = Math.max(1, bounds.maxMs - bounds.minMs);
  const cursorPctRaw = ((currentTime.getTime() - bounds.minMs) / span) * 100;
  const cursorPct = Math.max(0, Math.min(100, cursorPctRaw));
  const nowPctRaw = ((nowMs - bounds.minMs) / span) * 100;
  const nowPct = Math.max(0, Math.min(100, nowPctRaw));

  const tickScale = computeTicks({ ...bounds, nowMs });
  const ticks = buildTickPositions(tickScale, { ...bounds, nowMs }, formatLabel);

  const onPointerJump = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ts = bounds.minMs + pct * span;
    setTime(new Date(ts));
  }, [bounds.minMs, span, setTime]);

  const draggingRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onPointerJump(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) onPointerJump(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      const step = e.shiftKey ? 6 * HOUR : HOUR;
      setTime(new Date(currentTime.getTime() - step));
    } else if (e.key === 'ArrowRight') {
      const step = e.shiftKey ? 6 * HOUR : HOUR;
      setTime(new Date(currentTime.getTime() + step));
    } else if (e.key === 'Home') {
      setTime(new Date(bounds.minMs));
    } else if (e.key === 'End') {
      setTime(new Date(bounds.maxMs));
    }
  };

  return (
    <div className={styles.row}>
      <span className={styles.bookend}>{formatBookend(bounds.minMs)}</span>
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        aria-valuemin={bounds.minMs}
        aria-valuemax={bounds.maxMs}
        aria-valuenow={currentTime.getTime()}
        aria-label="position dans le temps de course"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className={styles.trackPast} style={{ width: `${nowPct}%` }} />
        <div className={styles.trackFuture} style={{ left: `${nowPct}%`, width: `${100 - nowPct}%` }} />
        <div className={styles.nowLine} style={{ left: `${nowPct}%` }}>
          <span className={styles.nowLabel}>NOW</span>
        </div>
        <div className={styles.cursor} style={{ left: `${cursorPct}%` }} />
        <div className={styles.tickLabels}>
          {ticks.map((t) => (
            <span key={t.ts} className={styles.tickLabel} style={{ left: `${t.pctX}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <span className={`${styles.bookend} ${styles.rowGold}`}>{formatBookend(bounds.maxMs)}</span>
    </div>
  );
}
