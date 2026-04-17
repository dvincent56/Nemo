'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { parseGfsWind, interpolateGfsWind } from '@/lib/weather/gfsParser';
import type { WeatherGrid } from '@/lib/store/types';

/**
 * Wind particle overlay using real GFS data.
 * Loads /data/wind.json (grib2json format), parses it, and animates
 * particles that follow the actual wind field.
 */

const PARTICLE_COUNT = 2500;

interface Particle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

function windColor(speed: number, alpha: number): string {
  if (speed < 5) return `rgba(98,180,230,${alpha})`;    // very light — pale blue
  if (speed < 10) return `rgba(108,210,138,${alpha})`;   // light — green
  if (speed < 18) return `rgba(200,210,80,${alpha})`;    // moderate — yellow-green
  if (speed < 25) return `rgba(240,185,107,${alpha})`;   // fresh — orange
  if (speed < 35) return `rgba(217,119,6,${alpha})`;     // strong — dark orange
  return `rgba(180,50,50,${alpha})`;                      // storm — red
}

function resetParticle(p: Particle, w: number, h: number): void {
  p.x = Math.random() * w;
  p.y = Math.random() * h;
  p.age = 0;
  p.maxAge = 50 + Math.floor(Math.random() * 50);
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
      const p: Particle = { x: 0, y: 0, age: 0, maxAge: 0 };
      resetParticle(p, canvas.width, canvas.height);
      p.age = Math.floor(Math.random() * p.maxAge); // stagger
      particles.push(p);
    }

    const animate = () => {
      const grid = gridRef.current;
      if (!grid) {
        // Data not loaded yet — retry next frame
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Get map bounds from store
      const mapState = useGameStore.getState().map;
      const [cLon, cLat] = mapState.center;
      const span = 180 / Math.pow(2, mapState.zoom);
      const aspectRatio = height / width;
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMin = cLat - span * aspectRatio;
      const latMax = cLat + span * aspectRatio;

      for (const p of particles) {
        // Pixel → geo
        const lon = lonMin + (p.x / width) * (lonMax - lonMin);
        const lat = latMax - (p.y / height) * (latMax - latMin);

        // Interpolate real wind at this position
        const wind = interpolateGfsWind(grid, lat, lon);
        const speed = wind.tws;

        // Move particle following wind
        const toRad = Math.PI / 180;
        const scale = 0.08 + speed * 0.03;
        p.x += -Math.sin(wind.twd * toRad) * scale;
        p.y += Math.cos(wind.twd * toRad) * scale;
        p.age++;

        if (p.age > p.maxAge || p.x < -10 || p.x > width + 10 || p.y < -10 || p.y > height + 10) {
          resetParticle(p, width, height);
          continue;
        }

        // Fade in/out
        const fadeIn = Math.min(1, p.age / 8);
        const fadeOut = Math.min(1, (p.maxAge - p.age) / 12);
        const alpha = fadeIn * fadeOut * 0.55;
        if (alpha < 0.02) continue;

        // Draw small dot
        const radius = speed > 25 ? 1.5 : 1;
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
