import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Next.js 16.2 auth proxy (replaces legacy middleware.ts).
 * Runs at the edge before any route handler.
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
