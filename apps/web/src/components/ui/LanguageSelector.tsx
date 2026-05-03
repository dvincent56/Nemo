'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import styles from './LanguageSelector.module.css';

const LOCALES = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
] as const;

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function LanguageSelector(): React.ReactElement {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: string): void {
    if (target === currentLocale) return;

    document.cookie = `NEMO_LOCALE=${target}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;

    const segments = pathname.split('/');
    if (segments[1] && LOCALES.some((l) => l.code === segments[1])) {
      segments[1] = target;
    } else {
      segments.unshift('', target);
    }
    const newPath = segments.join('/') || `/${target}`;

    startTransition(() => {
      router.replace(newPath as Parameters<typeof router.replace>[0]);
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
