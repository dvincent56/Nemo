# Global Weather Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock correct global wind overlay and projection (currently broken outside the Atlantic because of a silent-clamp bug combined with an Atlantic-only prefetch bounds). Introduce a tiered LOD payload strategy that keeps client downloads small.

**Architecture:** Server keeps 10 days of GFS data at 0.25° (unchanged). Client fetches global coverage at **1° resolution** capped at **120h (5 days)**, in three sequential phases (TTFW → t=3..48h → t=54..120h). A **tactical 0.25° tile** covering 40°×40° around the boat, t=0..24h, is fetched lazily for high-precision rendering near the player. Binary wire format gains an optional **int16 quantization** mode that halves payload size (`?q=int16`) and a `resolution` query param that asks the server for a decimated grid.

**Silent-clamp root cause:** [apps/web/src/components/play/WindOverlay.tsx:50-53](../../apps/web/src/components/play/WindOverlay.tsx#L50-L53) and [apps/web/src/lib/weather/interpolate.ts:36-39](../../apps/web/src/lib/weather/interpolate.ts#L36-L39) silently clamp out-of-range indices to the grid edge, which makes the bounds-scoping bug invisible (produces fake latitudinal bands instead of zeros). Fixing the clamp is a prerequisite — without it, the next time someone narrows bounds the same bug returns.

**Tech Stack:** TypeScript (Fastify backend, Next.js 16 frontend), Vitest, existing binary GRIB pipeline

**Spec source:** conversation with user on 2026-04-22, no written spec document

---

## File Structure

### Modified files (backend — game-engine)
- `apps/game-engine/src/weather/binary-encoder.ts` — add `resolution` downsampling + optional int16 quantization + header version bump
- `apps/game-engine/src/routes/weather.ts` — parse `resolution` and `q` query params, relax bounds validation for global
- `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts` — new cases (downsample, int16 roundtrip)

### Modified files (frontend — web)
- `apps/web/src/lib/weather/binaryDecoder.ts` — read header version, decode int16 body, expose `encoding` field
- `apps/web/src/lib/weather/prefetch.ts` — change `DEFAULT_BOUNDS` to global, split hours into 3 phases, add `resolution`/`encoding` options
- `apps/web/src/hooks/useWeatherPrefetch.ts` — sequential 3-phase loading (TTFW → phase1 → phase2)
- `apps/web/src/lib/projection/fetchWindGrid.ts` — cap to 120h, use phase1+2 combined at 1° resolution
- `apps/web/src/components/play/WindOverlay.tsx` — lose the silent clamp (return zero tws when out of grid), add tactical-tile priority lookup
- `apps/web/src/lib/weather/interpolate.ts` — same silent-clamp fix for consistency

### New files (frontend — web)
- `apps/web/src/lib/weather/tacticalTile.ts` — tactical 0.25° tile fetcher + cache (40°×40° around boat, t=0..24h)
- `apps/web/src/hooks/useTacticalTile.ts` — React hook that triggers lazy fetch + refetch on boat movement
- `apps/web/src/lib/weather/__tests__/prefetch.test.ts` — verifies phase splits and payload budgets
- `apps/web/src/lib/weather/__tests__/tacticalTile.test.ts` — tile-window logic tests

### Files to verify (no modification expected)
- `apps/web/src/hooks/useProjectionLine.ts` — consumes `header.gridStepLat`/`lonMax`, should just work at 1°
- `apps/web/src/lib/weather/gridFromBinary.ts` — already reads `gridStepLat` from header, no change
- `apps/web/public/data/wind.json` — 1° global fallback file, keep as-is

---

## Task 1: Backend — int16 Quantization Encoder

**Context:** Currently the binary body is Float32 (4 bytes per value). We add an optional int16 (2 bytes per value) encoding triggered by `?q=int16` query param. Scale factors are fixed per field so the decoder doesn't need per-field metadata:

- U, V, SWH, MWP → `int16 = round(value × 100)` (range ±327 m/s / ±327 m / ±327 s with 0.01 precision)
- mwdSin, mwdCos → `int16 = round(value × 30000)` (range ±1.09 with 0.000033 precision)
- NaN is encoded as `-32768` (sentinel) and decoded back to `NaN`

We bump `gridVersion` in the header so mixed-version clients don't silently misread.

**Files:**
- Modify: `apps/game-engine/src/weather/binary-encoder.ts`
- Modify: `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts`

- [ ] **Step 1: Add the new `encoding` option to `EncodeOptions`**

Update the interface at the top of `apps/game-engine/src/weather/binary-encoder.ts`:

```typescript
export type GridEncoding = 'float32' | 'int16';

export interface EncodeOptions {
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  hours: number[];
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number;
  blendAlpha: number;
  /** Target grid step in degrees. If > source resolution, the encoder decimates. */
  resolution?: number;
  /** Wire body encoding. Defaults to 'float32' for backwards compatibility. */
  encoding?: GridEncoding;
}
```

Add a header constant near the top:

```typescript
export const GRID_VERSION = 2; // bumped from implicit v1 (float32) to v2 (adds encoding byte)
export const SCALE_UV_SWH_MWP = 100;
export const SCALE_SIN_COS = 30000;
export const INT16_NAN = -32768;
```

- [ ] **Step 2: Write failing test for int16 roundtrip**

Append to `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts`:

```typescript
import { encodeGridSubset, decodeHeader, GRID_VERSION, SCALE_UV_SWH_MWP, SCALE_SIN_COS, INT16_NAN, HEADER_SIZE } from '../binary-encoder.js';

describe('encodeGridSubset — int16 encoding', () => {
  it('roundtrips U/V values within 0.01 m/s tolerance', () => {
    const grid = makeTinyGrid(); // existing helper, float32 U/V
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: -10, latMax: 10, lonMin: -10, lonMax: 10 },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
      encoding: 'int16',
    });
    const header = decodeHeader(buf);
    expect(header.numLat * header.numLon).toBeGreaterThan(0);

    const dv = new DataView(buf);
    // Read first U/V pair as int16 from body
    const u0 = dv.getInt16(HEADER_SIZE, true) / SCALE_UV_SWH_MWP;
    const v0 = dv.getInt16(HEADER_SIZE + 2, true) / SCALE_UV_SWH_MWP;
    expect(u0).toBeCloseTo(grid.u[0]!, 2);
    expect(v0).toBeCloseTo(grid.v[0]!, 2);
  });

  it('encodes NaN as INT16_NAN sentinel', () => {
    const grid = makeTinyGrid();
    grid.swh[0] = NaN;
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: -10, latMax: 10, lonMin: -10, lonMax: 10 },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
      encoding: 'int16',
    });
    const dv = new DataView(buf);
    // SWH is the 3rd field per cell (after u, v), so offset = HEADER_SIZE + 4
    expect(dv.getInt16(HEADER_SIZE + 4, true)).toBe(INT16_NAN);
  });

  it('writes GRID_VERSION=2 in the header', () => {
    const grid = makeTinyGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: -10, latMax: 10, lonMin: -10, lonMax: 10 },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
      encoding: 'int16',
    });
    const dv = new DataView(buf);
    // version byte lives at offset 46 (see Step 3 layout)
    expect(dv.getUint8(46)).toBe(GRID_VERSION);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm --filter @nemo/game-engine test -- binary-encoder`
Expected: FAIL — `encoding` option unknown / version byte missing.

- [ ] **Step 4: Implement int16 encoding + version byte**

In `encodeGridSubset`, replace the header write block and body write block. The header layout becomes (48 bytes total):

| offset | size | field |
|---|---|---|
| 0 | 4 | runTimestamp |
| 4 | 4 | nextRunExpectedUtc |
| 8 | 1 | weatherStatus (padded to 4) |
| 12 | 4 | blendAlpha |
| 16 | 4 | latMin |
| 20 | 4 | latMax |
| 24 | 4 | lonMin |
| 28 | 4 | lonMax |
| 32 | 4 | gridStepLat |
| 36 | 4 | gridStepLon |
| 40 | 2 | numLat |
| 42 | 2 | numLon |
| 44 | 2 | numHours |
| 46 | 1 | **gridVersion** (new) |
| 47 | 1 | **encoding** (0=float32, 1=int16) (new) |

Replace the full body write section with:

```typescript
const encoding: GridEncoding = opts.encoding ?? 'float32';

const bodyBytesPerFloat = encoding === 'int16' ? 2 : 4;
const bodyFloats = numHours * numLat * numLon * 6;
const totalBytes = HEADER_SIZE + bodyFloats * bodyBytesPerFloat;
const buf = new ArrayBuffer(totalBytes);
const dv = new DataView(buf);

// Header
let off = 0;
dv.setUint32(off, opts.runTimestamp, true); off += 4;
dv.setUint32(off, opts.nextRunExpectedUtc, true); off += 4;
dv.setUint8(off, opts.weatherStatus); off += 4;
dv.setFloat32(off, opts.blendAlpha, true); off += 4;
dv.setFloat32(off, actualLatMin, true); off += 4;
dv.setFloat32(off, actualLatMax, true); off += 4;
dv.setFloat32(off, actualLonMin, true); off += 4;
dv.setFloat32(off, actualLonMax, true); off += 4;
dv.setFloat32(off, res, true); off += 4;
dv.setFloat32(off, res, true); off += 4;
dv.setUint16(off, numLat, true); off += 2;
dv.setUint16(off, numLon, true); off += 2;
dv.setUint16(off, numHours, true); off += 2;
dv.setUint8(off, GRID_VERSION); off += 1;
dv.setUint8(off, encoding === 'int16' ? 1 : 0); off += 1;

// Body
const quant = (value: number, scale: number): number => {
  if (!Number.isFinite(value)) return INT16_NAN;
  const q = Math.round(value * scale);
  if (q >= 32767) return 32767;
  if (q <= -32767) return -32767; // reserve -32768 for NaN
  return q;
};

let bi = 0;
for (const fh of opts.hours) {
  const slotIdx = grid.forecastHours.indexOf(fh);
  if (slotIdx === -1) continue;
  const slotOff = slotIdx * plane;
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const i = slotOff + r * grid.shape.cols + c;
      const u = grid.u[i]!, v = grid.v[i]!, swh = grid.swh[i]!;
      const ms = grid.mwdSin[i]!, mc = grid.mwdCos[i]!, mwp = grid.mwp[i]!;
      if (encoding === 'int16') {
        dv.setInt16(HEADER_SIZE + bi * 2, quant(u, SCALE_UV_SWH_MWP), true); bi++;
        dv.setInt16(HEADER_SIZE + bi * 2, quant(v, SCALE_UV_SWH_MWP), true); bi++;
        dv.setInt16(HEADER_SIZE + bi * 2, quant(swh, SCALE_UV_SWH_MWP), true); bi++;
        dv.setInt16(HEADER_SIZE + bi * 2, quant(ms, SCALE_SIN_COS), true); bi++;
        dv.setInt16(HEADER_SIZE + bi * 2, quant(mc, SCALE_SIN_COS), true); bi++;
        dv.setInt16(HEADER_SIZE + bi * 2, quant(mwp, SCALE_UV_SWH_MWP), true); bi++;
      } else {
        dv.setFloat32(HEADER_SIZE + bi * 4, u, true); bi++;
        dv.setFloat32(HEADER_SIZE + bi * 4, v, true); bi++;
        dv.setFloat32(HEADER_SIZE + bi * 4, swh, true); bi++;
        dv.setFloat32(HEADER_SIZE + bi * 4, ms, true); bi++;
        dv.setFloat32(HEADER_SIZE + bi * 4, mc, true); bi++;
        dv.setFloat32(HEADER_SIZE + bi * 4, mwp, true); bi++;
      }
    }
  }
}
return buf;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @nemo/game-engine test -- binary-encoder`
Expected: PASS (all existing + 3 new cases).

- [ ] **Step 6: Commit**

```bash
git add apps/game-engine/src/weather/binary-encoder.ts apps/game-engine/src/weather/__tests__/binary-encoder.test.ts
git commit -m "feat(weather-engine): add int16 quantization encoding (v2 binary format)"
```

---

## Task 2: Backend — Resolution Downsampling

**Context:** Client requests a coarser grid via `?resolution=1`. We decimate from the 0.25° source by a stride `N = round(resolution / source.resolution)`. Decimation (every Nth row/col) is fine for visualization — the wind field is already smooth at synoptic scales.

**Files:**
- Modify: `apps/game-engine/src/weather/binary-encoder.ts` (extends Task 1 changes)
- Modify: `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts`

- [ ] **Step 1: Write failing test for downsample stride=4**

Append:

```typescript
describe('encodeGridSubset — resolution downsampling', () => {
  it('decimates a 0.25° grid to 1° via stride=4', () => {
    const grid = makeGridWithRes(0.25, /*rows*/ 21, /*cols*/ 21); // 5° × 5° at 0.25°
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: grid.bbox.latMin, latMax: grid.bbox.latMax,
                lonMin: grid.bbox.lonMin, lonMax: grid.bbox.lonMax },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
      resolution: 1,
    });
    const header = decodeHeader(buf);
    expect(header.gridStepLat).toBeCloseTo(1, 4);
    expect(header.gridStepLon).toBeCloseTo(1, 4);
    // 21 source rows at 0.25°, stride=4 → ceil(21/4)=6 output rows
    expect(header.numLat).toBe(6);
    expect(header.numLon).toBe(6);
  });

  it('returns source resolution when resolution omitted', () => {
    const grid = makeGridWithRes(0.25, 9, 9);
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: grid.bbox.latMin, latMax: grid.bbox.latMax,
                lonMin: grid.bbox.lonMin, lonMax: grid.bbox.lonMax },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
    });
    const header = decodeHeader(buf);
    expect(header.gridStepLat).toBeCloseTo(0.25, 4);
    expect(header.numLat).toBe(9);
  });
});

function makeGridWithRes(resolution: number, rows: number, cols: number): WeatherGridUV {
  // helper using existing shape: fill u/v with row+col to make decimation testable
  const len = rows * cols;
  const u = new Float32Array(len), v = new Float32Array(len);
  const swh = new Float32Array(len), ms = new Float32Array(len);
  const mc = new Float32Array(len), mwp = new Float32Array(len);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; u[i] = r; v[i] = c;
  }
  return {
    runTs: 1000,
    bbox: { latMin: 0, latMax: (rows - 1) * resolution, lonMin: 0, lonMax: (cols - 1) * resolution },
    resolution,
    shape: { rows, cols },
    forecastHours: [0],
    u, v, swh, mwdSin: ms, mwdCos: mc, mwp,
  };
}
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @nemo/game-engine test -- binary-encoder`
Expected: FAIL — `resolution` ignored, still outputs source stride.

- [ ] **Step 3: Implement decimation stride**

Near the top of `encodeGridSubset`, after computing `rowStart/rowEnd/colStart/colEnd`, insert:

```typescript
const targetRes = opts.resolution && opts.resolution > 0 ? opts.resolution : res;
// Use round to tolerate floating-point (e.g. 1 / 0.25 === 3.9999 on some JITs)
const stride = Math.max(1, Math.round(targetRes / res));
const outRes = res * stride;
```

Replace the `numLat`/`numLon` computation with:

```typescript
const rawNumLat = rowEnd - rowStart + 1;
const rawNumLon = colEnd - colStart + 1;
const numLat = Math.ceil(rawNumLat / stride);
const numLon = Math.ceil(rawNumLon / stride);
```

Replace `actualLatMax` / `actualLonMax` to use the decimated extent:

```typescript
const actualLatMax = grid.bbox.latMin + (rowStart + (numLat - 1) * stride) * res;
const actualLonMax = grid.bbox.lonMin + (colStart + (numLon - 1) * stride) * res;
```

Replace the two `dv.setFloat32(off, res, true)` calls writing `gridStepLat`/`gridStepLon` with `outRes`.

Change the body loops to stride:

```typescript
for (let r = rowStart; r <= rowEnd; r += stride) {
  for (let c = colStart; c <= colEnd; c += stride) {
    const i = slotOff + r * grid.shape.cols + c;
    // ... existing u/v/swh/... read + write ...
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @nemo/game-engine test -- binary-encoder`
Expected: PASS (downsample + encoding tests all green).

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/weather/binary-encoder.ts apps/game-engine/src/weather/__tests__/binary-encoder.test.ts
git commit -m "feat(weather-engine): support resolution downsampling via stride decimation"
```

---

## Task 3: Backend — Expose `resolution` and `q` Query Params

**Files:**
- Modify: `apps/game-engine/src/routes/weather.ts`

- [ ] **Step 1: Parse new query params**

Replace the `Querystring` generic and parsing block at [apps/game-engine/src/routes/weather.ts:17-34](../../apps/game-engine/src/routes/weather.ts#L17-L34) with:

```typescript
app.get<{ Querystring: { bounds?: string; hours?: string; resolution?: string; q?: string } }>(
  '/api/v1/weather/grid',
  async (req, reply) => {
    const provider = getProvider();
    const grid = provider.getGrid();

    const boundsStr = req.query.bounds ?? `${grid.bbox.latMin},${grid.bbox.lonMin},${grid.bbox.latMax},${grid.bbox.lonMax}`;
    const parts = boundsStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
      return reply.status(400).send({ error: 'invalid bounds' });
    }
    const [latMin, lonMin, latMax, lonMax] = parts;

    const hoursStr = req.query.hours ?? '0';
    const hours = hoursStr.split(',').map(Number).filter(h => grid.forecastHours.includes(h));
    if (hours.length === 0) {
      return reply.status(400).send({ error: 'no valid forecast hours' });
    }

    const resolution = req.query.resolution ? Number(req.query.resolution) : undefined;
    if (resolution !== undefined && (!Number.isFinite(resolution) || resolution <= 0 || resolution > 10)) {
      return reply.status(400).send({ error: 'invalid resolution (must be >0 and ≤10)' });
    }

    const encoding = req.query.q === 'int16' ? 'int16' : 'float32';

    const statusMap = { stable: 0, blending: 1, delayed: 2 } as const;
    const maxAge = provider.blendStatus === 'blending' ? 60 : 300;

    const buf = encodeGridSubset(grid, {
      bounds: { latMin: latMin!, latMax: latMax!, lonMin: lonMin!, lonMax: lonMax! },
      hours,
      runTimestamp: provider.runTs,
      nextRunExpectedUtc: provider.nextRunExpectedUtc,
      weatherStatus: statusMap[provider.blendStatus],
      blendAlpha: provider.blendAlpha,
      resolution,
      encoding,
    });

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Cache-Control', `public, max-age=${maxAge}`)
      .send(Buffer.from(buf));
  },
);
```

- [ ] **Step 2: Smoke-test the endpoint manually**

Start the engine locally and hit the endpoint. Add a bash one-liner to verify payload size:

```bash
curl -sS "http://localhost:3001/api/v1/weather/grid?bounds=-90,-180,90,180&hours=0&resolution=1&q=int16" | wc -c
# Expected around 48 + 181*361*6*2 = ~784 KB  (pre-gzip)
```

Compare with float32 (same bounds/hours, no `q`):

```bash
curl -sS "http://localhost:3001/api/v1/weather/grid?bounds=-90,-180,90,180&hours=0&resolution=1" | wc -c
# Expected around 48 + 181*361*6*4 = ~1.57 MB
```

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/routes/weather.ts
git commit -m "feat(weather-engine): expose resolution and int16 encoding query params"
```

