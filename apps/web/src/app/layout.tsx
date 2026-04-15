import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Bebas_Neue, Space_Mono } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Nemo — Jeu de voile offshore',
  description:
    "Jeu de voile offshore en ligne. Polaires réelles, météo NOAA, zéro pay-to-win.",
  applicationName: 'Nemo',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#060a0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html
      lang="fr"
      className={`${grotesk.variable} ${bebas.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
