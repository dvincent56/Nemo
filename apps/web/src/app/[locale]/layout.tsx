import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Bebas_Neue, Space_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import '../globals.css';

// Les variables exposées à CSS portent un suffixe -raw ; globals.css les
// agrège derrière --font-display / --font-body / --font-mono avec leurs
// fallbacks locaux. Règle d'usage stricte :
//   • Bebas Neue   (--font-display) — titres, noms de course, valeurs fortes
//   • Space Grotesk (--font-body)   — tout le corps de texte UI
//   • Space Mono   (--font-mono)    — TOUTES les données numériques

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-grotesk-raw',
  display: 'swap',
});

const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-bebas-raw',
  display: 'swap',
});

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono-raw',
  display: 'swap',
});

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
    <html
      lang={locale}
      className={`${grotesk.variable} ${bebas.variable} ${mono.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
