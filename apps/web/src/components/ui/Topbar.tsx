'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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

export function Topbar({ links, showLang = true, isVisitor = false }: TopbarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('common');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const playerLinks: TopbarLink[] = [
    { href: '/races', label: t('nav.courses') },
    { href: '/marina', label: t('nav.marina') },
    { href: '/ranking', label: t('nav.ranking') },
    { href: '/profile', label: t('nav.profile') },
  ];
  const visitorLinks: TopbarLink[] = [
    { href: '/races', label: t('nav.courses') },
    { href: '/ranking', label: t('nav.ranking') },
  ];
  const navLinks = links ?? (isVisitor ? visitorLinks : playerLinks);

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
      label: t('actions.signin'),
      num: String(drawerLinks.length + 1).padStart(2, '0'),
      active: pathname === '/login',
    });
  }

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label={t('aria.brandNemo')}>
          NE<span>M</span>O
        </Link>

        <nav className={styles.nav} aria-label={t('aria.primaryNav')}>
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
              {t('actions.signin')}
            </Button>
          ) : (
            <button
              type="button"
              className={styles.logoutBtn}
              onClick={handleLogout}
            >
              {t('actions.signout')}
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
          aria-label={t('aria.openMenu')}
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
        showLang={showLang}
        {...(!isVisitor
          ? { bottomAction: { label: t('actions.signout'), onClick: handleLogout } }
          : {})}
      />
    </>
  );
}
