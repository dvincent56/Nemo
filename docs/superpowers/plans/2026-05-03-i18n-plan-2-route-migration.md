# i18n — Plan 2 : Migration physique des routes + shell dynamique

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déplacer physiquement toutes les routes existantes sous `apps/web/src/app/[locale]/`, convertir le root layout en passthrough, intégrer fonts + `<html lang>` + metadata dans `[locale]/layout.tsx`, créer un manifest dynamique par locale, élargir le middleware proxy.ts pour rediriger les URLs sans préfixe vers `/{locale}/...` (301), ajouter le cookie `NEMO_LOCALE` à la page `/cookies`, et insérer un sélecteur de langue dans `SiteFooter`. Aucune string n'est encore traduite — la migration des wordings vient en Plans 3-6.

**Architecture:** L'app entière vit désormais sous `app/[locale]/`. Le root layout devient un passthrough (`return children`) parce que `<html>` et `<body>` sont propriétés de `[locale]/layout.tsx` (pattern next-intl pour avoir un `lang` dynamique). Le middleware `proxy.ts` voit son matcher s'élargir : tout chemin sans préfixe locale (sauf `/api`, `/_next`, statiques) est redirigé en 301 vers `/{locale_choisie}/{chemin}`, où `locale_choisie` vient du cookie `NEMO_LOCALE` → header `Accept-Language` → fallback `fr`. Le sélecteur de langue est un composant client minimal qui set le cookie et reload la page (la persistance DB attendra le plan dédié `user_settings.locale`).

**Tech Stack:** Next.js 16.2.3 App Router, next-intl v4 (déjà installé en PR 1), TypeScript strict, ESLint 9, Vitest 4.

**Spec reference:** [docs/superpowers/specs/2026-04-28-i18n-design.md](../specs/2026-04-28-i18n-design.md) (PR 2 row du tableau de découpage)

---

## File structure

**New files:**

```
apps/web/src/app/manifest.ts                          — manifest dynamique par locale
apps/web/src/components/ui/LanguageSelector.tsx       — composant client (4 boutons FR/EN/ES/DE)
apps/web/src/components/ui/LanguageSelector.module.css
```

