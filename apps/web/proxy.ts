import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

/**
 * Next.js 16.2 auth proxy (replaces legacy middleware.ts).
 * Runs at the edge before any route handler.
 *
 * Composition (PR 1 i18n) :
 *   1. Si le path commence par /fr|/en|/es|/de → next-intl middleware (gère
 *      la résolution de locale, set le contexte). Pas de redirect dans cette PR
 *      car les routes existantes vivent encore à la racine.
 *   2. Auth check sur le path original.
 *
 * PR 2 i18n élargira le matcher i18n à toutes les URLs et activera les redirects
 * vers /fr/... pour les paths sans préfixe.
 *
 * Routes publiques (accessibles en mode spectateur, sans cookie) :
 *   - `/`, `/login`, `/register`, `/reset-password`
 *   - `/races` et `/races/*`              → catalogue des courses
 *   - `/ranking` et `/ranking/*`    → classements saison + courses
 *   - `/profile/<username>`               → fiche publique (mais pas
 *     `/profile`, `/profile/settings`, `/profile/social` qui sont privés)
 *
 * Tout le reste (marina, profile perso, play, etc.) exige un cookie
 * `nemo_access_token`. Phase 2 ajoutera la vérification JWT Cognito.
 */

const intlMiddleware = createMiddleware(routing);

const LOCALE_PREFIX_RE = /^\/(fr|en|es|de)(\/|$)/;

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/login',
  '/register',
  '/reset-password',
  '/races',
  '/ranking',
  '/news',
]);

const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/public/',
  '/assets/',
  '/icons/',
  '/favicon',
  '/manifest.webmanifest',
  '/races/',
  '/ranking/',
  '/news/',
];

const PROFILE_PRIVATE_SEGMENTS = new Set<string>(['settings', 'social']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname.startsWith('/profile/')) {
    const seg = pathname.slice('/profile/'.length).split('/')[0];
    if (seg && !PROFILE_PRIVATE_SEGMENTS.has(seg)) return true;
  }
  return false;
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Étape 1 : passer par next-intl si path préfixé locale
  if (LOCALE_PREFIX_RE.test(pathname)) {
    return intlMiddleware(request);
  }

  // Étape 2 : auth check sur les routes existantes (inchangé)
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get('nemo_access_token')?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|assets).*)',
  ],
};
