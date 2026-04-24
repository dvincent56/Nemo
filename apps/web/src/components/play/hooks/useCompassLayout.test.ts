import { describe, it, expect } from 'vitest';
import { pickCompassLayout } from './useCompassLayout';

describe('pickCompassLayout', () => {
  it('desktop landscape → stack-vertical', () => {
    expect(pickCompassLayout(1080, 1920)).toBe('stack-vertical');
  });

  it('tablet portrait → stack-vertical', () => {
    expect(pickCompassLayout(1024, 768)).toBe('stack-vertical');
  });

  it('boundary at 480px height → stack-vertical', () => {
    expect(pickCompassLayout(480, 1024)).toBe('stack-vertical');
  });

  it('tablet landscape short → bar-horizontal', () => {
    expect(pickCompassLayout(400, 1024)).toBe('bar-horizontal');
  });

  it('boundary 360×720 → bar-horizontal', () => {
    expect(pickCompassLayout(360, 720)).toBe('bar-horizontal');
  });

  it('mobile landscape (height<360) → side-by-side', () => {
    expect(pickCompassLayout(350, 800)).toBe('side-by-side');
  });

  it('wide but too short for horizontal bar → side-by-side', () => {
    expect(pickCompassLayout(359, 2000)).toBe('side-by-side');
  });

  it('height ok but width too narrow for horizontal bar → side-by-side', () => {
    expect(pickCompassLayout(400, 600)).toBe('side-by-side');
  });

  it('very small → side-by-side', () => {
    expect(pickCompassLayout(300, 400)).toBe('side-by-side');
  });
});
