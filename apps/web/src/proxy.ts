import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

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

// Routes publiques exprimées avec un suffixe (la partie après /{locale}).
const PUBLIC_PATH_SUFFIXES = new Set<string>([
  '',
  '/login',
  '/register',
  '/reset-password',
  '/races',
  '/ranking',
  '/news',
  '/cgu',
  '/cookies',
  '/legal',
  '/privacy',
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
  if (!match || !match[1]) return null;
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
  const { pathname } = request.nextUrl;

  // Étape 1 : si le path n'a pas de préfixe locale, on délègue ENTIEREMENT
  // à next-intl middleware qui va rediriger en 307 vers /{locale}/{path}.
  // (next-intl résout la locale via cookie NEMO_LOCALE → Accept-Language → fallback.)
  const stripped = stripLocale(pathname);
  if (!stripped) {
    return intlMiddleware(request);
  }

  // Étape 2 : path préfixé. next-intl set le contexte de locale (no-op de routing).
  const intlResponse = intlMiddleware(request);
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }
  if (intlResponse.headers.get('x-middleware-rewrite')) {
    return intlResponse;
  }

  // Étape 3 : auth check sur le path déjà localisé
  if (isPublicLocalized(pathname)) return intlResponse;

  const token = request.cookies.get('nemo_access_token')?.value;
  if (!token) {
    const loginUrl = new URL(`/${stripped.locale}/login`, request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlResponse;
}

export const config = {
  matcher: [
    // Exclut /api, /_next, statiques (icons, images, assets, data).
    // Tout le reste passe par le proxy (chemins racine ET préfixés locale).
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|assets|images|data|sw.js|wind-debug.html).*)',
  ],
};
