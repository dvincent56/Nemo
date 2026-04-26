'use client';
import type * as React from 'react';
import type { RaceStatus } from '@/lib/store/timeline-selectors';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { TimelineHeader } from './timeline/TimelineHeader';
import { TimelineTrack } from './timeline/TimelineTrack';
import { TimelineControls } from './timeline/TimelineControls';
import styles from './WeatherTimeline.module.css';

interface WeatherTimelineProps {
  /** Statut de la course parent. PlayClient le fournit ; en l'absence, on
   *  suppose LIVE (le cas le plus courant pour le bateau démo). */
  raceStatus?: RaceStatus;
}

export default function WeatherTimeline({ raceStatus = 'LIVE' }: WeatherTimelineProps): React.ReactElement {
  useTimelinePlayback(raceStatus);

  return (
    <div className={styles.wrapper}>
      <TimelineHeader />
      <TimelineTrack raceStatus={raceStatus} />
      <TimelineControls />
    </div>
  );
}
