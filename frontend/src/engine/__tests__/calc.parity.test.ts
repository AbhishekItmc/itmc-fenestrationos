import { describe, expect, it } from 'vitest';
import type { CalcResult, Elevation, Issue } from '../../api/types';
import { calculate } from '../calc';
import { DEMO_CATALOGUE } from '../catalogue';
import { validateElevation } from '../elevation';
import cases from '../__fixtures__/calc_cases.json';

interface Case {
  name: string;
  elevation: Elevation;
  result: CalcResult;
  issues_no_catalogue: Issue[];
}
const fixtures = cases as unknown as Case[];
const issueKey = (i: Issue) => `${i.code}|${i.severity}|${i.ref ?? ''}`;

describe('offline calc parity with the Python engine (fixtures from backend/app/engines/calc.py)', () => {
  it.each(fixtures.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = calculate(c.elevation, DEMO_CATALOGUE);
    const py = c.result;
    expect(r.validation_status).toBe(py.validation_status);
    expect(r.validation.passed).toBe(py.validation.passed);
    expect(r.issues.map(issueKey)).toEqual(py.issues.map(issueKey));
    expect(r.profile_cuts.map((x) => [x.mark, x.role, x.profile_id, x.quantity, x.position, x.formula])).toEqual(
      py.profile_cuts.map((x) => [x.mark, x.role, x.profile_id, x.quantity, x.position, x.formula]),
    );
    r.profile_cuts.forEach((x, i) => expect(x.length).toBeCloseTo(py.profile_cuts[i].length, 6));
    expect(r.glass_items.map((g) => [g.mark, g.field_key, g.fill_type, g.glass_type_id, g.panel_type_id ?? null, g.quantity, g.formula, g.description])).toEqual(
      py.glass_items.map((g) => [g.mark, g.field_key, g.fill_type, g.glass_type_id, g.panel_type_id ?? null, g.quantity, g.formula, g.description]),
    );
    r.glass_items.forEach((g, i) => {
      expect(g.width).toBeCloseTo(py.glass_items[i].width, 6);
      expect(g.height).toBeCloseTo(py.glass_items[i].height, 6);
      expect(g.area_m2).toBeCloseTo(py.glass_items[i].area_m2, 9);
    });
    expect(r.bom.map((b) => [b.item_type, b.item_id, b.code, b.unit, b.description])).toEqual(py.bom.map((b) => [b.item_type, b.item_id, b.code, b.unit, b.description]));
    r.bom.forEach((b, i) => expect(b.quantity).toBeCloseTo(py.bom[i].quantity, 6));
    expect(Object.keys(r.totals).sort()).toEqual(Object.keys(py.totals).sort());
    for (const [k, v] of Object.entries(py.totals)) expect(r.totals[k]).toBeCloseTo(v, 6);
  });

  it.each(fixtures.map((c) => [c.name, c] as const))('validate without catalogue: %s', (_n, c) => {
    expect(validateElevation(c.elevation, null).map(issueKey)).toEqual(c.issues_no_catalogue.map(issueKey));
  });

  it('labels every successful offline result as provisional and never VALIDATED with demo rules', () => {
    for (const c of fixtures) {
      const r = calculate(c.elevation, DEMO_CATALOGUE);
      expect(r.validation_status).not.toBe('VALIDATED');
      expect(r.engine_version).toContain('offline');
    }
  });
});
