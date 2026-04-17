'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { getPointsAtTime } from '@/lib/weather/mockGrid';
import { interpolateWind } from '@/lib/weather/interpolate';

const PARTICLE_COUNT = 2000;
interface Particle {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  age: number;
  maxAge: number;
}

function windSpeedColor(speed: number): string {
  if (speed < 8) return 'rgba(108,210,138,0.7)';
  if (speed < 15) return 'rgba(201,216,96,0.7)';
  if (speed < 22) return 'rgba(240,185,107,0.7)';
  if (speed < 30) return 'rgba(217,119,6,0.7)';
  return 'rgba(158,42,42,0.7)';
}

export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  const windVisible = useGameStore((s) => s.layers.wind);
  const hasGrid = useGameStore((s) => s.weather.gridData !== null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible || !hasGrid) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
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

    // Initialize particles
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      particles.push({
        x, y, prevX: x, prevY: y,
        age: Math.floor(Math.random() * 80),
        maxAge: 60 + Math.floor(Math.random() * 60),
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

      // CLEAR canvas each frame — map stays visible underneath
      ctx.clearRect(0, 0, width, height);

      const mapState = store.map;
      const [cLon, cLat] = mapState.center;
      const span = 180 / Math.pow(2, mapState.zoom);
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMin = cLat - span * 0.6;
      const latMax = cLat + span * 0.6;

      for (const p of particles) {
        const lon = lonMin + (p.x / width) * (lonMax - lonMin);
        const lat = latMax - (p.y / height) * (latMax - latMin);

        const wind = interpolateWind(points, lat, lon);
        const speed = wind.tws;

        // Save previous position
        p.prevX = p.x;
        p.prevY = p.y;

        // Move particle by wind vector
        const scale = 0.4 + speed * 0.1;
        const toRad = Math.PI / 180;
        p.x += -Math.sin(wind.twd * toRad) * scale;
        p.y += Math.cos(wind.twd * toRad) * scale;
        p.age++;

        // Reset if out of bounds or too old
        if (p.age > p.maxAge || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.prevX = p.x;
          p.prevY = p.y;
          p.age = 0;
          p.maxAge = 60 + Math.floor(Math.random() * 60);
        }

        // Draw trail line (not a fading fill — fully transparent background)
        const alpha = Math.min(0.8, (p.maxAge - p.age) / 20, p.age / 8);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = windSpeedColor(speed);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.prevX, p.prevY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
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
