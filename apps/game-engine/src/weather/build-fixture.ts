import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Génère une fixture météo déterministe pour les tests Phase 2.
 * Grille 11×11 points sur [40°N–50°N, 10°W–0°W], résolution 1°.
 * 4 slots prévisionnels (0h, 1h, 2h, 4h) avec TWS qui évolue :
 *   slot 0 → 12 kts (calme) · slot 1 → 18 kts · slot 2 → 25 kts · slot 3 → 30 kts
 * TWD constant à 270° (vent d'ouest). Houle absente.
 *
 * Sortie : apps/game-engine/fixtures/weather-grid.json
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROWS = 11;
const COLS = 11;
const BBOX = { latMin: 40, latMax: 50, lonMin: -10, lonMax: 0 };
const RESOLUTION = 1.0;
const FORECAST_HOURS = [0, 0.25, 0.5, 1.0];
const TWS_BY_SLOT = [12, 22, 28, 32];
const TWD = 270;

function b64(arr: Float32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

async function main(): Promise<void> {
  const plane = ROWS * COLS;
  const total = plane * FORECAST_HOURS.length;
  const tws = new Float32Array(total);
  const twd = new Float32Array(total);
  const swh = new Float32Array(total);
  const mwd = new Float32Array(total);
  const mwp = new Float32Array(total);

  for (let s = 0; s < FORECAST_HOURS.length; s++) {
    const base = s * plane;
    const windKts = TWS_BY_SLOT[s] ?? 15;
    for (let i = 0; i < plane; i++) {
      tws[base + i] = windKts;
      twd[base + i] = TWD;
      swh[base + i] = 0;
      mwd[base + i] = 0;
      mwp[base + i] = 0;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const grid = {
    runTs: now,
    bbox: BBOX,
    resolution: RESOLUTION,
    shape: { rows: ROWS, cols: COLS },
    forecastHours: FORECAST_HOURS,
    variables: {
      tws: b64(tws),
      twd: b64(twd),
      swh: b64(swh),
      mwd: b64(mwd),
      mwp: b64(mwp),
    },
  };

  const out = join(__dirname, '..', '..', 'fixtures', 'weather-grid.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(grid, null, 2), 'utf8');
  console.log(`fixture écrite : ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
