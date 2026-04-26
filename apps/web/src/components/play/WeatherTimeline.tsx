'use client';
import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import type { RaceStatus } from '@/lib/store/timeline-selectors';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { TimelineHeader } from './timeline/TimelineHeader';
import { RankSparkline } from './timeline/RankSparkline';
import { TimelineTrack } from './timeline/TimelineTrack';
import styles from './WeatherTimeline.module.css';

interface WeatherTimelineProps {
  /** Statut de la course parent. PlayClient le fournit ; en l'absence, on
   *  suppose LIVE (le cas le plus courant pour le bateau démo). */
  raceStatus?: RaceStatus;
}

export default function WeatherTimeline({ raceStatus = 'LIVE' }: WeatherTimelineProps): React.ReactElement {
  useTimelinePlayback(raceStatus);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <TimelineHeader />
      <RankSparkline widthPx={Math.max(0, width - 32)} />
      <TimelineTrack raceStatus={raceStatus} />
    </div>
  );
}
