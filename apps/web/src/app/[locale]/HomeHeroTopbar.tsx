'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_BASE } from '@/lib/api';
import { Drawer, type DrawerLink, LanguageSelector } from '@/components/ui';
import styles from './page.module.css';

interface HeroNavLink {
  href: string;
  label: string;
}

export interface HomeHeroTopbarProps {
  isVisitor: boolean;
}

export function HomeHeroTopbar({ isVisitor }: HomeHeroTopbarProps): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations('common');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const playerLinks: HeroNavLink[] = [
    { href: '/races', label: t('nav.courses') },
    { href: '/marina', label: t('nav.marina') },
    { href: '/ranking', label: t('nav.ranking') },
    { href: '/profile', label: t('nav.profile') },
  ];
  const visitorLinks: HeroNavLink[] = [
    { href: '/races', label: t('nav.courses') },
    { href: '/ranking', label: t('nav.ranking') },
  ];
  const navLinks = isVisitor ? visitorLinks : playerLinks;

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
      label: t('actions.signin'),
      num: String(drawerLinks.length + 1).padStart(2, '0'),
      active: pathname === '/login',
    });
  }

  return (
    <>
      <header className={styles.heroTopbar}>
        <Link href="/" className={styles.brand} aria-label={t('aria.brandNemo')}>
          NE<span>M</span>O
        </Link>

        <nav aria-label={t('aria.primaryNav')}>
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
            {t('actions.signin')}
          </Link>
        ) : (
          <button
            type="button"
            className={styles.heroLogoutBtn}
            onClick={handleLogout}
          >
            {t('actions.signout')}
          </button>
        )}

        <div className={styles.heroLang}>
          <LanguageSelector />
        </div>

        <button
          type="button"
          className={`${styles.heroBurger} ${drawerOpen ? styles.heroBurgerOpen : ''}`}
          aria-label={t('aria.openMenu')}
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
        showLang
        variant="hero"
        {...(!isVisitor
          ? { bottomAction: { label: t('actions.signout'), onClick: handleLogout } }
          : {})}
      />
    </>
  );
}
