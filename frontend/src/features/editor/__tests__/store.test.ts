import { beforeEach, describe, expect, it } from 'vitest';
import { addMullion, addTransom, makeGrid, moveMullion, removeMullion } from '../../../engine/elevation';
import { createEditorStore, HISTORY_LIMIT, sanitizeSelection } from '../store';

describe('editor undo/redo store', () => {
  let store = createEditorStore();
  beforeEach(() => {
    store = createEditorStore();
    store.getState().load(makeGrid(3000, 3000, 2, 1), null);
  });

  it('records one history step per edit and supports undo/redo', () => {
    const s = store.getState;
    expect(s().edit((e) => addMullion(e, 700), 'add mullion').ok).toBe(true);
    expect(s().elevation!.mullions).toEqual([0, 700, 1500, 3000]);
    expect(s().dirty).toBe(true);
    s().edit((e) => addTransom(e, 0, 1000), 'add transom');
    s().undo();
    expect(s().elevation!.bays[0].transoms).toEqual([]);
    s().undo();
    expect(s().elevation!.mullions).toEqual([0, 1500, 3000]);
    expect(s().canUndo()).toBe(false);
    s().redo();
    s().redo();
    expect(s().elevation!.mullions).toEqual([0, 700, 1500, 3000]);
    expect(s().elevation!.bays[0].transoms).toEqual([1000]);
    expect(s().canRedo()).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const s = store.getState;
    s().edit((e) => addMullion(e, 700), 'a');
    s().undo();
    s().edit((e) => addMullion(e, 2000), 'b');
    expect(s().canRedo()).toBe(false);
    expect(s().elevation!.mullions).toEqual([0, 1500, 2000, 3000]);
  });

  it('failed edits do not touch history and report the error', () => {
    const r = store.getState().edit((e) => addMullion(e, 1500), 'dup');
    expect(r).toEqual({ ok: false, error: 'a mullion already exists at this position' });
    expect(store.getState().canUndo()).toBe(false);
  });

  it('keeps at least 100 steps (bounded at HISTORY_LIMIT)', () => {
    const s = store.getState;
    for (let i = 0; i < HISTORY_LIMIT + 30; i++) s().edit((e) => ({ ...e, name: `n${i}` }), 'rename');
    expect(s().past.length).toBe(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < 100; i++) s().undo();
    expect(s().elevation!.name).toBe(`n${HISTORY_LIMIT + 30 - 101}`);
  });

  it('a drag transaction is a single undo step and can be cancelled', () => {
    const s = store.getState;
    s().edit((e) => addMullion(e, 700), 'add');
    s().beginDrag();
    s().dragTo(moveMullion(s().elevation!, 1, 800));
    s().dragTo(moveMullion(s().elevation!, 1, 900));
    s().endDrag('move');
    expect(s().elevation!.mullions[1]).toBe(900);
    s().undo();
    expect(s().elevation!.mullions[1]).toBe(700);
    s().beginDrag();
    s().dragTo(moveMullion(s().elevation!, 1, 1000));
    s().cancelDrag();
    expect(s().elevation!.mullions[1]).toBe(700);
  });

  it('sanitizes the selection after structural changes', () => {
    const s = store.getState;
    s().edit((e) => addMullion(e, 700), 'add');
    s().setSelection({ kind: 'mullion', index: 2 });
    s().edit((e) => removeMullion(e, 1), 'remove');
    expect(s().selection).toEqual({ kind: 'mullion', index: 2 });
    s().edit((e) => removeMullion(e, 1), 'remove');
    expect(s().selection).toEqual({ kind: 'elevation' });
    const e = makeGrid(1000, 1000, 1, 1);
    expect(sanitizeSelection(e, { kind: 'fields', keys: ['b0-f0', 'b3-f0'] })).toEqual({ kind: 'fields', keys: ['b0-f0'] });
  });

  it('shift-toggles multi-field selection', () => {
    const s = store.getState;
    s().toggleField('b0-f0', false);
    s().toggleField('b1-f0', true);
    expect(s().selection).toEqual({ kind: 'fields', keys: ['b0-f0', 'b1-f0'] });
    s().toggleField('b0-f0', true);
    expect(s().selection).toEqual({ kind: 'fields', keys: ['b1-f0'] });
  });
});
