import { NextResponse } from 'next/server';
import { NEWS_SEED } from '@/app/home-data';

/**
 * GET /api/public/news — mock temporaire.
 *
 * En Phase 5 : remplacer par un proxy vers Fastify (`/api/v1/news`) ou
 * migrer la table `news` + CRUD admin. Pour l'instant on sert le seed
 * statique défini dans `home-data.ts`.
 *
 * Route placée sous `/api/public/` pour être accessible en mode visiteur
 * (cf. `proxy.ts` → PUBLIC_PREFIXES).
 */
export const dynamic = 'force-static';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ news: NEWS_SEED });
}
