'use client';

import styles from './SlidePanel.module.css';

interface SlidePanelProps {
  side: 'left' | 'right';
  width: number;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Extra class on the `.panel` aside. Used by RouterPanel to mark "placing
   * mode" so the panel can be hidden on mobile portrait — see
   * RouterPanel.module.css :global(.slidePanelMobileHide).
   */
  panelClassName?: string;
}

export default function SlidePanel({ side, width, title, isOpen, onClose, children, panelClassName }: SlidePanelProps): React.ReactElement {
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
        <div className={styles.body}>
          {children}
        </div>
      </aside>
    </div>
  );
}
