'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './Drawer.module.css';
import { LanguageSelector } from './LanguageSelector';

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
  /** Affiche le LanguageSelector sous les liens (mobile uniquement —
   *  le top-bar mobile masque l'inline lang switcher). */
  showLang?: boolean;
  /** Bouton d'action rendu en bas du drawer (ex. "Se déconnecter"). */
  bottomAction?: { label: string; onClick: () => void };
  /** Variante visuelle. `hero` = fond navy + texte ivoire pour s'accorder
   *  avec le hero sombre de la page d'accueil. */
  variant?: 'default' | 'hero';
}

export function Drawer({
  open, onClose, links, showLang, bottomAction, variant = 'default',
}: DrawerProps): React.ReactElement {
  const t = useTranslations('common');

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
      aria-label={t('aria.mobileMenu')}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={styles.close}
        aria-label={t('aria.closeMenu')}
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
      {showLang && (
        <div className={styles.langs}>
          <LanguageSelector />
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
        <span>{t('drawer.season')}</span>
      </div>
    </nav>
  );
}
