'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { mapInstance } from './MapCanvas';
import { useGameStore } from '@/lib/store';
import { sampleDecodedWindAtTime } from '@/lib/weather/gridFromBinary';
import { tileMaxValidMs } from '@/lib/weather/tacticalTile';
import { haversinePosNM } from '@/lib/geo';
import { formatDMS } from './formatDMS';
import styles from './CursorTooltip.module.css';

interface CursorData {
  x: number;
  y: number;
  lat: number;
  lon: number;
  tws: number;
  twd: number;
  swellHeight: number;
  swellDir: number;
  swellPeriod: number;
  dtuNm: number | null;
}

export default function CursorTooltip(): React.ReactElement | null {
  const t = useTranslations('play.cursor');
  const [data, setData] = useState<CursorData | null>(null);
  const [mapReady, setMapReady] = useState(!!mapInstance);
  const rafRef = useRef(0);
  const lastEvent = useRef<{ mapX: number; mapY: number; clientX: number; clientY: number } | null>(null);
  const swellOn = useGameStore((s) => s.layers.swell);
  const windOn = useGameStore((s) => s.layers.wind);
  const currentTimeMs = useGameStore((s) => s.timeline.currentTime.getTime());
  const isLive = useGameStore((s) => s.timeline.isLive);
  const boatLat = useGameStore((s) => s.hud.lat);
  const boatLon = useGameStore((s) => s.hud.lon);

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
    const state = useGameStore.getState();
    const weatherState = state.weather;
    const decoded = weatherState.decodedGrid;
    const grid = weatherState.gridData;
    // Sample at the scrubbed timeline — when the user previews t+12h we want
    // the tooltip to show the forecast wind, not "now".
    const targetMs = state.timeline.isLive
      ? Date.now()
      : state.timeline.currentTime.getTime();

    let tws = 0;
    let twd = 0;
    let swellHeight = 0;
    let swellDir = 0;
    let swellPeriod = 0;
    // Wind: prefer the 0.25° tactical tile when the cursor is inside it AND
    // the scrubbed time is within the tile's temporal horizon (24h today). The
    // engine reads weather at the boat from the same 0.25° NOAA grid, so
    // sampling from the global 1° decimated grid here would misalign the HUD
    // and tooltip by ~1 kt in zones with wind gradient. Fall back to the 1°
    // grid when the cursor is outside the tile, or beyond its horizon.
    const tile = weatherState.tacticalTile;
    const cursorInTile = tile !== null
      && lngLat.lat >= tile.bounds.latMin && lngLat.lat <= tile.bounds.latMax
      && lngLat.lng >= tile.bounds.lonMin && lngLat.lng <= tile.bounds.lonMax;
    const tileTemporallyValid = tile !== null && targetMs <= tileMaxValidMs(tile.decoded);
    if (cursorInTile && tileTemporallyValid && tile) {
      const wind = sampleDecodedWindAtTime(tile.decoded, lngLat.lat, lngLat.lng, targetMs);
      tws = wind.tws;
      twd = wind.twd;
    } else if (decoded) {
      const wind = sampleDecodedWindAtTime(decoded, lngLat.lat, lngLat.lng, targetMs);
      tws = wind.tws;
      twd = wind.twd;
    }
    // Swell: the 2D snapshot is good enough (no sub-hour evolution visible
    // at the UI cadence) and saves a second temporal interp pass.
    if (grid) {
      let swellLon = lngLat.lng;
      if (swellLon < grid.bounds.west) swellLon += 360;
      const gy = Math.max(0, Math.min(grid.rows - 1, Math.floor((lngLat.lat - grid.bounds.south) / grid.resolution)));
      const gx = Math.max(0, Math.min(grid.cols - 1, Math.floor((swellLon - grid.bounds.west) / grid.resolution)));
      const nearest = grid.points[gy * grid.cols + gx];
      if (nearest) {
        swellHeight = nearest.swellHeight;
        swellDir = nearest.swellDir;
        swellPeriod = nearest.swellPeriod;
      }
    }

    const bLat = state.hud.lat;
    const bLon = state.hud.lon;
    const dtuNm =
      typeof bLat === 'number' && typeof bLon === 'number'
        ? haversinePosNM({ lat: bLat, lon: bLon }, { lat: lngLat.lat, lon: lngLat.lng })
        : null;

    setData({
      x: ev.clientX,
      y: ev.clientY,
      lat: lngLat.lat,
      lon: lngLat.lng,
      tws,
      twd,
      swellHeight,
      swellDir,
      swellPeriod,
      dtuNm,
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

  // Re-sample the cursor wind when the timeline scrubs even if the mouse
  // stays still — otherwise the displayed value would lag the timeline.
  // Boat lat/lon are deps too so DTU stays in sync as the boat moves under a
  // stationary cursor.
  useEffect(() => {
    if (lastEvent.current) compute();
  }, [currentTimeMs, isLive, boatLat, boatLon, compute]);

  if (!data) return null;

  return (
    <div
      className={styles.tooltip}
      style={{ left: data.x, top: data.y }}
    >
      <div className={styles.row}>
        <span className={styles.label}>{t('pos')}</span>
        <span className={styles.value}>
          {formatDMS(data.lat, true)} {formatDMS(data.lon, false)}
        </span>
      </div>
      {data.dtuNm !== null && (
        <div className={styles.row}>
          <span className={styles.label}>{t('dtu')}</span>
          <span className={styles.value}>
            {data.dtuNm < 0.1
              ? data.dtuNm.toFixed(3)
              : data.dtuNm < 10
                ? data.dtuNm.toFixed(1)
                : Math.round(data.dtuNm).toLocaleString('fr-FR')} NM
          </span>
        </div>
      )}
      {swellOn && !windOn ? (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t('dir')}</span>
            <span className={styles.value}>{Math.round(data.swellDir)}°</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('swh')}</span>
            <span className={styles.value}>{data.swellHeight.toFixed(1)} m · {data.swellPeriod.toFixed(0)}s</span>
          </div>
        </>
      ) : (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t('dir')}</span>
            <span className={styles.value}>{Math.round(data.twd)}°</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('tws')}</span>
            <span className={styles.value}>{data.tws.toFixed(1)} kn</span>
          </div>
          {swellOn && (
            <div className={styles.row}>
              <span className={styles.label}>{t('swh')}</span>
              <span className={styles.value}>{data.swellHeight.toFixed(1)} m · {data.swellPeriod.toFixed(0)}s</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
