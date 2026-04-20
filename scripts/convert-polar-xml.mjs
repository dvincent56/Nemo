#!/usr/bin/env node
/**
 * Convert a Bureau Vallée polar XML export to the Nemo JSON format.
 *
 * Usage:
 *   node scripts/convert-polar-xml.mjs <input.xml> <output.json> [--tws 4,6,8,10,12,14,16,20,25,30] [--boat IMOCA60]
 *
 * The XML has one <PolarCurve> per TWS step, with per-degree <PolarItem>
 * for TWA 1..180. We downsample to a sensible TWA axis and collapse the
 * 7 Nemo sails (JIB/LJ/SS/C0/SPI/HG/LG) onto the same curve — Bureau Vallée
 * doesn't split per-sail, so all sails share the boat's optimal envelope.
 *
 * Flags:
 *   --tws <csv>     TWS values (knots) matching PolarCurveIndex 1..N. Default:
 *                   4,6,8,10,12,14,16,20,25,30
 *   --twa <csv>     TWA axis (degrees). Default: 30,40,50,60,75,90,110,120,135,150,165,180
 *   --boat <class>  Boat class string. Default: IMOCA60
 */
import { readFileSync, writeFileSync } from 'node:fs';

const NEMO_SAILS = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];
const DEFAULT_TWS = [4, 6, 8, 10, 12, 14, 16, 20, 25, 30];
const DEFAULT_TWA = [30, 40, 50, 60, 75, 90, 110, 120, 135, 150, 165, 180];

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args.flags[a.slice(2)] = argv[++i];
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function parseXml(xml) {
  // Extract PolarCurves by regex (simpler than a full XML parser for this shape).
  const curves = [];
  const curveRe = /<PolarCurve>([\s\S]*?)<\/PolarCurve>/g;
  let m;
  while ((m = curveRe.exec(xml))) {
    const body = m[1];
    const idxMatch = body.match(/<PolarCurveIndex value ="(\d+)"\/>/);
    const index = idxMatch ? parseInt(idxMatch[1], 10) : curves.length + 1;
    const items = {};
    const itemRe = /<PolarItem><Angle value="(\d+)"\/><Value value="([\d.]+)"\/><\/PolarItem>/g;
    let it;
    while ((it = itemRe.exec(body))) {
      items[parseInt(it[1], 10)] = parseFloat(it[2]);
    }
    curves.push({ index, items });
  }
  curves.sort((a, b) => a.index - b.index);
  return curves;
}

/** Linear interpolation within a curve's per-degree map. */
function lookup(items, angle) {
  const intAngle = Math.round(angle);
  if (items[intAngle] !== undefined) return items[intAngle];
  // Find neighbours
  let below = 0, above = 180;
  for (const k of Object.keys(items)) {
    const v = parseInt(k, 10);
    if (v <= angle && v > below) below = v;
    if (v >= angle && v < above) above = v;
  }
  if (items[below] === undefined) return items[above] ?? 0;
  if (items[above] === undefined) return items[below] ?? 0;
  if (above === below) return items[below];
  const t = (angle - below) / (above - below);
  return items[below] * (1 - t) + items[above] * t;
}

function main() {
  const args = parseArgs(process.argv);
  const [input, output] = args.positional;
  if (!input || !output) {
    console.error('Usage: node convert-polar-xml.mjs <input.xml> <output.json> [--tws ..] [--twa ..] [--boat ..]');
    process.exit(1);
  }
  const tws = args.flags.tws ? args.flags.tws.split(',').map(Number) : DEFAULT_TWS;
  const twa = args.flags.twa ? args.flags.twa.split(',').map(Number) : DEFAULT_TWA;
  const boatClass = args.flags.boat ?? 'IMOCA60';

  const xml = readFileSync(input, 'utf8');
  const curves = parseXml(xml);
  if (curves.length === 0) {
    console.error('No <PolarCurve> found in XML.');
    process.exit(1);
  }
  if (curves.length !== tws.length) {
    console.warn(`XML has ${curves.length} curves but --tws has ${tws.length} values. Mapping by index; adjust --tws if needed.`);
  }

  // Build grid: for each TWA in our axis, for each TWS index, read the curve value.
  // Nemo stores speeds[sail][twaIdx][twsIdx]. Since XML has no sail split, all
  // sails share the same grid.
  const grid = twa.map((a) => curves.map((c) => Math.round(lookup(c.items, a) * 100) / 100));
  const speeds = {};
  for (const sail of NEMO_SAILS) {
    speeds[sail] = grid.map((row) => [...row]);
  }

  const out = {
    boatClass,
    source: 'Bureau Vallée XML — converted by scripts/convert-polar-xml.mjs',
    twa,
    tws: tws.slice(0, curves.length),
    speeds,
  };

  writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${output} — ${twa.length} TWA × ${curves.length} TWS, sails: ${NEMO_SAILS.join(', ')}`);
}

main();
