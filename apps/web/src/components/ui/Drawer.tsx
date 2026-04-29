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

export interface DrawerLang {
  code: string;
  label: string;
  active?: boolean;
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  links: DrawerLink[];
  /** Sélecteur de langue rendu sous les liens (mobile uniquement —
   *  le top-bar mobile masque l'inline lang switcher). */
  langs?: DrawerLang[];
  /** Bouton d'action rendu en bas du drawer (ex. "Se déconnecter"). */
  bottomAction?: { label: string; onClick: () => void };
  /** Variante visuelle. `hero` = fond navy + texte ivoire pour s'accorder
   *  avec le hero sombre de la page d'accueil. */
  variant?: 'default' | 'hero';
}

export function Drawer({
  open, onClose, links, langs, bottomAction, variant = 'default',
}: DrawerProps): React.ReactElement {
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

  const drawerCls = [
    styles.drawer,
    variant === 'hero' ? styles.hero : '',
    open ? styles.open : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav
      className={drawerCls}
      aria-label="Menu mobile"
      aria-hidden={!open}
    >
      <button
        type="button"
        className={styles.close}
        aria-label="Fermer le menu"
        onClick={onClose}
      >
        <span aria-hidden>×</span>
      </button>
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
      {langs && langs.length > 0 && (
        <div className={styles.langs} role="navigation" aria-label="Langue">
          {langs.map((l) => (
            <a
              key={l.code}
              href="#"
              className={`${styles.lang} ${l.active ? styles.langActive : ''}`}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
      {bottomAction && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            bottomAction.onClick();
            onClose();
          }}
        >
          {bottomAction.label}
        </button>
      )}
      <div className={styles.foot}>
        <span>Saison 2026</span>
      </div>
    </nav>
  );
}