---

## Task 4: Frontend — binaryDecoder int16 Support

**Context:** Decoder must handle both float32 (v1/v2 without int16 flag) and int16 (v2 with encoding byte=1). After decoding, upstream consumers still receive a Float32Array — the decoder dequantizes transparently.

**Files:**
- Modify: `apps/web/src/lib/weather/binaryDecoder.ts`

- [ ] **Step 1: Extend header + write failing test**

Create `apps/web/src/lib/weather/__tests__/binaryDecoder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { decodeWeatherGrid, HEADER_SIZE } from '../binaryDecoder';

function buildFloat32Grid(): ArrayBuffer {
  const numLat = 2, numLon = 2, numHours = 1;
  const body = numLat * numLon * numHours * 6;
  const buf = new ArrayBuffer(HEADER_SIZE + body * 4);
  const dv = new DataView(buf);
  dv.setFloat32(32, 1.0, true); dv.setFloat32(36, 1.0, true); // gridStep
  dv.setUint16(40, numLat, true); dv.setUint16(42, numLon, true); dv.setUint16(44, numHours, true);
  dv.setUint8(46, 2); // version 2
  dv.setUint8(47, 0); // encoding = float32
  new Float32Array(buf, HEADER_SIZE, body).fill(3.5);
  return buf;
}

function buildInt16Grid(): ArrayBuffer {
  const numLat = 2, numLon = 2, numHours = 1;
  const body = numLat * numLon * numHours * 6;
  const buf = new ArrayBuffer(HEADER_SIZE + body * 2);
  const dv = new DataView(buf);
  dv.setFloat32(32, 1.0, true); dv.setFloat32(36, 1.0, true);
  dv.setUint16(40, numLat, true); dv.setUint16(42, numLon, true); dv.setUint16(44, numHours, true);
  dv.setUint8(46, 2); dv.setUint8(47, 1); // version 2, int16
  // 350 → 3.50 m/s (U/V scale 100)
  for (let i = 0; i < body; i++) dv.setInt16(HEADER_SIZE + i * 2, 350, true);
  return buf;
}

describe('decodeWeatherGrid', () => {
  it('decodes a float32 (encoding=0) body unchanged', () => {
    const { header, data } = decodeWeatherGrid(buildFloat32Grid());
    expect(header.numLat).toBe(2);
    expect(data[0]).toBeCloseTo(3.5, 4);
  });

  it('decodes an int16 (encoding=1) body and dequantizes U/V with 0.01 precision', () => {
    const { header, data } = decodeWeatherGrid(buildInt16Grid());
    expect(header.numLat).toBe(2);
    // index 0 is U at lat=0,lon=0,hour=0 → 350 / 100 = 3.5
    expect(data[0]).toBeCloseTo(3.5, 4);
    // index 3 is mwdSin → 350 / 30000 ≈ 0.01167
    expect(data[3]).toBeCloseTo(350 / 30000, 5);
  });
});
```

