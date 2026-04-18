'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { parseGfsWind } from '@/lib/weather/gfsParser';
import { decodeWeatherGrid } from '@/lib/weather/binaryDecoder';
import { decodedGridToWeatherGrid } from '@/lib/weather/gridFromBinary';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay — WebGL TRIANGLES, CPU simulation.
 * Optimized: grid-cell wind cache, pre-allocated typed arrays, no per-frame allocs.
 */

const MAX_PARTICLES = 8000;
const TRAIL_LEN = 25;

// ─── Wind interpolation cache ─────────────────────────
// Cache wind lookups by grid cell to avoid redundant bilinear interpolation.
// At 0.25° resolution, particles in the same cell get the same wind.

interface CachedWind { u: number; v: number; tws: number; }

let windCache: Map<number, CachedWind> = new Map();
let windCacheFrame = -1;

function getCachedWind(grid: WeatherGrid, lat: number, lon: number, frame: number): CachedWind {
  if (frame !== windCacheFrame) {
    windCache.clear();
    windCacheFrame = frame;
  }

  let normLon = lon;
  if (normLon < grid.bounds.west) normLon += 360;
  if (normLon > grid.bounds.east) normLon -= 360;

  const fy = (lat - grid.bounds.south) / grid.resolution;
  const fx = (normLon - grid.bounds.west) / grid.resolution;
  const iy = Math.floor(fy);
  const ix = Math.floor(fx);
  const key = iy * 100000 + ix; // unique cell key

  let cached = windCache.get(key);
  if (cached) return cached;

  // Bilinear interpolation (inlined for speed)
  const { cols, rows, points } = grid;
  const dx = fx - ix;
  const dy = fy - iy;
  const x0 = Math.max(0, Math.min(ix, cols - 1));
  const x1 = Math.min(x0 + 1, cols - 1);
  const y0 = Math.max(0, Math.min(iy, rows - 1));
  const y1 = Math.min(y0 + 1, rows - 1);

  const p00 = points[y0 * cols + x0]!;
  const p10 = points[y0 * cols + x1]!;
  const p01 = points[y1 * cols + x0]!;
  const p11 = points[y1 * cols + x1]!;

  const toR = Math.PI / 180;
  const u =
    (-Math.sin(p00.twd * toR) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.sin(p10.twd * toR) * p10.tws * dx * (1 - dy)) +
    (-Math.sin(p01.twd * toR) * p01.tws * (1 - dx) * dy) +
    (-Math.sin(p11.twd * toR) * p11.tws * dx * dy);
  const v =
    (-Math.cos(p00.twd * toR) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.cos(p10.twd * toR) * p10.tws * dx * (1 - dy)) +
    (-Math.cos(p01.twd * toR) * p01.tws * (1 - dx) * dy) +
    (-Math.cos(p11.twd * toR) * p11.tws * dx * dy);

  const tws = Math.sqrt(u * u + v * v);
  cached = { u, v, tws };
  windCache.set(key, cached);
  return cached;
}

// ─── Particle state (SoA for cache-friendliness) ──────

interface ParticleArrays {
  lons: Float32Array; // [particle * TRAIL_LEN + trailIdx]
  lats: Float32Array;
  head: Int32Array;
  len: Int32Array;
  age: Int32Array;
  maxAge: Int32Array;
  speed: Float32Array;
  count: number;
}

function createParticles(n: number, bounds: { west: number; east: number; south: number; north: number }): ParticleArrays {
  const pa: ParticleArrays = {
    lons: new Float32Array(n * TRAIL_LEN),
    lats: new Float32Array(n * TRAIL_LEN),
    head: new Int32Array(n),
    len: new Int32Array(n),
    age: new Int32Array(n),
    maxAge: new Int32Array(n),
    speed: new Float32Array(n),
    count: n,
  };
  for (let i = 0; i < n; i++) {
    const lon = bounds.west + Math.random() * (bounds.east - bounds.west);
    const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
    pa.lons[i * TRAIL_LEN] = lon;
    pa.lats[i * TRAIL_LEN] = lat;
    pa.head[i] = 0;
    pa.len[i] = 1;
    pa.age[i] = Math.floor(Math.random() * 150);
    pa.maxAge[i] = 120 + Math.floor(Math.random() * 100);
  }
  return pa;
}

function resetParticle(pa: ParticleArrays, i: number, bounds: { west: number; east: number; south: number; north: number }): void {
  const lon = bounds.west + Math.random() * (bounds.east - bounds.west);
  const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
  const base = i * TRAIL_LEN;
  for (let t = 0; t < TRAIL_LEN; t++) {
    pa.lons[base + t] = lon;
    pa.lats[base + t] = lat;
  }
  pa.head[i] = 0;
  pa.len[i] = 1;
  pa.age[i] = 20 + Math.floor(Math.random() * 80);
  pa.maxAge[i] = pa.age[i]! + 80 + Math.floor(Math.random() * 80);
}

// ─── Shaders ──────────────────────────────────────────

