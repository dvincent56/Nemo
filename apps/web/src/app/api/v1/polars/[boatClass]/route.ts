import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoatClass } from '@nemo/shared-types';

const BOAT_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boatClass: string }> },
) {
  const { boatClass } = await params;
  const file = BOAT_FILES[boatClass.toUpperCase() as BoatClass];
  if (!file) {
    return NextResponse.json({ error: 'Unknown boat class' }, { status: 404 });
  }

  const filePath = join(process.cwd(), 'public', 'data', 'polars', file);
  const raw = await readFile(filePath, 'utf8');
  const polar = JSON.parse(raw);

  return NextResponse.json(
    { ...polar, version: '1.0.0' },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    },
  );
}