Run: `pnpm --filter @nemo/web test -- binaryDecoder`
Expected: FAIL — decoder treats body as Float32 always.

- [ ] **Step 2: Update `binaryDecoder.ts` to handle both encodings**

Replace the file contents with:

```typescript
// apps/web/src/lib/weather/binaryDecoder.ts

export const HEADER_SIZE = 48;
const SCALE_UV_SWH_MWP = 100;
const SCALE_SIN_COS = 30000;
const INT16_NAN = -32768;

export interface WeatherGridHeader {
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: 0 | 1 | 2;
  blendAlpha: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  gridStepLat: number;
  gridStepLon: number;
  numLat: number;
  numLon: number;
  numHours: number;
  gridVersion: number;
  encoding: 'float32' | 'int16';
}

export interface DecodedWeatherGrid {
  header: WeatherGridHeader;
  data: Float32Array;
  hours?: number[];
}

export function decodeWeatherGrid(buf: ArrayBuffer): DecodedWeatherGrid {
  const dv = new DataView(buf);
  const gridVersion = dv.getUint8(46);
  const encodingByte = gridVersion >= 2 ? dv.getUint8(47) : 0;
  const encoding: 'float32' | 'int16' = encodingByte === 1 ? 'int16' : 'float32';

  const header: WeatherGridHeader = {
    runTimestamp: dv.getUint32(0, true),
    nextRunExpectedUtc: dv.getUint32(4, true),
    weatherStatus: dv.getUint8(8) as 0 | 1 | 2,
    blendAlpha: dv.getFloat32(12, true),
    latMin: dv.getFloat32(16, true),
    latMax: dv.getFloat32(20, true),
    lonMin: dv.getFloat32(24, true),
    lonMax: dv.getFloat32(28, true),
    gridStepLat: dv.getFloat32(32, true),
    gridStepLon: dv.getFloat32(36, true),
    numLat: dv.getUint16(40, true),
    numLon: dv.getUint16(42, true),
    numHours: dv.getUint16(44, true),
    gridVersion,
    encoding,
  };

  const bodyLen = header.numHours * header.numLat * header.numLon * 6;
  let data: Float32Array;
  if (encoding === 'float32') {
    data = new Float32Array(buf, HEADER_SIZE, bodyLen);
  } else {
    // Dequantize int16 → float32. Field order per cell: u, v, swh, sin, cos, mwp
    const i16 = new Int16Array(buf, HEADER_SIZE, bodyLen);
    data = new Float32Array(bodyLen);
    for (let i = 0; i < bodyLen; i++) {
      const raw = i16[i]!;
      if (raw === INT16_NAN) { data[i] = NaN; continue; }
      const mod = i % 6;
      const scale = (mod === 3 || mod === 4) ? SCALE_SIN_COS : SCALE_UV_SWH_MWP;
      data[i] = raw / scale;
    }
  }
  return { header, data };
}

export function getPointAt(
  grid: DecodedWeatherGrid,
  hourIdx: number,
  latIdx: number,
  lonIdx: number,
): { u: number; v: number; swh: number; mwdSin: number; mwdCos: number; mwp: number } {
  const { numLat, numLon } = grid.header;
  const pointsPerHour = numLat * numLon;
  const base = (hourIdx * pointsPerHour + latIdx * numLon + lonIdx) * 6;
  return {
    u: grid.data[base]!,
    v: grid.data[base + 1]!,
    swh: grid.data[base + 2]!,
    mwdSin: grid.data[base + 3]!,
    mwdCos: grid.data[base + 4]!,
    mwp: grid.data[base + 5]!,
  };
}
```

