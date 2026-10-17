/**
 * Elevation editor state: document + undo/redo history (≥100 steps), selection, tools, view options.
 * Every geometry edit goes through `edit()` (one history step) or the drag transaction
 * (`beginDrag` → `dragTo`* → `endDrag`, also one step).
 */
import { create } from 'zustand';
import type { Elevation, FieldFill, Id } from '../../api/types';
import { fillKey } from '../../engine/elevation';
import { loadJson, saveJson } from '../../lib/storage';

export const HISTORY_LIMIT = 200;

export type Selection =
  | { kind: 'elevation' }
  | { kind: 'mullion'; index: number }
  | { kind: 'transom'; bay: number; index: number }
  | { kind: 'fields'; keys: string[] };

export type Tool = 'select' | 'mullion' | 'transom' | 'delete' | 'split' | 'fill' | 'hand';

export interface DocRecord {
  id: Id | null;
  projectId: Id | null;
  version: number | null;
}

export interface ViewPrefs {
  snapStep: number;
  snapGrid: boolean;
  snapMembers: boolean;
  showGrid: boolean;
  showDims: boolean;
  theme: 'dark' | 'light';
}

const PREFS_KEY = 'fos.editor.view';
const defaultPrefs: ViewPrefs = { snapStep: 10, snapGrid: true, snapMembers: true, showGrid: true, showDims: true, theme: 'dark' };

export interface EditorState extends ViewPrefs {
  elevation: Elevation | null;
  record: DocRecord | null;
  dirty: boolean;
  past: Elevation[];
  future: Elevation[];
  lastLabel: string | null;
  dragBase: Elevation | null;
  selection: Selection;
  tool: Tool;
  transomAllBays: boolean;
  splitN: number;
  splitDir: 'rows' | 'cols';
  brush: FieldFill;
  highlightRef: string | null;
  /** increments on every load (canvas re-fits) */
  loadSeq: number;

  load(e: Elevation, record: DocRecord | null): void;
  clear(): void;
  edit(fn: (e: Elevation) => Elevation, label: string): { ok: true } | { ok: false; error: string };
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  beginDrag(): void;
  dragTo(e: Elevation): void;
  endDrag(label: string): void;
  cancelDrag(): void;
  markSaved(record: DocRecord, e?: Elevation): void;
  setSelection(s: Selection): void;
  toggleField(key: string, additive: boolean): void;
  setTool(t: Tool): void;
  setPrefs(p: Partial<ViewPrefs>): void;
  set(p: Partial<Pick<EditorState, 'transomAllBays' | 'splitN' | 'splitDir' | 'brush' | 'highlightRef'>>): void;
}

/** Keep the selection pointing at something that exists in `e`. */
export function sanitizeSelection(e: Elevation, s: Selection): Selection {
  if (s.kind === 'mullion') return s.index >= 0 && s.index < e.mullions.length ? s : { kind: 'elevation' };
  if (s.kind === 'transom') return s.bay < e.bays.length && s.index < e.bays[s.bay].transoms.length ? s : { kind: 'elevation' };
  if (s.kind === 'fields') {
    const valid = new Set<string>();
    e.bays.forEach((b, bi) => {
      for (let f = 0; f <= b.transoms.length; f++) valid.add(fillKey(bi, f));
    });
    const keys = s.keys.filter((k) => valid.has(k));
    return keys.length ? { kind: 'fields', keys } : { kind: 'elevation' };
  }
  return s;
}

function pushPast(past: Elevation[], e: Elevation): Elevation[] {
  const next = [...past, e];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export const createEditorStore = () =>
  create<EditorState>((set, get) => ({
    ...defaultPrefs,
    ...loadJson<Partial<ViewPrefs>>(PREFS_KEY, {}),
    elevation: null,
    record: null,
    dirty: false,
    past: [],
    future: [],
    lastLabel: null,
    dragBase: null,
    selection: { kind: 'elevation' },
    tool: 'select',
    transomAllBays: false,
    splitN: 2,
    splitDir: 'rows',
    brush: { type: 'glass' },
    highlightRef: null,
    loadSeq: 0,

    load(e, record) {
      set({ loadSeq: get().loadSeq + 1, elevation: e, record, dirty: false, past: [], future: [], dragBase: null, selection: { kind: 'elevation' }, highlightRef: null, lastLabel: null });
    },
    clear() {
      set({ elevation: null, record: null, dirty: false, past: [], future: [], dragBase: null, selection: { kind: 'elevation' } });
    },
    edit(fn, label) {
      const cur = get().elevation;
      if (!cur) return { ok: false, error: 'No elevation loaded' };
      try {
        const next = fn(cur);
        if (next === cur) return { ok: true };
        set({ elevation: next, past: pushPast(get().past, cur), future: [], dirty: true, lastLabel: label, selection: sanitizeSelection(next, get().selection) });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    undo() {
      const { past, elevation, future } = get();
      if (!past.length || !elevation) return;
      const prev = past[past.length - 1];
      set({ elevation: prev, past: past.slice(0, -1), future: [elevation, ...future].slice(0, HISTORY_LIMIT), dirty: true, selection: sanitizeSelection(prev, get().selection) });
    },
    redo() {
      const { past, elevation, future } = get();
      if (!future.length || !elevation) return;
      const next = future[0];
      set({ elevation: next, past: pushPast(past, elevation), future: future.slice(1), dirty: true, selection: sanitizeSelection(next, get().selection) });
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    beginDrag() {
      const e = get().elevation;
      if (e) set({ dragBase: e });
    },
    dragTo(e) {
      if (get().dragBase) set({ elevation: e });
    },
    endDrag(label) {
      const { dragBase, elevation } = get();
      if (!dragBase || !elevation) return set({ dragBase: null });
      if (JSON.stringify(dragBase) === JSON.stringify(elevation)) return set({ dragBase: null });
      set({ dragBase: null, past: pushPast(get().past, dragBase), future: [], dirty: true, lastLabel: label });
    },
    cancelDrag() {
      const base = get().dragBase;
      if (base) set({ elevation: base, dragBase: null });
    },
    markSaved(record, e) {
      set({ record, dirty: false, ...(e ? { elevation: e } : {}) });
    },
    setSelection(s) {
      const e = get().elevation;
      set({ selection: e ? sanitizeSelection(e, s) : s });
    },
    toggleField(key, additive) {
      const s = get().selection;
      if (!additive || s.kind !== 'fields') return set({ selection: { kind: 'fields', keys: [key] } });
      const keys = s.keys.includes(key) ? s.keys.filter((k) => k !== key) : [...s.keys, key];
      set({ selection: keys.length ? { kind: 'fields', keys } : { kind: 'elevation' } });
    },
    setTool(t) {
      set({ tool: t });
    },
    setPrefs(p) {
      set(p);
      const s = get();
      saveJson(PREFS_KEY, { snapStep: s.snapStep, snapGrid: s.snapGrid, snapMembers: s.snapMembers, showGrid: s.showGrid, showDims: s.showDims, theme: s.theme });
    },
    set(p) {
      set(p);
    },
  }));

export const useEditor = createEditorStore();
