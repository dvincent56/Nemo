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
  /** Forecast hour offsets (from runTimestamp) for each layer in `data`, in
   *  the same order. Populated by fetchWeatherGrid with the requested hours
   *  list so downstream consumers can build correct timestamps when layers
   *  aren't one hour apart. */
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
