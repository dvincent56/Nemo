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

const PARTICLE_COUNT = 2000;
const MAX_TRAIL = 6; // max positions stored per particle

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

      const { bounds } = useGameStore.getState().map;
      const lonMin = bounds.west;
      const lonMax = bounds.east;
      const latMin = bounds.south;
      const latMax = bounds.north;
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
        const alpha = fadeIn * fadeOut * 0.6;
        if (alpha < 0.03) continue;

        // Draw entire trail as a single path (1 stroke call per particle)
        ctx.strokeStyle = `${windColor(p.speed)}${alpha.toFixed(2)})`;
        ctx.lineWidth = p.speed > 25 ? 1.6 : p.speed > 15 ? 1.2 : 0.8;
        ctx.beginPath();
        // Start from oldest point in trail, draw to head
        const oldest = (p.head - p.len + 1 + MAX_TRAIL) % MAX_TRAIL;
        ctx.moveTo(p.trail[oldest * 2]!, p.trail[oldest * 2 + 1]!);
        for (let s = 1; s < p.len; s++) {
          const idx = (oldest + s) % MAX_TRAIL;
          ctx.lineTo(p.trail[idx * 2]!, p.trail[idx * 2 + 1]!);
        }
        ctx.stroke();
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
