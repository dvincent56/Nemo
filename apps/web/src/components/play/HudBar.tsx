'use client';

import { memo } from 'react';
import { useGameStore } from '@/lib/store';
import styles from './HudBar.module.css';

const TWA_CLASS: Record<string, string> = {
  optimal: styles.colorOptimal!,
  overlap: styles.colorOverlap!,
  neutral: styles.colorNeutral!,
  deadzone: styles.colorDeadzone!,
};

function Cell(props: { label: string; value: string; className?: string | undefined }): React.ReactElement {
  const extra = props.className ?? '';
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{props.label}</span>
      <span className={`${styles.value} ${extra}`}>{props.value}</span>
    </div>
  );
}

function HudBarInner(): React.ReactElement {
  const hud = useGameStore((s) => s.hud);
  const conn = useGameStore((s) => s.connection.wsState);

  return (
    <div className={styles.bar} role="toolbar" aria-label="HUD navigation">
      <span className={styles.brand}>NEMO</span>

      <Cell label="TWS" value={`${hud.tws.toFixed(1)} kt`} />
      <Cell label="TWD" value={`${hud.twd.toFixed(1)}°`} />
      <Cell label="TWA" value={`${hud.twa >= 0 ? '+' : ''}${hud.twa.toFixed(1)}°`} className={TWA_CLASS[hud.twaColor] ?? ''} />
      <Cell label="HDG" value={`${hud.hdg.toFixed(1)}°`} />
      <Cell label="BSP" value={`${hud.bsp.toFixed(3)} kt`} />
      <Cell label="VMG" value={`${hud.vmg.toFixed(2)} kt`} />
      <Cell label="DTF" value={`${hud.dtf.toFixed(3)} NM`} />
      <Cell label="Factor" value={hud.overlapFactor.toFixed(4)} className={hud.overlapFactor > 1.001 ? styles.colorOverlap : ''} />

      <span className={styles.grow} />

      <div className={styles.rank}>#{hud.rank || '—'}</div>

      <div className={styles.wsStatus}>
        <span className={`${styles.wsDot} ${
          conn === 'open' ? styles.wsOpen : conn === 'closed' || conn === 'error' ? styles.wsClosed : styles.wsIdle
        }`} />
        WS
      </div>
    </div>
  );
}

export default memo(HudBarInner);
