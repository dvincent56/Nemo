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
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = u_color;
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

function windColor(speed: number): [number, number, number] {
  if (speed < 5) return [0.24, 0.55, 0.78];   // soft blue
  if (speed < 10) return [0.31, 0.74, 0.66];   // teal
  if (speed < 18) return [0.42, 0.82, 0.55];   // green
  if (speed < 25) return [0.86, 0.78, 0.27];   // yellow
  if (speed < 35) return [0.86, 0.59, 0.16];   // orange
  return [0.78, 0.22, 0.16];                    // red
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
  p.lons[0] = lon; p.lats[0] = lat;
  p.head = 0; p.len = 1; p.age = 0;
  p.maxAge = 120 + Math.floor(Math.random() * 100);
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
    const uColor = gl.getUniformLocation(prog, 'u_color');
    const posBuf = gl.createBuffer()!;

    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Init particles
    const bounds = useGameStore.getState().map.bounds;
    const particles: Particle[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) particles.push(makeParticle(bounds));

    // Mercator helpers
    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));

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
      const pxPerLon = lonRange !== 0 ? width / lonRange : 1;
      const PIXELS_PER_FRAME = 0.3;
      const degPerFrame = PIXELS_PER_FRAME / pxPerLon;

      // Lon/lat → clip space [-1, 1]
      const lonToClip = (lon: number) => ((lon - vBounds.west) / lonRange) * 2 - 1;
      const latToClip = (lat: number) => ((mercY(lat) - mercS) / mercRange) * 2 - 1;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Group particles by color bucket for batched drawing
      const colorBuckets: Map<string, { r: number; g: number; b: number; verts: number[]; alpha: number }> = new Map();

      for (const p of particles) {
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Move at constant pixel speed in wind direction
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

        // Recycle if out of bounds or old
        if (p.age > p.maxAge ||
            newLon < vBounds.west - 2 || newLon > vBounds.east + 2 ||
            newLat < vBounds.south - 2 || newLat > vBounds.north + 2) {
          resetParticle(p, vBounds);
          continue;
        }

        if (p.len < 3) continue;

        // Fade
        const fadeIn = Math.min(1, p.age / 15);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 30);
        const speedAlpha = p.speed < 3 ? 0.25 : p.speed < 8 ? 0.40 : p.speed < 18 ? 0.55 : 0.75;
        const alpha = fadeIn * fadeOut * speedAlpha;
        if (alpha < 0.02) continue;

        // Color
        const [r, g, bv] = windColor(p.speed);
        const key = `${r},${g},${bv}`;
        if (!colorBuckets.has(key)) colorBuckets.set(key, { r, g, b: bv, verts: [], alpha });

        const bucket = colorBuckets.get(key)!;
        // Use the max alpha for this bucket (simplification)
        if (alpha > bucket.alpha) bucket.alpha = alpha;

        // Build LINE_STRIP as pairs of LINE segments
        const oldest = (p.head - p.len + 1 + TRAIL_LEN) % TRAIL_LEN;
        for (let s = 0; s < p.len - 1; s++) {
          const i0 = (oldest + s) % TRAIL_LEN;
          const i1 = (oldest + s + 1) % TRAIL_LEN;
          bucket.verts.push(
            lonToClip(p.lons[i0]!), latToClip(p.lats[i0]!),
            lonToClip(p.lons[i1]!), latToClip(p.lats[i1]!),
          );
        }
      }

      // Draw each color bucket in one call
      gl.enableVertexAttribArray(aPos);
      for (const bucket of colorBuckets.values()) {
        if (bucket.verts.length === 0) continue;
        const data = new Float32Array(bucket.verts);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(uColor, bucket.r, bucket.g, bucket.b, bucket.alpha);
        gl.drawArrays(gl.LINES, 0, data.length / 2);
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
      window.removeEventListener('resize', onResize);
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
