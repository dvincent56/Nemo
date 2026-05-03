'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
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

/** Below this dragged height (in px), drag-release closes the sheet. */
const CLOSE_THRESHOLD_PX = 32;

function nearestSnap(viewportFrac: number): SheetSnap {
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
  const t = useTranslations('play.slidePanel');
  const [snap, setSnap] = useState<SheetSnap>('mid');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  // Reset to default snap each time the sheet is reopened — otherwise
  // closing at "full" then reopening would keep the sheet maximised,
  // which surprises users who expect the panel to start at mid.
  useEffect(() => {
    if (isOpen) setSnap('mid');
  }, [isOpen]);

  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek'));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary) return;
    const sheet = e.currentTarget.parentElement as HTMLElement | null;
    if (!sheet) return;
    dragStartRef.current = { y: e.clientY, height: sheet.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    // Live update — finger drives height, capped at the "full" snap so
    // the user cannot drag the sheet beyond the intended max.
    const dy = e.clientY - start.y;
    const maxHeight = Math.min(0.7 * window.innerHeight, window.innerHeight - 120);
    const next = Math.min(maxHeight, Math.max(0, start.height - dy));
    setDragHeight(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragHeight(null);
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 8) {
      // Treat as tap — cycle.
      cycleSnap();
      return;
    }
    const newHeight = Math.max(0, start.height - dy);
    if (newHeight < CLOSE_THRESHOLD_PX) {
      onClose();
      return;
    }
    const frac = newHeight / window.innerHeight;
    setSnap(nearestSnap(frac));
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragStartRef.current = null;
    setDragHeight(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  if (mode === 'sheet') {
    // While dragging, override CSS height with inline style and disable
    // the transition so the sheet tracks the finger 1:1. When dragHeight
    // is null we fall back to the snap class (.sheet_peek/mid/full)
    // which has the standard 220ms transition.
    const dragStyle = dragHeight !== null
      ? { height: `${dragHeight}px`, transition: 'none' as const }
      : undefined;

    return (
      <div className={styles.overlay}>
        <aside
          className={`${styles.sheet} ${styles[`sheet_${snap}`]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
          style={dragStyle}
          aria-label={title}
        >
          <button
            type="button"
            className={styles.sheetHandle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            aria-label={t('resize')}
          >
            <span className={styles.sheetHandleBar} />
          </button>
          <div className={styles.head}>
            <h3 className={styles.title}>{title}</h3>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('close')}>✕</button>
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
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('close')}>✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>
  );
}
