'use client';

import { Wind, Waves, Shrimp, Ban } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGameStore } from '@/lib/store';
import type { LayerName } from '@/lib/store';
import { useGfsStatus } from '@/hooks/useGfsStatus';
import styles from './LayersWidget.module.css';

/** Format run timestamp into GFS run label: "Run 06z · 18/04" */
function fmtRunLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `Run ${hh}z · ${dd}/${mm}`;
}

/** Format countdown: "dans ~2h15" or "dans ~45min" */
function fmtCountdown(targetTs: number): string {
  const diffSec = targetTs - Math.floor(Date.now() / 1000);
  if (diffSec <= 0) return 'imminent';
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  if (h === 0) return `~${m}min`;
  if (m === 0) return `~${h}h`;
  return `~${h}h${String(m).padStart(2, '0')}`;
}

interface LayerRow {
  id: LayerName;
  Icon?: LucideIcon;
  /** Fallback unicode glyph when no lucide icon fits (e.g. coastline). */
  glyph?: string;
  label: string;
}

const LAYERS: LayerRow[] = [
  { id: 'wind', Icon: Wind, label: 'Vent' },
  { id: 'swell', Icon: Waves, label: 'Houle' },
  { id: 'coastline', glyph: '⌇', label: 'Trait de côte' },
  { id: 'opponents', Icon: Shrimp, label: 'Adversaires' },
  { id: 'zones', Icon: Ban, label: 'Zones' },
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
      {gfs && gfs.next > 0 && (
        <div className={styles.gfsStatus}>
          <span className={styles.gfsLine}>
            GFS : {fmtRunLabel(gfs.run)}
          </span>
          {gfs.status === 1 ? (
            <span className={`${styles.gfsLine} ${styles.gfsUpdating}`}>
              Mise à jour en cours…
            </span>
          ) : gfs.status === 2 ? (
            <span className={styles.gfsLine}>
              Prochaine maj : en attente NOAA
            </span>
          ) : (
            <span className={styles.gfsLine}>
              Prochaine maj : {fmtCountdown(gfs.next)}
            </span>
          )}
        </div>
      )}
      <p className={styles.title}>Couches</p>
      {visibleLayers.map((l) => {
        const isOn = layers[l.id];
        return (
          <div key={l.id} className={styles.row} onClick={() => toggleLayer(l.id)}>
            <span className={`${styles.rowLabel} ${!isOn ? styles.rowLabelOff : ''}`}>
              <span className={styles.icon}>
                {l.Icon ? <l.Icon size={14} strokeWidth={2} /> : l.glyph}
              </span>
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
