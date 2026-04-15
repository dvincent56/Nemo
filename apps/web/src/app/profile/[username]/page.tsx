import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/ui';
import { getPublicProfile } from '@/app/classement/data';
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
  return (
    <SiteShell>
      <PublicProfileView profile={profile} />
    </SiteShell>
  );
}
