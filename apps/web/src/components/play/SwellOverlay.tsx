// apps/web/src/components/play/SwellOverlay.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { getPointsAtTime } from '@/lib/weather/mockGrid';
import { interpolateSwell } from '@/lib/weather/interpolate';

function swellColor(height: number): [number, number, number, number] {
  // 0m = transparent, 1m = blue, 2m = cyan, 3m = yellow, 4m+ = red
  if (height < 0.3) return [0, 0, 0, 0];
  if (height < 1) return [40, 80, 160, 60];      // blue
  if (height < 2) return [60, 160, 180, 80];      // cyan
  if (height < 3) return [200, 180, 60, 80];      // yellow
  if (height < 4) return [220, 140, 40, 90];      // orange
  return [180, 50, 50, 100];                       // red
}

export default function SwellOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swellVisible = useGameStore((s) => s.layers.swell);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !swellVisible) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    const render = () => {
      const store = useGameStore.getState();
      const grid = store.weather.gridData;
      if (!grid) return;

      const time = store.timeline.currentTime.getTime();
      const points = getPointsAtTime(grid, time);
      const { width, height } = canvas;

      const mapState = store.map;
      const [cLon, cLat] = mapState.center;
      const span = 180 / Math.pow(2, mapState.zoom);
      const lonMin = cLon - span;
      const lonMax = cLon + span;
      const latMin = cLat - span * 0.6;
      const latMax = cLat + span * 0.6;

      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;
      const step = 4; // sample every 4 pixels for performance

      for (let py = 0; py < height; py += step) {
        for (let px = 0; px < width; px += step) {
          const lon = lonMin + (px / width) * (lonMax - lonMin);
          const lat = latMax - (py / height) * (latMax - latMin);
          const swell = interpolateSwell(points, lat, lon);
          const [r, g, b, a] = swellColor(swell.height);

          // Fill step x step block
          for (let dy = 0; dy < step && py + dy < height; dy++) {
            for (let dx = 0; dx < step && px + dx < width; dx++) {
              const idx = ((py + dy) * width + (px + dx)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = a;
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
    };

    render();

    // Re-render when timeline or map changes
    const unsub = useGameStore.subscribe((s, prev) => {
      if (
        s.timeline.currentTime !== prev.timeline.currentTime ||
        s.map.center !== prev.map.center ||
        s.map.zoom !== prev.map.zoom
      ) {
        render();
      }
    });

    const onResize = () => {
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      render();
    };
    window.addEventListener('resize', onResize);

    return () => {
      unsub();
      window.removeEventListener('resize', onResize);
    };
  }, [swellVisible]);

  if (!swellVisible) return <></>;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
        opacity: 0.6,
      }}
    />
  );
}
