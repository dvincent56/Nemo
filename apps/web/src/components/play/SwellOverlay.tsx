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

const MAX_PARTICLES_DESKTOP = 6000;
const MAX_PARTICLES_MOBILE = 2000;
const BAR_LEN = 8;
const BAR_WIDTH = 1.5;
const DRIFT_SPEED = 0.005; // degrees per frame — very gentle drift
const MIN_LIFE = 120;     // frames
const MAX_LIFE = 220;     // frames
const FADE_FRAMES = 25;   // frames for fade in/out

// SWH color ramp — warm tones that contrast with the dark navy map
const SWH_STOPS: [number, number, number, number][] = [
  [0,    0.70, 0.80, 0.85],   // 0m — pale ice
  [0.5,  0.55, 0.85, 0.80],   // 0.5m — light cyan
  [1.0,  0.40, 0.85, 0.70],   // 1m — seafoam
  [2.0,  0.65, 0.55, 0.80],   // 2m — lavender
  [3.0,  0.80, 0.40, 0.70],   // 3m — orchid
  [4.5,  0.90, 0.28, 0.55],   // 4.5m — magenta
  [6,    0.95, 0.22, 0.35],   // 6m+ — hot pink
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

function lookupSwell(grid: WeatherGrid, lat: number, lon: number): { swh: number; dir: number; period: number } {
  let normLon = lon;
  if (normLon < grid.bounds.west) normLon += 360;
  if (normLon > grid.bounds.east + grid.resolution) normLon -= 360;

  const fy = (lat - grid.bounds.south) / grid.resolution;
  const fx = (normLon - grid.bounds.west) / grid.resolution;
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);

  if (y0 < 0 || y0 >= grid.rows || x0 < 0 || x0 >= grid.cols) {
    return { swh: 0, dir: 0, period: 0 };
  }

  // Bilinear interpolation between 4 neighbors
  const y1 = Math.min(y0 + 1, grid.rows - 1);
  const x1 = Math.min(x0 + 1, grid.cols - 1);
  const dx = fx - x0;
  const dy = fy - y0;

  const p00 = grid.points[y0 * grid.cols + x0];
  const p10 = grid.points[y0 * grid.cols + x1];
  const p01 = grid.points[y1 * grid.cols + x0];
  const p11 = grid.points[y1 * grid.cols + x1];
  if (!p00 || !p10 || !p01 || !p11) return { swh: 0, dir: 0, period: 0 };

  const lerp = (a: number, b: number, c: number, d: number) =>
    a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;

  const swh = lerp(p00.swellHeight, p10.swellHeight, p01.swellHeight, p11.swellHeight);
  const period = lerp(
    (p00 as any).swellPeriod ?? 0, (p10 as any).swellPeriod ?? 0,
    (p01 as any).swellPeriod ?? 0, (p11 as any).swellPeriod ?? 0,
  );

  // Direction: interpolate in sin/cos space to avoid wrap-around artifacts
  const toRad = Math.PI / 180;
  const dirs = [p00.swellDir, p10.swellDir, p01.swellDir, p11.swellDir];
  const sinD = lerp(...dirs.map(d => Math.sin(d * toRad)) as [number, number, number, number]);
  const cosD = lerp(...dirs.map(d => Math.cos(d * toRad)) as [number, number, number, number]);
  const dir = ((Math.atan2(sinD, cosD) * 180 / Math.PI) + 360) % 360;

  return { swh, dir, period };
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
  const currentTimeMs = useGameStore((s) => s.timeline.currentTime.getTime());
  const isLive = useGameStore((s) => s.timeline.isLive);
  const weatherTimeVisible = isLive || currentTimeMs >= Date.now();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !swellVisible || !weatherTimeVisible) {
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

    // Scale particle count to logical screen area (DPR-aware)
    const dpr = window.devicePixelRatio || 1;
    const isMobile = canvas.width / dpr < 768;
    const maxParticles = isMobile ? MAX_PARTICLES_MOBILE : MAX_PARTICLES_DESKTOP;
    const logicalArea = (canvas.width / dpr) * (canvas.height / dpr);
    const particleCount = Math.min(maxParticles, Math.max(isMobile ? 800 : 2000, Math.round(logicalArea / 150)));

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

      for (const p of particles) {
        p.age++;
        const needsRespawn = p.age >= p.maxAge ||
            p.lon < vBounds.west - 2 || p.lon > vBounds.east + 2 ||
            p.lat < vBounds.south - 2 || p.lat > vBounds.north + 2;

        if (needsRespawn) {
          // Respawn — retry up to 5 times to avoid landing on land
          for (let attempt = 0; attempt < 5; attempt++) {
            Object.assign(p, spawnParticle(vBounds));
            p.age = 0;
            const check = lookupSwell(grid, p.lat, p.lon);
            if (check.swh >= 0.3) break;
          }
          continue;
        }

        const { swh, dir, period } = lookupSwell(grid, p.lat, p.lon);

        // Kill particles on land or in coastal transition zone
        if (swh < 0.3) {
          p.age = p.maxAge;
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
        const baseAlpha = Math.min(0.90, 0.45 + swh * 0.10);
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

        // Length scales with swell height: 1m→1x, 5m→1.8x
        const swhScale = 1 + Math.min(1, swh / 5) * 0.8;
        const scaledHalfLen = halfLen * swhScale;

        // Width varies with period: short period (≤6s) = 3px, long period (≥14s) = 1px
        const periodWidth = period > 0
          ? BAR_WIDTH * (1 + Math.max(0, (10 - period) / 4))  // 6s→2x, 10s→1x, 14s→0.5x
          : BAR_WIDTH;
        const halfW = Math.max(0.5, periodWidth) / 2;

        // Bar corners in clip space
        const lx = perpX * scaledHalfLen * pxClipX;
        const ly = perpY * scaledHalfLen * pxClipY;
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

    // When the tab is hidden then becomes visible again, browsers may drop
    // the queued rAF callback, breaking the self-perpetuating loop. Restart
    // the loop fresh on every visibility return.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(animate);
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
      particlesRef.current = [];
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
  }, [swellVisible, weatherTimeVisible]);

  if (!swellVisible || !weatherTimeVisible) return <></>;

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
