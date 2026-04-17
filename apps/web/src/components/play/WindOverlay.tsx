'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { parseGfsWind, interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay using real GFS data.
 * Each particle keeps a trail of previous positions drawn as a
 * polyline — longer and faster when wind is strong.
 * Color encodes wind speed (blue → green → yellow → orange → red).
 */

const PARTICLE_COUNT = 5000;
const MAX_TRAIL = 12; // max positions stored per particle

interface Particle {
  trail: Float64Array; // [x0,y0, x1,y1, ...] — ring buffer
  head: number;        // current write index (0..MAX_TRAIL-1)
  len: number;         // how many trail segments filled so far
  age: number;
  maxAge: number;
  speed: number;       // cached last wind speed (for color)
}

function windColor(speed: number): string {
  if (speed < 5) return 'rgba(98,170,220,';     // very light — pale blue
  if (speed < 10) return 'rgba(108,210,138,';    // light — green
  if (speed < 18) return 'rgba(200,210,80,';     // moderate — yellow-green
  if (speed < 25) return 'rgba(240,185,107,';    // fresh — orange
  if (speed < 35) return 'rgba(217,119,6,';      // strong — dark orange
  return 'rgba(180,50,50,';                       // storm — red
}

function makeParticle(w: number, h: number): Particle {
  const trail = new Float64Array(MAX_TRAIL * 2);
  const x = Math.random() * w;
  const y = Math.random() * h;
  trail[0] = x;
  trail[1] = y;
  return {
    trail,
    head: 0,
    len: 1,
    age: Math.floor(Math.random() * 80),
    maxAge: 60 + Math.floor(Math.random() * 60),
    speed: 0,
  };
}

function resetParticle(p: Particle, w: number, h: number): void {
  const x = Math.random() * w;
  const y = Math.random() * h;
  p.trail[0] = x;
  p.trail[1] = y;
  p.head = 0;
  p.len = 1;
  p.age = 0;
  p.maxAge = 60 + Math.floor(Math.random() * 60);
  p.speed = 0;
}

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gridRef = useRef<WeatherGrid | null>(null);

  const windVisible = useGameStore((s) => s.layers.wind);

  // Load GFS data once
  useEffect(() => {
    if (gridRef.current) return;
    fetch('/data/wind.json')
      .then((res) => res.json())
      .then((json) => {
        gridRef.current = parseGfsWind(json);
      })
      .catch((err) => console.warn('Failed to load wind data:', err));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Init particles
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(makeParticle(canvas.width, canvas.height));
    }

    const toRad = Math.PI / 180;

    const animate = () => {
      const grid = gridRef.current;
      if (!grid) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const mapState = useGameStore.getState().map;
      const [cLon, cLat] = mapState.center;
      const span = 180 / Math.pow(2, mapState.zoom);
      const ar = height / width;
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMax = cLat + span * ar;
      const latMin = cLat - span * ar;
      const lonRange = lonMax - lonMin;
      const latRange = latMax - latMin;

      ctx.lineCap = 'round';

      for (const p of particles) {
        // Current head position
        const hx = p.trail[p.head * 2]!;
        const hy = p.trail[p.head * 2 + 1]!;

        // Pixel → geo
        const lon = lonMin + (hx / width) * lonRange;
        const lat = latMax - (hy / height) * latRange;

        // Interpolate wind
        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Advance position — faster when wind is stronger
        const scale = 0.15 + wind.tws * 0.05;
        const nx = hx + (-Math.sin(wind.twd * toRad) * scale);
        const ny = hy + (Math.cos(wind.twd * toRad) * scale);

        // Push new position into trail ring buffer
        const newHead = (p.head + 1) % MAX_TRAIL;
        p.trail[newHead * 2] = nx;
        p.trail[newHead * 2 + 1] = ny;
        p.head = newHead;
        p.len = Math.min(p.len + 1, MAX_TRAIL);
        p.age++;

        // Reset if dead or off-screen
        if (p.age > p.maxAge || nx < -20 || nx > width + 20 || ny < -20 || ny > height + 20) {
          resetParticle(p, width, height);
          continue;
        }

        // Fade
        const fadeIn = Math.min(1, p.age / 10);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 15);
        const baseAlpha = fadeIn * fadeOut;
        if (baseAlpha < 0.03) continue;

        // Draw trail as polyline with fading segments
        const colorBase = windColor(p.speed);
        const lineWidth = p.speed > 25 ? 1.8 : p.speed > 15 ? 1.3 : 0.9;
        ctx.lineWidth = lineWidth;

        for (let s = 1; s < p.len; s++) {
          // Walk backwards from head
          const i1 = ((p.head - s + MAX_TRAIL) % MAX_TRAIL);
          const i0 = ((p.head - s + 1 + MAX_TRAIL) % MAX_TRAIL);
          const x0 = p.trail[i0 * 2]!;
          const y0 = p.trail[i0 * 2 + 1]!;
          const x1 = p.trail[i1 * 2]!;
          const y1 = p.trail[i1 * 2 + 1]!;

          // Each segment fades out toward the tail
          const segAlpha = baseAlpha * (1 - s / p.len) * 0.7;
          if (segAlpha < 0.02) break;

          ctx.strokeStyle = `${colorBase}${segAlpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
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
