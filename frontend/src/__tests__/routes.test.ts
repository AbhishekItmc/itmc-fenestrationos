import { describe, expect, it } from 'vitest';
import { isAppPath, LEGACY_APP_PATHS, legacyRedirect } from '../routes';

describe('legacy application URL redirects', () => {
  it('maps every old top-level app path to /app/...', () => {
    const cases: [string, string][] = [
      ['/projects', '/app/projects'],
      ['/projects/7', '/app/projects/7'],
      ['/editor', '/app/editor'],
      ['/editor/11', '/app/editor/11'],
      ['/cutting', '/app/cutting'],
      ['/nesting', '/app/nesting'],
      ['/production', '/app/production'],
      ['/production/3', '/app/production/3'],
      ['/production/3/labels', '/app/production/3/labels'],
      ['/station', '/app/station'],
      ['/purchasing', '/app/purchasing'],
      ['/inventory', '/app/inventory'],
      ['/quotes', '/app/quotes'],
      ['/quotations', '/app/quotes'],
      ['/reports', '/app/reports'],
      ['/admin', '/app/admin'],
      ['/catalogue', '/app/catalogue'],
      ['/glass', '/app/glass'],
      ['/calc', '/app/calc'],
      ['/login', '/app'],
    ];
    for (const [from, to] of cases) expect(legacyRedirect(from), from).toBe(to);
    // every map entry is exercised
    for (const k of Object.keys(LEGACY_APP_PATHS)) expect(cases.some(([f]) => f === k), k).toBe(true);
  });

  it('keeps query string and hash, ignores a trailing slash', () => {
    expect(legacyRedirect('/production/3/labels', '?layout=a4-8', '#top')).toBe('/app/production/3/labels?layout=a4-8#top');
    expect(legacyRedirect('/cutting/')).toBe('/app/cutting');
    expect(legacyRedirect('/login', '?next=x')).toBe('/app?next=x');
  });

  it('does not touch website, app or QR paths', () => {
    for (const p of ['/', '/solutions', '/solutions/cutting-nesting', '/pricing', '/about', '/contact', '/privacy', '/terms', '/app', '/app/editor/11', '/p/K7M2QX9A', '/projectsX', '/editorial', '/stations'])
      expect(legacyRedirect(p), p).toBeNull();
  });

  it('classifies app vs website paths', () => {
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/app/cutting')).toBe(true);
    expect(isAppPath('/p/K7M2QX9A')).toBe(true);
    expect(isAppPath('/')).toBe(false);
    expect(isAppPath('/apple')).toBe(false);
    expect(isAppPath('/solutions/production-tracking')).toBe(false);
    expect(isAppPath('/pricing')).toBe(false);
  });
});
