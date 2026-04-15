'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Topbar.module.css';
import { Drawer, type DrawerLink } from './Drawer';

export interface TopbarLink {
  href: string;
  label: string;
}

export interface TopbarProps {
  links?: TopbarLink[];
  /** Affiche le language switcher (défaut true). */
  showLang?: boolean;
}

const DEFAULT_LINKS: TopbarLink[] = [
  { href: '/races', label: 'Courses' },
  { href: '/marina', label: 'Marina' },
  { href: '/classement', label: 'Classement' },
  { href: '/profile', label: 'Profil' },
];

const LANGS = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
];

export function Topbar({ links = DEFAULT_LINKS, showLang = true }: TopbarProps): React.ReactElement {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const drawerLinks: DrawerLink[] = links.map((l, i) => ({
    href: l.href,
    label: l.label,
    num: String(i + 1).padStart(2, '0'),
    active: pathname === l.href || pathname?.startsWith(`${l.href}/`),
  }));

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Nemo">
          NE<span>M</span>O
        </Link>

        <nav className={styles.nav} aria-label="Principal">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href as Parameters<typeof Link>[0]['href']}
              className={pathname === l.href || pathname?.startsWith(`${l.href}/`) ? styles.active : ''}
            >
              {l.label}
            </Link>
          ))}
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
