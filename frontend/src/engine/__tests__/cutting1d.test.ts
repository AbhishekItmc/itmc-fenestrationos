import { describe, expect, it } from 'vitest';
import type { Cutting1DRequest, Cutting1DResult } from '../../api/types';
import { optimize1D } from '../cutting1d';
import { validate1D } from '../validate1d';
import cases from '../__fixtures__/cutting1d_cases.json';

const fixtures = cases as unknown as { name: string; request: Cutting1DRequest; result: Cutting1DResult }[];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('1D offline heuristic — parity with cutting1d.py (strategy=heuristic)', () => {
  it.each(fixtures.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const r = optimize1D(c.request);
    expect(r.status).toBe(c.result.status);
    expect(r.summary.bars_used).toBe(c.result.summary.bars_used);
    expect(r.summary.total_stock_length).toBeCloseTo(c.result.summary.total_stock_length, 6);
    expect(r.summary.reusable_offcut_length).toBeCloseTo(c.result.summary.reusable_offcut_length, 6);
    expect(r.method).toBe(`offline ${c.result.method}`);
    expect(r.patterns.map((p) => [p.stock_id, p.count, p.cuts.map((x) => x.piece_id)])).toEqual(
      c.result.patterns.map((p) => [p.stock_id, p.count, p.cuts.map((x) => x.piece_id)]),
    );
    expect(r.proof?.lower_bound_bars).toBe(c.result.proof?.lower_bound_bars);
    expect(r.validation.passed).toBe(true);
  });

  it.each(fixtures.map((c) => [c.name, c] as const))('TS validator accepts the Python result: %s', (_n, c) => {
    expect(validate1D(c.request, c.result).errors).toEqual([]);
  });
});

describe('1D randomized feasibility', () => {
  it('every random instance yields a validator-PASSED result and never over-claims optimality', () => {
    const rand = rng(7);
    for (let n = 0; n < 150; n++) {
      const L = [3000, 6000, 6500][Math.floor(rand() * 3)];
      const req: Cutting1DRequest = {
        kerf: Math.round(rand() * 6 * 2) / 2,
        trim_start: Math.floor(rand() * 20),
        trim_end: Math.floor(rand() * 30),
        min_reusable_offcut: 300 + Math.floor(rand() * 700),
        stocks: [{ id: 'S', length: L, quantity: rand() < 0.3 ? 2 + Math.floor(rand() * 5) : null }, ...(rand() < 0.3 ? [{ id: 'OFF', length: 1500 + Math.floor(rand() * 2000), quantity: 2, is_offcut: true }] : [])],
        pieces: Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, j) => ({ id: `p${j}`, length: 100 + Math.floor(rand() * (L - 200)), quantity: 1 + Math.floor(rand() * 6) })),
      };
      const r = optimize1D(req);
      expect(r.validation.passed, JSON.stringify(r.validation.errors.slice(0, 3))).toBe(true);
      if (r.validation_status === 'OPTIMAL_PROVEN') expect(r.summary.bars_used).toBe(r.proof?.lower_bound_bars);
      for (const p of r.patterns) expect(p.remainder).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe('1D validator detects corruption', () => {
  const base = optimize1D(fixtures[0].request);
  const corrupt = (fn: (r: Cutting1DResult) => void) => {
    const r = JSON.parse(JSON.stringify(base)) as Cutting1DResult;
    fn(r);
    return validate1D(fixtures[0].request, r);
  };
  it('baseline passes', () => expect(validate1D(fixtures[0].request, base).passed).toBe(true));
  it.each([
    ['dropped piece', (r: Cutting1DResult): void => void r.patterns[0].cuts.pop(), 'QUANTITY_MISMATCH'],
    ['overlap', (r: Cutting1DResult): void => void (r.patterns[0].cuts[1].offset -= 5), 'CUT_OVERLAP'],
    ['wrong length', (r: Cutting1DResult): void => void (r.patterns[0].cuts[0].length += 1), 'CUT_LENGTH_MISMATCH'],
    ['overflow', (r: Cutting1DResult): void => void r.patterns[0].cuts.push({ ...r.patterns[0].cuts[0], offset: 5990 }), 'BAR_OVERFLOW'],
    ['count', (r: Cutting1DResult): void => void (r.patterns[0].count += 1), 'QUANTITY_MISMATCH'],
    ['summary', (r: Cutting1DResult): void => void (r.summary.utilization += 0.01), 'SUMMARY_MISMATCH'],
    ['offcut flag', (r: Cutting1DResult): void => void (r.patterns[0].offcut_reusable = !r.patterns[0].offcut_reusable), 'OFFCUT_FLAG_WRONG'],
    ['unknown stock', (r: Cutting1DResult): void => void (r.patterns[0].stock_id = 'NOPE'), 'UNKNOWN_STOCK'],
    ['status', (r: Cutting1DResult): void => void (r.status = 'PARTIAL'), 'STATUS_INCONSISTENT'],
  ] as const)('%s', (_n, fn, code) => {
    const rep = corrupt(fn);
    expect(rep.passed).toBe(false);
    expect(rep.errors.map((e) => e.code)).toContain(code);
  });
});