- [ ] **Step 3: Run tests to verify pass**

Run: `pnpm --filter @nemo/web test -- binaryDecoder`
Expected: PASS (both float32 + int16 cases).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/weather/binaryDecoder.ts apps/web/src/lib/weather/__tests__/binaryDecoder.test.ts
git commit -m "feat(web): decode int16-quantized weather grids"
```

---

## Task 5: Frontend — Prefetch Bounds and Phase Splits

**Context:** `DEFAULT_BOUNDS` is scoped to the Atlantic and `PREFETCH_HOURS_PHASE2` reaches t+240h. We want: global bounds, a dedicated TTFW (t=0 only) phase, a phase1 stopping at 48h, and a phase2 stopping at 120h. Also expose `resolution` + `encoding` options on `fetchWeatherGrid`.

**Files:**
- Modify: `apps/web/src/lib/weather/prefetch.ts`
- Create: `apps/web/src/lib/weather/__tests__/prefetch.test.ts`

- [ ] **Step 1: Write failing test asserting new constants**

`apps/web/src/lib/weather/__tests__/prefetch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOUNDS,
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
} from '../prefetch';

describe('prefetch constants', () => {
  it('DEFAULT_BOUNDS covers the full globe', () => {
    expect(DEFAULT_BOUNDS.latMin).toBeLessThanOrEqual(-80);
    expect(DEFAULT_BOUNDS.latMax).toBeGreaterThanOrEqual(80);
    expect(DEFAULT_BOUNDS.lonMin).toBeLessThanOrEqual(-180);
    expect(DEFAULT_BOUNDS.lonMax).toBeGreaterThanOrEqual(180);
  });

  it('TTFW contains only t=0', () => {
    expect(PREFETCH_HOURS_TTFW).toEqual([0]);
  });

  it('PHASE1 covers 3..48h and starts after TTFW', () => {
    expect(PREFETCH_HOURS_PHASE1[0]).toBe(3);
    expect(PREFETCH_HOURS_PHASE1[PREFETCH_HOURS_PHASE1.length - 1]).toBe(48);
  });

  it('PHASE2 covers 54..120h and never exceeds 120h', () => {
    expect(PREFETCH_HOURS_PHASE2[0]).toBe(54);
    expect(Math.max(...PREFETCH_HOURS_PHASE2)).toBe(120);
  });
});
```

Run: `pnpm --filter @nemo/web test -- prefetch`
Expected: FAIL (bounds Atlantic, TTFW missing, PHASE2 reaches 240h).

- [ ] **Step 2: Rewrite `apps/web/src/lib/weather/prefetch.ts`**

Replace the file with:

```typescript
// apps/web/src/lib/weather/prefetch.ts
import { decodeWeatherGrid, type DecodedWeatherGrid } from './binaryDecoder';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface PrefetchOptions {
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number };
  hours: number[];
  /** Grid resolution in degrees. Server decimates if > source. Defaults to source (0.25°). */
  resolution?: number;
  /** Wire encoding. 'int16' halves payload with 0.01 m/s precision. */
  encoding?: 'float32' | 'int16';
}

