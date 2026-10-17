import { describe, expect, it } from 'vitest';
import type { Nesting2DRequest, Nesting2DResult } from '../../api/types';
import { optimize2D } from '../nesting2d';
import { guillotineOk, validate2D } from '../validate2d';
import cases from '../__fixtures__/nesting2d_cases.json';

const fixtures = cases as unknown as { name: string; request: Nesting2DRequest; result: Nesting2DResult }[];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('2D offline heuristic — parity with nesting2d.py', () => {
  it.each(fixtures.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const r = optimize2D(c.request);
    expect(r.status).toBe(c.result.status);
    expect(r.summary.sheets_used).toBe(c.result.summary.sheets_used);
    expect(r.summary.total_piece_area_m2).toBeCloseTo(c.result.summary.total_piece_area_m2, 9);
    expect(r.summary.reusable_residual_area_m2).toBeCloseTo(c.result.summary.reusable_residual_area_m2, 6);
    expect(r.method).toBe(`offline ${c.result.method}`);
    expect(r.lower_bound_sheets).toBe(c.result.lower_bound_sheets);
    expect(r.layouts.length).toBe(c.result.layouts.length);
    expect(r.validation.passed).toBe(true);
  });
  it.each(fixtures.map((c) => [c.name, c] as const))('TS validator accepts the Python result: %s', (_n, c) => {
    expect(validate2D(c.request, c.result).errors).toEqual([]);
  });
});

describe('2D randomized feasibility', () => {
  it('random instances are always validator-PASSED', () => {
    const rand = rng(99);
    for (let n = 0; n < 60; n++) {
      const req: Nesting2DRequest = {
        kerf: [0, 3, 4][Math.floor(rand() * 3)],
        guillotine: rand() < 0.6,
        edge_trim: { left: 10, right: 10, top: rand() < 0.5 ? 0 : 15, bottom: 10 },
        sheets: [{ id: 'S', width: 3210, height: 2250, quantity: rand() < 0.2 ? 2 : null }],
        pieces: Array.from({ length: 1 + Math.floor(rand() * 7) }, (_, j) => ({
          id: `q${j}`,
          width: 150 + Math.floor(rand() * 1600),
          height: 150 + Math.floor(rand() * 1600),
          quantity: 1 + Math.floor(rand() * 5),
          can_rotate: rand() < 0.7,
        })),
      };
      const r = optimize2D(req);
      expect(r.validation.passed, JSON.stringify(r.validation.errors.slice(0, 3))).toBe(true);
      if (r.validation_status === 'OPTIMAL_PROVEN') expect(r.summary.sheets_used).toBe(r.lower_bound_sheets);
    }
  });
});

describe('2D validator detects corruption', () => {
  const req = fixtures[0].request;
  const base = optimize2D(req);
  const corrupt = (fn: (r: Nesting2DResult) => void) => {
    const r = JSON.parse(JSON.stringify(base)) as Nesting2DResult;
    fn(r);
    return validate2D(req, r);
  };
  it.each([
    ['overlap', (r: Nesting2DResult): void => void (r.layouts[0].placements[1].x = r.layouts[0].placements[0].x), 'OVERLAP_OR_KERF'],
    ['outside', (r: Nesting2DResult): void => void (r.layouts[0].placements[0].x = -5), 'OUTSIDE_USABLE_AREA'],
    ['dropped', (r: Nesting2DResult): void => void r.layouts[0].placements.pop(), 'QUANTITY_MISMATCH'],
    ['size', (r: Nesting2DResult): void => void (r.layouts[0].placements[0].width += 10), 'PLACEMENT_SIZE_MISMATCH'],
    ['residual flag', (r: Nesting2DResult): void => void (r.layouts[0].residuals[0].reusable = !r.layouts[0].residuals[0].reusable), 'RESIDUAL_FLAG_WRONG'],
    ['summary', (r: Nesting2DResult): void => void (r.summary.sheets_used += 1), 'SUMMARY_MISMATCH'],
  ] as const)('%s', (_n, fn, code) => {
    const rep = corrupt(fn);
    expect(rep.passed).toBe(false);
    expect(rep.errors.map((e) => e.code)).toContain(code);
  });
  it('detects a rotation on a locked piece', () => {
    const r = JSON.parse(JSON.stringify(base)) as Nesting2DResult;
    const pl = r.layouts.flatMap((l) => l.placements).find((p) => p.piece_id === 'G3')!;
    pl.rotated = true;
    [pl.width, pl.height] = [pl.height, pl.width];
    expect(validate2D(req, r).errors.map((e) => e.code)).toContain('ROTATION_NOT_ALLOWED');
  });
  it('guillotine check rejects a pinwheel', () => {
    const pinwheel: [number, number, number, number][] = [
      [0, 0, 200, 100],
      [200, 0, 100, 200],
      [100, 200, 200, 100],
      [0, 100, 100, 200],
      [100, 100, 100, 100],
    ];
    expect(guillotineOk(pinwheel, 0)).toBe(false);
    expect(guillotineOk([[0, 0, 100, 100], [110, 0, 100, 100]], 5)).toBe(true);
  });
});
