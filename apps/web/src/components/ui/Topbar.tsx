'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import styles from './Topbar.module.css';
import { Button } from './Button';
import { Drawer, type DrawerLink } from './Drawer';

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
  { href: '/classement', label: 'Classement' },
  { href: '/profile', label: 'Profil' },
];

const VISITOR_LINKS: TopbarLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/classement', label: 'Classement' },
];

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
          {isVisitor && (
            <Button
              variant="primary"
              className={styles.loginCta}
              onClick={() => router.push('/login')}
            >
              Se connecter
            </Button>
          )}
        </nav>

        {showLang && (
          <nav className={styles.lang} aria-label="Langue">
            {LANGS.map((l) => (
              <Link
                key={l.code}
                href={`/${l.code}${pathname ?? ''}` as Parameters<typeof Link>[0]['href']}
                className={l.code === 'fr' ? styles.active : ''}
              >
                {l.label}
              </Link>
            ))}
          </nav>
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

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} links={drawerLinks} />
    </>
  );
}