**Moved (via `git mv` pour préserver l'historique) :**

```
apps/web/src/app/page.tsx                             → apps/web/src/app/[locale]/page.tsx (REPLACE le placeholder de PR 1)
apps/web/src/app/page.module.css                      → apps/web/src/app/[locale]/page.module.css
apps/web/src/app/HomeView.tsx                         → apps/web/src/app/[locale]/HomeView.tsx
apps/web/src/app/HomeHeroTopbar.tsx                   → apps/web/src/app/[locale]/HomeHeroTopbar.tsx
apps/web/src/app/home-data.ts                         → apps/web/src/app/[locale]/home-data.ts
apps/web/src/app/not-found.tsx                        → apps/web/src/app/[locale]/not-found.tsx
apps/web/src/app/not-found.module.css                 → apps/web/src/app/[locale]/not-found.module.css

apps/web/src/app/cgu/                                 → apps/web/src/app/[locale]/cgu/
apps/web/src/app/cookies/                             → apps/web/src/app/[locale]/cookies/
apps/web/src/app/dev/                                 → apps/web/src/app/[locale]/dev/
apps/web/src/app/legal/                               → apps/web/src/app/[locale]/legal/
apps/web/src/app/login/                               → apps/web/src/app/[locale]/login/
apps/web/src/app/marina/                              → apps/web/src/app/[locale]/marina/
apps/web/src/app/news/                                → apps/web/src/app/[locale]/news/
apps/web/src/app/play/                                → apps/web/src/app/[locale]/play/
apps/web/src/app/privacy/                             → apps/web/src/app/[locale]/privacy/
apps/web/src/app/profile/                             → apps/web/src/app/[locale]/profile/
apps/web/src/app/races/                               → apps/web/src/app/[locale]/races/
apps/web/src/app/ranking/                             → apps/web/src/app/[locale]/ranking/
apps/web/src/app/team/                                → apps/web/src/app/[locale]/team/
```

**Stays at root :**

```
apps/web/src/app/layout.tsx                           — converti en passthrough (return children)
apps/web/src/app/globals.css                          — inchangé (importé par [locale]/layout.tsx désormais)
apps/web/src/app/api/                                 — inchangé (les API routes ne sont pas localisées)
apps/web/public/manifest.webmanifest                  — supprimé (remplacé par app/manifest.ts dynamique)
```

**Modified :**

```
apps/web/src/app/layout.tsx                           — passthrough minimal
apps/web/src/app/[locale]/layout.tsx                  — réécrit : fonts + html lang + body + metadata + provider
apps/web/src/app/[locale]/page.tsx                    — remplacé par le contenu réel (ex-app/page.tsx)
apps/web/src/app/[locale]/cookies/page.tsx            — ajout d'une entrée NEMO_LOCALE
apps/web/proxy.ts                                     — matcher élargi + redirect 301 vers /{locale}/...
apps/web/src/components/ui/SiteFooter.tsx             — intégration du LanguageSelector
apps/web/src/components/ui/index.ts                   — export du LanguageSelector
apps/web/messages/fr.json                             — ajout namespace common.languages + common.cookies + common.meta
apps/web/messages/en.json                             — copie identique
apps/web/messages/es.json                             — copie identique
apps/web/messages/de.json                             — copie identique
```

**Out of scope (autres plans) :**

- **Migration des wordings** (les pages restent en français en dur) → Plans 3-6 (UI partagée, publiques, joueur, /play)
- **`user_settings.locale` DB column + endpoint API** — la persistance par utilisateur authentifié sera ajoutée dans un plan backend dédié (probablement Plan 3.5 ou intégré au plan profile/settings). En PR 2, le sélecteur de langue ne persiste que via cookie.
- **Sélecteur de langue dans `/profile/settings`** — fait en Plan 5 (migration des pages joueur), à ce moment les translations + le contexte settings sont disponibles.
- **Élargissement du glob ESLint** — la règle `react/jsx-no-literals` reste scopée à `apps/web/src/app/[locale]/{layout,page}.tsx` (les 2 fichiers de PR 1, qu'on remet propres en PR 2). Les autres fichiers déplacés sous `[locale]/` ne sont **pas** couverts par la règle car ils contiennent encore des strings FR en dur. Plans 3-6 élargiront le glob progressivement par sous-dossier au fur et à mesure des migrations.

---

## Test infrastructure approach

Pas de nouveau framework de test. Les tests unitaires existants (vitest) doivent continuer de passer après le déplacement physique. Les tests qui font référence à des chemins hardcodés (peu probable côté src/) ne sont pas attendus mais on vérifie en T13.

Les tests d'intégration end-to-end utilisent du smoke (curl localhost) pendant la dev :
- `/fr` → home content (pas le placeholder)
- `/fr/marina` → marina page (peut nécessiter auth, on accepte 200 ou redirect /fr/login)
- `/marina` → 301 vers `/fr/marina`
- `/` → 301 vers `/fr`
- `/api/v1/...` → reste accessible (matcher exclut `/api/`)
- `/xx` (locale invalide) → 404

Run tests with: `pnpm --filter @nemo/web test`

---

## Task 1 : Préparer la migration — supprimer le placeholder PR 1

**Files:**
- Delete: `apps/web/src/app/[locale]/layout.tsx` (placeholder de PR 1, sera réécrit en T3)
- Delete: `apps/web/src/app/[locale]/page.tsx` (placeholder de PR 1, sera remplacé par la home en T2)

Le placeholder de PR 1 servait à valider l'infra. Maintenant il faut faire de la place pour les vrais fichiers : `app/page.tsx` deviendra `app/[locale]/page.tsx`, et un nouveau `[locale]/layout.tsx` absorbera le shell + fonts. On supprime les placeholders avant de `git mv` pour éviter un conflit de chemin.

- [ ] **Step 1 : Supprimer les 2 placeholder files**

```bash
git rm apps/web/src/app/\[locale\]/page.tsx apps/web/src/app/\[locale\]/layout.tsx
```

- [ ] **Step 2 : Vérifier que `git status` montre uniquement ces 2 suppressions**

```bash
git status --short
```
Expected:
```
D  apps/web/src/app/[locale]/layout.tsx
D  apps/web/src/app/[locale]/page.tsx
```

- [ ] **Step 3 : Commit**

```bash
git commit -m "chore(web/i18n): remove PR 1 [locale]/ placeholders before route migration"
```

---

## Task 2 : Déplacer toutes les routes existantes sous [locale]/

**Files:**
- Multiple `git mv` operations (voir liste exhaustive ci-dessous)

Cette task fait UN GROS commit avec tous les `git mv`. C'est volontairement atomique : un commit "déplacement physique" sans aucune autre modification, pour que le diff git montre clairement des renames purs (préservation de l'historique).

- [ ] **Step 1 : Déplacer les fichiers loose à la racine de `app/`**

```bash
git mv apps/web/src/app/page.tsx              apps/web/src/app/\[locale\]/page.tsx
git mv apps/web/src/app/page.module.css       apps/web/src/app/\[locale\]/page.module.css
git mv apps/web/src/app/HomeView.tsx          apps/web/src/app/\[locale\]/HomeView.tsx
git mv apps/web/src/app/HomeHeroTopbar.tsx    apps/web/src/app/\[locale\]/HomeHeroTopbar.tsx
git mv apps/web/src/app/home-data.ts          apps/web/src/app/\[locale\]/home-data.ts
git mv apps/web/src/app/not-found.tsx         apps/web/src/app/\[locale\]/not-found.tsx
git mv apps/web/src/app/not-found.module.css  apps/web/src/app/\[locale\]/not-found.module.css
```

- [ ] **Step 2 : Déplacer les directories de routes (14 directories)**

```bash
git mv apps/web/src/app/cgu      apps/web/src/app/\[locale\]/cgu
git mv apps/web/src/app/cookies  apps/web/src/app/\[locale\]/cookies
git mv apps/web/src/app/dev      apps/web/src/app/\[locale\]/dev
git mv apps/web/src/app/legal    apps/web/src/app/\[locale\]/legal
git mv apps/web/src/app/login    apps/web/src/app/\[locale\]/login
git mv apps/web/src/app/marina   apps/web/src/app/\[locale\]/marina
git mv apps/web/src/app/news     apps/web/src/app/\[locale\]/news
git mv apps/web/src/app/play     apps/web/src/app/\[locale\]/play
git mv apps/web/src/app/privacy  apps/web/src/app/\[locale\]/privacy
git mv apps/web/src/app/profile  apps/web/src/app/\[locale\]/profile
git mv apps/web/src/app/races    apps/web/src/app/\[locale\]/races
git mv apps/web/src/app/ranking  apps/web/src/app/\[locale\]/ranking
git mv apps/web/src/app/team     apps/web/src/app/\[locale\]/team
```

- [ ] **Step 3 : Vérifier l'inventaire post-déplacement**

```bash
ls apps/web/src/app/
```
Expected: seulement `[locale]/`, `api/`, `globals.css`, `layout.tsx` (pas de `cgu/`, `marina/`, `page.tsx`, `HomeView.tsx`, etc.)

```bash
ls apps/web/src/app/\[locale\]/
```
Expected: tous les routes + loose files (cgu, cookies, dev, HomeHeroTopbar.tsx, HomeView.tsx, home-data.ts, legal, login, marina, news, not-found.module.css, not-found.tsx, page.module.css, page.tsx, play, privacy, profile, races, ranking, team)

- [ ] **Step 4 : Vérifier que `git status` montre uniquement des renames**

```bash
git status --short | head -20
```
Expected: lignes `R  apps/web/src/app/X → apps/web/src/app/[locale]/X` (`R` = rename). PAS de modifications (`M`) à ce stade.

- [ ] **Step 5 : Commit**

```bash
git commit -m "feat(web/i18n): physically move all routes under app/[locale]/ via git mv"
```

---

## Task 3 : Convertir le root layout en passthrough

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

Le pattern next-intl pour avoir un `<html lang={locale}>` dynamique exige que `<html>` et `<body>` soient dans `[locale]/layout.tsx`, pas dans le root. Le root layout devient minimal.

- [ ] **Step 1 : Réécrire le root layout**

Remplacer le contenu de `apps/web/src/app/layout.tsx` par :

```typescript
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
```

- [ ] **Step 2 : Vérifier que typecheck passe**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web/i18n): convert root layout to passthrough (html/body owned by [locale]/layout)"
```

---

## Task 4 : Réécrire `[locale]/layout.tsx` avec fonts + html + metadata

**Files:**
- Modify (recreate): `apps/web/src/app/[locale]/layout.tsx`

Le placeholder de PR 1 a été supprimé en T1. On crée maintenant le vrai layout — celui qui hostait avant `app/layout.tsx` (fonts, metadata, html), enrichi de `NextIntlClientProvider` et du `lang` dynamique.

- [ ] **Step 1 : Créer le nouveau [locale]/layout.tsx**

Créer `apps/web/src/app/[locale]/layout.tsx` :

```typescript
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
```

**Notes** :
- `generateStaticParams` permet à Next.js de pré-générer les 4 variantes statiques au build (perf SEO).
- `setRequestLocale(locale)` est requis par next-intl pour les pages statiques sous `[locale]`.
- L'import `'../globals.css'` (au lieu de `'./globals.css'` de l'ancien root layout) reflète la nouvelle position du fichier.
- `manifest: '/manifest.webmanifest'` pointe vers la route dynamique créée en T7 (next gère automatiquement le routing du manifest.ts → `/manifest.webmanifest`).

- [ ] **Step 2 : Vérifier le typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur

- [ ] **Step 3 : Ajouter les clés `common.meta` aux 4 fichiers messages**

Modifier `apps/web/messages/fr.json` — ajouter sous `common` :

```json
{
  "common": {
    "actions": { "save": "Enregistrer", "cancel": "Annuler" },
    "meta": {
      "title": "Nemo — Jeu de voile offshore",
      "description": "Jeu de voile offshore en ligne. Polaires réelles, météo NOAA, zéro pay-to-win.",
      "applicationName": "Nemo"
    }
  }
}
```

Copier le même contenu dans `en.json`, `es.json`, `de.json` (stubs identiques au fr).

Vérifier :
```bash
diff apps/web/messages/fr.json apps/web/messages/en.json
diff apps/web/messages/fr.json apps/web/messages/es.json
diff apps/web/messages/fr.json apps/web/messages/de.json
```
Expected: aucun output

- [ ] **Step 4 : Vérifier i18n:check**

```bash
pnpm --filter @nemo/web i18n:check
```
Expected: `✓ N clés utilisées, M orphelines, 4 locales complètes` (avec exit 0). Le nombre exact varie selon ce que la home page utilise — l'important : exit 0 et "4 locales complètes".

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/app/\[locale\]/layout.tsx apps/web/messages/
git commit -m "feat(web/i18n): real [locale]/layout.tsx with dynamic lang + metadata + provider"
```