export async function fetchWeatherGrid(opts: PrefetchOptions): Promise<DecodedWeatherGrid> {
  const boundsStr = `${opts.bounds.latMin},${opts.bounds.lonMin},${opts.bounds.latMax},${opts.bounds.lonMax}`;
  const hoursStr = opts.hours.join(',');
  const params = new URLSearchParams({ bounds: boundsStr, hours: hoursStr });
  if (opts.resolution !== undefined) params.set('resolution', String(opts.resolution));
  if (opts.encoding === 'int16') params.set('q', 'int16');
  const url = `${API_BASE}/api/v1/weather/grid?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`weather grid fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const decoded = decodeWeatherGrid(buf);
  decoded.hours = opts.hours;
  return decoded;
}

// === Prefetch plan (global 1°, cap 5 days) ===
//
// TTFW (Time To First Wind): t=0 only — visible overlay in <1 s.
// PHASE1: t=3..48h — short-term overlay + projection (~2-4 s).
// PHASE2: t=54..120h — long-term overlay, capped at J+5 (~3-5 s).
// Server keeps 10 days; we only display 5.
export const PREFETCH_HOURS_TTFW = [0];
export const PREFETCH_HOURS_PHASE1 = [3, 6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48];
export const PREFETCH_HOURS_PHASE2 = [54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120];

export const DEFAULT_BOUNDS = { latMin: -80, lonMin: -180, latMax: 80, lonMax: 180 };
export const DEFAULT_RESOLUTION = 1;
```

- [ ] **Step 3: Run test to verify pass**

Run: `pnpm --filter @nemo/web test -- prefetch`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/weather/prefetch.ts apps/web/src/lib/weather/__tests__/prefetch.test.ts
git commit -m "feat(web): global 1° prefetch bounds + TTFW/phase1/phase2 split capped at J+5"
```

---

## Task 6: Frontend — Rewire `useWeatherPrefetch` for 3 Phases

**Context:** The hook currently fetches phase1 then optionally phase1+phase2 combined. New flow: TTFW → phase1 (cumulative) → phase2 (cumulative), each writing a grid to the store so the overlay sees progressively more hours. Also pass `resolution: DEFAULT_RESOLUTION` and `encoding: 'int16'`.

**Files:**
- Modify: `apps/web/src/hooks/useWeatherPrefetch.ts`

- [ ] **Step 1: Rewrite the hook**

Replace the file with:

```typescript
// apps/web/src/hooks/useWeatherPrefetch.ts
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchWeatherGrid,
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
  DEFAULT_RESOLUTION,
} from '@/lib/weather/prefetch';
import {
  decodedGridToWeatherGrid,
  decodedGridToWeatherGridAtNow,
} from '@/lib/weather/gridFromBinary';

/**
 * Three-phase prefetch of the global weather grid at 1° resolution, int16-quantized.
 * Each phase fetches a *cumulative* hour list so the store always has the widest
 * temporal horizon available, and downstream consumers (overlay, projection, HUD)
 * always read the most complete grid.
 *
 * Phase cap is J+5 (120h). The server still holds J+10 — upgrade here when the UI
 * needs it.
 */
export function useWeatherPrefetch(options?: { phase2?: boolean }) {
  const setDecodedWeatherGrid = useGameStore((s) => s.setDecodedWeatherGrid);
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    const currentRun = gfsStatus?.run ?? 0;
    if (currentRun === lastRunRef.current && lastRunRef.current !== 0) return;
    lastRunRef.current = currentRun;

    let cancelled = false;

    async function prefetch() {
      const common = {
        bounds: DEFAULT_BOUNDS,
        resolution: DEFAULT_RESOLUTION,
        encoding: 'int16' as const,
      };
      try {
        // Phase TTFW — t=0 only, visible overlay ASAP.
        const ttfw = await fetchWeatherGrid({ ...common, hours: PREFETCH_HOURS_TTFW });
        if (cancelled) return;
        setDecodedWeatherGrid(ttfw);
        setWeatherGrid(decodedGridToWeatherGridAtNow(ttfw), new Date(Date.now() + 6 * 3600 * 1000));

        // Phase 1 — cumulative t=0..48h.
        const phase1Hours = [...PREFETCH_HOURS_TTFW, ...PREFETCH_HOURS_PHASE1];
        const phase1 = await fetchWeatherGrid({ ...common, hours: phase1Hours });
        if (cancelled) return;
        setDecodedWeatherGrid(phase1);
        setWeatherGrid(decodedGridToWeatherGridAtNow(phase1), new Date(Date.now() + 6 * 3600 * 1000));

        if (options?.phase2) {
          // Phase 2 — cumulative t=0..120h.
          const phase2Hours = [...phase1Hours, ...PREFETCH_HOURS_PHASE2];
          const phase2 = await fetchWeatherGrid({ ...common, hours: phase2Hours });
          if (cancelled) return;
          setDecodedWeatherGrid(phase2);
          setWeatherGrid(decodedGridToWeatherGrid(phase2), new Date(Date.now() + 6 * 3600 * 1000));
        }
      } catch {
        // silently ignore (e.g. server unreachable)
      }
    }

    prefetch();
    return () => { cancelled = true; };
  }, [gfsStatus?.run, options?.phase2, setDecodedWeatherGrid, setWeatherGrid]);
}
```

- [ ] **Step 2: Manual smoke test in dev**

Start `pnpm dev`, open the /play route, open DevTools → Network. Expected request timeline (filter on `weather/grid`):

1. First request → `hours=0` → completes in <1 s (payload ~2-3 MB pre-gzip, ~700 KB gzip).
2. Second request → `hours=0,3,6,...,48` → completes a few seconds later.
3. Third request (if phase2 enabled) → `hours=0,3,...,120` → completes a few more seconds later.

