import { describe, expect, it } from 'vitest';
import type { Elevation } from '../../api/types';
import { addMullion, addTransom, addTransomAllBays, moveMullion, moveTransom, removeMullion, removeTransom, resize, setFill } from '../elevation';
import raw from '../__fixtures__/edit_cases.json';

const ed = raw as unknown as Record<string, Elevation>;
const pick = (e: Elevation) => ({ mullions: e.mullions, transoms: e.bays.map((b) => b.transoms), fills: e.fills });
const norm = (e: Elevation) => {
  const p = pick(e);
  const fills: Record<string, unknown> = {};
  for (const k of Object.keys(p.fills).sort()) {
    const f = p.fills[k];
    fills[k] = { type: f.type, glass_type_id: f.glass_type_id ?? null, panel_type_id: f.panel_type_id ?? null };
  }
  return { ...p, fills };
};

describe('elevation editing helpers — parity with elevation.py', () => {
  const base = ed.base;
  it('add_mullion splits the bay and duplicates fills', () => expect(norm(addMullion(base, 1000))).toEqual(norm(ed.add_mullion_1000)));
  it('remove_mullion merges bays keeping the left fills', () => expect(norm(removeMullion(base, 1))).toEqual(norm(ed.remove_mullion_1)));
  it('add_transom remaps fills above', () => expect(norm(addTransom(base, 1, 700))).toEqual(norm(ed.add_transom_b1_700)));
  it('remove_transom keeps the lower fill', () => expect(norm(removeTransom(base, 0, 0))).toEqual(norm(ed.remove_transom_b0_0)));
  it('add_transom_all_bays', () => expect(norm(addTransomAllBays(base, 2200))).toEqual(norm(ed.add_transom_all_2200)));
  it('is pure (input untouched)', () => {
    const snap = JSON.stringify(base);
    addMullion(base, 500);
    addTransom(base, 0, 400);
    setFill(base, 0, 0, { type: 'none' });
    expect(JSON.stringify(base)).toBe(snap);
  });
  it('rejects invalid edits', () => {
    expect(() => addMullion(base, 0)).toThrow();
    expect(() => addMullion(base, 2000)).toThrow(/already exists/);
    expect(() => moveMullion(base, 1, 4500)).toThrow(/neighbours/);
    expect(() => moveMullion(base, 0, 10)).toThrow();
    expect(() => removeMullion(base, 0)).toThrow();
    expect(() => moveTransom(base, 0, 0, 3000)).toThrow();
    expect(() => addTransom(base, 5, 100)).toThrow();
  });
  it('resize scales positions proportionally', () => {
    const r = resize(base, 8000, 6000);
    expect(r.mullions).toEqual([0, 4000, 8000]);
    expect(r.bays[0].transoms).toEqual([3000]);
  });
});