---

## Task 5 : Vérifier que [locale]/page.tsx (ex-home page) est fonctionnel après le mv

**Files:** verification only (le fichier a été déplacé en T2, contenu inchangé)

Le déplacement de `app/page.tsx` → `app/[locale]/page.tsx` en T2 a préservé le contenu. Mais cette page importe `./ranking/data` (relative) — qui se résout maintenant à `app/[locale]/ranking/data.ts`, qui a aussi été déplacé. L'import devrait toujours fonctionner. À vérifier.

- [ ] **Step 1 : Lire le fichier pour confirmer les imports**

```bash
head -10 apps/web/src/app/\[locale\]/page.tsx
```
Expected: les imports relatifs `./HomeView`, `./home-data`, `./ranking/data` doivent toujours exister. Tous les targets sont aussi sous `[locale]/`.

- [ ] **Step 2 : Vérifier le typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur. Si erreur : un import a cassé → reporter BLOCKED avec le nom du fichier et l'import problématique.

- [ ] **Step 3 : Pas de commit (rien à committer si typecheck passe)**

---

## Task 6 : Élargir le matcher du middleware proxy.ts (redirect 301)

**Files:**
- Modify: `apps/web/proxy.ts`

C'est le changement comportemental majeur de PR 2. Avant : seuls `/fr/...`, `/en/...`, etc. passaient par next-intl. Maintenant : **tout** chemin sans préfixe locale est redirigé en 301 vers `/{locale}/...`. Le matcher s'élargit, et la logique du proxy change : si `intlMiddleware` redirige (status 307/308 ou rewrite), on retourne sa réponse ; sinon on continue vers l'auth check.

