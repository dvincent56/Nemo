'use client';
// apps/web/src/app/dev/simulator/OrderHistory.tsx

import styles from './OrderHistory.module.css';
import type { SimOrder } from '@/lib/simulator/types';

export interface OrderHistoryEntry {
  simTimeMs: number;
  order: SimOrder;
}

interface Props { entries: OrderHistoryEntry[]; }

function fmtSimTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `t=${h}h${String(m).padStart(2, '0')}`;
}

function fmtOrder(o: SimOrder): string {
  switch (o.kind) {
    case 'CAP':  return `CAP ${Math.round(o.value as number)}°`;
    case 'TWA':  return `TWA ${Math.round(o.value as number)}°`;
    case 'SAIL': return `Voile ${o.value}`;
    case 'MODE': return `Auto-voile ${o.value ? 'ON' : 'OFF'}`;
  }
}

export function OrderHistory({ entries }: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>Ordres envoyés</div>
      {entries.length === 0 && <div className={styles.empty}>Aucun ordre</div>}
      <ul className={styles.list}>
        {entries.map((e, i) => (
          <li key={i}>
            <span className={styles.time}>{fmtSimTime(e.simTimeMs)}</span>
            <span className={styles.order}>{fmtOrder(e.order)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
