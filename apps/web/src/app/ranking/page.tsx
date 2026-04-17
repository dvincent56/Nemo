import { cookies } from 'next/headers';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import RankingView from './RankingView';
import { TOTAL_SKIPPERS } from './data';

export default async function RankingPage(): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  return (
    <SiteShell>
      <RankingView
        totalSkippers={TOTAL_SKIPPERS}
        isVisitor={isVisitor}
        meUsername={session.username}
      />
    </SiteShell>
  );
}
