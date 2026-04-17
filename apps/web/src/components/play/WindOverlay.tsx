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

const MAX_PARTICLES = 8000;
const TRAIL_LEN = 30;

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
    maxAge: 150 + Math.floor(Math.random() * 100),
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
    for (let i = 0; i < MAX_PARTICLES; i++) {
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

      // ── Fast projection: compute lon/lat → pixel once via 2 reference points ──
      // Instead of calling map.project() per trail point (240k calls/frame),
      // project 2 corners and build a linear transform. Accurate enough for
      // the small viewport area (Mercator is ~linear at this scale).
      const topLeft = map.project([bounds.west, bounds.north]);
      const bottomRight = map.project([bounds.east, bounds.south]);
      const lonRange = bounds.east - bounds.west;
      const latRange = bounds.north - bounds.south;
      const pxPerLon = lonRange !== 0 ? (bottomRight.x - topLeft.x) / lonRange : 1;
      const pxPerLat = latRange !== 0 ? (bottomRight.y - topLeft.y) / -latRange : 1; // negative because lat↑ = pixel↓
      const lonToX = (lon: number) => topLeft.x + (lon - bounds.west) * pxPerLon;
      const latToY = (lat: number) => topLeft.y + (bounds.north - lat) * pxPerLat;

      ctx.lineCap = 'round';

      // Pixel speed adapted to zoom
      const PIXELS_PER_FRAME = 0.3;
      const degPerFrame = lonRange !== 0 ? PIXELS_PER_FRAME / pxPerLon : 0.001;

      // Detect mobile: fewer particles
      const isMobile = width < 768;
      const activeCount = isMobile ? Math.min(3000, particles.length) : particles.length;

      for (let pi = 0; pi < activeCount; pi++) {
        const p = particles[pi]!;
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Move in wind direction — faster for strong wind
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
            newLon < bounds.west - 1 || newLon > bounds.east + 1 ||
            newLat < bounds.south - 1 || newLat > bounds.north + 1) {
          resetParticle(p, bounds);
          continue;
        }

        // Opacity: calm = faint blue, strong = more opaque
        const fadeIn = Math.min(1, p.age / 15);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 30);
        const speedAlpha = p.speed < 3 ? 0.08 : p.speed < 8 ? 0.15 : p.speed < 18 ? 0.25 : 0.4;
        const alpha = fadeIn * fadeOut * speedAlpha;
        if (alpha < 0.01) continue;

        const drawLen = Math.min(p.len, TRAIL_LEN);
        if (drawLen < 2) continue;

        ctx.strokeStyle = `${windColor(p.speed)}${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();

        let started = false;
        const oldest = (p.head - drawLen + 1 + TRAIL_LEN) % TRAIL_LEN;
        for (let s = 0; s < drawLen; s++) {
          const idx = (oldest + s) % TRAIL_LEN;
          const px = lonToX(p.lons[idx]!);
          const py = latToY(p.lats[idx]!);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else { ctx.lineTo(px, py); }
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
