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

// Routes publiques exprimées avec un suffixe (la partie après /{locale}).
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
  // Étape 1 : next-intl handle locale routing (redirect si pas de préfixe,
  // ou simple set du contexte si déjà préfixé).
  const intlResponse = intlMiddleware(request);

  // Si next-intl a généré une redirection ou un rewrite, on la retourne tel quel.
  // C'est le cas pour les chemins sans préfixe locale (/marina → /fr/marina).
  if (
    intlResponse.headers.get('location') ||
    intlResponse.headers.get('x-middleware-rewrite')
  ) {
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
