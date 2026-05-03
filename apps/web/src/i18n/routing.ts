import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const locales = ['fr', 'en', 'es', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fr';

export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  localePrefix: 'always',
});

// Navigation helpers wrappés par next-intl. Préférer ceux-ci à
// `next/link` et `next/navigation` dans les composants client : ils
// gèrent automatiquement le préfixe de locale (ex. `router.replace('/profile',
// {locale: 'en'})` produit `/en/profile`).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
