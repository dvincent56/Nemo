'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

interface TooltipProps {
  text: string;
  shortcut?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export default function Tooltip({
  text,
  shortcut,
  children,
  position = 'bottom',
  delay = 800,
  className,
}: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const computePosition = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case 'top':
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
    }

    setCoords({ top, left });
  }, [position]);

  /** True when the primary pointer is coarse (touch) — tooltips are pointless */
  const isTouch = useRef(false);
  useEffect(() => {
    isTouch.current = window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const show = useCallback(() => {
    if (isTouch.current) return;
    timerRef.current = setTimeout(() => {
      computePosition();
      setVisible(true);
    }, delay);
  }, [delay, computePosition]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setCoords(null);
  }, []);

  // Clamp tooltip position to viewport after render
  useEffect(() => {
    if (!visible || !coords || !tipRef.current) return;
    const tip = tipRef.current;
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let { top, left } = coords;
    // Prevent overflow right
    if (tipRect.right > vw - 8) left -= (tipRect.right - vw + 8);
    // Prevent overflow left
    if (tipRect.left < 8) left += (8 - tipRect.left);
    // Prevent overflow bottom
    if (tipRect.bottom > vh - 8) top -= (tipRect.bottom - vh + 8);

    if (top !== coords.top || left !== coords.left) {
      setCoords({ top, left });
    }
  }, [visible, coords]);

  const tipStyle: React.CSSProperties = coords
    ? {
        position: 'fixed',
        zIndex: 9999,
        top: coords.top,
        left: coords.left,
        transform:
          position === 'bottom' || position === 'top'
            ? 'translateX(-50%)'
            : 'translateY(-50%)',
      }
    : {};

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={hide}
    >
      {children}
      {visible &&
        coords &&
        createPortal(
          <div
            ref={tipRef}
            className={styles.tip}
            style={{ ...tipStyle, pointerEvents: 'none' }}
            role="tooltip"
          >
            <span className={styles.text}>{text}</span>
            {shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </div>
  );
}
