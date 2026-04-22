import { describe, it, expect } from 'vitest';
import { interpolateWind } from '../interpolate';
import { generateMockWeatherGrid } from '../mockGrid';

describe('interpolateWind — out of grid', () => {
  it('returns zero wind for a lat/lon outside the grid bounds', () => {
    const grid = generateMockWeatherGrid(); // Atlantic-only mock
    const w = interpolateWind(grid.points, /*lat*/ 20, /*lon*/ 70); // Indian Ocean
    expect(w.tws).toBe(0);
  });

  it('returns non-zero wind for a lat/lon inside the grid bounds', () => {
    const grid = generateMockWeatherGrid();
    const w = interpolateWind(grid.points, /*lat*/ 45, /*lon*/ -10); // inside
    expect(w.tws).toBeGreaterThan(0);
  });
});
