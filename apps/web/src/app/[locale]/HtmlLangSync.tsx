'use client';

import { useEffect } from 'react';

/**
 * Réaligne `<html lang>` côté client pour matcher la locale active.
 * Le root layout (app/layout.tsx) hardcode lang="fr" parce que Next 16
 * exige <html> dans le root layout — où on n'a pas encore le paramètre
 * `[locale]`. Ce composant client comble le gap après hydratation.
 *
 * Limites assumées :
 * - Le SSR initial sert toujours `lang="fr"` ; les crawlers Google qui
 *   ne run pas le JS verront fr partout. Acceptable tant que les
 *   traductions ne sont pas réellement faites (Plans 3-6 résoudront ça
 *   de toute façon avec une vraie sitemap par locale).
 */
export function HtmlLangSync({ locale }: { locale: string }): null {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);
  return null;
}
