'use client';

import { useGameStore } from '@/lib/store';
import type { LayerName } from '@/lib/store';
import styles from './LayersWidget.module.css';

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

  const visibleLayers = isSpectator
    ? LAYERS.filter((l) => l.id !== 'opponents')
    : LAYERS;

  return (
    <div className={styles.widget}>
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
