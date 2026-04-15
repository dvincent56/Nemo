import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/ui';
import { getBoatDetail } from '../../data';
import CustomizeView from './CustomizeView';

export const dynamic = 'force-dynamic';

export default async function MarinaBoatCustomizePage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}): Promise<React.ReactElement> {
  const { boatId } = await params;
  const boat = getBoatDetail(boatId);
  if (!boat) notFound();
  return (
    <SiteShell>
      <CustomizeView boat={boat} />
    </SiteShell>
  );
}