- [ ] **Step 1 : Réécrire proxy.ts**

Remplacer le contenu de `apps/web/proxy.ts` par :

```typescript
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

/**
 * Next.js 16.2 auth proxy (replaces legacy middleware.ts).
 * Runs at the edge before any route handler.
 *
 * Composition (PR 2 i18n) :
 *   1. next-intl middleware traite TOUS les chemins de l'app (sauf /api,
 *      /_next, statiques). Si l'URL n'a pas de préfixe locale, il redirige
 *      en 308 vers la locale détectée (cookie NEMO_LOCALE → Accept-Language
 *      → fallback fr). Si l'URL est déjà préfixée (/fr/...), il set le
 *      contexte de locale et passe à l'étape 2.
 *   2. Auth check sur le path déjà localisé. PUBLIC_PATHS et PUBLIC_PREFIXES
 *      sont MAINTENANT exprimés sous forme localisée — toute la matrice de
 *      visibilité doit comprendre le préfixe locale.
 *
 * Routes publiques (accessibles en mode spectateur, sans cookie) :
 *   - `/{locale}`, `/{locale}/login`, `/{locale}/register`,
 *     `/{locale}/reset-password`
 *   - `/{locale}/races` et `/{locale}/races/*`
 *   - `/{locale}/ranking` et `/{locale}/ranking/*`
 *   - `/{locale}/profile/<username>` (mais pas `/{locale}/profile`,
 *     `/{locale}/profile/settings`, `/{locale}/profile/social`)
 *
 * Tout le reste (marina, profile perso, play) exige un cookie
 * `nemo_access_token`. Phase 2 ajoutera la vérification JWT Cognito.
 */

