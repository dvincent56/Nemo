import { describe, it, expect } from 'vitest';
import {
  selectTimelineBounds,
  selectGhostPosition,
  selectWeatherLayerVisible,
} from './timeline-selectors';

const baseTrack = [
  { ts: 1000, lat: 47.0, lon: -3.0, rank: 100 },
  { ts: 2000, lat: 48.0, lon: -3.5, rank: 80 },
  { ts: 3000, lat: 49.0, lon: -4.0, rank: 60 },
];

describe('selectTimelineBounds', () => {
  it('LIVE: minMs = raceStartMs, maxMs = forecastEndMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 1000, raceEndMs: null, forecastEndMs: 9999, status: 'LIVE' });
    expect(b).toEqual({ minMs: 1000, maxMs: 9999 });
  });
  it('FINISHED: maxMs = raceEndMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 1000, raceEndMs: 5000, forecastEndMs: 9999, status: 'FINISHED' });
    expect(b).toEqual({ minMs: 1000, maxMs: 5000 });
  });
  it('BRIEFING: minMs = nowMs, maxMs = forecastEndMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 5000, raceEndMs: null, forecastEndMs: 9999, status: 'BRIEFING', nowMs: 100 });
    expect(b).toEqual({ minMs: 100, maxMs: 9999 });
  });
});

describe('selectGhostPosition', () => {
  it('returns null when isLive', () => {
    expect(selectGhostPosition({
      currentTimeMs: 2000, isLive: true, nowMs: 5000, track: baseTrack, projection: null,
    })).toBeNull();
  });

  it('lerps between two adjacent past points', () => {
    const g = selectGhostPosition({
      currentTimeMs: 1500, isLive: false, nowMs: 5000, track: baseTrack, projection: null,
    });
    expect(g).not.toBeNull();
    expect(g!.lat).toBeCloseTo(47.5, 5);
    expect(g!.lon).toBeCloseTo(-3.25, 5);
  });

  it('clamps to first track point if currentTime < earliest', () => {
    const g = selectGhostPosition({
      currentTimeMs: 500, isLive: false, nowMs: 5000, track: baseTrack, projection: null,
    });
    expect(g).not.toBeNull();
    expect(g!.lat).toBe(47.0);
    expect(g!.lon).toBe(-3.0);
  });

  it('clamps to last track point if currentTime > latest (and currentTime <= now)', () => {
    const g = selectGhostPosition({
      currentTimeMs: 4500, isLive: false, nowMs: 5000, track: baseTrack, projection: null,
    });
    expect(g).not.toBeNull();
    expect(g!.lat).toBe(49.0);
    expect(g!.lon).toBe(-4.0);
  });

  it('uses projection points when currentTime > now', () => {
    const projection = [
      { dtMs: 0, lat: 50.0, lon: -5.0 },
      { dtMs: 1000, lat: 51.0, lon: -5.5 },
    ];
    const g = selectGhostPosition({
      currentTimeMs: 5500, isLive: false, nowMs: 5000, track: baseTrack, projection,
    });
    expect(g).not.toBeNull();
    expect(g!.lat).toBeCloseTo(50.5, 5);
    expect(g!.lon).toBeCloseTo(-5.25, 5);
  });

  it('returns null in future when projection is empty', () => {
    expect(selectGhostPosition({
      currentTimeMs: 5500, isLive: false, nowMs: 5000, track: baseTrack, projection: [],
    })).toBeNull();
  });

  it('derives heading via great-circle bearing between adjacent points', () => {
    const g = selectGhostPosition({
      currentTimeMs: 1500, isLive: false, nowMs: 5000, track: baseTrack, projection: null,
    });
    // baseTrack[0] = (47.0, -3.0), baseTrack[1] = (48.0, -3.5) → bearing roughly NW (~340°)
    expect(g).not.toBeNull();
    expect(g!.hdg).toBeGreaterThan(330);
    expect(g!.hdg).toBeLessThan(360);
  });
});

describe('selectWeatherLayerVisible', () => {
  it('true when currentTime >= now', () => {
    expect(selectWeatherLayerVisible({ currentTimeMs: 5000, nowMs: 5000 })).toBe(true);
    expect(selectWeatherLayerVisible({ currentTimeMs: 6000, nowMs: 5000 })).toBe(true);
  });
  it('false when currentTime < now', () => {
    expect(selectWeatherLayerVisible({ currentTimeMs: 4000, nowMs: 5000 })).toBe(false);
  });
});