All three should carry `resolution=1&q=int16`. The overlay should be visible after request 1.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useWeatherPrefetch.ts
git commit -m "feat(web): three-phase global prefetch (TTFW → phase1 → phase2)"
```

---

## Task 7: Frontend — Align Projection Fetch with 5-Day Cap

**Context:** `fetchWindGrid.ts` still combines old `PHASE1 + PHASE2` hours reaching t+240h. With new constants it'd auto-shrink to 125h, which is exactly what we want, but we should explicitly pass `resolution` and `encoding` so payload matches.

**Files:**
- Modify: `apps/web/src/lib/projection/fetchWindGrid.ts`

- [ ] **Step 1: Update `fetchLatestWindGrid`**

Replace the function body at [apps/web/src/lib/projection/fetchWindGrid.ts:84-96](../../apps/web/src/lib/projection/fetchWindGrid.ts#L84-L96) with:

```typescript
export async function fetchLatestWindGrid(): Promise<{
  windGrid: WindGridConfig;
  windData: Float32Array;
}> {
  // 5-day horizon, global 1° int16: ~5 MB gzip.
  const decoded = await fetchWeatherGrid({
    bounds: DEFAULT_BOUNDS,
    hours: [...PREFETCH_HOURS_TTFW, ...PREFETCH_HOURS_PHASE1, ...PREFETCH_HOURS_PHASE2],
    resolution: DEFAULT_RESOLUTION,
    encoding: 'int16',
  });
  return packWindData(decoded);
}
```

Add to imports at the top:

```typescript
import {
  fetchWeatherGrid,
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
  DEFAULT_RESOLUTION,
} from '@/lib/weather/prefetch';
```

- [ ] **Step 2: Run projection unit tests**

Run: `pnpm --filter @nemo/web test -- projection`
Expected: PASS (no behavioral change, just constants).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/projection/fetchWindGrid.ts
git commit -m "feat(web): projection fetch uses global 1° int16 capped at J+5"
```

---

## Task 8: Frontend — Fix Silent Clamp in Wind Lookup

**Context:** The silent clamp in `getCachedWind` (and its duplicate in `interpolate.ts`) is what hid the Atlantic-only bug. Make it return `{tws:0}` for truly out-of-range queries. After this, the bug would have been visible as empty zones instead of fake bands — defense in depth.

**Files:**
- Modify: `apps/web/src/components/play/WindOverlay.tsx`
- Modify: `apps/web/src/lib/weather/interpolate.ts`

- [ ] **Step 1: Write failing unit test for out-of-range wind lookup**

Create `apps/web/src/lib/weather/__tests__/interpolate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { interpolateWind } from '../interpolate';
import { generateMockWeatherGrid } from '../mockGrid';

describe('interpolateWind — out of grid', () => {
  it('returns zero wind for a lat/lon outside the grid bounds', () => {
    const grid = generateMockWeatherGrid(); // Atlantic-only mock
    const w = interpolateWind(grid.points, /*lat*/ 20, /*lon*/ 70); // Indian Ocean
    expect(w.tws).toBe(0);
  });

  it('returns non-zero wind for a lat/lon inside the grid bounds', () => {
    const grid = generateMockWeatherGrid();
    const w = interpolateWind(grid.points, /*lat*/ 45, /*lon*/ -10); // inside
    expect(w.tws).toBeGreaterThan(0);
  });
});
```

Run: `pnpm --filter @nemo/web test -- interpolate`
Expected: FAIL — out-of-range returns clamped edge value (non-zero).

- [ ] **Step 2: Replace the silent clamp in `interpolate.ts`**

In `apps/web/src/lib/weather/interpolate.ts`, replace the clamping block at lines 33-45 (inside `interpolateWind`) with:

```typescript
const maxX = cols - 1;
const maxY = Math.floor((BOUNDS.north - BOUNDS.south) / RESOLUTION);
if (ix < 0 || ix >= maxX || iy < 0 || iy >= maxY) {
  return { tws: 0, twd: 0, u: 0, v: 0 };
}
const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
```

Apply the same change to `interpolateSwell` (lines 91-99), returning `{ height: 0, dir: 0 }` for out-of-range.

- [ ] **Step 3: Replace the silent clamp in `WindOverlay.tsx`**

