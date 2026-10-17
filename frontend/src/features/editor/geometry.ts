/**
 * Pure editor geometry: snapping, move constraints, splitting, member lookup.
 * Coordinates: framework mm, origin bottom-left, y up.
 */
import type { Catalogue, Elevation } from '../../api/types';
import { getProfile } from '../../engine/catalogue';
import { addMullion, addTransom, effectiveMullionProfileId, effectiveTransomProfileId, fillKey as fieldKey, resolveRuleSet } from '../../engine/elevation';

export const GEOM_EPS = 1e-6;
/** Fallback minimum field size when no rule set is resolved (editor safety only, not an engineering rule). */
export const FALLBACK_MIN_FIELD = 100;

export interface SnapOptions {
  step: number;
  grid: boolean;
  /** absolute coordinates to snap to (members, alignment targets) */
  targets?: number[];
  /** tolerance for target snapping, in mm */
  tol?: number;
}

export interface SnapResult {
  value: number;
  kind: 'member' | 'grid' | 'none';
}

export function snapToStep(v: number, step: number): number {
  if (!(step > 0)) return v;
  const r = Math.round(v / step) * step;
  return Number(r.toFixed(6)) + 0;
}

export function snapValue(v: number, o: SnapOptions): SnapResult {
  if (o.targets?.length && o.tol && o.tol > 0) {
    let best: number | null = null;
    for (const t of o.targets) if (Math.abs(t - v) <= o.tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    if (best !== null) return { value: best, kind: 'member' };
  }
  if (o.grid && o.step > 0) return { value: snapToStep(v, o.step), kind: 'grid' };
  return { value: v, kind: 'none' };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface MinField {
  minW: number;
  minH: number;
  source: string;
}

export function minFieldSize(elev: Elevation, cat: Catalogue | null): MinField {
  const rs = cat ? resolveRuleSet(elev, cat) : null;
  const p = rs?.params ?? {};
  return {
    minW: typeof p.min_field_width === 'number' ? p.min_field_width : FALLBACK_MIN_FIELD,
    minH: typeof p.min_field_height === 'number' ? p.min_field_height : FALLBACK_MIN_FIELD,
    source: rs ? `${rs.id} (demo)` : 'editor fallback',
  };
}

export interface Range {
  lo: number;
  hi: number;
  /** true when the min-field rule had to be relaxed because the current geometry already violates it */
  relaxed: boolean;
}

/** Allowed x range for internal mullion `index`: cannot cross neighbours or leave a bay < minW. */
export function mullionRange(elev: Elevation, index: number, minW: number): Range {
  const prev = elev.mullions[index - 1];
  const next = elev.mullions[index + 1];
  const lo = prev + minW;
  const hi = next - minW;
  if (lo <= hi) return { lo, hi, relaxed: false };
  return { lo: prev + 1, hi: next - 1, relaxed: true };
}

/** Allowed y range for transom `index` in `bay`. */
export function transomRange(elev: Elevation, bay: number, index: number, minH: number): Range {
  const tr = elev.bays[bay].transoms;
  const prev = index > 0 ? tr[index - 1] : 0;
  const next = index + 1 < tr.length ? tr[index + 1] : elev.height;
  const lo = prev + minH;
  const hi = next - minH;
  if (lo <= hi) return { lo, hi, relaxed: false };
  return { lo: prev + 1, hi: next - 1, relaxed: true };
}

export function bayAt(elev: Elevation, x: number): number {
  for (let b = 0; b < elev.mullions.length - 1; b++) if (x >= elev.mullions[b] - GEOM_EPS && x <= elev.mullions[b + 1] + GEOM_EPS) return b;
  return -1;
}

export function fieldAt(elev: Elevation, x: number, y: number): { bay: number; field: number } | null {
  const b = bayAt(elev, x);
  if (b < 0 || y < 0 || y > elev.height) return null;
  const ys = [0, ...elev.bays[b].transoms, elev.height];
  for (let f = 0; f < ys.length - 1; f++) if (y >= ys[f] - GEOM_EPS && y <= ys[f + 1] + GEOM_EPS) return { bay: b, field: f };
  return null;
}

/** Why a mullion cannot be added at x (null = ok). */
export function checkAddMullion(elev: Elevation, x: number, minW: number): string | null {
  if (!(x > GEOM_EPS && x < elev.width - GEOM_EPS)) return 'Position must be inside the framework width';
  const b = bayAt(elev, x);
  if (b < 0) return 'Outside the framework';
  const l = x - elev.mullions[b];
  const r = elev.mullions[b + 1] - x;
  if (l < GEOM_EPS || r < GEOM_EPS) return 'A mullion already exists here';
  if (l < minW - GEOM_EPS || r < minW - GEOM_EPS) return `Resulting bay would be narrower than the minimum field width (${minW} mm)`;
  return null;
}

/** Why a transom cannot be added at y in bay (null = ok). */
export function checkAddTransom(elev: Elevation, bay: number, y: number, minH: number): string | null {
  if (!(y > GEOM_EPS && y < elev.height - GEOM_EPS)) return 'Position must be inside the framework height';
  const ys = [0, ...elev.bays[bay].transoms, elev.height];
  for (let f = 0; f < ys.length - 1; f++) {
    if (y > ys[f] && y < ys[f + 1]) {
      const below = y - ys[f];
      const above = ys[f + 1] - y;
      if (below < minH - GEOM_EPS || above < minH - GEOM_EPS) return `Resulting field would be shorter than the minimum field height (${minH} mm)`;
      return null;
    }
  }
  return 'A transom already exists here';
}

/** Split field (bay, field) into n equal rows by inserting n-1 transoms. */
export function splitFieldRows(elev: Elevation, bay: number, field: number, n: number): Elevation {
  if (!Number.isInteger(n) || n < 2) throw new Error('Split count must be an integer ≥ 2');
  const ys = [0, ...elev.bays[bay].transoms, elev.height];
  const y0 = ys[field];
  const y1 = ys[field + 1];
  let e = elev;
  for (let k = 1; k < n; k++) e = addTransom(e, bay, y0 + ((y1 - y0) * k) / n);
  return e;
}

/** Split bay into n equal columns by inserting n-1 full-height mullions. */
export function splitBayColumns(elev: Elevation, bay: number, n: number): Elevation {
  if (!Number.isInteger(n) || n < 2) throw new Error('Split count must be an integer ≥ 2');
  const x0 = elev.mullions[bay];
  const x1 = elev.mullions[bay + 1];
  let e = elev;
  for (let k = 1; k < n; k++) e = addMullion(e, x0 + ((x1 - x0) * k) / n);
  return e;
}

export interface FaceWidths {
  mullion: number;
  transomByBay: number[];
}

/** Profile face widths (drawn to scale). Falls back to series face width, then 50 mm. */
export function faceWidths(elev: Elevation, cat: Catalogue | null): FaceWidths {
  const fallback = 50;
  const m = cat ? getProfile(cat, effectiveMullionProfileId(elev, cat))?.face_width : undefined;
  return {
    mullion: m ?? fallback,
    transomByBay: elev.bays.map((_, b) => (cat ? getProfile(cat, effectiveTransomProfileId(elev, b, cat))?.face_width : undefined) ?? fallback),
  };
}

/** Alignment targets for transoms: heights used in other bays (so rows line up across bays). */
export function transomTargets(elev: Elevation, exceptBay: number): number[] {
  const s = new Set<number>();
  elev.bays.forEach((b, i) => {
    if (i !== exceptBay) b.transoms.forEach((t) => s.add(t));
  });
  return [...s];
}

/** Snap targets for an internal mullion: equal-split midpoint of its neighbours. */
export function mullionTargets(elev: Elevation, index: number): number[] {
  return [(elev.mullions[index - 1] + elev.mullions[index + 1]) / 2];
}

export function selectedFieldKeys(elev: Elevation): string[] {
  const out: string[] = [];
  elev.bays.forEach((b, bi) => {
    for (let f = 0; f <= b.transoms.length; f++) out.push(fieldKey(bi, f));
  });
  return out;
}

/** Map an engine issue `ref` to an editor element id. */
export function refToElement(ref: string | null | undefined): { kind: 'field'; key: string } | { kind: 'mullion'; index: number } | { kind: 'transom'; bay: number; index: number } | null {
  if (!ref) return null;
  let m = /^bay:(\d+)\/field:(\d+)$/.exec(ref);
  if (m) return { kind: 'field', key: fieldKey(Number(m[1]), Number(m[2])) };
  m = /^mullion:(\d+)$/.exec(ref);
  if (m) return { kind: 'mullion', index: Number(m[1]) };
  m = /^bay:(\d+)\/transom:(\d+)$/.exec(ref);
  if (m) return { kind: 'transom', bay: Number(m[1]), index: Number(m[2]) };
  m = /^fill:(b\d+-f\d+)$/.exec(ref);
  if (m) return { kind: 'field', key: m[1] };
  return null;
}
