import { describe, it, expect } from 'vitest';
import { isObsolete, MIN_LEAD_TIME_MS, validateLeadTime } from './obsolete';

const NOW = 1_000_000;

describe('MIN_LEAD_TIME_MS', () => {
  it('is 5 minutes', () => {
    expect(MIN_LEAD_TIME_MS).toBe(5 * 60 * 1000);
  });
});

describe('isObsolete', () => {
  it('AT_TIME in past → obsolete', () => {
    expect(isObsolete({ trigger: { type: 'AT_TIME', time: 900 } }, NOW, new Set())).toBe(true);
  });

  it('AT_TIME in future → not obsolete', () => {
    expect(isObsolete({ trigger: { type: 'AT_TIME', time: 2000 } }, NOW, new Set())).toBe(false);
  });

  it('AT_TIME exactly now → obsolete (<=)', () => {
    expect(isObsolete({ trigger: { type: 'AT_TIME', time: 1000 } }, NOW, new Set())).toBe(true);
  });

  it('AFTER_DURATION → never obsolete', () => {
    expect(isObsolete({ trigger: { type: 'AFTER_DURATION', duration: 120 } }, NOW, new Set())).toBe(false);
  });

  it('AT_WAYPOINT passed → obsolete', () => {
    const passed = new Set(['wp1']);
    expect(isObsolete({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'wp1' } }, NOW, passed)).toBe(true);
  });

  it('AT_WAYPOINT not yet passed → not obsolete', () => {
    const passed = new Set(['wp2']);
    expect(isObsolete({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'wp1' } }, NOW, passed)).toBe(false);
  });
});

describe('validateLeadTime', () => {
  it('AT_TIME with >5min lead is valid', () => {
    const r = validateLeadTime({ type: 'AT_TIME', time: NOW / 1000 + 360 }, NOW);
    expect(r.ok).toBe(true);
  });

  it('AT_TIME with <5min lead is invalid with explanatory error', () => {
    const r = validateLeadTime({ type: 'AT_TIME', time: NOW / 1000 + 120 }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5 min/);
  });

  it('AT_TIME exactly at 5min boundary is valid', () => {
    const r = validateLeadTime({ type: 'AT_TIME', time: NOW / 1000 + 300 }, NOW);
    expect(r.ok).toBe(true);
  });

  it('AFTER_DURATION with >5min is valid', () => {
    const r = validateLeadTime({ type: 'AFTER_DURATION', duration: 400 }, NOW);
    expect(r.ok).toBe(true);
  });

  it('AFTER_DURATION with <5min is invalid', () => {
    const r = validateLeadTime({ type: 'AFTER_DURATION', duration: 120 }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5 min/);
  });

  it('AT_WAYPOINT is always valid (checked elsewhere)', () => {
    const r = validateLeadTime({ type: 'AT_WAYPOINT', waypointOrderId: 'wp1' }, NOW);
    expect(r.ok).toBe(true);
  });
});
