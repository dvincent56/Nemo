'use client';
import { Plus, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';
import styles from '@/app/[locale]/play/[raceId]/page.module.css';

export default function ZoomCompact(): React.ReactElement {
  const t = useTranslations('play.zoom');
  return (
    <div className={styles.zoomCompact} role="group" aria-label={t('ariaGroup')}>
      <Tooltip text={t('tooltipPlus')} position="bottom">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => {
            const { center, zoom } = useGameStore.getState().map;
            useGameStore.getState().setMapView(center, Math.min(zoom + 1, 18));
          }}
          aria-label={t('ariaPlus')}
        ><Plus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
      <Tooltip text={t('tooltipMinus')} position="bottom">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => {
            const { center, zoom } = useGameStore.getState().map;
            useGameStore.getState().setMapView(center, Math.max(zoom - 1, 1));
          }}
          aria-label={t('ariaMinus')}
        ><Minus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
    </div>
  );
}
