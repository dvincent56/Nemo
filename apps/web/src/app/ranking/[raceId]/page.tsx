import { cookies } from 'next/headers';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import RankingRaceView from './RankingRaceView';

export default async function RankingRacePage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}): Promise<React.ReactElement> {
  const { raceId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  return (
    <SiteShell>
      <RankingRaceView
        raceId={raceId}
        isVisitor={isVisitor}
        meUsername={session.username}
      />
    </SiteShell>
  );
}
