'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { mapInstance } from '@/components/play/MapCanvas';
import { WindGL } from '@/lib/wind/WindGL';
import type { WindData } from '@/lib/wind/WindGL';

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

    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    const gl = canvas.getContext('webgl', { antialiasing: false, premultipliedAlpha: false }) as WebGLRenderingContext | null;
    if (!gl) return;

    const wind = new WindGL(gl);
    wind.numParticles = 32768;
    windRef.current = wind;

    // Load wind data
    fetch('/data/2016112000.json')
      .then((res) => res.json())
      .then((meta: Omit<WindData, 'image'>) => {
        const img = new Image();
        img.src = '/data/2016112000.png';
        img.onload = () => {
          wind.setWind({ ...meta, image: img });
        };
      });

    const frame = () => {
      const map = mapInstance;
      if (wind.windData && map) {
        const b = map.getBounds();
        wind.draw({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        });
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
        opacity: 0.45,
      }}
    />
  );
}
