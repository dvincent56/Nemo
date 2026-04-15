import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/ui';
import { getBoatDetail } from '../data';
import BoatDetailView from './BoatDetailView';

export const dynamic = 'force-dynamic';

export default async function MarinaBoatPage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}): Promise<React.ReactElement> {
  const { boatId } = await params;
  const boat = getBoatDetail(boatId);
  if (!boat) notFound();
  return (
    <SiteShell>
      <BoatDetailView boat={boat} />
    </SiteShell>
  );
}
