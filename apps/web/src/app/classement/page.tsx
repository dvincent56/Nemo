import { cookies } from 'next/headers';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import ClassementView from './ClassementView';
import { TOTAL_SKIPPERS } from './data';

export default async function ClassementPage(): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  return (
    <SiteShell>
      <ClassementView
        totalSkippers={TOTAL_SKIPPERS}
        isVisitor={isVisitor}
        meUsername={session.username}
      />
    </SiteShell>
  );
}
