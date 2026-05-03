import type { MetadataRoute } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { routing, defaultLocale, type Locale } from '@/i18n/routing';

/**
 * Manifest PWA — généré dynamiquement par locale.
 *
 * La locale est résolue via :
 *   1. cookie NEMO_LOCALE (set par le sélecteur de langue ou lors du
 *      premier hit du middleware)
 *   2. fallback defaultLocale (fr)
 *
 * Note : on n'utilise pas Accept-Language ici car Next met le manifest
 * en cache, et on veut un comportement stable une fois la locale choisie.
 */
async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEMO_LOCALE')?.value;
  if (cookieLocale && routing.locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }
  return defaultLocale;
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await resolveLocale();
  const t = await getTranslations({ locale, namespace: 'common.meta' });

  return {
    name: t('title'),
    short_name: t('shortName'),
    description: t('description'),
    start_url: `/${locale}`,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#1a2840',
    background_color: '#f5f0e8',
    lang: locale,
    icons: [],
  };
}
