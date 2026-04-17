'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { WindGL } from '@/lib/wind/WindGL';
import type { WindData } from '@/lib/wind/WindGL';

/**
 * GPU-accelerated wind particle overlay using mapbox/webgl-wind.
 *
 * Renders wind particles in equirectangular projection covering the full
 * viewport. The canvas sits on top of the map with pointer-events: none.
 */
export default function WindOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const windRef = useRef<WindGL | null>(null);
  const animRef = useRef<number>(0);

  const windVisible = useGameStore((s) => s.layers.wind);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !windVisible) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    // Size canvas to parent
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    const gl = canvas.getContext('webgl', { antialiasing: false, premultipliedAlpha: false }) as WebGLRenderingContext | null;
    if (!gl) return;

    const wind = new WindGL(gl);
    wind.numParticles = 16384;
    windRef.current = wind;

    // Load wind data (PNG texture + JSON metadata)
    fetch('/data/2016112000.json')
      .then((res) => res.json())
      .then((windMeta: Omit<WindData, 'image'>) => {
        const img = new Image();
        img.src = '/data/2016112000.png';
        img.onload = () => {
          const windData: WindData = { ...windMeta, image: img };
          wind.setWind(windData);
        };
      });

    const frame = () => {
      if (wind.windData) {
        wind.draw();
      }
      animRef.current = requestAnimationFrame(frame);
    };
    animRef.current = requestAnimationFrame(frame);

    const onResize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      wind.resize();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', onResize);
      windRef.current = null;
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
        opacity: 0.35,
      }}
    />
  );
}
