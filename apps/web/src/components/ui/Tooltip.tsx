'use client';

import { useState, useRef, useCallback } from 'react';
import styles from './Tooltip.module.css';

interface TooltipProps {
  text: string;
  shortcut?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export default function Tooltip({
  text,
  shortcut,
  children,
  position = 'bottom',
  delay = 400,
}: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div
      className={styles.wrapper}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div className={`${styles.tip} ${styles[position]}`} role="tooltip">
          <span className={styles.text}>{text}</span>
          {shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>}
        </div>
      )}
    </div>
  );
}
