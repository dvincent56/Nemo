'use client';
import styles from './DevSimulator.module.css';

interface Props {
  simTimeMs: number;
  launchTimeMs: number | null;
  locked: boolean;
}

function formatSimTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `t=${h}h${String(m).padStart(2, '0')}`;
}

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function SimTimeReadout({ simTimeMs, launchTimeMs, locked }: Props) {
  if (!locked || launchTimeMs === null) return null;
  return (
    <div className={styles.timeReadout}>
      Sim time : <span className={styles.accent}>{formatSimTime(simTimeMs)}</span> · {formatUtc(launchTimeMs + simTimeMs)}
    </div>
  );
}
