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

const MAX_PARTICLES = 12000;
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

      ctx.lineCap = 'round';

      // Constant pixel speed: all particles move at ~0.4 px/frame in the wind direction.
      // The DIRECTION comes from wind data, but the SPEED is constant.
      // Wind strength is encoded visually: thickness, opacity, trail length.
      const lonRange = bounds.east - bounds.west;
      const pixelsPerDeg = lonRange > 0 ? width / lonRange : 1;
      // Fixed pixel velocity → convert to degrees
      const PIXELS_PER_FRAME = 0.3;
      const degPerFrame = PIXELS_PER_FRAME / pixelsPerDeg;

      // Active count adapts to zoom
      const zoom = map.getZoom();
      // Always use all particles — they respawn within visible bounds anyway
      const activeCount = MAX_PARTICLES;

      for (let pi = 0; pi < activeCount && pi < particles.length; pi++) {
        const p = particles[pi]!;
        const lon = p.lons[p.head]!;
        const lat = p.lats[p.head]!;

        const wind = interpolateGfsWind(grid, lat, lon);
        p.speed = wind.tws;

        // Move at constant pixel speed in wind direction
        const dirRad = Math.atan2(wind.u, wind.v); // angle in radians
        const newLon = lon + Math.sin(dirRad) * degPerFrame;
        const newLat = lat + Math.cos(dirRad) * degPerFrame;

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

        // Opacity: calm zones are faint blue, strong wind is more opaque
        const fadeIn = Math.min(1, p.age / 15);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 30);
        const speedAlpha = p.speed < 3 ? 0.08 : p.speed < 8 ? 0.15 : p.speed < 18 ? 0.25 : 0.4;
        const alpha = fadeIn * fadeOut * speedAlpha;
        if (alpha < 0.01) continue;

        // Full trail length for everyone
        const drawLen = Math.min(p.len, TRAIL_LEN);
        if (drawLen < 2) continue;

        ctx.strokeStyle = `${windColor(p.speed)}${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();

        let started = false;
        const oldest = (p.head - drawLen + 1 + TRAIL_LEN) % TRAIL_LEN;
        for (let s = 0; s < drawLen; s++) {
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
