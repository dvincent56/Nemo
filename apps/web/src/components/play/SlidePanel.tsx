'use client';

import { useState, useCallback } from 'react';
import styles from './SlidePanel.module.css';

export type SlidePanelMode = 'side' | 'sheet';
export type SheetSnap = 'peek' | 'mid' | 'full';

interface SlidePanelProps {
  side: 'left' | 'right';
  width: number;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Layout mode. `side` (default) — slide-in from the side, full-height.
   * `sheet` — anchored to the bottom, three snap points (peek / mid / full).
   * Used for portrait phones so the map stays visible above the panel.
   */
  mode?: SlidePanelMode;
  panelClassName?: string;
}

export default function SlidePanel({
  side, width, title, isOpen, onClose, children,
  mode = 'side', panelClassName,
}: SlidePanelProps): React.ReactElement {
  const [snap, setSnap] = useState<SheetSnap>('mid');

  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek'));
  }, []);

  if (mode === 'sheet') {
    return (
      <div className={styles.overlay}>
        <aside
          className={`${styles.sheet} ${styles[`sheet_${snap}`]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
          aria-label={title}
        >
          <button
            type="button"
            className={styles.sheetHandle}
            onClick={cycleSnap}
            aria-label="Cycle panel size"
          >
            <span className={styles.sheetHandleBar} />
          </button>
          <div className={styles.head}>
            <h3 className={styles.title}>{title}</h3>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          <div className={styles.body}>{children}</div>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <aside
        className={`${styles.panel} ${styles[side]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        style={{ width }}
        aria-label={title}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>
  );
}
