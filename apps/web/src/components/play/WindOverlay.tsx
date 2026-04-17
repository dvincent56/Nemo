'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { parseGfsWind, interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay — WebGL LINES rendering, CPU simulation.
 * Particles stored in lat/lon, projected via fast Mercator math.
 * GPU only does the drawing (gl.LINES) — no texture-based simulation.
 */

const MAX_PARTICLES = 8000;
const TRAIL_LEN = 20;

// Per-particle state (CPU-side)
interface Particle {
  lons: Float32Array;
  lats: Float32Array;
  head: number;
  len: number;
  age: number;
  maxAge: number;
  speed: number;
}

// ─── Shaders ───────────────────────────────────────────

const VERT = `
attribute vec2 a_position;
attribute float a_alpha;
varying float v_alpha;
void main() {
  v_alpha = a_alpha;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec3 u_color;
uniform float u_baseAlpha;
varying float v_alpha;
void main() {
  gl_FragColor = vec4(u_color, u_baseAlpha * v_alpha);
}
`;

// ─── Helpers ───────────────────────────────────────────

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

// Smooth color interpolation between stops instead of hard steps
const COLOR_STOPS: [number, number, number, number][] = [
  [0,  0.24, 0.55, 0.78],  // 0 kt — soft blue
  [8,  0.31, 0.74, 0.66],  // 8 kt — teal
  [15, 0.42, 0.82, 0.55],  // 15 kt — green
  [22, 0.72, 0.80, 0.35],  // 22 kt — yellow-green
  [30, 0.86, 0.65, 0.20],  // 30 kt — orange
  [40, 0.78, 0.22, 0.16],  // 40 kt — red
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

function randomInBounds(b: { west: number; east: number; south: number; north: number }): [number, number] {
  return [
    b.west + Math.random() * (b.east - b.west),
    b.south + Math.random() * (b.north - b.south),
  ];
}

function makeParticle(b: { west: number; east: number; south: number; north: number }): Particle {
  const [lon, lat] = randomInBounds(b);
  const lons = new Float32Array(TRAIL_LEN); lons[0] = lon;
  const lats = new Float32Array(TRAIL_LEN); lats[0] = lat;
  return { lons, lats, head: 0, len: 1, age: Math.floor(Math.random() * 150), maxAge: 120 + Math.floor(Math.random() * 100), speed: 0 };
}

function resetParticle(p: Particle, b: { west: number; east: number; south: number; north: number }): void {
  const [lon, lat] = randomInBounds(b);
  // Fill ALL trail slots with the same position so no old trail segments remain
  for (let i = 0; i < TRAIL_LEN; i++) {
    p.lons[i] = lon;
    p.lats[i] = lat;
  }
  p.head = 0; p.len = 1;
  p.age = 20 + Math.floor(Math.random() * 80);
  p.maxAge = p.age + 80 + Math.floor(Math.random() * 80);
}

// ─── Component ─────────────────────────────────────────

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gridRef = useRef<WeatherGrid | null>(null);

  const windVisible = useGameStore((s) => s.layers.wind);

  // Load GFS data
  useEffect(() => {
    if (gridRef.current) return;
    fetch('/data/wind.json')
      .then((r) => r.json())
      .then((j) => { gridRef.current = parseGfsWind(j); })
      .catch((e) => console.warn('Wind data load failed:', e));
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
    const uColor = gl.getUniformLocation(prog, 'u_color');
    const uBaseAlpha = gl.getUniformLocation(prog, 'u_baseAlpha');
    const posBuf = gl.createBuffer()!;
    const alphaBuf = gl.createBuffer()!;

    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Scale particle count to screen area (pixels)
    // Desktop 1920×1080 ≈ 2M px → 8000 particles
    // Tablet 1024×768 ≈ 800k px → 3200 particles
    // Phone 390×844 ≈ 330k px → 1300 particles
    const screenArea = canvas.width * canvas.height;
    const particleCount = Math.min(MAX_PARTICLES, Math.max(800, Math.round(screenArea / 260)));
    const bounds = useGameStore.getState().map.bounds;
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) particles.push(makeParticle(bounds));

    // Mercator helpers
    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));

    let lastLonRange = 0;

    const animate = () => {
      const grid = gridRef.current;
      const map = mapInstance;
      if (!grid || !map) { animRef.current = requestAnimationFrame(animate); return; }

      const { width, height } = canvas;
      if (width !== parent.clientWidth || height !== parent.clientHeight) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // Map projection params
      const b = map.getBounds();
      const vBounds = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
      const lonRange = vBounds.east - vBounds.west;
      const mercN = mercY(vBounds.north);
      const mercS = mercY(vBounds.south);
      const mercRange = mercN - mercS;
      // Fixed speed: 0.5px per frame on a 1920px screen, converted to degrees
      // pxPerLon converts pixels to degrees at current zoom
      const pxPerLon = lonRange !== 0 ? 1920 / lonRange : 1; // always use 1920 as reference
      const degPerFrame = 0.3 / pxPerLon;

      // Detect zoom out: lonRange increased → redistribute ALL particles
      if (lastLonRange > 0 && lonRange > lastLonRange * 1.02) {
        for (const p of particles) resetParticle(p, vBounds);
      }
      lastLonRange = lonRange;

      // Lon/lat → clip space [-1, 1]
      const lonToClip = (lon: number) => ((lon - vBounds.west) / lonRange) * 2 - 1;
      const latToClip = (lat: number) => ((mercY(lat) - mercS) / mercRange) * 2 - 1;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Batch by color, per-vertex alpha for comet shape
      const batches: { r: number; g: number; b: number; baseAlpha: number; verts: number[]; alphas: number[] }[] = [];
      const colorMap = new Map<string, number>(); // key → batch index

      for (const p of particles) {
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        const dirRad = Math.atan2(wind.u, wind.v);
        const speedBoost = p.speed < 5 ? 0.8 : p.speed < 15 ? 1.2 : 1.8;
        const step = degPerFrame * speedBoost;
        const newLon = lon + Math.sin(dirRad) * step;
        const newLat = lat + Math.cos(dirRad) * step;

        const newHead = (p.head + 1) % TRAIL_LEN;
        p.lons[newHead] = newLon;
        p.lats[newHead] = newLat;
        p.head = newHead;
        p.len = Math.min(p.len + 1, TRAIL_LEN);
        p.age++;

        if (p.age > p.maxAge ||
            newLon < vBounds.west - 2 || newLon > vBounds.east + 2 ||
            newLat < vBounds.south - 2 || newLat > vBounds.north + 2) {
          resetParticle(p, vBounds);
          continue;
        }

        if (p.len < 3) continue;

        const fadeIn = Math.min(1, p.age / 5);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 30);
        const speedAlpha = p.speed < 3 ? 0.20 : p.speed < 8 ? 0.35 : p.speed < 18 ? 0.50 : 0.70;
        const baseAlpha = fadeIn * fadeOut * speedAlpha;
        if (baseAlpha < 0.02) continue;

        const [r, g, bv] = windColor(p.speed);
        const key = `${r.toFixed(2)},${g.toFixed(2)},${bv.toFixed(2)}`;
        let batchIdx = colorMap.get(key);
        if (batchIdx === undefined) {
          batchIdx = batches.length;
          colorMap.set(key, batchIdx);
          batches.push({ r, g, b: bv, baseAlpha: 1, verts: [], alphas: [] });
        }
        const batch = batches[batchIdx]!;

        // Comet shape: head is thick + opaque, tail tapers + fades
        // Fixed 2px head width in pixels, converted to clip space
        const maxWidth = 2.0 / Math.min(width, height) * 2;
        const oldest = (p.head - p.len + 1 + TRAIL_LEN) % TRAIL_LEN;

        for (let s = 0; s < p.len - 1; s++) {
          const i0 = (oldest + s) % TRAIL_LEN;
          const i1 = (oldest + s + 1) % TRAIL_LEN;
          const x0 = lonToClip(p.lons[i0]!);
          const y0 = latToClip(p.lats[i0]!);
          const x1 = lonToClip(p.lons[i1]!);
          const y1 = latToClip(p.lats[i1]!);

          const dx = x1 - x0;
          const dy = y1 - y0;
          const segLen = Math.sqrt(dx * dx + dy * dy);
          if (segLen < 0.00001) continue;

          // Progress: 0 = tail, 1 = head
          const t0 = s / (p.len - 1);
          const t1 = (s + 1) / (p.len - 1);

          // Width tapers: head = maxWidth, tail = 0.2 * maxWidth
          const w0 = maxWidth * (0.2 + 0.8 * t0);
          const w1 = maxWidth * (0.2 + 0.8 * t1);

          // Alpha tapers: head = baseAlpha, tail = baseAlpha * 0.1
          const a0 = baseAlpha * (0.1 + 0.9 * t0 * t0);
          const a1 = baseAlpha * (0.1 + 0.9 * t1 * t1);

          // Normal perpendicular
          const nx = -dy / segLen;
          const ny = dx / segLen;

          // 6 vertices = 2 triangles
          batch.verts.push(
            x0 - nx * w0, y0 - ny * w0,
            x0 + nx * w0, y0 + ny * w0,
            x1 - nx * w1, y1 - ny * w1,
            x1 - nx * w1, y1 - ny * w1,
            x0 + nx * w0, y0 + ny * w0,
            x1 + nx * w1, y1 + ny * w1,
          );
          batch.alphas.push(a0, a0, a1, a1, a0, a1);
        }
      }

      // Draw batches
      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aAlpha);
      for (const batch of batches) {
        if (batch.verts.length === 0) continue;
        const posData = new Float32Array(batch.verts);
        const alphaData = new Float32Array(batch.alphas);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
        gl.bufferData(gl.ARRAY_BUFFER, alphaData, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);

        gl.uniform3f(uColor, batch.r, batch.g, batch.b);
        gl.uniform1f(uBaseAlpha, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, posData.length / 2);
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
      // Clear canvas on unmount
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
