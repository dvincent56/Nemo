import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCorsAllowlist } from './cors-allowlist.js';

describe('parseCorsAllowlist', () => {
  it('parses a single origin', () => {
    assert.deepEqual(parseCorsAllowlist('http://localhost:3000'), ['http://localhost:3000']);
  });
  it('parses comma-separated origins, trimmed', () => {
    assert.deepEqual(
      parseCorsAllowlist('http://localhost:3000, https://nemo.example.com'),
      ['http://localhost:3000', 'https://nemo.example.com'],
    );
  });
  it('rejects "*" wildcard', () => {
    assert.throws(() => parseCorsAllowlist('*'), /wildcard not allowed/);
  });
  it('rejects an origin without scheme', () => {
    assert.throws(() => parseCorsAllowlist('nemo.example.com'), /must start with http/);
  });
  it('rejects empty input', () => {
    assert.throws(() => parseCorsAllowlist(''), /empty/);
  });
  it('strips trailing slashes', () => {
    assert.deepEqual(parseCorsAllowlist('https://nemo.example.com/'), ['https://nemo.example.com']);
  });
});
