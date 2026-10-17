import { describe, expect, it } from 'vitest';
import { DEMO_CATALOGUE } from '../../../engine/catalogue';
import { makeGrid, moveMullion } from '../../../engine/elevation';
import {
  bayAt,
  checkAddMullion,
  checkAddTransom,
  faceWidths,
  fieldAt,
  minFieldSize,
  mullionRange,
  refToElement,
  snapToStep,
  snapValue,
  splitBayColumns,
  splitFieldRows,
  transomRange,
  transomTargets,
} from '../geometry';

const elev = () => makeGrid(4500, 3000, 3, 2, { system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24' });

describe('snapping', () => {
  it('snaps to the grid step', () => {
    expect(snapToStep(1234.4, 10)).toBe(1230);
    expect(snapToStep(1235, 10)).toBe(1240);
    expect(snapToStep(1234.4, 50)).toBe(1250);
    expect(snapToStep(-26, 50)).toBe(-50);
    expect(snapToStep(17.3, 0)).toBe(17.3);
  });
  it('prefers member targets within tolerance over the grid', () => {
    expect(snapValue(1497, { step: 100, grid: true, targets: [1500], tol: 5 })).toEqual({ value: 1500, kind: 'member' });
    expect(snapValue(1490, { step: 100, grid: true, targets: [1500], tol: 5 })).toEqual({ value: 1500, kind: 'grid' });
    expect(snapValue(1443, { step: 100, grid: true, targets: [1500], tol: 5 })).toEqual({ value: 1400, kind: 'grid' });
    expect(snapValue(1443.2, { step: 100, grid: false })).toEqual({ value: 1443.2, kind: 'none' });
  });
  it('picks the nearest of several targets', () => {
    expect(snapValue(1004, { step: 10, grid: true, targets: [1000, 1006], tol: 10 }).value).toBe(1006);
  });
});

describe('move constraints', () => {
  it('reads min field size from the rule set', () => {
    expect(minFieldSize(elev(), DEMO_CATALOGUE)).toMatchObject({ minW: 300, minH: 300 });
    expect(minFieldSize({ ...elev(), system_id: null }, DEMO_CATALOGUE)).toMatchObject({ minW: 100, minH: 100, source: 'editor fallback' });
  });
  it('mullion cannot cross neighbours or create a too-narrow bay', () => {
    const r = mullionRange(elev(), 1, 300);
    expect(r).toEqual({ lo: 300, hi: 2700, relaxed: false });
  });
  it('relaxes when the geometry already violates the minimum', () => {
    const e = moveMullion(elev(), 1, 200);
    const r = mullionRange(e, 1, 300);
    expect(r.relaxed).toBe(false);
    const tight = makeGrid(500, 3000, 2, 1);
    expect(mullionRange(tight, 1, 300)).toEqual({ lo: 1, hi: 499, relaxed: true });
  });
  it('transom range respects neighbours and min height', () => {
    expect(transomRange(elev(), 0, 0, 300)).toEqual({ lo: 300, hi: 2700, relaxed: false });
  });
  it('validates add positions', () => {
    const e = elev();
    expect(checkAddMullion(e, 750, 300)).toBeNull();
    expect(checkAddMullion(e, 1600, 300)).toMatch(/narrower/);
    expect(checkAddMullion(e, 1500, 300)).toMatch(/already/);
    expect(checkAddMullion(e, 0, 300)).toMatch(/inside/);
    expect(checkAddTransom(e, 0, 750, 300)).toBeNull();
    expect(checkAddTransom(e, 0, 1400, 300)).toMatch(/shorter/);
    expect(checkAddTransom(e, 0, 1500, 300)).toMatch(/already/);
  });
});

describe('hit helpers & splitting', () => {
  it('locates bays and fields', () => {
    const e = elev();
    expect(bayAt(e, 10)).toBe(0);
    expect(bayAt(e, 3100)).toBe(2);
    expect(bayAt(e, 5000)).toBe(-1);
    expect(fieldAt(e, 2000, 2000)).toEqual({ bay: 1, field: 1 });
    expect(fieldAt(e, 2000, 4000)).toBeNull();
  });
  it('splits a field into equal rows (fills inherited)', () => {
    const e = { ...elev(), fills: { 'b1-f1': { type: 'spandrel' as const } } };
    const s = splitFieldRows(e, 1, 1, 3);
    expect(s.bays[1].transoms).toEqual([1500, 2000, 2500]);
    expect(s.fills['b1-f1'].type).toBe('spandrel');
    expect(s.fills['b1-f3'].type).toBe('spandrel');
    expect(() => splitFieldRows(e, 1, 1, 1)).toThrow();
  });
  it('splits a bay into equal columns', () => {
    const s = splitBayColumns(elev(), 0, 3);
    expect(s.mullions).toEqual([0, 500, 1000, 1500, 3000, 4500]);
    expect(s.bays).toHaveLength(5);
  });
  it('face widths come from catalogue profiles', () => {
    expect(faceWidths(elev(), DEMO_CATALOGUE)).toEqual({ mullion: 50, transomByBay: [50, 50, 50] });
    expect(faceWidths({ ...elev(), system_id: 'ser-cw65' }, DEMO_CATALOGUE).mullion).toBe(65);
  });
  it('transom alignment targets come from other bays', () => {
    const e = elev();
    e.bays[2].transoms = [1000, 2000];
    expect(transomTargets(e, 0).sort()).toEqual([1000, 1500, 2000]);
  });
  it('maps issue refs to elements', () => {
    expect(refToElement('bay:1/field:0')).toEqual({ kind: 'field', key: 'b1-f0' });
    expect(refToElement('mullion:3')).toEqual({ kind: 'mullion', index: 3 });
    expect(refToElement('bay:2/transom:1')).toEqual({ kind: 'transom', bay: 2, index: 1 });
    expect(refToElement('system_id')).toBeNull();
  });
});
