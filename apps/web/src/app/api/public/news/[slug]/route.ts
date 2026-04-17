import { NextResponse } from 'next/server';
import { NEWS_SEED } from '@/app/home-data';

/**
 * GET /api/public/news/[slug] — mock temporaire.
 *
 * Retourne la news complète (avec body structuré). 404 si slug inconnu.
 *
 * En Phase 5 : remplacer par un proxy vers Fastify (`/api/v1/news/:slug`).
 */
export const dynamic = 'force-static';

export function generateStaticParams(): Array<{ slug: string }> {
  return NEWS_SEED.map((n) => ({ slug: n.slug }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const news = NEWS_SEED.find((n) => n.slug === slug);
  if (!news) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ news });
}
