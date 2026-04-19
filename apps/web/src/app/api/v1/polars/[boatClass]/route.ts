import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BOAT_FILES: Record<string, string> = {
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
  const file = BOAT_FILES[boatClass.toUpperCase()];
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
