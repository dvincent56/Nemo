import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExclusionZone } from '@nemo/shared-types';

/**
 * GET /api/v1/races/:raceId/zones
 *
 * Returns the exclusion zones for a race.
 * Dev: serves a static JSON from public/data/zones/<raceId>.json when present.
 * Prod: will proxy to the Fastify game server.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
): Promise<NextResponse> {
  const { raceId } = await params;
  try {
    const path = join(process.cwd(), 'public', 'data', 'zones', `${raceId}.json`);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as { zones: ExclusionZone[] };
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ zones: [] });
  }
}
