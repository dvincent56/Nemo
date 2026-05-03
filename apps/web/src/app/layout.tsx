/**
 * Root layout — passthrough.
 *
 * Avec next-intl en mode "always prefix", la balise <html> doit avoir un
 * attribut lang dynamique, ce qui exige que <html> et <body> vivent dans
 * [locale]/layout.tsx (qui a accès au paramètre `locale`). Ce root layout
 * existe parce que Next.js l'exige (App Router requirement) mais ne fait
 * que passer ses children — toute la structure HTML est dans [locale]/.
 *
 * Référence : https://next-intl-docs.vercel.app/docs/getting-started/app-router
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return children as React.ReactElement;
}
