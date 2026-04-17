'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { getPointsAtTime } from '@/lib/weather/mockGrid';
import { interpolateWind } from '@/lib/weather/interpolate';

/**
 * Lightweight wind particle overlay — canvas with transparent background.
 * Particles are small dots that drift with the wind, colored by speed.
 * Uses clearRect each frame so the map underneath stays fully visible.
 */

const PARTICLE_COUNT = 1500;

interface Particle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

/** Speed-based color: green (light) → yellow → orange → red (storm) */
function windColor(speed: number, alpha: number): string {
  if (speed < 8) return `rgba(108,210,138,${alpha})`;
  if (speed < 15) return `rgba(180,210,80,${alpha})`;
  if (speed < 22) return `rgba(240,185,107,${alpha})`;
  if (speed < 30) return `rgba(217,119,6,${alpha})`;
  return `rgba(180,50,50,${alpha})`;
}

function resetParticle(p: Particle, w: number, h: number): void {
  p.x = Math.random() * w;
  p.y = Math.random() * h;
  p.age = 0;
  p.maxAge = 40 + Math.floor(Math.random() * 40);
}

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const windVisible = useGameStore((s) => s.layers.wind);
  const hasGrid = useGameStore((s) => s.weather.gridData !== null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible || !hasGrid) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      // Clear canvas when turning off
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
      particles.push({ x: 0, y: 0, age: 0, maxAge: 0 });
      resetParticle(particles[i]!, canvas.width, canvas.height);
      // Stagger initial ages so particles don't all appear at once
      particles[i]!.age = Math.floor(Math.random() * particles[i]!.maxAge);
    }

    const animate = () => {
      const store = useGameStore.getState();
      const grid = store.weather.gridData;
      if (!grid) { animRef.current = requestAnimationFrame(animate); return; }

      const time = store.timeline.currentTime.getTime();
      const points = getPointsAtTime(grid, time);
      const { width, height } = canvas;

      // Fully clear — map visible underneath
      ctx.clearRect(0, 0, width, height);

      // Approximate geo bounds from map state
      const [cLon, cLat] = store.map.center;
      const span = 180 / Math.pow(2, store.map.zoom);
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMin = cLat - span * 0.6;
      const latMax = cLat + span * 0.6;

      for (const p of particles) {
        // Geo position of this pixel
        const lon = lonMin + (p.x / width) * (lonMax - lonMin);
        const lat = latMax - (p.y / height) * (latMax - latMin);

        const wind = interpolateWind(points, lat, lon);
        const speed = wind.tws;

        // Move: small displacement per frame
        const toRad = Math.PI / 180;
        const scale = 0.15 + speed * 0.04;
        p.x += -Math.sin(wind.twd * toRad) * scale;
        p.y += Math.cos(wind.twd * toRad) * scale;
        p.age++;

        // Reset if dead or off-screen
        if (p.age > p.maxAge || p.x < -5 || p.x > width + 5 || p.y < -5 || p.y > height + 5) {
          resetParticle(p, width, height);
          continue; // don't draw the reset frame
        }

        // Fade in/out
        const fadeIn = Math.min(1, p.age / 6);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 10);
        const alpha = fadeIn * fadeOut * 0.6;
        if (alpha < 0.02) continue;

        // Draw a small dot (not a line — avoids the "thick strokes" problem)
        const radius = speed > 20 ? 1.5 : 1;
        ctx.fillStyle = windColor(speed, alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [windVisible, hasGrid]);

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
