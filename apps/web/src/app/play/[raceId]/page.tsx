import { notFound } from 'next/navigation';
import { fetchRace } from '@/lib/api';
import PlayClient from './PlayClient';

export const dynamic = 'force-dynamic';

export default async function PlayPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}): Promise<React.ReactElement> {
  const { raceId } = await params;
  const race = await fetchRace(raceId);
  if (!race) notFound();
  return <PlayClient race={race} />;
}
