import { SiteShell } from '@/components/ui/SiteShell';
import BoatDetailView from './BoatDetailView';

export default async function BoatDetailPage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}): Promise<React.ReactElement> {
  const { boatId } = await params;

  return (
    <SiteShell>
      <BoatDetailView boatId={boatId} />
    </SiteShell>
  );
}
