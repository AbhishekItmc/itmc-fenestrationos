import { describe, expect, it } from 'vitest';
import type { CalcRun, Part } from '../../api/types';
import { calculate } from '../calc';
import { DEMO_CATALOGUE } from '../catalogue';
import { makeGrid } from '../elevation';
import {
  allowedActions,
  applyAction,
  buildBoard,
  explodeParts,
  isPartCode,
  newPartCode,
  orderStatusAfter,
  PART_CODE_ALPHABET,
  parseScan,
  partUrl,
  ROUTES,
  TransitionError,
  type PartState,
} from '../production';

const run = (quantity = 1, id = 1): CalcRun => {
  const e = makeGrid(3000, 3000, 2, 2, { name: 'Test', system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24', colour_id: 'col-ral7016', anchor_levels: [0, 3000], quantity });
  e.fills = { 'b1-f1': { type: 'panel', panel_type_id: 'pnl-alu-3' } };
  return { id, elevation_id: 11, project_id: 1, result: calculate(e, DEMO_CATALOGUE) };
};

const fresh = (kind: 'profile' | 'glass' = 'profile'): PartState => ({ route: [...ROUTES[kind]], station_index: 0, current_station: ROUTES[kind][0], status: 'pending' });

describe('part codes & QR payload', () => {
  it('alphabet excludes look-alikes and codes are unique', () => {
    expect(PART_CODE_ALPHABET).toHaveLength(32);
    for (const ch of 'O0I1') expect(PART_CODE_ALPHABET).not.toContain(ch);
    const taken = new Set<string>();
    for (let i = 0; i < 2000; i++) expect(isPartCode(newPartCode(taken))).toBe(true);
    expect(taken.size).toBe(2000);
  });
  it('retries on collision (deterministic rand)', () => {
    let k = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0];
    const taken = new Set(['AAAAAAAA']);
    expect(newPartCode(taken, () => seq[k++ % seq.length])).toBe(`${PART_CODE_ALPHABET[16]}AAAAAAA`);
  });
  it('QR payload is the public part URL', () => {
    expect(partUrl('https://fos.example.com', 'K7M2QX9A')).toBe('https://fos.example.com/p/K7M2QX9A');
    expect(partUrl('http://localhost:5173/', 'ABCDEFGH')).toBe('http://localhost:5173/p/ABCDEFGH');
  });
  it('parses scanner input: bare codes and scanned URLs', () => {
    expect(parseScan('  k7m2qx9a ')).toBe('K7M2QX9A');
    expect(parseScan('http://localhost:4173/p/K7M2QX9A')).toBe('K7M2QX9A');
    expect(parseScan('https://x.y/p/ab3k9xq2/?src=label')).toBe('AB3K9XQ2');
    expect(parseScan('')).toBeNull();
  });
});

describe('part explosion', () => {
  it('one part per physical piece (cut/glass quantity already includes the elevation quantity)', () => {
    for (const q of [1, 2]) {
      const r = run(q);
      const parts = explodeParts([r], () => 'Test', DEMO_CATALOGUE);
      const cuts = r.result.profile_cuts.reduce((a, c) => a + c.quantity, 0);
      const fills = r.result.glass_items.reduce((a, g) => a + g.quantity, 0);
      expect(parts.filter((p) => p.kind === 'profile')).toHaveLength(cuts);
      expect(parts.filter((p) => p.kind !== 'profile')).toHaveLength(fills);
      expect(fills).toBe(4 * q);
    }
    // quantity scales linearly
    expect(explodeParts([run(2)], () => null)).toHaveLength(2 * explodeParts([run(1)], () => null).length);
  });
  it('seq is 1..n within a mark; routes and item codes per kind', () => {
    const parts = explodeParts([run(2)], () => 'Test', DEMO_CATALOGUE);
    const m1 = parts.filter((p) => p.mark === 'M1');
    expect(m1.map((p) => p.seq)).toEqual(m1.map((_, i) => i + 1));
    const panel = parts.find((p) => p.kind === 'panel')!;
    expect(panel.route).toEqual(['receiving', 'glazing', 'qc', 'dispatch']);
    expect(panel.item_code).toBe('DEMO-PNL-AL3');
    expect(parts.find((p) => p.kind === 'glass')!.item_code).toBe('DEMO-GL-D24');
    const prof = parts.find((p) => p.kind === 'profile')!;
    expect(prof.description).toMatch(/ — mullion$/);
    expect(prof.calc_run_id).toBe(1);
    expect(prof.route[0]).toBe('cutting');
    expect(prof.current_station).toBe('cutting');
    expect(prof.status).toBe('pending');
  });
  it('multiple runs are concatenated', () => {
    const a = explodeParts([run(1, 1)], () => null).length;
    expect(explodeParts([run(1, 1), run(1, 2)], () => null)).toHaveLength(2 * a);
  });
});

describe('transitions (same rules as services/production.apply_event)', () => {
  it('happy path walks the whole route to done', () => {
    let p = fresh('glass');
    for (const st of ROUTES.glass) {
      expect(allowedActions(p, st)).toEqual(['start', 'complete', 'block', 'note']);
      p = applyAction(p, st, 'start');
      expect(p.status).toBe('in_progress');
      expect(allowedActions(p, st)).toEqual(['complete', 'block', 'note']);
      p = applyAction(p, st, 'complete');
    }
    expect(p).toMatchObject({ status: 'done', current_station: null, station_index: 4 });
    expect(allowedActions(p, 'qc')).toEqual(['note']);
    expect(allowedActions(p, 'cutting')).toEqual([]); // not on its route
  });
  it('complete advances to the next station as pending; completing a pending part is an implicit start', () => {
    const p = applyAction(applyAction(fresh(), 'cutting', 'start'), 'cutting', 'complete');
    expect(p).toMatchObject({ station_index: 1, current_station: 'machining', status: 'pending' });
    expect(applyAction(p, 'machining', 'complete')).toMatchObject({ station_index: 2, current_station: 'assembly', status: 'pending' });
  });
  it('rejects invalid transitions with 409 INVALID_TRANSITION', () => {
    const p = fresh();
    const invalid = (fn: () => unknown, re: RegExp) => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(TransitionError);
        expect((e as TransitionError).code).toBe('INVALID_TRANSITION');
        expect((e as TransitionError).status).toBe(409);
        expect((e as Error).message).toMatch(re);
        return;
      }
      throw new Error('expected a TransitionError');
    };
    invalid(() => applyAction(p, 'machining', 'start'), /at station 'Cutting'/); // wrong station
    invalid(() => applyAction(p, 'machining', 'complete'), /at station 'Cutting'/);
    invalid(() => applyAction(p, 'cutting', 'unblock'), /needs a blocked part/);
    invalid(() => applyAction(applyAction(p, 'cutting', 'start'), 'cutting', 'start'), /needs a pending part/);
    invalid(() => applyAction(p, 'machining', 'note', 'x'), /at station/);
    const blocked = applyAction(p, 'cutting', 'block', 'damaged');
    invalid(() => applyAction(blocked, 'cutting', 'start'), /needs a pending part/);
    invalid(() => applyAction(blocked, 'cutting', 'complete'), /pending or in-progress/);
    invalid(() => applyAction(blocked, 'cutting', 'block', 'again'), /pending or in-progress/);
    const done: PartState = { ...p, status: 'done', current_station: null, station_index: 5 };
    invalid(() => applyAction(done, 'dispatch', 'start'), /already done/);
    invalid(() => applyAction(done, 'dispatch', 'complete'), /already done/);
    expect(applyAction(done, 'dispatch', 'note', 'shipped')).toEqual(done);
  });
  it('block and note need a note (422 NOTE_REQUIRED)', () => {
    for (const a of ['block', 'note'] as const)
      for (const n of [undefined, '', '   ']) {
        try {
          applyAction(fresh(), 'cutting', a, n);
          throw new Error('expected');
        } catch (e) {
          expect((e as TransitionError).code).toBe('NOTE_REQUIRED');
          expect((e as TransitionError).status).toBe(422);
        }
      }
  });
  it('block/unblock restores the previous state', () => {
    const working = applyAction(fresh(), 'cutting', 'start');
    const blocked = applyAction(working, 'cutting', 'block', 'damaged');
    expect(blocked.status).toBe('blocked');
    expect(allowedActions(blocked, 'cutting')).toEqual(['unblock', 'note']);
    expect(applyAction(blocked, 'cutting', 'unblock').status).toBe('in_progress');
    expect(applyAction(applyAction(fresh(), 'cutting', 'block', 'x'), 'cutting', 'unblock').status).toBe('pending');
  });
  it('note does not change state', () => {
    const p = fresh();
    expect(applyAction(p, 'cutting', 'note', 'checked')).toEqual(p);
  });
});

