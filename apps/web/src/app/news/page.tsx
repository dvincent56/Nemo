import { SiteShell } from '@/components/ui/SiteShell';
import { fetchNews } from '@/lib/api';
import NewsIndexView from './NewsIndexView';

export const dynamic = 'force-dynamic';

/**
 * Index `/news` — toutes les actualités, publiques (cf. proxy.ts).
 * Triées par `publishedAt` desc.
 */
export default async function NewsIndexPage(): Promise<React.ReactElement> {
  const news = await fetchNews().catch(() => []);
  return (
    <SiteShell>
      <NewsIndexView news={news} />
    </SiteShell>
  );
}
