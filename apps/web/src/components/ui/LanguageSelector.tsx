'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import styles from './LanguageSelector.module.css';

const LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
];

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function LanguageSelector(): React.ReactElement {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: Locale): void {
    if (target === currentLocale) return;

    document.cookie = `NEMO_LOCALE=${target}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;

    startTransition(() => {
      // pathname est déjà sans préfixe locale (next-intl le strip).
      // Le helper router.replace ré-injecte la locale cible.
      router.replace(pathname, { locale: target });
      router.refresh();
    });
  }

  return (
    <nav className={styles.selector} aria-label="Sélection de langue">
      {LOCALES.map((l) => {
        const isActive = l.code === currentLocale;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => switchTo(l.code)}
            disabled={isPending || isActive}
            className={isActive ? styles.active : styles.button}
            aria-current={isActive ? 'true' : undefined}
            aria-label={l.label}
          >
            {l.label}
          </button>
        );
      })}
    </nav>
  );
}
