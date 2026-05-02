import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCareer } from './campaigns.helpers.js';

describe('isCareer', () => {
  const FUTURE = new Date(Date.now() + 24 * 3600 * 1000);
  const PAST = new Date(Date.now() - 24 * 3600 * 1000);

  it('returns true for tier CAREER (no trial)', () => {
    assert.equal(isCareer({ tier: 'CAREER', trialUntil: null }), true);
  });
  it('returns false for tier FREE with no trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: null }), false);
  });
  it('returns false for tier FREE with expired trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: PAST }), false);
  });
  it('returns true for tier FREE with active trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: FUTURE }), true);
  });
  it('returns true for tier CAREER even with expired trial', () => {
    assert.equal(isCareer({ tier: 'CAREER', trialUntil: PAST }), true);
  });
  it('accepts a custom now() for time-travel testing', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const trialUntil = new Date('2029-12-31T00:00:00Z');
    assert.equal(isCareer({ tier: 'FREE', trialUntil }, now), false);
  });
});
