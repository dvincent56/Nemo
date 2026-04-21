// Node entry for @nemo/polar-lib. Adds loadPolar() which reads polar JSON
// from disk; re-exports the pure helpers from ./pure so both Node and the
// browser entry see the same implementation.

import type { BoatClass, Polar } from '@nemo/shared-types';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export * from './pure';

const __dirname = dirname(fileURLToPath(import.meta.url));

const POLAR_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

const polarCache = new Map<BoatClass, Polar>();

export async function loadPolar(boatClass: BoatClass): Promise<Polar> {
  const cached = polarCache.get(boatClass);
  if (cached) return cached;
  const filename = POLAR_FILES[boatClass];
  const path = join(__dirname, '..', 'polars', filename);
  const raw = await readFile(path, 'utf8');
  const polar = JSON.parse(raw) as Polar;
  polarCache.set(boatClass, polar);
  return polar;
}
