import { SiteShell } from '@/components/ui/SiteShell';
import CustomizeLoader from './CustomizeLoader';

export const dynamic = 'force-dynamic';

export default async function MarinaBoatCustomizePage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}): Promise<React.ReactElement> {
  const { boatId } = await params;
  return (
    <SiteShell>
      <CustomizeLoader boatId={boatId} />
    </SiteShell>
  );
}
