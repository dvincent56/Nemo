'use client';

import { useCallback, useRef, useState } from 'react';
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
  mode?: SlidePanelMode;
  panelClassName?: string;
}

/**
 * Snap thresholds, expressed as fraction of viewport height. Used by
 * `nearestSnap` to pick the closest snap on drag release.
 *
 * NOTE: these values are heuristics for snap detection — they do NOT need
 * to match the CSS heights exactly. The CSS sets:
 *   peek: 64px (≈ 7-20% of viewport depending on device)
 *   mid:  min(50vh, 360px)
 *   full: min(90vh, calc(100vh - 56px))
 *
 * `nearestSnap` only needs values that produce the right ordering and
 * reasonable midpoint boundaries (peek↔mid at ~30% viewport, mid↔full
 * at ~70%). If you change CSS sizes, revisit these to keep the boundaries
 * sensible — but they don't need to be precise.
 */
const SNAP_PCT: Record<SheetSnap, number> = {
  peek: 0.10,
  mid: 0.50,
  full: 0.90,
};

function nearestSnap(viewportFrac: number): SheetSnap {
  // viewportFrac = sheet height as fraction of viewport.
  // Pick the snap whose target is closest.
  let best: SheetSnap = 'mid';
  let bestDist = Infinity;
  (Object.keys(SNAP_PCT) as SheetSnap[]).forEach((k) => {
    const d = Math.abs(SNAP_PCT[k] - viewportFrac);
    if (d < bestDist) { best = k; bestDist = d; }
  });
  return best;
}

export default function SlidePanel({
  side, width, title, isOpen, onClose, children,
  mode = 'side', panelClassName,
}: SlidePanelProps): React.ReactElement {
  const [snap, setSnap] = useState<SheetSnap>('mid');
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek'));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const sheet = e.currentTarget.parentElement as HTMLElement | null;
    if (!sheet) return;
    if (!e.isPrimary) return;
    dragStartRef.current = { y: e.clientY, height: sheet.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 8) {
      // Treat as tap — cycle.
      cycleSnap();
      return;
    }
    const newHeight = Math.max(0, start.height - dy);
    const frac = newHeight / window.innerHeight;
    setSnap(nearestSnap(frac));
  };

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
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            aria-label="Redimensionner panneau"
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
