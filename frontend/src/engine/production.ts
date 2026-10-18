/**
 * Production tracking — pure logic (ARCHITECTURE §8.1). Used by the offline backend and the UI;
 * the server implements the same rules and is authoritative in server mode.
 *
 * Routes are code constants for now (documented as configurable later).
 */
import type { CalcRun, Catalogue, Part, PartAction, PartCounts, PartKind, PartStatus, ProductionBoard, ProductionStatus, StationId } from '../api/types';
import { getGlassType, getPanelType } from './catalogue';

export const STATIONS: { id: StationId; label: string }[] = [
  { id: 'cutting', label: 'Cutting' },
  { id: 'machining', label: 'Machining' },
  { id: 'assembly', label: 'Assembly' },
  { id: 'receiving', label: 'Glass receiving' },
  { id: 'glazing', label: 'Glazing' },
  { id: 'qc', label: 'Quality check' },
  { id: 'dispatch', label: 'Dispatch' },
];

export const STATION_LABEL: Record<string, string> = Object.fromEntries(STATIONS.map((s) => [s.id, s.label]));
export const stationLabel = (id: string | null | undefined): string => (id ? (STATION_LABEL[id] ?? id) : '—');

export const ROUTES: Record<PartKind, StationId[]> = {
  profile: ['cutting', 'machining', 'assembly', 'qc', 'dispatch'],
  glass: ['receiving', 'glazing', 'qc', 'dispatch'],
  panel: ['receiving', 'glazing', 'qc', 'dispatch'],
};

/** A–Z and 2–9 without the look-alikes O, I, 0, 1 (32 symbols). */
export const PART_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PART_CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${PART_CODE_ALPHABET}]{${PART_CODE_LENGTH}}$`);

export function isPartCode(s: string): boolean {
  return CODE_RE.test(s);
}

/** Random 8-char part code, unique against `taken`. `rand` is injectable for deterministic tests. */
export function newPartCode(taken: Set<string>, rand: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let c = '';
    for (let i = 0; i < PART_CODE_LENGTH; i++) c += PART_CODE_ALPHABET[Math.floor(rand() * PART_CODE_ALPHABET.length) % PART_CODE_ALPHABET.length];
    if (!taken.has(c)) {
      taken.add(c);
      return c;
    }
  }
  throw new Error('Could not allocate a unique part code');
}

/** QR payload for a part label: the public part page URL. */
export function partUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/p/${encodeURIComponent(code)}`;
}

/**
 * Extract a part code from scanner input: either a bare code ("AB3K9XQ2", any case, surrounding spaces)
 * or a scanned QR URL (".../p/AB3K9XQ2"). Returns the normalised code or null.
 */
export function parseScan(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /\/p\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(s);
  const raw = (m ? m[1] : s).toUpperCase().replace(/[\s-]/g, '');
  return raw.length ? raw : null;
}

export type PartDraft = Omit<Part, 'id' | 'production_order_id' | 'code' | 'updated_at'>;

/**
 * Explode calc runs into physical parts: one part per physical piece.
 * ProfileCut.quantity and GlassItem.quantity already include the elevation quantity (calc engine), so a
 * cut with quantity 8 yields 8 parts (seq 1..8 within the mark of that run).
 */
export function explodeParts(runs: CalcRun[], elevationName: (run: CalcRun) => string | null, cat: Catalogue | null = null): PartDraft[] {
  const out: PartDraft[] = [];
  for (const run of runs) {
    const r = run.result;
    const ename = elevationName(run);
    for (const c of r.profile_cuts) {
      for (let i = 1; i <= c.quantity; i++)
        out.push({
          kind: 'profile',
          mark: c.mark,
          description: `${c.description} — ${c.role}`.slice(0, 300),
          item_code: c.profile_code,
          length: c.length,
          width: null,
          height: null,
          angle_start: c.angle_start,
          angle_end: c.angle_end,
          calc_run_id: run.id,
          elevation_id: run.elevation_id ?? null,
          elevation_name: ename,
          field_key: null,
          seq: i,
          route: [...ROUTES.profile],
          station_index: 0,
          current_station: ROUTES.profile[0],
          status: 'pending',
        });
    }
    for (const g of r.glass_items) {
      const kind: PartKind = g.fill_type === 'panel' ? 'panel' : 'glass';
      const code =
        kind === 'panel'
          ? (cat && getPanelType(cat, g.panel_type_id)?.code) || g.panel_type_id || ''
          : (cat && getGlassType(cat, g.glass_type_id)?.code) || g.glass_type_id || 'UNSPECIFIED';
      for (let i = 1; i <= g.quantity; i++)
        out.push({
          kind,
          mark: g.mark,
          description: g.description.slice(0, 300),
          item_code: code,
          length: null,
          width: g.width,
          height: g.height,
          angle_start: null,
          angle_end: null,
          calc_run_id: run.id,
          elevation_id: run.elevation_id ?? null,
          elevation_name: ename,
          field_key: g.field_key,
          seq: i,
          route: [...ROUTES[kind]],
          station_index: 0,
          current_station: ROUTES[kind][0],
          status: 'pending',
        });
    }
  }
  return out;
}

export class TransitionError extends Error {
  readonly code: 'INVALID_TRANSITION' | 'NOTE_REQUIRED';
  /** HTTP status the server answers with: 409 INVALID_TRANSITION, 422 NOTE_REQUIRED. */
  readonly status: 409 | 422;
  constructor(message: string, code: 'INVALID_TRANSITION' | 'NOTE_REQUIRED' = 'INVALID_TRANSITION') {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
    this.status = code === 'NOTE_REQUIRED' ? 422 : 409;
  }
}

