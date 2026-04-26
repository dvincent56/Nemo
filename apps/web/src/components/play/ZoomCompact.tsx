'use client';
import { Plus, Minus } from 'lucide-react';
import { useGameStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';
import styles from '@/app/play/[raceId]/page.module.css';

export default function ZoomCompact(): React.ReactElement {
  return (
    <div className={styles.zoomCompact} role="group" aria-label="Zoom carte">
      <Tooltip text="Zoom +" position="bottom">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => {
            const { center, zoom } = useGameStore.getState().map;
            useGameStore.getState().setMapView(center, Math.min(zoom + 1, 18));
          }}
          aria-label="Zoomer"
        ><Plus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
      <Tooltip text="Zoom −" position="bottom">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => {
            const { center, zoom } = useGameStore.getState().map;
            useGameStore.getState().setMapView(center, Math.max(zoom - 1, 1));
          }}
          aria-label="Dézoomer"
        ><Minus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
    </div>
  );
}
