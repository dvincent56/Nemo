// scripts/import-vr-imoca-polars.ts
/**
 * Imports the new VR IMOCA per-sail polars from tmp/imoca/new/nofoil/*
 * to apps/web/public/data/polars/imoca60.json and packages/polar-lib/polars/imoca60.json.
 *
 * VR per-sail format: CSV-like with header "TWA\TWS;0;1;...;70" and 181 rows TWA 0..180,
 * separator ';', CRLF line endings.
 *
 * Output Nemo Polar format: { boatClass, tws[71], twa[181], speeds: Record<SailId, number[181][71]>, source }
 *
 * Usage: npx tsx scripts/import-vr-imoca-polars.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SAIL_FILE_TO_ID: Record<string, string> = {
  jib: 'JIB',
  lightJib: 'LJ',
  stay: 'SS',
  c0: 'C0',
  spi: 'SPI',
  hg: 'HG',
  lg: 'LG',
};

interface ParsedCSV {
  tws: number[];
  twa: number[];
  grid: number[][];
}

function parseCSV(path: string): ParsedCSV {
  const raw = readFileSync(path, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const headerCells = lines[0]!.split(';');
  if (headerCells[0] !== 'TWA\\TWS') {
    throw new Error(`unexpected header in ${path}: ${headerCells[0]}`);
  }
  const tws = headerCells.slice(1).map(Number);
  const twa: number[] = [];
  const grid: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(';').map(Number);
    twa.push(parts[0]!);
    grid.push(parts.slice(1));
  }
  if (twa.length !== 181) {
    throw new Error(`${path}: expected 181 TWA rows, got ${twa.length}`);
  }
  if (tws.length !== 71) {
    throw new Error(`${path}: expected 71 TWS columns, got ${tws.length}`);
  }
  return { tws, twa, grid };
}

function buildPolarJSON(srcDir: string, sourceLabel: string) {
  const speeds: Record<string, number[][]> = {};
  let tws: number[] | null = null;
  let twa: number[] | null = null;

  for (const [filename, sailId] of Object.entries(SAIL_FILE_TO_ID)) {
    const parsed = parseCSV(join(srcDir, filename));
    if (tws === null) tws = parsed.tws;
    if (twa === null) twa = parsed.twa;
    speeds[sailId] = parsed.grid;
  }

  return {
    boatClass: 'IMOCA60' as const,
    tws,
    twa,
    speeds,
    source: sourceLabel,
  };
}

const baseDir = join(ROOT, 'tmp', 'imoca', 'new');
const noFoil = buildPolarJSON(join(baseDir, 'nofoil'), 'VR-2026-imoca-nofoil');

const outputs = [
  join(ROOT, 'apps', 'web', 'public', 'data', 'polars', 'imoca60.json'),
  join(ROOT, 'packages', 'polar-lib', 'polars', 'imoca60.json'),
];

const json = JSON.stringify(noFoil, null, 2) + '\n';
for (const path of outputs) {
  writeFileSync(path, json);
  console.log(`OK -> ${path}`);
}

console.log('Done.');
