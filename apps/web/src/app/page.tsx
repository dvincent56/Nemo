import { cookies } from 'next/headers';
import { SiteFooter } from '@/components/ui';
import { fetchNews, fetchRaces } from '@/lib/api';
import { parseDevToken } from '@/lib/access';
import HomeView from './HomeView';
import { HERO_STATS } from './home-data';
import { getRanking } from './classement/data';

export const dynamic = 'force-dynamic';

/**
 * Racine `/` — landing page publique. Accessible aux visiteurs
 * (cf. `proxy.ts` → PUBLIC_PATHS). Le topbar est inliné dans le hero
 * (superposition sur la photo), donc on n'utilise PAS `<SiteShell>` ici.
 */
export default async function HomePage(): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const isVisitor = parseDevToken(token).role === 'VISITOR';

  const [allRaces, news] = await Promise.all([
    fetchRaces().catch(() => []),
    fetchNews().catch(() => []),
  ]);
  const liveRaces = allRaces.filter((r) => r.status === 'LIVE');
  const podium = getRanking('ALL').slice(0, 3);

  return (
    <>
      <HomeView
        isVisitor={isVisitor}
        liveRaces={liveRaces}
        news={news}
        podium={podium}
        heroStats={HERO_STATS}
      />
      <SiteFooter />
    </>
  );
}
