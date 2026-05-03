import { describe, it, expect } from 'vitest';
import { routing, locales, defaultLocale } from './routing';

describe('i18n routing', () => {
  it('expose les 4 locales attendues', () => {
    expect(locales).toEqual(['fr', 'en', 'es', 'de']);
  });

  it('définit fr comme locale par défaut', () => {
    expect(defaultLocale).toBe('fr');
  });

  it('configure routing avec localePrefix always', () => {
    expect(routing.locales).toEqual(['fr', 'en', 'es', 'de']);
    expect(routing.defaultLocale).toBe('fr');
    expect(routing.localePrefix).toBe('always');
  });
});