describe('order status and board', () => {
  const part = (s: Partial<Part>): Part => ({ id: 1, production_order_id: 1, code: 'AAAAAAAA', kind: 'profile', mark: 'M1', description: '', item_code: '', seq: 1, route: [...ROUTES.profile], station_index: 0, current_station: 'cutting', status: 'pending', ...s });
  it('automation: start/complete on planned/released → in_progress; last completion → done', () => {
    expect(orderStatusAfter('released', 'start', [part({ status: 'in_progress' }), part({})])).toBe('in_progress');
    expect(orderStatusAfter('planned', 'complete', [part({ station_index: 1 }), part({})])).toBe('in_progress');
    expect(orderStatusAfter('released', 'block', [part({ status: 'blocked' })])).toBe('released');
    expect(orderStatusAfter('in_progress', 'complete', [part({ status: 'done' }), part({ status: 'done' })])).toBe('done');
    expect(orderStatusAfter('in_progress', 'note', [part({ status: 'done' })])).toBe('in_progress');
  });
  it('board counts per station', () => {
    const b = buildBoard([
      part({}),
      part({ status: 'in_progress' }),
      part({ status: 'blocked', current_station: 'machining', station_index: 1 }),
      part({ status: 'done', current_station: null, station_index: 5 }),
      part({ kind: 'glass', route: [...ROUTES.glass], current_station: 'receiving' }),
    ]);
    expect(b.stations.map((s) => s.id)).toEqual(['cutting', 'machining', 'assembly', 'receiving', 'glazing', 'qc', 'dispatch']);
    const by = Object.fromEntries(b.stations.map((s) => [s.id, s]));
    expect(by.cutting).toMatchObject({ pending: 1, in_progress: 1, blocked: 0, done_here: 2 });
    expect(by.machining).toMatchObject({ blocked: 1, done_here: 1 });
    expect(by.dispatch.done_here).toBe(1);
    expect(by.receiving.pending).toBe(1);
    expect(b.counts).toEqual({ total: 5, pending: 2, in_progress: 1, done: 1, blocked: 1 });
  });
});
