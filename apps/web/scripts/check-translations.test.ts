import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { extractUsedKeys, validateTranslations } from './check-translations';

const FIXTURES = resolve(__dirname, '__fixtures__');

describe('extractUsedKeys', () => {
  it('extrait clé namespace.key depuis useTranslations + t()', () => {
    const keys = extractUsedKeys(join(FIXTURES, 'missing/src'));
    expect(keys).toContainEqual({ ns: 'marina', key: 'title' });
    expect(keys).toContainEqual({ ns: 'marina', key: 'newButton' });
  });

  it('gère plusieurs useTranslations dans un même fichier', () => {
    const keys = extractUsedKeys(join(FIXTURES, 'multi-ns/src'));
    expect(keys).toContainEqual({ ns: 'marina', key: 'title' });
    expect(keys).toContainEqual({ ns: 'common', key: 'save' });
    expect(keys).not.toContainEqual({ ns: 'marina', key: 'save' });
    expect(keys).not.toContainEqual({ ns: 'common', key: 'title' });
  });

  it('extrait events.code depuis tEvent()', () => {
    const keys = extractUsedKeys(join(FIXTURES, 'event-codes/src'));
    expect(keys).toContainEqual({ ns: 'events', key: 'wind-shift' });
  });
});

describe('validateTranslations', () => {
  it('échoue si une clé utilisée est absente d\'une locale', () => {
    const result = validateTranslations({
      messagesDir: join(FIXTURES, 'missing/messages'),
      srcDir: join(FIXTURES, 'missing/src'),
      locales: ['fr', 'en'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('marina.newButton'))).toBe(true);
  });

  it('échoue si une clé manque dans une locale autre que fr (incohérence)', () => {
    const result = validateTranslations({
      messagesDir: join(FIXTURES, 'inconsistent/messages'),
      srcDir: join(FIXTURES, 'inconsistent/src'),  // src vide ok
      locales: ['fr', 'en'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('common.cancel') && e.includes('en'))).toBe(true);
  });

  it('warn (sans fail) sur les clés orphelines', () => {
    const result = validateTranslations({
      messagesDir: join(FIXTURES, 'orphan/messages'),
      srcDir: join(FIXTURES, 'orphan/src'),
      locales: ['fr', 'en'],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('marina.unused'))).toBe(true);
  });
});
