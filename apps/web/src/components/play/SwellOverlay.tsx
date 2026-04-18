'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Swell overlay — particle-based animated bars (Windy-style).
 *
 * Each particle is a short bar oriented perpendicular to swell direction.
 * Particles spawn at random positions, drift slowly in the wave direction,
 * fade in → stay visible → fade out over their lifetime, then respawn.
 */

const MAX_PARTICLES = 6000;
const BAR_LEN = 7;
const BAR_WIDTH = 1.2;
const DRIFT_SPEED = 0.12; // degrees per frame — slow visible drift
const MIN_LIFE = 120;     // frames
const MAX_LIFE = 220;     // frames
const FADE_FRAMES = 25;   // frames for fade in/out

// SWH color ramp
const SWH_STOPS: [number, number, number, number][] = [
  [0,    0.35, 0.45, 0.65],
  [0.3,  0.40, 0.55, 0.75],
  [0.8,  0.45, 0.65, 0.82],
  [1.5,  0.50, 0.78, 0.85],
  [2.5,  0.65, 0.80, 0.45],
  [4,    0.85, 0.60, 0.18],
  [6,    0.75, 0.20, 0.15],
];

function swellColor(swh: number): [number, number, number] {
  if (swh <= SWH_STOPS[0]![0]) return [SWH_STOPS[0]![1], SWH_STOPS[0]![2], SWH_STOPS[0]![3]];
  for (let i = 1; i < SWH_STOPS.length; i++) {
    const prev = SWH_STOPS[i - 1]!;
    const curr = SWH_STOPS[i]!;
    if (swh <= curr[0]) {
      const t = (swh - prev[0]) / (curr[0] - prev[0]);
      return [
        prev[1] + (curr[1] - prev[1]) * t,
        prev[2] + (curr[2] - prev[2]) * t,
        prev[3] + (curr[3] - prev[3]) * t,
      ];
    }
  }
  const last = SWH_STOPS[SWH_STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

// ─── Shaders ───────────────────────────────────────────

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

// ─── Particle state ────────────────────────────────────

interface SwellParticle {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
}

function lookupSwell(grid: WeatherGrid, lat: number, lon: number): { swh: number; dir: number } {
  let normLon = lon;
  if (normLon < grid.bounds.west) normLon += 360;
  if (normLon > grid.bounds.east + grid.resolution) normLon -= 360;
  const gy = Math.max(0, Math.min(grid.rows - 1, Math.floor((lat - grid.bounds.south) / grid.resolution)));
  const gx = Math.max(0, Math.min(grid.cols - 1, Math.floor((normLon - grid.bounds.west) / grid.resolution)));
  const pt = grid.points[gy * grid.cols + gx];
  if (!pt) return { swh: 0, dir: 0 };
  return { swh: pt.swellHeight, dir: pt.swellDir };
}

function spawnParticle(bounds: { west: number; east: number; south: number; north: number }): SwellParticle {
  return {
    lon: bounds.west + Math.random() * (bounds.east - bounds.west),
    lat: bounds.south + Math.random() * (bounds.north - bounds.south),
    age: Math.floor(Math.random() * MAX_LIFE), // stagger initial ages
    maxAge: MIN_LIFE + Math.floor(Math.random() * (MAX_LIFE - MIN_LIFE)),
  };
}

// ─── Component ─────────────────────────────────────────

export default function SwellOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<SwellParticle[]>([]);

  const swellVisible = useGameStore((s) => s.layers.swell);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !swellVisible) {
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

    const toRad = Math.PI / 180;
    const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));

    // Scale particle count to screen
    const screenArea = canvas.width * canvas.height;
    const particleCount = Math.min(MAX_PARTICLES, Math.max(1500, Math.round(screenArea / 200)));

    // Initialize particles
    const mapBounds = useGameStore.getState().map.bounds;
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < particleCount; i++) {
        particlesRef.current.push(spawnParticle(mapBounds));
      }
    }
    const particles = particlesRef.current;

    const animate = () => {
      const grid: WeatherGrid | null = useGameStore.getState().weather.gridData;
      const map = mapInstance;
      if (!grid || !map) { animRef.current = requestAnimationFrame(animate); return; }

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

      // Degrees per frame for drift (scale to zoom)
      const degPerFrame = DRIFT_SPEED * lonRange / 360;

      const lonToClip = (lon: number) => ((lon - vBounds.west) / lonRange) * 2 - 1;
      const latToClip = (lat: number) => ((mercY(lat) - mercS) / mercRange) * 2 - 1;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const verts: number[] = [];
      const alphas: number[] = [];
      const colors: number[] = [];

      // Pixel size in clip space (for bar dimensions)
      const pxClipX = 2 / width;
      const pxClipY = 2 / height;
      const halfLen = BAR_LEN / 2;
      const halfW = BAR_WIDTH / 2;

      for (const p of particles) {
        const { swh, dir } = lookupSwell(grid, p.lat, p.lon);

        // Skip land / negligible swell
        if (swh < 0.05) {
          p.age = p.maxAge; // force respawn
        }

        p.age++;
        if (p.age >= p.maxAge ||
            p.lon < vBounds.west - 2 || p.lon > vBounds.east + 2 ||
            p.lat < vBounds.south - 2 || p.lat > vBounds.north + 2) {
          // Respawn
          Object.assign(p, spawnParticle(vBounds));
          p.age = 0;
          continue;
        }

        // Drift in swell direction (FROM → TO = +180°)
        const dirRad = (dir + 180) * toRad;
        p.lon += Math.sin(dirRad) * degPerFrame;
        p.lat += Math.cos(dirRad) * degPerFrame;

        // Skip if not in view
        if (p.lon < vBounds.west || p.lon > vBounds.east ||
            p.lat < vBounds.south || p.lat > vBounds.north) continue;

        // Fade envelope: quick fade in → plateau → quick fade out
        const fadeIn = Math.min(1, p.age / FADE_FRAMES);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / FADE_FRAMES);
        const baseAlpha = Math.min(0.7, 0.30 + swh * 0.08);
        const alpha = baseAlpha * fadeIn * fadeOut;
        if (alpha < 0.02) continue;

        // Color
        const [r, g, bv] = swellColor(swh);

        // Bar position in clip space
        const cx = lonToClip(p.lon);
        const cy = latToClip(p.lat);

        // Bar perpendicular to swell direction
        const perpX = Math.cos(dirRad);
        const perpY = -Math.sin(dirRad); // flip Y for screen coords

        // Bar corners in clip space
        const lx = perpX * halfLen * pxClipX;
        const ly = perpY * halfLen * pxClipY;
        const wx = Math.sin(dirRad) * halfW * pxClipX;
        const wy = Math.cos(dirRad) * halfW * pxClipY;

        const ax = cx - lx - wx, ay = cy - ly + wy;
        const bx = cx + lx - wx, by = cy + ly + wy;
        const ccx = cx + lx + wx, ccy = cy + ly - wy;
        const dx = cx - lx + wx, dy = cy - ly - wy;

        verts.push(
          ax, ay, bx, by, ccx, ccy,
          ax, ay, ccx, ccy, dx, dy,
        );
        for (let j = 0; j < 6; j++) {
          alphas.push(alpha);
          colors.push(r, g, bv);
        }
      }

      if (verts.length > 0) {
        gl.enableVertexAttribArray(aPos);
        gl.enableVertexAttribArray(aAlpha);
        gl.enableVertexAttribArray(aColor);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alphas), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
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
      particlesRef.current = [];
      window.removeEventListener('resize', onResize);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
  }, [swellVisible]);

  if (!swellVisible) return <></>;

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
