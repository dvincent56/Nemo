'use client';
import { useMemo } from 'react';
import type * as React from 'react';
import { useGameStore } from '@/lib/store';
import { selectRankSparklineNormalized } from '@/lib/store/timeline-selectors';
import styles from './RankSparkline.module.css';

const SPARK_HEIGHT = 14;

export function RankSparkline({ widthPx }: { widthPx: number }): React.ReactElement | null {
  const points = useGameStore((s) => s.track.myPoints);
  const setTime = useGameStore((s) => s.setTime);

  const normalized = useMemo(() => selectRankSparklineNormalized(points), [points]);
  if (normalized.length < 2 || widthPx <= 0) return null;

  const minTs = normalized[0]!.ts;
  const maxTs = normalized[normalized.length - 1]!.ts;
  const span = Math.max(1, maxTs - minTs);

  const linePoints = normalized
    .map((p) => `${((p.ts - minTs) / span) * widthPx},${(1 - p.yNorm) * SPARK_HEIGHT}`)
    .join(' ');

  // Build a closed polygon for the soft fill under the curve.
  const fillPath = `${linePoints} ${widthPx},${SPARK_HEIGHT} 0,${SPARK_HEIGHT}`;

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${widthPx} ${SPARK_HEIGHT}`}
      width={widthPx}
      height={SPARK_HEIGHT}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ts = minTs + (x / widthPx) * span;
        setTime(new Date(ts));
      }}
      role="img"
      aria-label="évolution du classement dans le temps"
    >
      <polygon points={fillPath} className={styles.fill} />
      <polyline points={linePoints} className={styles.line} />
    </svg>
  );
}
