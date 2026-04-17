'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mapInstance } from './MapCanvas';
import { useGameStore } from '@/lib/store';
import { interpolateGfsWind } from '@/lib/weather/gfsParser';
import styles from './CursorTooltip.module.css';

interface CursorData {
  x: number;
  y: number;
  lat: number;
  lon: number;
  tws: number;
  twd: number;
}

function formatDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(2);
  const dir = isLat
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'O');
  return `${deg}°${min}'${dir}`;
}

export default function CursorTooltip(): React.ReactElement | null {
  const [data, setData] = useState<CursorData | null>(null);
  const [mapReady, setMapReady] = useState(!!mapInstance);
  const rafRef = useRef(0);
  const lastEvent = useRef<{ mapX: number; mapY: number; clientX: number; clientY: number } | null>(null);

  // Wait for mapInstance to be available (dynamic import)
  useEffect(() => {
    if (mapReady) return;
    const id = setInterval(() => {
      if (mapInstance) {
        setMapReady(true);
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, [mapReady]);

  const compute = useCallback(() => {
    const ev = lastEvent.current;
    if (!ev || !mapInstance) return;

    const lngLat = mapInstance.unproject([ev.mapX, ev.mapY]);
    const grid = useGameStore.getState().weather.gridData;

    let tws = 0;
    let twd = 0;
    if (grid) {
      const wind = interpolateGfsWind(grid, lngLat.lat, lngLat.lng);
      tws = wind.tws;
      twd = wind.twd;
    }

    setData({
      x: ev.clientX,
      y: ev.clientY,
      lat: lngLat.lat,
      lon: lngLat.lng,
      tws,
      twd,
    });
  }, []);

  useEffect(() => {
    if (!mapReady || !mapInstance) return;

    const mapContainer = mapInstance.getContainer();
    if (!mapContainer) return;

    const onMove = (e: MouseEvent) => {
      const rect = mapContainer.getBoundingClientRect();
      lastEvent.current = {
        mapX: e.clientX - rect.left,
        mapY: e.clientY - rect.top,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          compute();
          rafRef.current = 0;
        });
      }
    };

    const onLeave = () => {
      lastEvent.current = null;
      setData(null);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    mapContainer.addEventListener('mousemove', onMove);
    mapContainer.addEventListener('mouseleave', onLeave);

    return () => {
      mapContainer.removeEventListener('mousemove', onMove);
      mapContainer.removeEventListener('mouseleave', onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [mapReady, compute]);

  if (!data) return null;

  return (
    <div
      className={styles.tooltip}
      style={{ left: data.x, top: data.y }}
    >
      <div className={styles.row}>
        <span className={styles.label}>Pos</span>
        <span className={styles.value}>
          {formatDMS(data.lat, true)} {formatDMS(data.lon, false)}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Dir</span>
        <span className={styles.value}>{Math.round(data.twd)}°</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>TWS</span>
        <span className={styles.value}>{data.tws.toFixed(1)} kn</span>
      </div>
    </div>
  );
}
