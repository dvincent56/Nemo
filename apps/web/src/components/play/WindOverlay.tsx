'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { parseGfsWind, interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay using real GFS data.
 * Particles are stored in GEO coordinates (lat/lon) so they stick to the
 * map when panning/zooming. Converted to pixel coordinates each frame.
 */

const PARTICLE_COUNT = 2000;
const TRAIL_LEN = 6;

interface Particle {
  // Geo positions (ring buffer)
  lons: Float64Array;
  lats: Float64Array;
  head: number;
  len: number;
  age: number;
  maxAge: number;
  speed: number;
}

function windColor(speed: number): string {
  if (speed < 5) return 'rgba(98,170,220,';
  if (speed < 10) return 'rgba(108,210,138,';
  if (speed < 18) return 'rgba(200,210,80,';
  if (speed < 25) return 'rgba(240,185,107,';
  if (speed < 35) return 'rgba(217,119,6,';
  return 'rgba(180,50,50,';
}

function randomInBounds(b: { west: number; east: number; south: number; north: number }): [number, number] {
  const lon = b.west + Math.random() * (b.east - b.west);
  const lat = b.south + Math.random() * (b.north - b.south);
  return [lon, lat];
}

function makeParticle(b: { west: number; east: number; south: number; north: number }): Particle {
  const [lon, lat] = randomInBounds(b);
  const lons = new Float64Array(TRAIL_LEN);
  const lats = new Float64Array(TRAIL_LEN);
  lons[0] = lon;
  lats[0] = lat;
  return { lons, lats, head: 0, len: 1, age: Math.floor(Math.random() * 60), maxAge: 50 + Math.floor(Math.random() * 50), speed: 0 };
}

function resetParticle(p: Particle, b: { west: number; east: number; south: number; north: number }): void {
  const [lon, lat] = randomInBounds(b);
  p.lons[0] = lon;
  p.lats[0] = lat;
  p.head = 0;
  p.len = 1;
  p.age = 0;
  p.maxAge = 50 + Math.floor(Math.random() * 50);
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
      .then((json) => { gridRef.current = parseGfsWind(json); })
      .catch((err) => console.warn('Failed to load wind data:', err));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
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

    // Init particles in current map bounds
    const initBounds = useGameStore.getState().map.bounds;
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(makeParticle(initBounds));
    }

    const animate = () => {
      const grid = gridRef.current;
      if (!grid) { animRef.current = requestAnimationFrame(animate); return; }

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Get real map bounds from store (synced continuously from MapCanvas)
      const { bounds } = useGameStore.getState().map;
      const lonRange = bounds.east - bounds.west;
      const latRange = bounds.north - bounds.south;
      if (lonRange === 0 || latRange === 0) { animRef.current = requestAnimationFrame(animate); return; }

      // Geo → pixel conversion
      const lonToPx = (lon: number) => ((lon - bounds.west) / lonRange) * width;
      const latToPx = (lat: number) => ((bounds.north - lat) / latRange) * height;

      ctx.lineCap = 'round';

      for (const p of particles) {
        // Current geo position
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        // Interpolate wind at this geo position
        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Advance in geo coordinates
        // wind.u = east component (m/s), wind.v = north component (m/s)
        // Convert m/s to degrees/frame (~0.001 deg per m/s at mid-latitudes)
        const speedScale = 0.002;
        const newLon = lon + wind.u * speedScale;  // u > 0 = eastward
        const newLat = lat + wind.v * speedScale;  // v > 0 = northward

        // Push to trail
        const newHead = (p.head + 1) % TRAIL_LEN;
        p.lons[newHead] = newLon;
        p.lats[newHead] = newLat;
        p.head = newHead;
        p.len = Math.min(p.len + 1, TRAIL_LEN);
        p.age++;

        // Reset if out of visible bounds or too old
        if (p.age > p.maxAge ||
            newLon < bounds.west - 5 || newLon > bounds.east + 5 ||
            newLat < bounds.south - 5 || newLat > bounds.north + 5) {
          resetParticle(p, bounds);
          continue;
        }

        // Fade
        const fadeIn = Math.min(1, p.age / 8);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 12);
        const alpha = fadeIn * fadeOut * 0.6;
        if (alpha < 0.03) continue;

        // Draw trail as polyline (geo → pixel)
        ctx.strokeStyle = `${windColor(p.speed)}${alpha.toFixed(2)})`;
        ctx.lineWidth = p.speed > 25 ? 1.6 : p.speed > 15 ? 1.2 : 0.8;
        ctx.beginPath();
        const oldest = (p.head - p.len + 1 + TRAIL_LEN) % TRAIL_LEN;
        ctx.moveTo(lonToPx(p.lons[oldest]!), latToPx(p.lats[oldest]!));
        for (let s = 1; s < p.len; s++) {
          const idx = (oldest + s) % TRAIL_LEN;
          ctx.lineTo(lonToPx(p.lons[idx]!), latToPx(p.lats[idx]!));
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
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    />
  );
}