const intlMiddleware = createMiddleware(routing);

const LOCALE_RE = '(fr|en|es|de)';

// Routes publiques exprimées avec un placeholder {locale} qu'on remplacera
// par la locale extraite de l'URL.
const PUBLIC_PATH_SUFFIXES = new Set<string>([
  '',
  '/login',
  '/register',
  '/reset-password',
  '/races',
  '/ranking',
  '/news',
]);

const PUBLIC_PREFIX_SUFFIXES = [
  '/api/public/',
  '/races/',
  '/ranking/',
  '/news/',
];

const PROFILE_PRIVATE_SEGMENTS = new Set<string>(['settings', 'social']);

function stripLocale(pathname: string): { locale: string; rest: string } | null {
  const match = pathname.match(new RegExp(`^/${LOCALE_RE}(/.*)?$`));
  if (!match) return null;
  return { locale: match[1], rest: match[2] ?? '' };
}

function isPublicLocalized(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  if (!stripped) return false;
  const { rest } = stripped;
  if (PUBLIC_PATH_SUFFIXES.has(rest)) return true;
  if (PUBLIC_PREFIX_SUFFIXES.some((p) => rest.startsWith(p))) return true;
  if (rest.startsWith('/profile/')) {
    const seg = rest.slice('/profile/'.length).split('/')[0];
    if (seg && !PROFILE_PRIVATE_SEGMENTS.has(seg)) return true;
  }
  return false;
}

