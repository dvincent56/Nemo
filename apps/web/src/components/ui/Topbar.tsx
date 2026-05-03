'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import styles from './Topbar.module.css';
import { Button } from './Button';
import { Drawer, type DrawerLink } from './Drawer';
import { LanguageSelector } from './LanguageSelector';

export interface TopbarLink {
  href: string;
  label: string;
}

export interface TopbarProps {
  links?: TopbarLink[];
  /** Affiche le language switcher (défaut true). */
  showLang?: boolean;
  /** Visiteur non authentifié : masque Marina/Profil, affiche "Se connecter". */
  isVisitor?: boolean;
}

const PLAYER_LINKS: TopbarLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/marina', label: 'Marina' },
  { href: '/ranking', label: 'Classement' },
  { href: '/profile', label: 'Profil' },
];

const VISITOR_LINKS: TopbarLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/ranking', label: 'Classement' },
];

// Le sélecteur de langue inline (legacy) renvoyait vers /{locale}{pathname}
// sans stripper le préfixe locale courant — bug concat /en/fr/profile.
// Remplacé par <LanguageSelector /> qui utilise les helpers next-intl.
// Le drawer mobile reste sur le tableau LANGS local pour son propre rendu
// stub jusqu'à sa migration en Plan 3.
const LANGS = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
];

export function Topbar({ links, showLang = true, isVisitor = false }: TopbarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navLinks = links ?? (isVisitor ? VISITOR_LINKS : PLAYER_LINKS);

  const handleLogout = async (): Promise<void> => {
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore — full reload below will land on `/` either way
    }
    window.location.href = '/';
  };

  const drawerLinks: DrawerLink[] = navLinks.map((l, i) => ({
    href: l.href,
    label: l.label,
    num: String(i + 1).padStart(2, '0'),
    active: pathname === l.href || pathname?.startsWith(`${l.href}/`),
  }));
  if (isVisitor) {
    drawerLinks.push({
      href: '/login',
      label: 'Se connecter',
      num: String(drawerLinks.length + 1).padStart(2, '0'),
      active: pathname === '/login',
    });
  }

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Nemo">
          NE<span>M</span>O
        </Link>

        <nav className={styles.nav} aria-label="Principal">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href as Parameters<typeof Link>[0]['href']}
              className={pathname === l.href || pathname?.startsWith(`${l.href}/`) ? styles.active : ''}
            >
              {l.label}
            </Link>
          ))}
          {isVisitor ? (
            <Button
              variant="primary"
              className={styles.loginCta}
              onClick={() => router.push('/login')}
            >
              Se connecter
            </Button>
          ) : (
            <button
              type="button"
              className={styles.logoutBtn}
              onClick={handleLogout}
            >
              Se déconnecter
            </button>
          )}
        </nav>

        {showLang && (
          <div className={styles.lang}>
            <LanguageSelector />
          </div>
        )}

        <button
          type="button"
          className={`${styles.burger} ${drawerOpen ? styles.open : ''}`}
          aria-label="Ouvrir le menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span className={styles.burgerBars} aria-hidden />
        </button>
      </header>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        links={drawerLinks}
        {...(showLang
          ? { langs: LANGS.map((l) => ({ ...l, active: l.code === 'fr' })) }
          : {})}
        {...(!isVisitor
          ? { bottomAction: { label: 'Se déconnecter', onClick: handleLogout } }
          : {})}
      />
    </>
  );
}
