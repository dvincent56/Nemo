'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { parseGfsWind, interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay — Canvas 2D on top of MapLibre.
 *
 * Uses map.project(lngLat) for pixel-perfect geo-referencing.
 * Particles stored in geo coords (lon/lat), projected to screen each frame.
 * Windy-style: thin trailing lines on transparent background.
 */

const PARTICLE_COUNT = 3000;
const TRAIL_LEN = 8;

interface Particle {
  lons: Float64Array; // ring buffer of longitudes
  lats: Float64Array; // ring buffer of latitudes
  head: number;
  len: number;
  age: number;
  maxAge: number;
  speed: number;
}

function windColor(speed: number): string {
  // Windy-style blue/green/yellow palette
  if (speed < 5) return 'rgba(60,140,200,';
  if (speed < 10) return 'rgba(80,190,170,';
  if (speed < 18) return 'rgba(130,210,100,';
  if (speed < 25) return 'rgba(220,200,70,';
  if (speed < 35) return 'rgba(220,150,40,';
  return 'rgba(200,60,40,';
}

function randomInBounds(b: { north: number; south: number; east: number; west: number }): [number, number] {
  return [
    b.west + Math.random() * (b.east - b.west),
    b.south + Math.random() * (b.north - b.south),
  ];
}

function makeParticle(b: { north: number; south: number; east: number; west: number }): Particle {
  const [lon, lat] = randomInBounds(b);
  const lons = new Float64Array(TRAIL_LEN);
  const lats = new Float64Array(TRAIL_LEN);
  lons[0] = lon;
  lats[0] = lat;
  return {
    lons, lats, head: 0, len: 1,
    age: Math.floor(Math.random() * 70),
    maxAge: 50 + Math.floor(Math.random() * 70),
    speed: 0,
  };
}

function resetParticle(p: Particle, b: { north: number; south: number; east: number; west: number }): void {
  const [lon, lat] = randomInBounds(b);
  p.lons[0] = lon; p.lats[0] = lat;
  p.head = 0; p.len = 1; p.age = 0;
  p.maxAge = 50 + Math.floor(Math.random() * 70);
  p.speed = 0;
}

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gridRef = useRef<WeatherGrid | null>(null);
  const particlesRef = useRef<Particle[]>([]);

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

    // Init particles when bounds are available
    const bounds = useGameStore.getState().map.bounds;
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(makeParticle(bounds));
    }
    particlesRef.current = particles;

    const animate = () => {
      const grid = gridRef.current;
      const map = mapInstance;
      if (!grid || !map) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Current visible bounds
      const b = map.getBounds();
      const bounds = {
        north: b.getNorth(), south: b.getSouth(),
        east: b.getEast(), west: b.getWest(),
      };

      ctx.lineCap = 'round';

      for (const p of particles) {
        // Current head position (geo)
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        // Wind at this geo position
        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Advance in geo coords — u is m/s east, v is m/s north
        // Scale factor: ~0.00001 degree per m/s per frame at 60fps
        const scale = 0.0015;
        const newLon = lon + wind.u * scale;
        const newLat = lat + wind.v * scale;

        // Push to trail ring buffer
        const newHead = (p.head + 1) % TRAIL_LEN;
        p.lons[newHead] = newLon;
        p.lats[newHead] = newLat;
        p.head = newHead;
        p.len = Math.min(p.len + 1, TRAIL_LEN);
        p.age++;

        // Reset if out of expanded bounds or too old
        const margin = 2;
        if (p.age > p.maxAge ||
            newLon < bounds.west - margin || newLon > bounds.east + margin ||
            newLat < bounds.south - margin || newLat > bounds.north + margin) {
          resetParticle(p, bounds);
          continue;
        }

        // Fade in/out
        const fadeIn = Math.min(1, p.age / 8);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 15);
        const alpha = fadeIn * fadeOut * 0.5;
        if (alpha < 0.02) continue;

        // Draw trail as polyline — project each point via MapLibre
        if (p.len < 2) continue;

        ctx.strokeStyle = `${windColor(p.speed)}${alpha.toFixed(2)})`;
        ctx.lineWidth = p.speed > 25 ? 1.5 : p.speed > 15 ? 1.2 : 0.8;
        ctx.beginPath();

        let started = false;
        const oldest = (p.head - p.len + 1 + TRAIL_LEN) % TRAIL_LEN;
        for (let s = 0; s < p.len; s++) {
          const idx = (oldest + s) % TRAIL_LEN;
          const pt = map.project([p.lons[idx]!, p.lats[idx]!]);
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
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
