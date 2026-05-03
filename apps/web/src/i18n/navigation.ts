import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Helpers de navigation localisés (next-intl).
 *
 * À utiliser à la place de `next/link` et `next/navigation` dans les
 * composants client : ils gèrent automatiquement le préfixe de locale.
 *
 * Exemple :
 *   const router = useRouter();
 *   router.replace(pathname, { locale: 'en' });  // strip + ré-injecte /en
 *
 * Séparé de `routing.ts` pour ne pas charger `next/navigation` (côté
 * serveur Next) dans les tests vitest qui ne tournent pas sous Next.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