In [apps/web/src/components/play/WindOverlay.tsx:47-58](../../apps/web/src/components/play/WindOverlay.tsx#L47-L58), replace the clamp block with:

```typescript
const { cols, rows, points } = grid;
if (ix < 0 || ix >= cols - 1 || iy < 0 || iy >= rows - 1) {
  const zero: CachedWind = { u: 0, v: 0, tws: 0 };
  windCache.set(key, zero);
  return zero;
}
const dx = fx - ix;
const dy = fy - iy;
const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nemo/web test -- interpolate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/weather/interpolate.ts apps/web/src/components/play/WindOverlay.tsx apps/web/src/lib/weather/__tests__/interpolate.test.ts
git commit -m "fix(web): return zero wind out of grid instead of silently clamping to edge"
```

---

## Task 9: Frontend — Tactical Tile Fetcher

**Context:** Lazy-fetch a 40°×40° 0.25° tile centered on the boat, t=0..24h. The tile is invalidated and re-fetched when the boat drifts past a margin (e.g. 10°) from the tile center. This gives tactical-grade precision near the player without paying for it globally.

Tile payload estimate at 0.25°, 40°×40°, 9 hours (t=0,3,6,9,12,15,18,21,24), int16:
`161 × 161 × 9 × 6 × 2 bytes ≈ 2.7 MB` (pre-gzip), ~1 MB gzip.

**Files:**
- Create: `apps/web/src/lib/weather/tacticalTile.ts`
- Create: `apps/web/src/lib/weather/__tests__/tacticalTile.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/web/src/lib/weather/__tests__/tacticalTile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTileBounds, isBoatInsideMargin } from '../tacticalTile';

describe('computeTileBounds', () => {
  it('centers a 40x40 box around the boat', () => {
    const b = computeTileBounds({ lat: 45, lon: -10 });
    expect(b.latMin).toBe(25); expect(b.latMax).toBe(65);
    expect(b.lonMin).toBe(-30); expect(b.lonMax).toBe(10);
  });

  it('clamps to -90/+90 at the poles', () => {
    const b = computeTileBounds({ lat: 85, lon: 0 });
    expect(b.latMax).toBe(90);
    expect(b.latMin).toBeGreaterThanOrEqual(50); // still 40° wide when possible
  });
});

describe('isBoatInsideMargin', () => {
  it('returns true when boat is well inside the tile', () => {
    const b = { latMin: 25, latMax: 65, lonMin: -30, lonMax: 10 };
    expect(isBoatInsideMargin({ lat: 45, lon: -10 }, b, 10)).toBe(true);
  });

  it('returns false when boat is within margin of a tile edge', () => {
    const b = { latMin: 25, latMax: 65, lonMin: -30, lonMax: 10 };
    expect(isBoatInsideMargin({ lat: 58, lon: -10 }, b, 10)).toBe(false); // lat within 7° of top
    expect(isBoatInsideMargin({ lat: 45, lon: 5 }, b, 10)).toBe(false);   // lon within 5° of east
  });
});
```

Run: `pnpm --filter @nemo/web test -- tacticalTile`
Expected: FAIL — module missing.

- [ ] **Step 2: Implement `tacticalTile.ts`**

```typescript
// apps/web/src/lib/weather/tacticalTile.ts
import { fetchWeatherGrid } from './prefetch';
import type { DecodedWeatherGrid } from './binaryDecoder';

const TILE_SIZE_DEG = 40;       // full width of the 0.25° tile
const TILE_MARGIN_DEG = 10;     // trigger refetch when boat is within this margin
const TILE_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export interface BoatPos { lat: number; lon: number; }
export interface Bbox { latMin: number; latMax: number; lonMin: number; lonMax: number; }

export function computeTileBounds(boat: BoatPos): Bbox {
  const half = TILE_SIZE_DEG / 2;
  const latMin = Math.max(-90, boat.lat - half);
  const latMax = Math.min(90, boat.lat + half);
  // lon wraps ±180; keep simple and clip (consumers use the normalized lookup)
  const lonMin = Math.max(-180, boat.lon - half);
  const lonMax = Math.min(180, boat.lon + half);
  return { latMin, latMax, lonMin, lonMax };
}

export function isBoatInsideMargin(boat: BoatPos, tile: Bbox, margin = TILE_MARGIN_DEG): boolean {
  return (
    boat.lat >= tile.latMin + margin &&
    boat.lat <= tile.latMax - margin &&
    boat.lon >= tile.lonMin + margin &&
    boat.lon <= tile.lonMax - margin
  );
}

export async function fetchTacticalTile(boat: BoatPos): Promise<{
  tile: DecodedWeatherGrid;
  bounds: Bbox;
}> {
  const bounds = computeTileBounds(boat);
  const tile = await fetchWeatherGrid({
    bounds,
    hours: TILE_HOURS,
    resolution: 0.25,
    encoding: 'int16',
  });
  return { tile, bounds };
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @nemo/web test -- tacticalTile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/weather/tacticalTile.ts apps/web/src/lib/weather/__tests__/tacticalTile.test.ts
git commit -m "feat(web): tactical 0.25° tile fetcher with margin-based invalidation"
```

---

## Task 10: Frontend — Tactical Tile Hook + Store Wiring

**Context:** `useTacticalTile` watches boat position in the game store, fires an initial fetch, and refetches when the boat leaves the margin. The result is stored in a new slice field `weather.tacticalTile`. WindOverlay's `getCachedWind` consults the tile first and falls back to the global grid.

**Files:**
- Create: `apps/web/src/hooks/useTacticalTile.ts`
- Modify: `apps/web/src/lib/store/weatherSlice.ts` (add `tacticalTile` field + setter)
- Modify: `apps/web/src/lib/store/types.ts` (extend `WeatherState`)
- Modify: `apps/web/src/components/play/WindOverlay.tsx` (prefer tile when particle is inside)

- [ ] **Step 1: Extend store types**

In `apps/web/src/lib/store/types.ts`, find the `WeatherState` interface and add:

```typescript
/** Tactical 0.25° tile centered on the boat, t=0..24h. Optional. */
tacticalTile: {
  grid: import('./weather-grid-types').WeatherGrid;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
} | null;
```

And in the `WeatherActions` interface add:

```typescript
setTacticalTile: (grid: WeatherGrid | null, bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) => void;
```

(Use the existing `WeatherGrid` import path — match whatever the neighboring `setWeatherGrid` uses.)

- [ ] **Step 2: Implement the setter in `weatherSlice.ts`**

Add alongside `setWeatherGrid`:

```typescript
setTacticalTile: (grid, bounds) => set((state) => {
  state.weather.tacticalTile = (grid && bounds) ? { grid, bounds } : null;
}),
```

And initialize `tacticalTile: null` in the slice default state.

- [ ] **Step 3: Create `useTacticalTile.ts`**

```typescript
// apps/web/src/hooks/useTacticalTile.ts
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchTacticalTile,
  isBoatInsideMargin,
  type Bbox,
} from '@/lib/weather/tacticalTile';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';

/**
 * Lazily fetches a 0.25° tactical tile around the boat position (t=0..24h).
 * Refetches when the boat drifts within the edge margin. Safe no-op before the
 * boat position is known.
 */
export function useTacticalTile(): void {
  const boat = useGameStore((s) => s.boat?.position ?? null);
  const setTacticalTile = useGameStore((s) => s.setTacticalTile);
  const currentBoundsRef = useRef<Bbox | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!boat) return;
    const current = currentBoundsRef.current;
    if (current && isBoatInsideMargin(boat, current)) return;
    if (inFlightRef.current) return;

    let cancelled = false;
    inFlightRef.current = true;
    (async () => {
      try {
        const { tile, bounds } = await fetchTacticalTile(boat);
        if (cancelled) return;
        currentBoundsRef.current = bounds;
        setTacticalTile(decodedGridToWeatherGridAtNow(tile), bounds);
      } catch {
        // silently ignore
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [boat, setTacticalTile]);
}
```

Adjust the `boat?.position` selector to match the actual store shape — verify by grepping for existing usage of boat position:

Run: `rg -n "boat.*position" apps/web/src/lib/store apps/web/src/hooks`

If the shape differs, use the correct selector path (e.g. `s.boat.lat / s.boat.lon` or `s.player.boat.position`).

- [ ] **Step 4: Mount `useTacticalTile` in the play screen**

Find where `useWeatherPrefetch` is currently called (grep for it):

Run: `rg -n "useWeatherPrefetch" apps/web/src`

Add a call to `useTacticalTile()` right next to it, usually in the top-level `/play` page component.

- [ ] **Step 5: Wire tile priority into `WindOverlay.getCachedWind`**

Update `WindOverlay` to pull the tile from the store and consult it first. Add near the grid selector (line ~203):

```typescript
const tacticalTile = useGameStore((s) => s.weather.tacticalTile);
```

Pass it into the animate loop via a ref:

```typescript
const tileRef = useRef<{grid: WeatherGrid; bounds: {latMin:number;latMax:number;lonMin:number;lonMax:number}} | null>(null);
useEffect(() => { tileRef.current = tacticalTile; }, [tacticalTile]);
```

Wrap the existing `getCachedWind(grid, lat, lon, frame)` call to try the tile first:

```typescript
function pickWind(lat: number, lon: number, frame: number): CachedWind {
  const tile = tileRef.current;
  if (tile) {
    const b = tile.bounds;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) {
      const w = getCachedWind(tile.grid, lat, lon, frame);
      if (w.tws > 0) return w;
    }
  }
  return getCachedWind(grid, lat, lon, frame);
}
```

Then replace the call on line 307 `const wind = getCachedWind(grid, lat, lon, frame);` with `const wind = pickWind(lat, lon, frame);`.

- [ ] **Step 6: Manual verification**

Start `pnpm dev`, open /play, open the Network tab. Expected:

1. Three `weather/grid?resolution=1&q=int16` requests (TTFW, phase1, phase2).
2. After ~1-2 s, a fourth request `weather/grid?resolution=0.25&q=int16&bounds=<tile>&hours=0,3,...,24` — the tactical tile.
3. Sail the boat near the tile edge (using the dev simulator or manual teleport) → another tactical request fires with updated bounds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useTacticalTile.ts apps/web/src/components/play/WindOverlay.tsx apps/web/src/lib/store/weatherSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(web): lazy 0.25° tactical tile with tile-first lookup in WindOverlay"
```

---

## Task 11: Visual Verification + Payload Budget Assertions

**Context:** Sanity tests that guard the two specific failure modes: banded overlay (resolution lookup broken) and payload blow-up (someone removes the 5-day cap).

**Files:**
- Create: `apps/web/src/lib/weather/__tests__/budget.test.ts`

- [ ] **Step 1: Write payload budget test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
  DEFAULT_RESOLUTION,
} from '../prefetch';

// Global 1° int16: 181 rows × 361 cols × 6 fields × 2 bytes = 784,092 bytes/hour
const BYTES_PER_HOUR_INT16_1DEG = 181 * 361 * 6 * 2;

describe('prefetch payload budget', () => {
  it('TTFW fits under 1 MB raw (pre-gzip) at 1° int16 global', () => {
    const raw = PREFETCH_HOURS_TTFW.length * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(1 * 1024 * 1024);
  });

  it('cumulative phase1 fits under 11 MB raw', () => {
    const hours = PREFETCH_HOURS_TTFW.length + PREFETCH_HOURS_PHASE1.length;
    const raw = hours * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(11 * 1024 * 1024);
  });

  it('cumulative phase2 fits under 21 MB raw (J+5 cap)', () => {
    const hours = PREFETCH_HOURS_TTFW.length + PREFETCH_HOURS_PHASE1.length + PREFETCH_HOURS_PHASE2.length;
    const raw = hours * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(21 * 1024 * 1024);
  });

  it('never exceeds 120h (J+5) on any prefetch phase', () => {
    const maxHour = Math.max(
      ...PREFETCH_HOURS_TTFW,
      ...PREFETCH_HOURS_PHASE1,
      ...PREFETCH_HOURS_PHASE2,
    );
    expect(maxHour).toBeLessThanOrEqual(120);
  });

  it('DEFAULT_RESOLUTION is 1° (not accidentally 0.25°)', () => {
    expect(DEFAULT_RESOLUTION).toBe(1);
  });

  it('DEFAULT_BOUNDS is global (not Atlantic-only)', () => {
    const width = DEFAULT_BOUNDS.lonMax - DEFAULT_BOUNDS.lonMin;
    const height = DEFAULT_BOUNDS.latMax - DEFAULT_BOUNDS.latMin;
    expect(width).toBeGreaterThanOrEqual(360);
    expect(height).toBeGreaterThanOrEqual(160);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @nemo/web test -- budget`
Expected: PASS.

- [ ] **Step 3: Manual visual check**

Start `pnpm dev`. Open /play. Visually confirm:

- [ ] Wind particles in the Atlantic flow with realistic variation (baseline unchanged).
- [ ] Wind particles in the **Indian Ocean** (e.g. 20°S, 70°E) show natural swirls — no horizontal bands.
- [ ] Wind particles in the **Pacific** (e.g. 30°N, -150°E or 170°E) show natural swirls.
- [ ] Wind particles near poles (lat > 80°) are absent or zero (outside prefetched bounds, not banded).
- [ ] Zooming to the boat's immediate area shows visibly finer structure than far zones (tile effect).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/weather/__tests__/budget.test.ts
git commit -m "test(web): payload budget + global bounds assertions on prefetch constants"
```

---

## Task 12: Cleanup + Final Check

**Files:**
- Verify no consumer still imports old Atlantic-only `DEFAULT_BOUNDS` behavior.
- Verify Workbox SW does not cache the new URLs under the old hash.

- [ ] **Step 1: Grep for any lingering hardcoded Atlantic bounds**

Run: `rg -n "latMin.*-60.*lonMin.*-80|lonMax.*30" apps/web`
Expected: no matches outside the prefetch tests.

- [ ] **Step 2: Clear the dev Workbox cache**

Document for anyone running dev: hard-reload (Ctrl+Shift+R) or run `Application → Storage → Clear site data` in DevTools once after pulling this change, since the `weather/grid` URL shape changed.

- [ ] **Step 3: Run full typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS across the monorepo.

- [ ] **Step 4: Commit (if any cleanup edits were required)**

```bash
git add -p # review any final touches
git commit -m "chore: remove stale Atlantic-only weather bounds references"
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `dev-simulator` relies on `fetchLatestWindGrid` returning 240h data for its timeline scrubber | Medium | Task 7 caps at 120h. If the scrubber exposes hours >120h, the simulator will silently stop animating at J+5. Check [apps/web/src/app/dev-simulator](../../apps/web/src/app/dev-simulator) — if it needs 10 days, expose a separate prefetch path for it (opt-in flag). |
| SW Workbox cache holds pre-change URLs | Low | Document hard-reload in Task 12 Step 2. Next auth cycle will refresh anyway (weather status changes → hook re-runs). |
| Downsample rounding produces off-by-one column at 180°E | Low | `encodeGridSubset` uses `Math.ceil` on the output row/col count. Test case added in Task 2 Step 1 asserts 21 → 6 rows at stride 4; global 0.25°→1° behaves identically. |
| int16 quantization loses precision for very weak winds (< 0.01 m/s) | Negligible | Below 0.1 m/s the overlay already renders nothing visible. Polar interpolation and projection operate at >0.5 m/s relevance. |
| Tactical tile refetches too often during the dev simulator's accelerated time | Low | Margin-based invalidation uses spatial position, not time. Simulator clock changes don't trigger refetch. |

---

## Deferred / Out of Scope

These are intentionally not in this plan:

- **J+5..J+10 UI access** — user confirmed 5 days is enough. Server still ingests 10 days; re-enabling UI access only needs to re-add `PREFETCH_HOURS_PHASE3 = [132..240]` and a phase3 fetch call when the UI needs it.
- **Spatial block-average downsampling** (instead of stride decimation) — marginal quality gain, significant encoder rewrite. Revisit if banding artifacts appear at 1°.
- **Tile prefetch ahead of boat** — current trigger is reactive (boat drifts near edge). Predictive prefetch based on heading can cut the visible "tile refetch" blink; low priority until observed.
- **Per-race tile caching** — store tile between race restarts so reopening /play doesn't re-pay the 1 MB cost. Wait until persistence layer is firmed up.
