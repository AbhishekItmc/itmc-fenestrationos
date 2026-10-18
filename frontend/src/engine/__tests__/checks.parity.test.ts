import { describe, expect, it } from 'vitest';
import type { Elevation, Issue } from '../../api/types';
import { DEMO_CATALOGUE } from '../catalogue';
import { DESIGN_CHECK_SUFFIX, mullionSpans, runDesignChecks } from '../checks';
import { makeGrid } from '../elevation';
import cases from '../__fixtures__/checks_cases.json';

const fixtures = cases as unknown as { name: string; elevation: Elevation; issues: Issue[] }[];

describe('design checks parity with backend/app/engines/checks.py', () => {
  it.each(fixtures.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(runDesignChecks(c.elevation, DEMO_CATALOGUE)).toEqual(c.issues.map((i) => ({ ...i, ref: i.ref ?? null })));
  });
  it('fixtures cover every warning code', () => {
    const codes = new Set(fixtures.flatMap((c) => c.issues.map((i) => i.code)));
    for (const k of ['GLASS_WEIGHT_HIGH', 'FIELD_AREA_HIGH', 'FIELD_ASPECT_HIGH', 'MULLION_SPAN_HIGH', 'ANCHORS_MISSING', 'NO_COLOUR_SELECTED']) expect(codes).toContain(k);
  });
});

describe('design checks', () => {
  it('warnings only, each with the demo suffix', () => {
    const e = makeGrid(6000, 4000, 1, 1, { system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-28', anchor_levels: [] });
    const out = runDesignChecks(e, DEMO_CATALOGUE);
    expect(out.length).toBeGreaterThan(3);
    for (const i of out) {
      expect(i.severity).toBe('warning');
      expect(i.message.endsWith(DESIGN_CHECK_SUFFIX)).toBe(true);
    }
  });
  it('skips invalid geometry', () => {
    const e = makeGrid(3000, 3000, 2, 1, { system_id: 'ser-cw50' });
    e.mullions = [0, 3200, 3000];
    expect(runDesignChecks(e, DEMO_CATALOGUE)).toEqual([]);
  });
  it('mullion spans include the cantilevers', () => {
    expect(mullionSpans(makeGrid(3000, 9000, 1, 1, { anchor_levels: [1000, 5000] }))).toEqual([1000, 4000, 4000]);
    expect(mullionSpans(makeGrid(3000, 9000, 1, 1, { anchor_levels: [] }))).toEqual([9000]);
  });
});
