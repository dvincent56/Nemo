import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/ui/SiteShell';
import { getTeamProfile } from '../data';
import TeamView from './TeamView';

export const dynamic = 'force-dynamic';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const team = getTeamProfile(decodeURIComponent(slug));
  if (!team) notFound();
  return (
    <SiteShell>
      <TeamView team={team} />
    </SiteShell>
  );
}
