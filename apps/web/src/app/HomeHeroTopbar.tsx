'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import { Drawer, type DrawerLink } from '@/components/ui';
import styles from './page.module.css';

interface HeroNavLink {
  href: string;
  label: string;
}

const PLAYER_LINKS: HeroNavLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/marina', label: 'Marina' },
  { href: '/ranking', label: 'Classement' },
  { href: '/profile', label: 'Profil' },
];

const VISITOR_LINKS: HeroNavLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/ranking', label: 'Classement' },
];

const LANGS = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
];

export interface HomeHeroTopbarProps {
  isVisitor: boolean;
}

export function HomeHeroTopbar({ isVisitor }: HomeHeroTopbarProps): React.ReactElement {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navLinks = isVisitor ? VISITOR_LINKS : PLAYER_LINKS;

  const handleLogout = async (): Promise<void> => {
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore — full reload below resets state either way
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

  const drawerLangs = LANGS.map((l) => ({
    code: l.code,
    label: l.label,
    active: l.code === 'fr',
  }));

  return (
    <>
      <header className={styles.heroTopbar}>
        <Link href="/" className={styles.brand} aria-label="Nemo">
          NE<span>M</span>O
        </Link>

        <nav aria-label="Principal">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href as Parameters<typeof Link>[0]['href']}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {isVisitor ? (
          <Link href="/login" className={styles.heroLoginBtn}>
            Se connecter
          </Link>
        ) : (
          <button
            type="button"
            className={styles.heroLogoutBtn}
            onClick={handleLogout}
          >
            Se déconnecter
          </button>
        )}

        <div
          className={styles.heroLang}
          role="navigation"
          aria-label="Langue"
        >
          {LANGS.map((l) => (
            <a
              key={l.code}
              href="#"
              className={l.code === 'fr' ? styles.heroLangActive : ''}
            >
              {l.label}
            </a>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.heroBurger} ${drawerOpen ? styles.heroBurgerOpen : ''}`}
          aria-label="Ouvrir le menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span className={styles.heroBurgerBars} aria-hidden />
        </button>
      </header>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        links={drawerLinks}
        langs={drawerLangs}
        variant="hero"
        {...(!isVisitor
          ? { bottomAction: { label: 'Se déconnecter', onClick: handleLogout } }
          : {})}
      />
    </>
  );
}
