import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { HtmlLangSync } from './HtmlLangSync';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'common.meta' });
  return {
    title: t('title'),
    description: t('description'),
    applicationName: t('applicationName'),
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = {
  themeColor: '#060a0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export function generateStaticParams(): { locale: Locale }[] {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Layout du segment [locale] — Next 16 ne tolère pas <html>/<body>
 * dans deux layouts (root + [locale]/) : le root les possède désormais.
 * Ici on fournit uniquement le contexte i18n + un alignement client-side
 * de l'attribut <html lang> via <HtmlLangSync /> (pour que les lecteurs
 * d'écran et les outils SEO voient la bonne langue après hydratation).
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) notFound();
  setRequestLocale(locale as Locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HtmlLangSync locale={locale} />
      {children}
    </NextIntlClientProvider>
  );
}
