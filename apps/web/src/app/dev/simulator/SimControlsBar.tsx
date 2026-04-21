'use client';
// apps/web/src/app/dev/simulator/SimControlsBar.tsx
import styles from './SimControlsBar.module.css';
import type { SimSpeedFactor } from '@/lib/simulator/types';
import type { SimStatus } from '@/hooks/useSimulatorWorker';

interface Props {
  status: SimStatus;
  speed: SimSpeedFactor;
  canLaunch: boolean;
  onLaunch(): void;
  onPause(): void;
  onResume(): void;
  onSetSpeed(s: SimSpeedFactor): void;
  onResetSoft(): void;
  onResetHard(): void;
}

const SPEEDS: SimSpeedFactor[] = [600, 1800, 3600, 7200];

export function SimControlsBar(p: Props) {
  return (
    <div className={styles.bar}>
      {p.status === 'idle' && (
        <button
          className={styles.primary}
          onClick={p.onLaunch}
          disabled={!p.canLaunch}
          title={p.canLaunch ? undefined : 'Ajoute au moins un bateau'}
        >
          &#x25BA; Lancer la simulation
        </button>
      )}
      {p.status === 'running' && (
        <button className={styles.primaryDanger} onClick={p.onPause}>
          &#x275A;&#x275A; Pause
        </button>
      )}
      {p.status === 'paused' && (
        <button className={styles.primary} onClick={p.onResume}>
          &#x25BA; Reprendre
        </button>
      )}
      {p.status === 'done' && (
        <span className={styles.doneLabel}>Simulation termin&#xe9;e</span>
      )}

      <div className={styles.speedGroup}>
        <span className={styles.speedLabel}>Vitesse&nbsp;:</span>
        {SPEEDS.map(s => (
          <button
            key={s}
            className={s === p.speed ? styles.speedActive : styles.speedBtn}
            onClick={() => p.onSetSpeed(s)}
          >
            {s}&times;
          </button>
        ))}
      </div>

      <div className={styles.spacer} />

      <button
        className={styles.secondary}
        onClick={p.onResetSoft}
        disabled={p.status === 'idle'}
      >
        &#x27F2; Relancer (t=0)
      </button>
      <button className={styles.secondary} onClick={p.onResetHard}>
        Nouvelle simu
      </button>
    </div>
  );
}
