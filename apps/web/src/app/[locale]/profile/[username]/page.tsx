import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/ui/SiteShell';
import { parseDevToken } from '@/lib/access';
import { getPublicProfile } from '@/app/[locale]/ranking/data';
import PublicProfileView from './PublicProfileView';

export const dynamic = 'force-dynamic';

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<React.ReactElement> {
  const { username } = await params;
  const profile = getPublicProfile(decodeURIComponent(username));
  if (!profile) notFound();
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const isVisitor = parseDevToken(token).role === 'VISITOR';
  return (
    <SiteShell>
      <PublicProfileView profile={profile} isVisitor={isVisitor} />
    </SiteShell>
  );
}
