#!/usr/bin/env node
/**
 * Convert a qtVLM-style polar CSV to the Nemo JSON format.
 *
 * Input CSV shape:
 *   TWA\TWS;0;1;2;...;70      ← first row = TWS values (knots)
 *   0;0;0;0;...;0             ← each row starts with TWA (0..180)
 *   1;0;0.009;0.017;...
 *   ...
 *
 * Usage:
 *   node scripts/convert-polar-csv.mjs <input.csv> <output.json> [--boat IMOCA60] [--sail JIB] [--merge existing.json]
 *
 * Because qtVLM delivers one CSV per (boat × sail), run it once per sail and
 * use --merge to accumulate the 7 Nemo sails (JIB/LJ/SS/C0/SPI/HG/LG) into a
 * single output JSON. Unspecified sails fall back to JIB when merging.
 *
 * Flags:
 *   --boat <class>           Boat class key in output. Default: IMOCA60
 *   --sail <JIB|LJ|...>     Sail to populate. Default: JIB
 *   --twa <csv>              Subsampled TWA axis. Default: full axis from CSV
 *   --tws <csv>              Subsampled TWS axis. Default: full axis from CSV
 *   --merge <path>           Merge into existing JSON (adds this sail, keeps others)
 *   --sep <char>             CSV separator. Default: ;
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const NEMO_SAILS = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { args.flags[a.slice(2)] = argv[++i]; }
    else args.positional.push(a);
  }
  return args;
}

function parseCsv(text, sep) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = rows[0].split(sep).map((c) => c.trim());
  // header[0] is "TWA\TWS" label; header[1..] are TWS values
  const tws = header.slice(1).map(Number).filter((n) => !Number.isNaN(n));
  const twa = [];
  const grid = []; // grid[twaIdx][twsIdx] = BSP
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(sep);
    const a = Number(cells[0]);
    if (Number.isNaN(a)) continue;
    twa.push(a);
    const row = [];
    for (let j = 0; j < tws.length; j++) {
      const v = Number(cells[j + 1] ?? 0);
      row.push(Number.isFinite(v) ? v : 0);
    }
    grid.push(row);
  }
  return { twa, tws, grid };
}

function subsampleAxis(full, wanted) {
  const out = [];
  for (const w of wanted) {
    // Find nearest index
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < full.length; i++) {
      const d = Math.abs(full[i] - w);
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }
    out.push(bestIdx);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const [input, output] = args.positional;
  if (!input || !output) {
    console.error('Usage: node convert-polar-csv.mjs <input.csv> <output.json> [--boat ..] [--sail ..] [--twa ..] [--tws ..] [--merge path] [--sep ;]');
    process.exit(1);
  }
  const sep = args.flags.sep ?? ';';
  const boatClass = args.flags.boat ?? 'IMOCA60';
  const sail = args.flags.sail ?? 'JIB';
  if (!NEMO_SAILS.includes(sail)) {
    console.error(`--sail must be one of ${NEMO_SAILS.join(', ')}`);
    process.exit(1);
  }

  const text = readFileSync(input, 'utf8');
  const { twa: fullTwa, tws: fullTws, grid: fullGrid } = parseCsv(text, sep);
  if (fullTwa.length === 0 || fullTws.length === 0) {
    console.error('Failed to parse TWA/TWS axes from CSV.');
    process.exit(1);
  }

  // Resolve the output TWA / TWS axes (subsample if requested)
  const twaAxis = args.flags.twa ? args.flags.twa.split(',').map(Number) : fullTwa;
  const twsAxis = args.flags.tws ? args.flags.tws.split(',').map(Number) : fullTws;
  const twaIdx = twaAxis === fullTwa ? fullTwa.map((_, i) => i) : subsampleAxis(fullTwa, twaAxis);
  const twsIdx = twsAxis === fullTws ? fullTws.map((_, i) => i) : subsampleAxis(fullTws, twsAxis);

  const sailGrid = twaIdx.map((ai) => twsIdx.map((si) => Math.round(fullGrid[ai][si] * 1000) / 1000));

  // Merge with existing JSON if requested, else build from scratch
  let out;
  const mergePath = args.flags.merge ?? (existsSync(output) ? output : null);
  if (mergePath && existsSync(mergePath)) {
    out = JSON.parse(readFileSync(mergePath, 'utf8'));
    if (!out.speeds || typeof out.speeds !== 'object') out.speeds = {};
    out.boatClass = boatClass;
    out.twa = twaAxis;
    out.tws = twsAxis;
    out.source = out.source ?? 'qtVLM CSV';
  } else {
    out = {
      boatClass,
      source: 'qtVLM CSV — converted by scripts/convert-polar-csv.mjs',
      twa: twaAxis,
      tws: twsAxis,
      speeds: {},
    };
  }

  out.speeds[sail] = sailGrid;
  // Fill missing sails with the current sail data (fallback until all are provided)
  for (const s of NEMO_SAILS) {
    if (!out.speeds[s]) out.speeds[s] = sailGrid.map((row) => [...row]);
  }

  writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${output} — sail=${sail}, TWA=${twaAxis.length} pts, TWS=${twsAxis.length} pts`);
  console.log(`Sails populated: ${Object.keys(out.speeds).join(', ')}`);
}

main();
