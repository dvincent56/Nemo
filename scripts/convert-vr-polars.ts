/**
 * Converts VR polar data (toxcct/VRPolarsChartData format) to Nemo per-sail polar format.
 *
 * VR format:  { tws: number[], twa: number[], sail: [{ name: string, speed: number[][] }] }
 * Nemo format: { boatClass: string, tws: number[], twa: number[], speeds: Record<SailId, number[][]> }
 *
 * Usage: npx tsx scripts/convert-vr-polars.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGET_TWA = [40, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180];
const TARGET_TWS = [6, 8, 10, 12, 14, 16, 20, 25, 30, 35];

const SAIL_MAP: Record<string, string> = {
  JIB: 'JIB', Jib: 'JIB',
  SPI: 'SPI', Spi: 'SPI',
  STAYSAIL: 'SS', Staysail: 'SS',
  LIGHT_JIB: 'LJ', LightJib: 'LJ',
  CODE_0: 'C0', Code0: 'C0',
  HEAVY_GNK: 'HG', HeavyGnk: 'HG',
  LIGHT_GNK: 'LG', LightGnk: 'LG',
};

const BOATS: { vrFile: string; boatClass: string; outFile: string }[] = [
  { vrFile: 'class_40.json', boatClass: 'CLASS40', outFile: 'class40.json' },
  { vrFile: 'figaro3.json', boatClass: 'FIGARO', outFile: 'figaro.json' },
  { vrFile: 'imoca_60_foils.json', boatClass: 'IMOCA60', outFile: 'imoca60.json' },
  { vrFile: 'multi_50_v2.json', boatClass: 'OCEAN_FIFTY', outFile: 'ocean-fifty.json' },
  { vrFile: 'ultim_macif.json', boatClass: 'ULTIM', outFile: 'ultim.json' },
];

function findBracket(arr: number[], value: number): { i0: number; i1: number; t: number } {
  if (value <= arr[0]!) return { i0: 0, i1: 0, t: 0 };
  if (value >= arr[arr.length - 1]!) {
    const i = arr.length - 1;
    return { i0: i, i1: i, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i]! && value <= arr[i + 1]!) {
      const span = arr[i + 1]! - arr[i]!;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - arr[i]!) / span };
    }
  }
  return { i0: 0, i1: 0, t: 0 };
}

function interpolate2D(
  srcTwa: number[], srcTws: number[], srcSpeeds: number[][],
  targetTwa: number, targetTws: number,
): number {
  const a = findBracket(srcTwa, targetTwa);
  const s = findBracket(srcTws, targetTws);
  const r0 = srcSpeeds[a.i0];
  const r1 = srcSpeeds[a.i1];
  if (!r0 || !r1) return 0;
  const v00 = r0[s.i0] ?? 0;
  const v01 = r0[s.i1] ?? 0;
  const v10 = r1[s.i0] ?? 0;
  const v11 = r1[s.i1] ?? 0;
  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
}

function resampleSail(
  srcTwa: number[], srcTws: number[], srcSpeeds: number[][],
): number[][] {
  return TARGET_TWA.map((twa) =>
    TARGET_TWS.map((tws) => {
      const v = interpolate2D(srcTwa, srcTws, srcSpeeds, twa, tws);
      return Math.round(Math.max(0, v) * 100) / 100;
    }),
  );
}

const outDirWeb = join(__dirname, '..', 'apps', 'web', 'public', 'data', 'polars');
mkdirSync(outDirWeb, { recursive: true });

for (const boat of BOATS) {
  const srcPath = join(__dirname, 'vr-source', boat.vrFile);
  const src = JSON.parse(readFileSync(srcPath, 'utf8'));
  const srcTwa: number[] = src.twa;
  const srcTws: number[] = src.tws;

  const speeds: Record<string, number[][]> = {};
  let sailCount = 0;

  for (const sailDef of src.sail) {
    const ourId = SAIL_MAP[sailDef.name];
    if (!ourId) {
      console.warn(`  Unknown sail "${sailDef.name}" in ${boat.vrFile}, skipping`);
      continue;
    }
    speeds[ourId] = resampleSail(srcTwa, srcTws, sailDef.speed);
    sailCount++;
  }

  const polar = {
    boatClass: boat.boatClass,
    tws: TARGET_TWS,
    twa: TARGET_TWA,
    speeds,
  };

  const outPath = join(outDirWeb, boat.outFile);
  writeFileSync(outPath, JSON.stringify(polar, null, 2) + '\n');
  console.log(`OK ${boat.boatClass}: ${sailCount} sails -> ${outPath}`);
}

console.log('Done.');
