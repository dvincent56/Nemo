import { Space_Grotesk, Bebas_Neue, Space_Mono } from 'next/font/google';
import './globals.css';

/**
 * Root layout — Next 16 exige <html> et <body> dans le root layout
 * (impossible de déléguer à [locale]/layout.tsx comme le suggère la doc
 * next-intl 4 qui était valide pour Next 15).
 *
 * `lang` est figé à "fr" ici puis ré-aligné côté client par
 * [locale]/layout.tsx via un effet qui met à jour `document.documentElement.lang`.
 * Compromis acceptable : SSR initial pour Google = "fr", puis client réajuste.
 *
 * Les fonts (variables CSS) sont chargées ici car elles s'attachent à
 * <html className="..."> et restent stables entre locales.
 */

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