/** Part state for transitions; `prev_status` remembers the state before a block (for unblock). */
export interface PartState {
  route: string[];
  station_index: number;
  current_station: string | null;
  status: PartStatus;
  prev_status?: PartStatus | null;
}

/** Which actions are valid for this part at `station` (the UI enables buttons from this). */
export function allowedActions(p: PartState, station: string | null): PartAction[] {
  if (!station) return [];
  if (p.status === 'done') return p.route.includes(station) ? ['note'] : [];
  if (p.current_station !== station) return [];
  if (p.status === 'pending') return ['start', 'complete', 'block', 'note'];
  if (p.status === 'in_progress') return ['complete', 'block', 'note'];
  return ['unblock', 'note']; // blocked
}

/**
 * Apply an action (pure) — same rules as backend/app/services/production.py `apply_event`:
 *   start     pending → in_progress (at the part's current station)
 *   complete  pending|in_progress → next station pending, or done after the last station
 *             (completing a pending part is an implicit start: one scan per station on the shop floor)
 *   block     pending|in_progress → blocked (note required; previous status remembered)
 *   unblock   blocked → previous status
 *   note      any status (current station, or any station of the route once done); note required
 * Anything else → TransitionError (409 INVALID_TRANSITION; missing note → 422 NOTE_REQUIRED).
 */
export function applyAction<T extends PartState>(p: T, station: string, action: PartAction, note?: string | null): T {
  const n = (note ?? '').trim();
  if ((action === 'block' || action === 'note') && !n) throw new TransitionError(`A note is required for '${action}'`, 'NOTE_REQUIRED');
  if (action === 'note') {
    if (!(station === p.current_station || (p.status === 'done' && p.route.includes(station))))
      throw new TransitionError(`Part is at station '${stationLabel(p.current_station)}', not '${stationLabel(station)}'`);
    return { ...p };
  }
  if (p.status === 'done') throw new TransitionError('Part is already done');
  if (station !== p.current_station) throw new TransitionError(`Part is at station '${stationLabel(p.current_station)}', not '${stationLabel(station)}'`);
  switch (action) {
    case 'start':
      if (p.status !== 'pending') throw new TransitionError(`'start' needs a pending part; it is ${p.status.replace('_', ' ')}`);
      return { ...p, status: 'in_progress' };
    case 'complete': {
      if (p.status !== 'pending' && p.status !== 'in_progress') throw new TransitionError(`'complete' needs a pending or in-progress part; it is ${p.status}`);
      const next = p.station_index + 1;
      if (next >= p.route.length) return { ...p, station_index: p.route.length, current_station: null, status: 'done' };
      return { ...p, station_index: next, current_station: p.route[next], status: 'pending' };
    }
    case 'block':
      if (p.status !== 'pending' && p.status !== 'in_progress') throw new TransitionError(`'block' needs a pending or in-progress part; it is ${p.status}`);
      return { ...p, status: 'blocked', prev_status: p.status };
    case 'unblock':
      if (p.status !== 'blocked') throw new TransitionError(`'unblock' needs a blocked part; it is ${p.status.replace('_', ' ')}`);
      return { ...p, status: p.prev_status === 'pending' || p.prev_status === 'in_progress' ? p.prev_status : 'pending', prev_status: null };
    default:
      throw new TransitionError(`Unknown action '${String(action)}'`);
  }
}

export function countParts(parts: Pick<Part, 'status'>[]): PartCounts {
  const c: PartCounts = { total: parts.length, pending: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const p of parts) c[p.status] += 1;
  return c;
}

export const pctComplete = (c: PartCounts): number => (c.total ? c.done / c.total : 0);

/**
 * Order status automation after a part event (backend rule): start/complete on a planned/released order →
 * in_progress; the completion that finishes the last open part → done. Cancelled orders refuse events.
 */
export function orderStatusAfter(current: ProductionStatus, action: PartAction, parts: Pick<Part, 'status'>[]): ProductionStatus {
  let st = current;
  if ((action === 'start' || action === 'complete') && (st === 'planned' || st === 'released')) st = 'in_progress';
  if (action === 'complete' && parts.length && parts.every((p) => p.status === 'done')) st = 'done';
  return st;
}

/** Station board: per station on any part's route (in canonical order), counts of parts waiting/working/blocked/passed. */
export function buildBoard(parts: Pick<Part, 'route' | 'station_index' | 'current_station' | 'status'>[]): ProductionBoard {
  const used = new Set<string>();
  for (const p of parts) for (const s of p.route) used.add(s);
  const stations = STATIONS.filter((s) => used.has(s.id)).map((s) => ({ id: s.id as string, label: s.label, pending: 0, in_progress: 0, done_here: 0, blocked: 0 }));
  const byId = new Map(stations.map((s) => [s.id, s]));
  for (const p of parts) {
    if (p.current_station) {
      const st = byId.get(p.current_station);
      if (st) st[p.status === 'done' ? 'done_here' : p.status] += 1;
    }
    (p.route as string[]).forEach((sid, i) => {
      if (i < p.station_index) {
        const st = byId.get(sid);
        if (st) st.done_here += 1;
      }
    });
  }
  return { stations, counts: countParts(parts) };
}

export function fmtPartSize(p: Pick<Part, 'kind' | 'length' | 'width' | 'height'>): string {
  const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (p.kind === 'profile' && p.length != null) return `L ${f(p.length)} mm`;
  if (p.width != null && p.height != null) return `${f(p.width)} × ${f(p.height)} mm`;
  return '—';
}
