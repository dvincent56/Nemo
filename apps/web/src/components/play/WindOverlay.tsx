'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { parseGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay — WebGL TRIANGLES, CPU simulation.
 * Each particle is a comet of fixed pixel length, drawn as a tapered quad.
 * No trail history — just position + direction → fixed-size comet shape.
 */

const MAX_PARTICLES = 8000;
const COMET_LEN_PX = 40;   // comet length in CSS pixels
const COMET_HEAD_PX = 2.2;  // head width in CSS pixels
const COMET_TAIL_PX = 0.2;  // tail width in CSS pixels
const COMET_SEGMENTS = 5;   // segments per comet
const SPEED_PX_PER_FRAME = 0.05; // particle drift in CSS pixels per frame (slow base)

// ─── Wind interpolation cache ─────────────────────────

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
  const key = iy * 100000 + ix;

  let cached = windCache.get(key);
  if (cached) return cached;

  const { cols, rows, points } = grid;
  if (ix < 0 || ix >= cols - 1 || iy < 0 || iy >= rows - 1) {
    const zero: CachedWind = { u: 0, v: 0, tws: 0 };
    windCache.set(key, zero);
    return zero;
  }
  const dx = fx - ix;
  const dy = fy - iy;
  const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;

  const p00 = points[y0 * cols + x0];
  const p10 = points[y0 * cols + x1];
  const p01 = points[y1 * cols + x0];
  const p11 = points[y1 * cols + x1];

  if (!p00 || !p10 || !p01 || !p11) {
    // Grid may be mid-swap (rows/cols updated before points). Return zero
    // so the animation keeps running; the next frame will recompute with
    // the consistent grid.
    const zero: CachedWind = { u: 0, v: 0, tws: 0 };
    windCache.set(key, zero);
    return zero;
  }

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

// ─── Particle state (flat arrays) ─────────────────────

interface Particles {
  lon: Float32Array;
  lat: Float32Array;
  dirRad: Float32Array; // current wind direction at particle
  age: Int32Array;
  maxAge: Int32Array;
  speed: Float32Array;
  count: number;
}

function createParticles(n: number, bounds: { west: number; east: number; south: number; north: number }): Particles {
  const p: Particles = {
    lon: new Float32Array(n),
    lat: new Float32Array(n),
    dirRad: new Float32Array(n),
    age: new Int32Array(n),
    maxAge: new Int32Array(n),
    speed: new Float32Array(n),
    count: n,
  };
  for (let i = 0; i < n; i++) {
    p.lon[i] = bounds.west + Math.random() * (bounds.east - bounds.west);
    p.lat[i] = bounds.south + Math.random() * (bounds.north - bounds.south);
    p.age[i] = Math.floor(Math.random() * 150);
    p.maxAge[i] = 100 + Math.floor(Math.random() * 120);
  }
  return p;
}

