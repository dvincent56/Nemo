import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Next.js 16.2 auth proxy (replaces legacy middleware.ts).
 * Runs at the edge before any route handler. Phase 1 scaffolding:
 * - mark public routes explicitly
 * - everything else requires a Cognito JWT (verified server-side later)
 *
 * Phase 2 wires actual JWT verification against the Cognito JWKs.
 */

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/login',
  '/register',
  '/reset-password',
]);

const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/public/',
  '/assets/',
  '/icons/',
  '/favicon',
  '/manifest.webmanifest',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
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