export default function proxy(request: NextRequest): NextResponse {
  // Étape 1 : next-intl handle locale routing (redirect si pas de préfixe,
  // ou simple set du contexte si déjà préfixé).
  const intlResponse = intlMiddleware(request);

  // Si next-intl a généré une redirection ou un rewrite, on la retourne tel quel.
  // C'est le cas pour les chemins sans préfixe locale (/marina → /fr/marina).
  if (intlResponse.headers.get('location') || intlResponse.headers.get('x-middleware-rewrite')) {
    return intlResponse;
  }

  // Étape 2 : auth check sur le path localisé
  const { pathname } = request.nextUrl;
  if (isPublicLocalized(pathname)) return intlResponse;

  const token = request.cookies.get('nemo_access_token')?.value;
  if (!token) {
    // Récupérer la locale du chemin courant pour rediriger vers /{locale}/login
    const stripped = stripLocale(pathname);
    const locale = stripped?.locale ?? routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlResponse;
}

export const config = {
  matcher: [
    // Exclut /api, /_next, statiques. Tout le reste passe par le proxy
    // (chemins racine ET chemins préfixés locale).
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|assets).*)',
  ],
};
```

**Notes** :
- `intlMiddleware` retourne soit une `NextResponse.redirect` (si pas de préfixe), soit une `NextResponse.next()` avec headers de contexte (si déjà préfixé).
- On détecte la redirection via la présence du header `location` ou `x-middleware-rewrite`.
- L'auth check ne s'applique que pour les paths déjà localisés non-publics.
- `PUBLIC_PATH_SUFFIXES` contient l'empty string `''` pour matcher `/{locale}` (la home, publique).

- [ ] **Step 2 : Vérifier le typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur

- [ ] **Step 3 : Commit**

```bash
git add apps/web/proxy.ts
git commit -m "feat(web/i18n): widen proxy matcher to redirect unprefixed paths to /{locale}/..."
```

---

## Task 7 : Manifest dynamique par locale

**Files:**
- Create: `apps/web/src/app/manifest.ts`
- Delete: `apps/web/public/manifest.webmanifest`

Next.js 16 supporte `app/manifest.ts` qui génère dynamiquement le manifest. On en profite pour servir le `name`, `short_name`, `description` traduits selon la locale détectée. La locale est récupérée via le cookie ou les headers (le manifest est requesté SANS chemin de locale — `/manifest.webmanifest`).

- [ ] **Step 1 : Créer le manifest dynamique**

Créer `apps/web/src/app/manifest.ts` :

```typescript
import type { MetadataRoute } from 'next';
import { cookies, headers } from 'next/headers';
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
```

- [ ] **Step 2 : Ajouter `common.meta.shortName` aux 4 fichiers messages**

Modifier `apps/web/messages/fr.json` — `common.meta` devient :

```json
"meta": {
  "title": "Nemo — Jeu de voile offshore",
  "shortName": "Nemo",
  "description": "Jeu de voile offshore en ligne. Polaires réelles, météo NOAA, zéro pay-to-win.",
  "applicationName": "Nemo"
}
```

Copier dans en.json, es.json, de.json.

- [ ] **Step 3 : Supprimer l'ancien manifest statique**

```bash
git rm apps/web/public/manifest.webmanifest
```

- [ ] **Step 4 : Vérifier le typecheck + i18n:check**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web i18n:check
```
Expected: les deux verts. `i18n:check` doit toujours afficher "4 locales complètes".

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/app/manifest.ts apps/web/messages/ apps/web/public/manifest.webmanifest
git commit -m "feat(web/i18n): dynamic manifest per locale (replaces static manifest.webmanifest)"
```

---

## Task 8 : Mettre à jour /cookies pour mentionner NEMO_LOCALE

**Files:**
- Modify: `apps/web/src/app/[locale]/cookies/page.tsx`

La spec mentionne explicitement : "ajout d'une entrée NEMO_LOCALE à la page cookies". L'entrée informe l'utilisateur du nouveau cookie de préférence de langue.

- [ ] **Step 1 : Lire le fichier pour comprendre la structure**

```bash
head -60 apps/web/src/app/\[locale\]/cookies/page.tsx
```

Identifier le tableau ou la liste où sont décrits les cookies existants (typiquement un `const COOKIES = [...]` array, ou des sections JSX inline).

- [ ] **Step 2 : Ajouter l'entrée NEMO_LOCALE**

Insérer une nouvelle entrée pour `NEMO_LOCALE` au même format que les entrées existantes. Champs typiques :
- **Nom** : `NEMO_LOCALE`
- **Finalité** : Mémoriser la langue d'affichage choisie (FR/EN/ES/DE)
- **Type** : Fonctionnel (pas de consentement requis)
- **Durée** : 1 an
- **Origine** : Première partie (Nemo)

Si la page utilise un format différent (HTML libre, MDX, etc.), adapter en gardant la cohérence visuelle.

**Note importante** : la page `/cookies` est encore en français en dur (PR 4 la migrera vers les translations). On garde donc les libellés en français pour cette task.

- [ ] **Step 3 : Vérifier le rendu visuel via dev server (optionnel mais recommandé)**

```bash
pnpm --filter @nemo/web dev &
sleep 10
curl -s http://localhost:3000/fr/cookies | grep -i "NEMO_LOCALE"
kill %1
```
Expected: au moins une ligne contenant `NEMO_LOCALE`.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/app/\[locale\]/cookies/page.tsx
git commit -m "feat(web/i18n): document NEMO_LOCALE cookie on /cookies page"
```

---

## Task 9 : Composant LanguageSelector

**Files:**
- Create: `apps/web/src/components/ui/LanguageSelector.tsx`
- Create: `apps/web/src/components/ui/LanguageSelector.module.css`

Composant client minimal : 4 boutons inline (FR/EN/ES/DE), highlight celui actif, click → set cookie + redirect vers la même page sous la nouvelle locale.

- [ ] **Step 1 : Créer le composant LanguageSelector.tsx**

Créer `apps/web/src/components/ui/LanguageSelector.tsx` :

