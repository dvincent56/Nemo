'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import { selectTimelineBounds, type RaceStatus } from '@/lib/store/timeline-selectors';
import { buildTicks, type Tick } from './ticks';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './TimelineTrack.module.css';

const HOUR = 3_600_000;

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

  const isMobile = useMediaQuery('(max-width: 600px), (max-height: 500px)');

  const bounds = selectTimelineBounds({ raceStartMs, raceEndMs, forecastEndMs, status: raceStatus, nowMs });
  const span = Math.max(1, bounds.maxMs - bounds.minMs);
  const cursorPct = clampPct(((currentTime.getTime() - bounds.minMs) / span) * 100);
  const nowPct = clampPct(((nowMs - bounds.minMs) / span) * 100);

  const ticks: Tick[] = buildTicks({ ...bounds, nowMs, compactPast: isMobile });

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
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onPointerJump(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) onPointerJump(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
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
    <div className={styles.zone}>
      {/* Tick labels — past + future, all above the rail. NOW intentionally
          omitted: the gold cursor disc already materialises the present. */}
      <div className={styles.tickRowAbove} aria-hidden>
        {ticks.filter((t) => t.kind === 'past').map((t) => (
          <span
            key={`a-past-${t.ts}`}
            className={`${styles.tickLabel} ${styles.tickPast}`}
            style={{ left: `${t.pctX}%` }}
          >
            {t.label}
          </span>
        ))}
        {ticks.filter((t) => t.kind === 'future').map((t) => (
          <span
            key={`a-fut-${t.ts}`}
            className={`${styles.tickLabel} ${styles.tickFuture}`}
            style={{ left: `${t.pctX}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* Rail itself — interactive */}
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
        <div className={styles.rail} />
        <div className={styles.pastFill} style={{ width: `${nowPct}%` }} />
        <div className={styles.futureFill} style={{ left: `${nowPct}%`, width: `${100 - nowPct}%` }} />
        {/* tick marks (small vertical strokes) */}
        {ticks.map((t) => (
          <span
            key={`m-${t.ts}`}
            className={`${styles.tickMark} ${
              t.kind === 'now' ? styles.tickMarkNow
                : t.kind === 'future' ? styles.tickMarkFuture
                : styles.tickMarkPast
            }`}
            style={{ left: `${t.pctX}%` }}
          />
        ))}
        <div className={styles.cursor} style={{ left: `${cursorPct}%` }}>
          <span className={styles.cursorStem} />
          <span className={styles.cursorHandle} />
        </div>
      </div>

      {/* tickRowBelow kept as an empty placeholder to preserve grid spacing on
          desktop — labels render above only. */}
      <div className={styles.tickRowBelow} aria-hidden />
    </div>
  );
}

function clampPct(p: number): number {
  if (Number.isNaN(p)) return 0;
  return Math.max(0, Math.min(100, p));
}
