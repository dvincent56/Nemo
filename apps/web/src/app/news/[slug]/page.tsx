import { notFound } from 'next/navigation';
import { SiteFooter } from '@/components/ui';
import { fetchNews, fetchNewsBySlug } from '@/lib/api';
import NewsArticle from './NewsArticle';

export const dynamic = 'force-dynamic';

/**
 * Page article — `/news/[slug]`. Publique (cf. proxy.ts).
 * Topbar inliné dans l'article (pas de SiteShell).
 */
export default async function NewsDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const [news, allNews] = await Promise.all([
    fetchNewsBySlug(slug),
    fetchNews().catch(() => []),
  ]);
  if (!news) notFound();

  // 3 related : autres news (pas l'article courant), tri par date desc
  const related = allNews
    .filter((n) => n.slug !== slug)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3);

  return (
    <>
      <NewsArticle news={news} related={related} />
      <SiteFooter />
    </>
  );
}
