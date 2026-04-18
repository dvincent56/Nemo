'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Swell overlay — animated bars moving in the wave direction (Windy-style).
 * WebGL TRIANGLES rendering, CPU simulation.
 *
 * Each bar is a short thick line oriented perpendicular to the swell direction,
 * animating slowly forward. Color encodes significant wave height (SWH).
 */

const CELL_SIZE = 24;      // pixels between grid cells
const BAR_LEN = 7;         // bar length in pixels
const BAR_WIDTH = 1.2;     // bar thickness
const BARS_PER_CELL = 4;   // parallel wave crests per cell
const ANIM_SPEED = 0.15;   // pixels per frame — visible drift

// SWH color ramp — same as before (validated)
const SWH_STOPS: [number, number, number, number][] = [
  [0,    0.35, 0.45, 0.65],   // 0m — muted slate blue
  [0.3,  0.40, 0.55, 0.75],   // 0.3m — light blue
  [0.8,  0.45, 0.65, 0.82],   // 0.8m — sky blue
  [1.5,  0.50, 0.78, 0.85],   // 1.5m — cyan
  [2.5,  0.65, 0.80, 0.45],   // 2.5m — yellow-green
  [4,    0.85, 0.60, 0.18],   // 4m — orange
  [6,    0.75, 0.20, 0.15],   // 6m+ — red
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

// ─── Component ─────────────────────────────────────────

export default function SwellOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

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

      // Map bounds
      const b = map.getBounds();
      const west = b.getWest(), east = b.getEast();
      const south = b.getSouth(), north = b.getNorth();
      const lonRange = east - west;
      const mercN = mercY(north);
      const mercS = mercY(south);
      const mercRange = mercN - mercS;

      // Pixel → clip space conversion
      const pxToClipX = (px: number) => (px / width) * 2 - 1;
      const pxToClipY = (py: number) => 1 - (py / height) * 2;
      const lonToPx = (lon: number) => ((lon - west) / lonRange) * width;
      const latToPx = (lat: number) => ((mercN - mercY(lat)) / mercRange) * height;

      phaseRef.current += ANIM_SPEED;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const verts: number[] = [];
      const alphas: number[] = [];
      const colors: number[] = [];

      // Generate dense grid of bars
      const gridCols = Math.ceil(width / CELL_SIZE) + 2;
      const gridRows = Math.ceil(height / CELL_SIZE) + 2;

      for (let row = -1; row < gridRows; row++) {
        for (let col = -1; col < gridCols; col++) {
          const basePx = col * CELL_SIZE;
          const basePy = row * CELL_SIZE;

          // Convert pixel to lat/lon for weather lookup
          const lon = west + (basePx / width) * lonRange;
          const latMerc = mercN - (basePy / height) * mercRange;
          const lat = (2 * Math.atan(Math.exp(latMerc)) - Math.PI / 2) * (180 / Math.PI);

          // Get swell data at this position
          const wind = interpolateGfsWind(grid, lat, lon);
          const point = grid.points[0]; // just need swellHeight/swellDir existence
          if (!point) continue;

          // Find nearest grid point for swell data (normalize lon for 0-360 grids)
          let normLon = lon;
          if (normLon < grid.bounds.west) normLon += 360;
          const gy = Math.floor((lat - grid.bounds.south) / grid.resolution);
          const gx = Math.floor((normLon - grid.bounds.west) / grid.resolution);
          const gi = Math.max(0, Math.min(grid.rows - 1, gy)) * grid.cols + Math.max(0, Math.min(grid.cols - 1, gx));
          const nearest = grid.points[gi];
          if (!nearest) continue;

          const swh = nearest.swellHeight;
          const swellDirDeg = nearest.swellDir;

          // Skip only negligible swell (land / very sheltered)
          if (swh < 0.05) continue;

          // Swell direction FROM (meteo convention) → direction waves travel TO
          const dirRad = (swellDirDeg + 180) * toRad;
          const dirSin = Math.sin(dirRad);
          const dirCos = Math.cos(dirRad);

          // Perpendicular to wave direction (for bar orientation)
          const perpX = dirCos;
          const perpY = dirSin;
          const halfLen = BAR_LEN / 2;
          const halfW = BAR_WIDTH / 2;

          // Color from SWH
          const [r, g, bv] = swellColor(swh);
          const baseAlpha = Math.min(0.75, 0.30 + swh * 0.10);

          // Draw multiple parallel crests per cell, evenly spaced
          const crestSpacing = CELL_SIZE / BARS_PER_CELL;
          for (let ci = 0; ci < BARS_PER_CELL; ci++) {
            // Position: base + crest offset + animation drift
            const crestOffset = ci * crestSpacing;
            const phase = (phaseRef.current + crestOffset) % CELL_SIZE;

            // Fade: smooth trapezoid — quick fade in, long plateau, quick fade out
            const t = phase / CELL_SIZE; // 0→1 through the cycle
            const fadeIn = Math.min(1, t * 5);       // 0→1 in first 20%
            const fadeOut = Math.min(1, (1 - t) * 5); // 1→0 in last 20%
            const fade = fadeIn * fadeOut;             // plateau at 1.0 for 60% of cycle

            const alpha = baseAlpha * fade;
            if (alpha < 0.02) continue;

            const px = basePx + dirSin * phase;
            const py = basePy - dirCos * phase;

            // 4 corners of the bar quad (in pixels)
            const ax = px - perpX * halfLen - dirSin * halfW;
            const ay = py - perpY * halfLen + dirCos * halfW;
            const bx = px + perpX * halfLen - dirSin * halfW;
            const by = py + perpY * halfLen + dirCos * halfW;
            const cx = px + perpX * halfLen + dirSin * halfW;
            const cy = py + perpY * halfLen - dirCos * halfW;
            const dx = px - perpX * halfLen + dirSin * halfW;
            const dy = py - perpY * halfLen - dirCos * halfW;

            // Convert to clip space
            const cax = pxToClipX(ax), cay = pxToClipY(ay);
            const cbx = pxToClipX(bx), cby = pxToClipY(by);
            const ccx = pxToClipX(cx), ccy = pxToClipY(cy);
            const cdx = pxToClipX(dx), cdy = pxToClipY(dy);

            // 2 triangles = 6 vertices
            verts.push(
              cax, cay, cbx, cby, ccx, ccy,
              cax, cay, ccx, ccy, cdx, cdy,
            );
            for (let j = 0; j < 6; j++) {
              alphas.push(alpha);
              colors.push(r, g, bv);
            }
          }
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