function respawn(p: Particles, i: number, bounds: { west: number; east: number; south: number; north: number }): void {
  p.lon[i] = bounds.west + Math.random() * (bounds.east - bounds.west);
  p.lat[i] = bounds.south + Math.random() * (bounds.north - bounds.south);
  p.age[i] = 0;
  p.maxAge[i] = 100 + Math.floor(Math.random() * 120);
  p.speed[i] = 0;
  p.dirRad[i] = 0;
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

function createProg(gl: WebGLRenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  return p;
}

// Color ramp
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
      return [prev[1] + (curr[1] - prev[1]) * t, prev[2] + (curr[2] - prev[2]) * t, prev[3] + (curr[3] - prev[3]) * t];
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
  const tileRef = useRef<{ grid: WeatherGrid; bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number } } | null>(null);

  const windVisible = useGameStore((s) => s.layers.wind);
  const currentTimeMs = useGameStore((s) => s.timeline.currentTime.getTime());
  const isLive = useGameStore((s) => s.timeline.isLive);
  const weatherTimeVisible = isLive || currentTimeMs >= Date.now();

  // Consume the grid already loaded by useWeatherPrefetch — single source of
  // truth so HUD, cursor tooltip and projection all agree on TWS/TWD.
  // Fallback to the bundled wind.json only if no grid is present at all.
  const gridData = useGameStore((s) => s.weather.gridData);
  useEffect(() => {
    if (gridData) {
      gridRef.current = gridData;
      return;
    }
    fetch('/data/wind.json')
      .then((r) => r.json())
      .then((j) => {
        const grid = parseGfsWind(j);
        gridRef.current = grid;
        useGameStore.getState().setWeatherGrid(grid, new Date(Date.now() + 6 * 3600 * 1000));
      })
      .catch((e) => console.warn('Wind data load failed:', e));
  }, [gridData]);

  // Tactical tile: higher-res grid for the area around the boat.
  // Clear the wind cache whenever the tile (or global grid) changes so
  // stale (iy,ix) keyed values from the old grid don't bleed through.
  const tacticalTile = useGameStore((s) => s.weather.tacticalTile);
  useEffect(() => {
    tileRef.current = tacticalTile;
    windCache = new Map();
    windCacheFrame = -1;
  }, [tacticalTile]);
  useEffect(() => {
    windCache = new Map();
    windCacheFrame = -1;
  }, [gridData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible || !weatherTimeVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return;

    const prog = createProg(gl);
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
    const particleCount = Math.min(MAX_PARTICLES, Math.max(2000, Math.round(screenArea / 180)));
    const bounds = useGameStore.getState().map.bounds;
    const pa = createParticles(particleCount, bounds);

    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));

    let lastLonRange = 0;

    // Pre-allocate: each particle = COMET_SEGMENTS quads × 6 verts
    const vertsPerParticle = COMET_SEGMENTS * 6 * 2;
    const alphasPerParticle = COMET_SEGMENTS * 6;
    const colorsPerParticle = COMET_SEGMENTS * 6 * 3;
    const vertArr = new Float32Array(particleCount * vertsPerParticle);
    const alphaArr = new Float32Array(particleCount * alphasPerParticle);
    const colorArr = new Float32Array(particleCount * colorsPerParticle);

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
      // Convert fixed pixel speed to degrees: pixels / (pixels per degree)
      const pxPerDeg = width / lonRange;
      const degPerFrame = SPEED_PX_PER_FRAME / pxPerDeg;

      if (lastLonRange > 0 && lonRange > lastLonRange * 1.02) {
        for (let i = 0; i < pa.count; i++) respawn(pa, i, vBounds);
      }
      lastLonRange = lonRange;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Clip-space units per CSS pixel (canvas is CSS-pixel sized)
      const csPerPxX = 2 / width;
      const csPerPxY = 2 / height;

      let vi = 0, ai = 0, ci = 0;

      // Pick wind: prefer the tactical tile when the particle falls inside it,
      // fall back to the global grid otherwise.
      const pickWind = (lat: number, lon: number): CachedWind => {
        const tile = tileRef.current;
        if (tile) {
          const b = tile.bounds;
          if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) {
            return getCachedWind(tile.grid, lat, lon, frame);
          }
        }
        return getCachedWind(grid, lat, lon, frame);
      };

      for (let i = 0; i < pa.count; i++) {
        const lon = pa.lon[i]!;
        const lat = pa.lat[i]!;

        const wind = pickWind(lat, lon);
        pa.speed[i] = wind.tws;

        const dir = Math.atan2(wind.u, wind.v);
        pa.dirRad[i] = dir;

        // Advance particle position
        const speedBoost = wind.tws < 5 ? 0.5 : wind.tws < 15 ? 1.0 : 2.0;
        pa.lon[i] = lon + Math.sin(dir) * degPerFrame * speedBoost;
        pa.lat[i] = lat + Math.cos(dir) * degPerFrame * speedBoost;
        pa.age[i]!++;

        if (pa.age[i]! > pa.maxAge[i]! ||
            pa.lon[i]! < vBounds.west - 2 || pa.lon[i]! > vBounds.east + 2 ||
            pa.lat[i]! < vBounds.south - 2 || pa.lat[i]! > vBounds.north + 2) {
          respawn(pa, i, vBounds);
          continue;
        }

        // Skip particles not in view
        if (pa.lon[i]! < vBounds.west || pa.lon[i]! > vBounds.east ||
            pa.lat[i]! < vBounds.south || pa.lat[i]! > vBounds.north) continue;

        const fadeIn = Math.min(1, pa.age[i]! / 8);
        const fadeOut = Math.min(1, (pa.maxAge[i]! - pa.age[i]!) / 30);
        const spd = wind.tws;
        const speedAlpha = spd < 3 ? 0.20 : spd < 8 ? 0.35 : spd < 18 ? 0.50 : 0.70;
        const baseAlpha = fadeIn * fadeOut * speedAlpha;
        if (baseAlpha < 0.02) continue;

        const [r, g, bv] = windColor(spd);

        // Comet center in clip space
        const cx = ((pa.lon[i]! - vBounds.west) / lonRange) * 2 - 1;
        const cy = ((mercY(pa.lat[i]!) - mercS) / mercRange) * 2 - 1;

        // Comet direction in clip space (Y up = lat up = north)
        // dir = atan2(u,v) gives direction wind blows TO
        const dirScreenX = Math.sin(dir);
        const dirScreenY = Math.cos(dir); // clip space Y = up = north

        // Perpendicular for width
        const perpX = dirScreenY;
        const perpY = -dirScreenX;

        // Draw comet as COMET_SEGMENTS tapered quads from tail to head
        // Comet extends backward from particle position (tail behind, head at particle)
        const cometLen = COMET_LEN_PX;
        for (let s = 0; s < COMET_SEGMENTS; s++) {
          const t0 = s / COMET_SEGMENTS;       // 0 = tail
          const t1 = (s + 1) / COMET_SEGMENTS; // 1 = head

          // Width: tail thin, head thick
          const w0 = COMET_TAIL_PX + (COMET_HEAD_PX - COMET_TAIL_PX) * t0;
          const w1 = COMET_TAIL_PX + (COMET_HEAD_PX - COMET_TAIL_PX) * t1;

          // Alpha: tail faint, head opaque (quadratic for sharper head)
          const a0 = baseAlpha * (0.05 + 0.95 * t0 * t0);
          const a1 = baseAlpha * (0.05 + 0.95 * t1 * t1);

          // Position along comet (backward from head)
          const d0 = (1 - t0) * cometLen; // distance from head (tail = far)
          const d1 = (1 - t1) * cometLen;

          // Quad corners in clip space
          const px0 = cx - dirScreenX * d0 * csPerPxX;
          const py0 = cy - dirScreenY * d0 * csPerPxY;
          const px1 = cx - dirScreenX * d1 * csPerPxX;
          const py1 = cy - dirScreenY * d1 * csPerPxY;

          const wx0 = perpX * w0 / 2 * csPerPxX;
          const wy0 = perpY * w0 / 2 * csPerPxY;
          const wx1 = perpX * w1 / 2 * csPerPxX;
          const wy1 = perpY * w1 / 2 * csPerPxY;

          // 6 vertices = 2 triangles
          vertArr[vi++] = px0 - wx0; vertArr[vi++] = py0 - wy0;
          vertArr[vi++] = px0 + wx0; vertArr[vi++] = py0 + wy0;
          vertArr[vi++] = px1 - wx1; vertArr[vi++] = py1 - wy1;
          vertArr[vi++] = px1 - wx1; vertArr[vi++] = py1 - wy1;
          vertArr[vi++] = px0 + wx0; vertArr[vi++] = py0 + wy0;
          vertArr[vi++] = px1 + wx1; vertArr[vi++] = py1 + wy1;

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

        gl.drawArrays(gl.TRIANGLES, 0, vi / 2);
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
  }, [windVisible, weatherTimeVisible]);

  if (!windVisible || !weatherTimeVisible) return <></>;

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    />
  );
}
