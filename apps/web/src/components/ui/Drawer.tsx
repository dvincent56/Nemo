'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from './Drawer.module.css';

export interface DrawerLink {
  href: string;
  label: string;
  num: string;
  active?: boolean;
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  links: DrawerLink[];
}

export function Drawer({ open, onClose, links }: DrawerProps): React.ReactElement {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <nav
      className={`${styles.drawer} ${open ? styles.open : ''}`}
      aria-label="Menu mobile"
      aria-hidden={!open}
    >
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href as Parameters<typeof Link>[0]['href']}
          className={`${styles.link} ${l.active ? styles.active : ''}`}
          onClick={onClose}
        >
          {l.label}
          <span className={styles.num}>{l.num}</span>
        </Link>
      ))}
      <div className={styles.foot}>
        <span>Saison 2026</span>
      </div>
    </nav>
  );
}
