import { SiteShell } from '@/components/ui';
import ClassementRaceView from './ClassementRaceView';

export default async function ClassementRacePage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}): Promise<React.ReactElement> {
  const { raceId } = await params;
  return (
    <SiteShell>
      <ClassementRaceView raceId={raceId} />
    </SiteShell>
  );
}
