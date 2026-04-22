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
