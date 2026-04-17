// apps/web/src/components/play/WindOverlay.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { getPointsAtTime } from '@/lib/weather/mockGrid';
import { interpolateWind } from '@/lib/weather/interpolate';

const PARTICLE_COUNT = 3000;
const FADE_RATE = 0.97;

interface Particle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

function windSpeedColor(speed: number): string {
  if (speed < 8) return 'rgba(108,210,138,0.6)';   // green — light
  if (speed < 15) return 'rgba(201,216,96,0.6)';    // yellow-green
  if (speed < 22) return 'rgba(240,185,107,0.6)';   // orange
  if (speed < 30) return 'rgba(217,119,6,0.6)';     // dark orange
  return 'rgba(158,42,42,0.6)';                      // red — storm
}

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  const windVisible = useGameStore((s) => s.layers.wind);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas to container
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Initialize particles
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        age: Math.floor(Math.random() * 100),
        maxAge: 80 + Math.floor(Math.random() * 60),
      });
    }
    particlesRef.current = particles;

    const animate = () => {
      const store = useGameStore.getState();
      const grid = store.weather.gridData;
      if (!grid || !ctx) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const time = store.timeline.currentTime.getTime();
      const points = getPointsAtTime(grid, time);
      const { width, height } = canvas;

      // Fade existing content
      ctx.fillStyle = `rgba(6,11,24,${1 - FADE_RATE})`;
      ctx.fillRect(0, 0, width, height);

      // Get map bounds (approximate — map center + zoom)
      const mapState = store.map;
      const [cLon, cLat] = mapState.center;
      const span = 180 / Math.pow(2, mapState.zoom); // approximate degrees visible
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMin = cLat - span * 0.6;
      const latMax = cLat + span * 0.6;

      for (const p of particles) {
        // Convert pixel to geo
        const lon = lonMin + (p.x / width) * (lonMax - lonMin);
        const lat = latMax - (p.y / height) * (latMax - latMin);

        // Get wind at this position
        const wind = interpolateWind(points, lat, lon);
        const speed = wind.tws;

        // Move particle by wind vector (scaled)
        const scale = 0.3 + speed * 0.08;
        const toRad = Math.PI / 180;
        const dx = -Math.sin(wind.twd * toRad) * scale;
        const dy = Math.cos(wind.twd * toRad) * scale;

        p.x += dx;
        p.y += dy;
        p.age++;

        // Reset if out of bounds or too old
        if (p.age > p.maxAge || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.age = 0;
          p.maxAge = 80 + Math.floor(Math.random() * 60);
        }

        // Draw
        const alpha = Math.min(1, (p.maxAge - p.age) / 20, p.age / 10);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = windSpeedColor(speed);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
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