```typescript
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

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

export function LanguageSelector(): React.ReactElement {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: string): void {
    if (target === currentLocale) return;

    // Set cookie 1 an, SameSite=Lax, accessible client-side (le sélecteur
    // a besoin de le lire si on stocke un override explicite).
    document.cookie = `NEMO_LOCALE=${target}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;

    // Construire le nouveau path en remplaçant le préfixe locale courant.
    // pathname inclut déjà le segment locale (ex. /fr/marina) — on remplace.
    const segments = pathname.split('/');
    if (segments[1] && LOCALES.some((l) => l.code === segments[1])) {
      segments[1] = target;
    } else {
      segments.unshift('', target);
    }
    const newPath = segments.join('/') || `/${target}`;

    startTransition(() => {
      router.replace(newPath);
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
```

- [ ] **Step 2 : Créer le CSS minimal**

Créer `apps/web/src/components/ui/LanguageSelector.module.css` :

```css
.selector {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
}

.button,
.active {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  color: inherit;
  cursor: pointer;
  border-radius: 2px;
  transition: background 120ms ease, color 120ms ease;
}

.button:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.active {
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-weight: 700;
  cursor: default;
}

.button:disabled,
.active:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3 : Exporter depuis components/ui/index.ts**

Modifier `apps/web/src/components/ui/index.ts` — ajouter à la fin :

```typescript
export { LanguageSelector } from './LanguageSelector';
```

- [ ] **Step 4 : Vérifier le typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/ui/LanguageSelector.tsx apps/web/src/components/ui/LanguageSelector.module.css apps/web/src/components/ui/index.ts
git commit -m "feat(web/i18n): LanguageSelector component (cookie-based, no DB persistence yet)"
```

---

## Task 10 : Intégrer LanguageSelector dans SiteFooter

**Files:**
- Modify: `apps/web/src/components/ui/SiteFooter.tsx`

On insère le sélecteur dans le bas du footer (à côté du copyright). Pas de migration des autres strings du footer pour l'instant — juste l'ajout du composant.

- [ ] **Step 1 : Modifier SiteFooter.tsx**

Lire d'abord la structure actuelle :
```bash
cat apps/web/src/components/ui/SiteFooter.tsx
```

Puis ajouter l'import et insérer `<LanguageSelector />` dans le bloc bottom (à côté ou avant le copyright `© 2026 Nemo`). Exemple de patch :

```typescript
// En haut, ajouter à la liste des imports :
import { LanguageSelector } from './LanguageSelector';

// Dans le JSX, modifier le <div className={styles.bottom}> existant :
<div className={styles.bottom}>
  <Link href="/" className={styles.brand} aria-label="Nemo">
    NE<span>M</span>O
  </Link>
  <LanguageSelector />
  <p className={styles.copy}>© 2026 Nemo · Hébergé en Europe</p>
</div>
```

L'ordre exact dépend du design existant (LanguageSelector entre brand et copy semble logique). Si le `styles.bottom` utilise `justify-content: space-between` à 2 enfants, il faudra peut-être ajuster vers `space-around` ou wrap dans un conteneur intermédiaire — à juger sur le rendu.

- [ ] **Step 2 : Vérifier le typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: aucune erreur

- [ ] **Step 3 : Smoke visuel via dev server**

```bash
pnpm --filter @nemo/web dev &
sleep 10
curl -s http://localhost:3000/fr | grep -E "FR|EN|ES|DE" | head -5
kill %1
```
Expected: la sortie devrait contenir au moins une ligne avec les 4 codes locale (les boutons du sélecteur dans le footer du home).

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/ui/SiteFooter.tsx
git commit -m "feat(web/i18n): integrate LanguageSelector in SiteFooter"
```

---

## Task 11 : Validation d'intégration finale

**Files:** aucun (validation pure)

- [ ] **Step 1 : Typecheck monorepo**

```bash
pnpm -r typecheck
```
Expected: tous les workspaces verts

- [ ] **Step 2 : Lint apps/web**

```bash
pnpm --filter @nemo/web lint
```
Expected: 0 errors. Warnings tolérés (les 41 warnings pré-existants restent, plus possiblement quelques nouveaux du LanguageSelector si on en a — à investiguer si > 45).

- [ ] **Step 3 : Tests monorepo**

```bash
pnpm -r test
```
Expected: tous les tests verts

- [ ] **Step 4 : Build apps/web**

```bash
pnpm --filter @nemo/web build
```
Expected: build successful, route table inclut `/[locale]`, `/[locale]/marina`, `/[locale]/races`, etc. **Vérifier dans l'output qu'aucune route n'est listée sans préfixe locale** (sauf `/api/...`).

- [ ] **Step 5 : Smoke complet — toutes les routes principales**

```bash
pnpm --filter @nemo/web dev &
sleep 12

# Routes localisées qui doivent rendre du contenu
echo "--- /fr (home) ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr
echo "--- /en (home) ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/en
echo "--- /fr/races ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr/races
echo "--- /fr/login ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr/login
echo "--- /fr/cookies ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr/cookies

# Routes sans préfixe : doivent rediriger en 308 vers /fr/...
echo "--- / (devrait 308 vers /fr) ---"; curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" http://localhost:3000/
echo "--- /races (devrait 308 vers /fr/races) ---"; curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" http://localhost:3000/races
echo "--- /login (devrait 308 vers /fr/login) ---"; curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" http://localhost:3000/login

# /api inchangé (pas de préfixe)
echo "--- /api/v1/health (route API si existante) ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/health

# Locale invalide
echo "--- /xx ---"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/xx

kill %1
```

Expected:
- `/fr`, `/en`, `/fr/races`, `/fr/login`, `/fr/cookies` → **200** (ou 307/308 vers /fr/login pour les routes auth-protégées)
- `/`, `/races`, `/login` → **307 ou 308** vers `/fr/...`
- `/api/v1/health` → 200 ou 404 (peu importe — l'important c'est qu'il ne soit PAS redirigé vers `/fr/api/...`)
- `/xx` → 404

- [ ] **Step 6 : i18n:check final**

```bash
pnpm --filter @nemo/web i18n:check
```
Expected: exit 0, "4 locales complètes"

- [ ] **Step 7 : Pas de commit si tout est vert**

Si un check révèle un problème, STOP et report — ne corrige pas inline sans demander.

---

## Definition of Done — PR 2

- [ ] Toutes les routes existantes déplacées sous `apps/web/src/app/[locale]/` (préservation historique via `git mv`)
- [ ] Root layout converti en passthrough
- [ ] `[locale]/layout.tsx` réécrit : fonts + `<html lang>` dynamique + metadata via `getTranslations` + `NextIntlClientProvider` + `setRequestLocale` + `generateStaticParams`
- [ ] `[locale]/page.tsx` = vrai contenu home (placeholder PR 1 supprimé)
- [ ] `app/manifest.ts` dynamique remplace `public/manifest.webmanifest`
- [ ] `proxy.ts` matcher élargi : redirect 307/308 unprefixed → `/{locale}/...`
- [ ] `/cookies` mentionne `NEMO_LOCALE`
- [ ] `LanguageSelector` créé + intégré dans `SiteFooter`
- [ ] `messages/{fr,en,es,de}.json` enrichis avec `common.meta` (4 fichiers identiques)
- [ ] `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test`, `pnpm build` tous verts
- [ ] Smoke : `/fr/...` rendent, `/{path}` (sans préfixe) redirige vers `/fr/{path}`, `/api/...` non touché, `/xx` → 404

---

## Plans suivants

| Plan | Scope |
|---|---|
| Plan 3 | Migration des composants `components/ui/` (Button, Card, Drawer, Toast, Tooltip, Topbar, SiteFooter, LegalLayout, Pagination, ConfirmDialog, etc.) — extraction des libellés UI partagés vers `messages/common.*`, élargissement ESLint glob à `components/ui/**` |
| Plan 3.5 | Backend : `user_settings.locale` Drizzle migration + endpoint `PATCH /api/v1/users/me/settings` + branchement client dans LanguageSelector pour persister DB |
| Plan 4 | Pages publiques + légales (`/`, `/login`, `/news`, `/cgu`, `/cookies`, `/legal`, `/privacy`) — namespaces `home`, `login`, `news`, `legal` |
| Plan 5 | Pages joueur authentifié (marina, races, ranking, profile, team) — namespaces `marina`, `races`, `ranking`, `profile`, `team` ; ajoute aussi le LanguageSelector dans `/profile/settings` |
| Plan 6 | `/play/[raceId]` — HUD, compass, timeline, panels — namespace `play` |
| Plan 7 | Refacto game-balance + boat-catalog.{locale}.json + audit neutralité backend + helper tEvent() |
