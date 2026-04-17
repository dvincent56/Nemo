'use client';

import { useGameStore } from '@/lib/store';
import type { LayerName } from '@/lib/store';
import { useGfsStatus } from '@/hooks/useGfsStatus';
import styles from './LayersWidget.module.css';

function fmtRunTime(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtAgo(ts: number): string {
  const diffH = Math.round((Date.now() / 1000 - ts) / 3600);
  if (diffH < 1) return 'il y a < 1h';
  return `il y a ${diffH}h`;
}

function fmtIn(ts: number): string {
  const diffH = Math.round((ts - Date.now() / 1000) / 3600);
  if (diffH <= 0) return 'imminent';
  return `dans ~${diffH}h`;
}

const LAYERS: { id: LayerName; icon: string; label: string }[] = [
  { id: 'wind', icon: '≋', label: 'Vent' },
  { id: 'swell', icon: '∿', label: 'Houle' },
  { id: 'opponents', icon: '⛵', label: 'Adversaires' },
  { id: 'zones', icon: '⊘', label: 'Zones' },
];

interface LayersWidgetProps {
  isSpectator?: boolean;
}

export default function LayersWidget({ isSpectator }: LayersWidgetProps): React.ReactElement {
  const layers = useGameStore((s) => s.layers);
  const toggleLayer = useGameStore((s) => s.toggleLayer);
  const gfs = useGfsStatus();

  const visibleLayers = isSpectator
    ? LAYERS.filter((l) => l.id !== 'opponents')
    : LAYERS;

  return (
    <div className={styles.widget}>
      {gfs && (
        <div className={styles.gfsStatus}>
          {gfs.status === 1 ? (
            <span className={styles.gfsLine}>Météo GFS : mise à jour en cours...</span>
          ) : (
            <>
              <span className={styles.gfsLine}>
                Météo GFS : maj {fmtRunTime(gfs.run)} ({fmtAgo(gfs.run)})
              </span>
              <span className={styles.gfsLine}>
                {gfs.status === 2
                  ? 'Prochaine mise à jour en attente'
                  : `Prochaine mise à jour ${fmtIn(gfs.next)}`}
              </span>
            </>
          )}
        </div>
      )}
      <p className={styles.title}>Couches</p>
      {visibleLayers.map((l) => {
        const isOn = layers[l.id];
        return (
          <div key={l.id} className={styles.row} onClick={() => toggleLayer(l.id)}>
            <span className={`${styles.rowLabel} ${!isOn ? styles.rowLabelOff : ''}`}>
              <span className={styles.icon}>{l.icon}</span>
              {l.label}
            </span>
            <div className={`${styles.switch} ${isOn ? styles.switchOn : ''}`}>
              <div className={styles.switchDot} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