const VERT = `
attribute vec2 a_position;
attribute float a_alpha;
attribute vec3 a_color;
varying float v_alpha;
varying vec3 v_color;
void main() {
  v_alpha = a_alpha;
  v_color = a_color;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying float v_alpha;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, v_alpha);
}
`;

function createShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  return p;
}

// Color ramp (same as before)
const COLOR_STOPS: [number, number, number, number][] = [
  [0,  0.24, 0.55, 0.78],
  [8,  0.31, 0.74, 0.66],
  [15, 0.42, 0.82, 0.55],
  [22, 0.72, 0.80, 0.35],
  [30, 0.86, 0.65, 0.20],
  [40, 0.78, 0.22, 0.16],
];

function windColor(speed: number): [number, number, number] {
  if (speed <= COLOR_STOPS[0]![0]) return [COLOR_STOPS[0]![1], COLOR_STOPS[0]![2], COLOR_STOPS[0]![3]];
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const prev = COLOR_STOPS[i - 1]!;
    const curr = COLOR_STOPS[i]!;
    if (speed <= curr[0]) {
      const t = (speed - prev[0]) / (curr[0] - prev[0]);
      return [
        prev[1] + (curr[1] - prev[1]) * t,
        prev[2] + (curr[2] - prev[2]) * t,
        prev[3] + (curr[3] - prev[3]) * t,
      ];
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

// ─── Component ────────────────────────────────────────

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gridRef = useRef<WeatherGrid | null>(null);
  const frameRef = useRef(0);

  const windVisible = useGameStore((s) => s.layers.wind);

  // Load GFS data
  useEffect(() => {
    if (gridRef.current) return;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

    function loadFromWindJson() {
      fetch('/data/wind.json')
        .then((r) => r.json())
        .then((j) => {
          const grid = parseGfsWind(j);
          gridRef.current = grid;
          useGameStore.getState().setWeatherGrid(grid, new Date(Date.now() + 6 * 3600 * 1000));
        })
        .catch((e) => console.warn('Wind data load failed:', e));
    }

    function loadFromApi() {
      fetch(`${apiBase}/api/v1/weather/grid?hours=0`)
        .then((r) => {
          if (!r.ok) throw new Error(`status ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const decoded = decodeWeatherGrid(buf);
          const grid = decodedGridToWeatherGrid(decoded);
          gridRef.current = grid;
          useGameStore.getState().setWeatherGrid(grid, new Date(Date.now() + 6 * 3600 * 1000));
        })
        .catch(() => loadFromWindJson());
    }

    fetch(`${apiBase}/api/v1/weather/status`)
      .then((r) => r.ok ? r.json() : null)
      .then((status) => {
        if (status && status.next > 0) {
          loadFromApi();
        } else {
          loadFromWindJson();
        }
      })
      .catch(() => loadFromWindJson());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return;

    const prog = createProgram(gl);
    const aPos = gl.getAttribLocation(prog, 'a_position');
    const aAlpha = gl.getAttribLocation(prog, 'a_alpha');
    const aColor = gl.getAttribLocation(prog, 'a_color');
    const posBuf = gl.createBuffer()!;
    const alphaBuf = gl.createBuffer()!;
    const colorBuf = gl.createBuffer()!;

    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const screenArea = canvas.width * canvas.height;
    const particleCount = Math.min(MAX_PARTICLES, Math.max(800, Math.round(screenArea / 260)));
    const bounds = useGameStore.getState().map.bounds;
    const pa = createParticles(particleCount, bounds);

    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));

    let lastLonRange = 0;

    // Pre-allocate output arrays (worst case: each particle has TRAIL_LEN-1 segments × 6 verts × 2 coords)
    const maxVerts = particleCount * (TRAIL_LEN - 1) * 6 * 2;
    const maxAlphas = particleCount * (TRAIL_LEN - 1) * 6;
    const maxColors = particleCount * (TRAIL_LEN - 1) * 6 * 3;
    const vertArr = new Float32Array(maxVerts);
    const alphaArr = new Float32Array(maxAlphas);
    const colorArr = new Float32Array(maxColors);

    const animate = () => {
      const grid = gridRef.current;
      const map = mapInstance;
      if (!grid || !map) { animRef.current = requestAnimationFrame(animate); return; }

      frameRef.current++;
      const frame = frameRef.current;

      const { width, height } = canvas;
      if (width !== parent.clientWidth || height !== parent.clientHeight) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      const b = map.getBounds();
      const vBounds = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
      const lonRange = vBounds.east - vBounds.west;
      const mercN = mercY(vBounds.north);
      const mercS = mercY(vBounds.south);
      const mercRange = mercN - mercS;
      const pxPerLon = lonRange !== 0 ? 1920 / lonRange : 1;
      const degPerFrame = 0.6 / pxPerLon;

      if (lastLonRange > 0 && lonRange > lastLonRange * 1.02) {
        for (let i = 0; i < pa.count; i++) resetParticle(pa, i, vBounds);
      }
      lastLonRange = lonRange;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const maxWidthX = 1.5 / width * 2;
      const maxWidthY = 1.5 / height * 2;

      let vi = 0; // vert index
      let ai = 0; // alpha index
      let ci = 0; // color index

      for (let i = 0; i < pa.count; i++) {
        const base = i * TRAIL_LEN;
        const h = pa.head[i]!;
        const lon = pa.lons[base + h]!;
        const lat = pa.lats[base + h]!;

        const wind = getCachedWind(grid, lat, lon, frame);
        pa.speed[i] = wind.tws;

        const dirRad = Math.atan2(wind.u, wind.v);
        const speedBoost = wind.tws < 5 ? 0.8 : wind.tws < 15 ? 1.2 : 1.8;
        const step = degPerFrame * speedBoost;
        const newLon = lon + Math.sin(dirRad) * step;
        const newLat = lat + Math.cos(dirRad) * step;

        const newHead = (h + 1) % TRAIL_LEN;
        pa.lons[base + newHead] = newLon;
        pa.lats[base + newHead] = newLat;
        pa.head[i] = newHead;
        pa.len[i] = Math.min(pa.len[i]! + 1, TRAIL_LEN);
        pa.age[i]!++;

        if (pa.age[i]! > pa.maxAge[i]! ||
            newLon < vBounds.west - 2 || newLon > vBounds.east + 2 ||
            newLat < vBounds.south - 2 || newLat > vBounds.north + 2) {
          resetParticle(pa, i, vBounds);
          continue;
        }

        const pLen = pa.len[i]!;
        if (pLen < 3) continue;

        const fadeIn = Math.min(1, pa.age[i]! / 5);
        const fadeOut = Math.min(1, (pa.maxAge[i]! - pa.age[i]!) / 30);
        const spd = wind.tws;
        const speedAlpha = spd < 3 ? 0.20 : spd < 8 ? 0.35 : spd < 18 ? 0.50 : 0.70;
        const baseAlpha = fadeIn * fadeOut * speedAlpha;
        if (baseAlpha < 0.02) continue;

        const [r, g, bv] = windColor(spd);
        const oldest = (newHead - pLen + 1 + TRAIL_LEN) % TRAIL_LEN;

        for (let s = 0; s < pLen - 1; s++) {
          const i0 = (oldest + s) % TRAIL_LEN;
          const i1 = (oldest + s + 1) % TRAIL_LEN;
          const x0 = ((pa.lons[base + i0]! - vBounds.west) / lonRange) * 2 - 1;
          const y0 = ((mercY(pa.lats[base + i0]!) - mercS) / mercRange) * 2 - 1;
          const x1 = ((pa.lons[base + i1]! - vBounds.west) / lonRange) * 2 - 1;
          const y1 = ((mercY(pa.lats[base + i1]!) - mercS) / mercRange) * 2 - 1;

          const dx = x1 - x0;
          const dy = y1 - y0;
          const segLen = Math.sqrt(dx * dx + dy * dy);
          if (segLen < 0.00001) continue;

          const t0 = s / (pLen - 1);
          const t1 = (s + 1) / (pLen - 1);
          const taper0 = 0.2 + 0.8 * t0;
          const taper1 = 0.2 + 0.8 * t1;
          const a0 = baseAlpha * (0.1 + 0.9 * t0 * t0);
          const a1 = baseAlpha * (0.1 + 0.9 * t1 * t1);

          const nx = -dy / segLen;
          const ny = dx / segLen;
          const ox0 = nx * maxWidthX * taper0;
          const oy0 = ny * maxWidthY * taper0;
          const ox1 = nx * maxWidthX * taper1;
          const oy1 = ny * maxWidthY * taper1;

          // 6 vertices = 2 triangles
          vertArr[vi++] = x0 - ox0; vertArr[vi++] = y0 - oy0;
          vertArr[vi++] = x0 + ox0; vertArr[vi++] = y0 + oy0;
          vertArr[vi++] = x1 - ox1; vertArr[vi++] = y1 - oy1;
          vertArr[vi++] = x1 - ox1; vertArr[vi++] = y1 - oy1;
          vertArr[vi++] = x0 + ox0; vertArr[vi++] = y0 + oy0;
          vertArr[vi++] = x1 + ox1; vertArr[vi++] = y1 + oy1;

          alphaArr[ai++] = a0; alphaArr[ai++] = a0; alphaArr[ai++] = a1;
          alphaArr[ai++] = a1; alphaArr[ai++] = a0; alphaArr[ai++] = a1;

          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
          colorArr[ci++] = r; colorArr[ci++] = g; colorArr[ci++] = bv;
        }
      }

      if (vi > 0) {
        const vertCount = vi / 2;

        gl.enableVertexAttribArray(aPos);
        gl.enableVertexAttribArray(aAlpha);
        gl.enableVertexAttribArray(aColor);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, vertArr.subarray(0, vi), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
        gl.bufferData(gl.ARRAY_BUFFER, alphaArr.subarray(0, ai), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, colorArr.subarray(0, ci), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    gl.viewport(0, 0, canvas.width, canvas.height);
    animRef.current = requestAnimationFrame(animate);

    const onResize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
      window.removeEventListener('resize', onResize);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
  }, [windVisible]);

  if (!windVisible) return <></>;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
