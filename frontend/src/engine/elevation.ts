/**
 * Elevation geometry: validation, field geometry and pure editing helpers.
 * Faithful TypeScript port of backend/app/engines/elevation.py (same issue codes, refs and severities).
 * Coordinates: origin bottom-left of the framework, x right, y up, millimetres.
 * All editing helpers are pure: they return a NEW Elevation and never mutate the input.
 */
import type { Bay, Catalogue, CatRuleSet, Elevation, FieldFill, Issue, Severity } from '../api/types';
import {
  compatibilityRules,
  getColour,
  getGlassType,
  getPanelType,
  getProfile,
  getRuleSet,
  getSeries,
} from './catalogue';
import { EPS } from './units';

const FILL_KEY_RE = /^b(\d+)-f(\d+)$/;

export const fillKey = (bay: number, field: number): string => `b${bay}-f${field}`;

export function parseFillKey(key: string): [number, number] | null {
  const m = FILL_KEY_RE.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function resolveFill(elev: Elevation, key: string): FieldFill {
  const f = elev.fills[key];
  if (!f) return { type: 'glass', glass_type_id: elev.default_glass_type_id ?? null };
  if (f.type === 'glass' && !f.glass_type_id) return { ...f, glass_type_id: elev.default_glass_type_id ?? null };
  return f;
}

export function bayLevels(elev: Elevation, bay: number): number[] {
  return [0, ...elev.bays[bay].transoms, elev.height];
}

export interface FieldRect {
  key: string;
  bay: number;
  field: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function fieldRects(elev: Elevation): FieldRect[] {
  const out: FieldRect[] = [];
  const n = Math.min(elev.bays.length, Math.max(0, elev.mullions.length - 1));
  for (let b = 0; b < n; b++) {
    const x0 = elev.mullions[b];
    const x1 = elev.mullions[b + 1];
    const ys = bayLevels(elev, b);
    for (let f = 0; f < ys.length - 1; f++) out.push({ key: fillKey(b, f), bay: b, field: f, x0, x1, y0: ys[f], y1: ys[f + 1] });
  }
  return out;
}

export function resolveRuleSet(elev: Elevation, cat: Catalogue, ruleSetId?: string | null): CatRuleSet | null {
  if (ruleSetId) return getRuleSet(cat, ruleSetId);
  const s = getSeries(cat, elev.system_id);
  return s ? getRuleSet(cat, s.default_rule_set_id) : null;
}

export function effectiveMullionProfileId(elev: Elevation, cat: Catalogue | null): string | null {
  if (elev.mullion_profile_id) return elev.mullion_profile_id;
  if (cat) {
    const s = getSeries(cat, elev.system_id);
    if (s) return s.default_mullion_profile_id || s.mullion_profile_ids?.[0] || null;
  }
  return null;
}

export function effectiveTransomProfileId(elev: Elevation, bay: number, cat: Catalogue | null): string | null {
  if (bay >= 0 && bay < elev.bays.length && elev.bays[bay].transom_profile_id) return elev.bays[bay].transom_profile_id!;
  if (elev.transom_profile_id) return elev.transom_profile_id;
  if (cat) {
    const s = getSeries(cat, elev.system_id);
    if (s) return s.default_transom_profile_id || s.transom_profile_ids?.[0] || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateElevation(elev: Elevation, cat: Catalogue | null = null, ruleSetId: string | null = null): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, severity: Severity, message: string, ref: string | null = null) =>
    issues.push({ code, severity, message, ref });

  const W = elev.width;
  const H = elev.height;
  if (!(W && W > 0)) add('INVALID_WIDTH', 'error', `Framework width must be > 0 (got ${W})`, 'width');
  if (!(H && H > 0)) add('INVALID_HEIGHT', 'error', `Framework height must be > 0 (got ${H})`, 'height');
  if (elev.quantity == null || elev.quantity < 1) add('INVALID_QUANTITY', 'error', 'Quantity must be >= 1', 'quantity');
  if (issues.length) return issues;

  const m = elev.mullions;
  let geomOk = true;
  if (m.length < 2) {
    add('MULLIONS_TOO_FEW', 'error', 'At least two mullion lines (both edges) are required', 'mullions');
    geomOk = false;
  } else {
    if (Math.abs(m[0]) > EPS) {
      add('MULLION_FIRST_NOT_ZERO', 'error', `First mullion must be at x=0 (got ${m[0]})`, 'mullion:0');
      geomOk = false;
    }
    if (Math.abs(m[m.length - 1] - W) > EPS) {
      add('MULLION_LAST_NOT_WIDTH', 'error', `Last mullion must be at x=width=${W} (got ${m[m.length - 1]})`, `mullion:${m.length - 1}`);
      geomOk = false;
    }
    for (let i = 1; i < m.length; i++) {
      if (m[i] <= m[i - 1] + EPS) {
        add('MULLIONS_NOT_INCREASING', 'error', `Mullion positions must be strictly increasing (x[${i - 1}]=${m[i - 1]}, x[${i}]=${m[i]})`, `mullion:${i}`);
        geomOk = false;
      }
    }
    if (elev.bays.length !== m.length - 1) {
      add('BAY_COUNT_MISMATCH', 'error', `Number of bays (${elev.bays.length}) must equal mullion lines - 1 (${m.length - 1})`, 'bays');
      geomOk = false;
    }
  }

  elev.bays.forEach((bay, b) => {
    let prev = 0;
    bay.transoms.forEach((y, j) => {
      if (y <= EPS || y >= H - EPS) {
        add('TRANSOM_OUTSIDE', 'error', `Transom y=${y} must be strictly inside (0, ${H})`, `bay:${b}/transom:${j}`);
        geomOk = false;
      } else if (y <= prev + EPS) {
        add('TRANSOMS_NOT_INCREASING', 'error', `Transoms must be strictly increasing in bay ${b}`, `bay:${b}/transom:${j}`);
        geomOk = false;
      }
      prev = Math.max(prev, y);
    });
  });

  const ts = elev.top_shape;
  if (ts && ts.type === 'arch') {
    if (!(ts.rise > 0) || ts.rise > W / 2 + EPS) add('ARCH_RISE_INVALID', 'error', `Arch rise ${ts.rise} must be > 0 and not exceed half the width (${W / 2})`, 'top_shape');
    add('ARCH_CALC_UNSUPPORTED', 'error', 'Arched heads are geometry/display only in v1; member and glass calculation is not supported', 'top_shape');
  }

  elev.anchor_levels.forEach((y, k) => {
    if (y < -EPS || y > H + EPS) add('ANCHOR_OUTSIDE', 'error', `Anchor level y=${y} is outside the framework height (0..${H})`, `anchor:${k}`);
  });

  const nFields = new Map<number, number>();
  elev.bays.forEach((bay, b) => nFields.set(b, bay.transoms.length + 1));
  for (const key of Object.keys(elev.fills)) {
    const pk = parseFillKey(key);
    if (pk === null) add('FILL_KEY_INVALID', 'error', `Fill key '${key}' must match 'b{bay}-f{field}'`, `fill:${key}`);
    else if (!nFields.has(pk[0]) || pk[1] >= nFields.get(pk[0])!) add('FILL_KEY_ORPHAN', 'warning', `Fill key '${key}' does not refer to an existing field (ignored)`, `fill:${key}`);
  }

  if (!geomOk) return issues;

  const rects = fieldRects(elev);
  for (const r of rects) {
    if (resolveFill(elev, r.key).type === 'opening')
      add('VENT_NOT_SUPPORTED_IN_V1', 'warning', 'Opening/vent fields are not calculated in v1 (no glass or vent hardware produced)', `bay:${r.bay}/field:${r.field}`);
  }

  if (cat === null) return issues;

  // ---- catalogue-dependent checks ----
  const series = getSeries(cat, elev.system_id);
  if (!elev.system_id) add('SYSTEM_NOT_SET', 'error', 'No system (series) selected', 'system_id');
  else if (series === null) add('SYSTEM_NOT_FOUND', 'error', `Series '${elev.system_id}' not found in catalogue`, 'system_id');

  const rs = resolveRuleSet(elev, cat, ruleSetId);
  if (ruleSetId && rs === null) add('RULE_SET_NOT_FOUND', 'error', `Rule set '${ruleSetId}' not found`, 'rule_set');
  else if (rs !== null && series !== null && rs.series_id !== series.id)
    add('RULE_SET_SERIES_MISMATCH', 'error', `Rule set '${rs.id}' belongs to another series`, 'rule_set');

  const checkProfile = (pid: string | null, role: 'mullion' | 'transom', ref: string) => {
    if (!pid) {
      add('PROFILE_NOT_SET', 'error', `No ${role} profile selected`, ref);
      return;
    }
    const p = getProfile(cat, pid);
    if (p === null) {
      add('PROFILE_NOT_FOUND', 'error', `Profile '${pid}' not found`, ref);
      return;
    }
    if (p.role !== role) add('PROFILE_WRONG_ROLE', 'error', `Profile '${pid}' is a ${p.role}, not a ${role}`, ref);
    if (series !== null) {
      const allowed = (role === 'mullion' ? series.mullion_profile_ids : series.transom_profile_ids) ?? [];
      if (p.series_id !== series.id || (allowed.length && !allowed.includes(pid)))
        add('PROFILE_NOT_IN_SERIES', 'error', `Profile '${pid}' does not belong to series '${series.id}'`, ref);
    }
  };

  if (series !== null) {
    checkProfile(effectiveMullionProfileId(elev, cat), 'mullion', 'mullion_profile_id');
    const seen = new Set<string | null>();
    for (let b = 0; b < elev.bays.length; b++) {
      const tid = effectiveTransomProfileId(elev, b, cat);
      if (seen.has(tid)) continue;
      seen.add(tid);
      checkProfile(tid, 'transom', `bay:${b}/transom_profile_id`);
    }
    if (elev.colour_id && getColour(cat, elev.colour_id) === null) add('COLOUR_NOT_FOUND', 'error', `Colour '${elev.colour_id}' not found`, 'colour_id');
  }

  const tRanges: [number, number, string][] = [];
  if (series !== null) {
    if (series.glass_thickness_min != null && series.glass_thickness_max != null)
      tRanges.push([series.glass_thickness_min, series.glass_thickness_max, `series:${series.id}`]);
    for (const c of compatibilityRules(cat, series.id, 'glass_thickness_range')) tRanges.push([c.params.min ?? 0, c.params.max ?? 1e9, c.id]);
  }
  const sizeRules = series ? compatibilityRules(cat, series.id, 'max_field_size') : [];

  const p = rs?.params ?? {};
  for (const r of rects) {
    const ref = `bay:${r.bay}/field:${r.field}`;
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (rs !== null) {
      if ('min_field_width' in p && w < p.min_field_width - EPS) add('FIELD_TOO_NARROW', 'error', `Field width ${w.toFixed(1)} < min ${p.min_field_width}`, ref);
      if ('max_field_width' in p && w > p.max_field_width + EPS) add('FIELD_TOO_WIDE', 'error', `Field width ${w.toFixed(1)} > max ${p.max_field_width}`, ref);
      if ('min_field_height' in p && h < p.min_field_height - EPS) add('FIELD_TOO_SHORT', 'error', `Field height ${h.toFixed(1)} < min ${p.min_field_height}`, ref);
      if ('max_field_height' in p && h > p.max_field_height + EPS) add('FIELD_TOO_TALL', 'error', `Field height ${h.toFixed(1)} > max ${p.max_field_height}`, ref);
    }
    for (const c of sizeRules) {
      const ma = c.params.max_area_m2;
      if (ma != null && (w * h) / 1e6 > ma + EPS)
        add('FIELD_AREA_EXCEEDS_LIMIT', 'warning', `Field axis area ${((w * h) / 1e6).toFixed(2)} m2 > ${ma} m2 (${c.message ?? ''})`, ref);
    }
    const f = resolveFill(elev, r.key);
    if (f.type === 'glass' || f.type === 'spandrel') {
      if (!f.glass_type_id) {
        add('GLASS_TYPE_UNSPECIFIED', 'warning', 'No glass type selected for this field', ref);
        continue;
      }
      const g = getGlassType(cat, f.glass_type_id);
      if (g === null) {
        add('GLASS_TYPE_NOT_FOUND', 'error', `Glass type '${f.glass_type_id}' not found`, ref);
        continue;
      }
      if (f.type === 'spandrel' && g.category !== 'spandrel') add('SPANDREL_GLASS_CATEGORY', 'warning', `Spandrel field uses glass category '${g.category}'`, ref);
      if (g.category === 'fire') add('FIRE_RATING_NOT_CERTIFIED', 'warning', 'Fire glass selected: no certified fire rating in catalogue; must be supplied', ref);
      checkThickness(g.thickness, tRanges, ref, add, f.glass_type_id);
    } else if (f.type === 'panel') {
      if (!f.panel_type_id) {
        add('PANEL_TYPE_MISSING', 'error', 'Panel field without panel_type_id', ref);
        continue;
      }
      const pt = getPanelType(cat, f.panel_type_id);
      if (pt === null) {
        add('PANEL_TYPE_NOT_FOUND', 'error', `Panel type '${f.panel_type_id}' not found`, ref);
        continue;
      }
      checkThickness(pt.thickness, tRanges, ref, add, f.panel_type_id, 'PANEL_THICKNESS_OUTSIDE_GLAZING_RANGE', 'warning');
    }
  }
  return issues;
}

function checkThickness(
  t: number | null | undefined,
  ranges: [number, number, string][],
  ref: string,
  add: (code: string, sev: Severity, msg: string, ref?: string | null) => void,
  itemId: string,
  code = 'GLASS_THICKNESS_INCOMPATIBLE',
  severity: Severity = 'error',
): void {
  if (t == null) {
    add('FILL_THICKNESS_UNKNOWN', 'warning', `Fill '${itemId}' has no thickness; compatibility cannot be checked`, ref);
    return;
  }
  for (const [lo, hi, src] of ranges) {
    if (t < lo - EPS || t > hi + EPS) {
      add(code, severity, `Fill '${itemId}' thickness ${t} mm outside ${lo}-${hi} mm (${src})` + (severity === 'error' ? '' : '; packers/adaptor needed - requires engineering approval'), ref);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Construction & pure editing helpers (throw Error with a user-facing message on invalid edits)
// ---------------------------------------------------------------------------
export function makeGrid(width: number, height: number, nBays: number, nRows: number, extra: Partial<Elevation> = {}): Elevation {
  if (nBays < 1 || nRows < 1) throw new Error('n_bays and n_rows must be >= 1');
  const mullions = Array.from({ length: nBays + 1 }, (_, i) => (width * i) / nBays);
  mullions[0] = 0;
  mullions[mullions.length - 1] = width;
  const transoms = Array.from({ length: nRows - 1 }, (_, j) => (height * (j + 1)) / nRows);
  return {
    name: 'Elevation',
    units: 'mm',
    fills: {},
    top_shape: { type: 'flat' },
    anchor_levels: [],
    quantity: 1,
    ...extra,
    width,
    height,
    mullions,
    bays: Array.from({ length: nBays }, () => ({ transoms: [...transoms] })),
  };
}

export function cloneElevation(e: Elevation): Elevation {
  return JSON.parse(JSON.stringify(e)) as Elevation;
}

function remapFills(fills: Record<string, FieldFill>, fn: (bay: number, field: number) => [number, number][]): Record<string, FieldFill> {
  const out: Record<string, FieldFill> = {};
  for (const [k, v] of Object.entries(fills)) {
    const pk = parseFillKey(k);
    if (!pk) continue;
    for (const [nb, nf] of fn(pk[0], pk[1])) out[fillKey(nb, nf)] = { ...v };
  }
  return out;
}

/** Insert a mullion at x, splitting the bay containing it; both halves inherit transoms and fills. */
export function addMullion(elev: Elevation, x: number): Elevation {
  if (!(x > EPS && x < elev.width - EPS)) throw new Error('mullion must be strictly inside the framework width');
  if (elev.mullions.some((mx) => Math.abs(x - mx) <= EPS)) throw new Error('a mullion already exists at this position');
  const e = cloneElevation(elev);
  let b = 0;
  e.mullions.slice(0, -1).forEach((mx, i) => {
    if (mx < x) b = i;
  });
  e.mullions.splice(b + 1, 0, x);
  e.bays.splice(b + 1, 0, cloneBay(e.bays[b]));
  e.fills = remapFills(e.fills, (bb, ff) => (bb < b ? [[bb, ff]] : bb === b ? [[bb, ff], [bb + 1, ff]] : [[bb + 1, ff]]));
  return e;
}

function cloneBay(b: Bay): Bay {
  return { ...b, transoms: [...b.transoms] };
}

/** Remove internal mullion line (1..n-2), merging bays; merged bay keeps the LEFT bay's transoms/fills. */
export function removeMullion(elev: Elevation, index: number): Elevation {
  if (!(index >= 1 && index <= elev.mullions.length - 2)) throw new Error('only internal mullions can be removed');
  const e = cloneElevation(elev);
  e.mullions.splice(index, 1);
  e.bays.splice(index, 1);
  e.fills = remapFills(e.fills, (bb, ff) => (bb < index ? [[bb, ff]] : bb === index ? [] : [[bb - 1, ff]]));
  return e;
}

export function moveMullion(elev: Elevation, index: number, x: number): Elevation {
  if (!(index >= 1 && index <= elev.mullions.length - 2)) throw new Error('only internal mullions can be moved');
  if (!(elev.mullions[index - 1] + EPS < x && x < elev.mullions[index + 1] - EPS)) throw new Error('mullion must stay between its neighbours');
  const e = cloneElevation(elev);
  e.mullions[index] = x;
  return e;
}

/** Insert a transom at height y in a bay; both resulting fields inherit the split field's fill. */
export function addTransom(elev: Elevation, bay: number, y: number): Elevation {
  if (!(bay >= 0 && bay < elev.bays.length)) throw new Error('bay index out of range');
  if (!(y > EPS && y < elev.height - EPS)) throw new Error('transom must be strictly inside the framework height');
  const tr = elev.bays[bay].transoms;
  if (tr.some((t) => Math.abs(y - t) <= EPS)) throw new Error('a transom already exists at this height');
  const e = cloneElevation(elev);
  const j = tr.filter((t) => t < y).length;
  e.bays[bay].transoms = [...tr, y].sort((a, b) => a - b);
  e.fills = remapFills(e.fills, (bb, ff) => (bb !== bay || ff < j ? [[bb, ff]] : ff === j ? [[bb, ff], [bb, ff + 1]] : [[bb, ff + 1]]));
  return e;
}

export function addTransomAllBays(elev: Elevation, y: number): Elevation {
  let e = elev;
  for (let b = 0; b < elev.bays.length; b++) {
    if (!e.bays[b].transoms.some((t) => Math.abs(y - t) <= EPS)) e = addTransom(e, b, y);
  }
  return e;
}

/** Remove transom `index` of a bay; the merged field keeps the LOWER field's fill. */
export function removeTransom(elev: Elevation, bay: number, index: number): Elevation {
  if (!(bay >= 0 && bay < elev.bays.length) || !(index >= 0 && index < elev.bays[bay].transoms.length)) throw new Error('transom index out of range');
  const e = cloneElevation(elev);
  e.bays[bay].transoms.splice(index, 1);
  const upper = index + 1;
  e.fills = remapFills(e.fills, (bb, ff) => (bb !== bay || ff < upper ? [[bb, ff]] : ff === upper ? [] : [[bb, ff - 1]]));
  return e;
}

export function moveTransom(elev: Elevation, bay: number, index: number, y: number): Elevation {
  const tr = elev.bays[bay]?.transoms ?? [];
  if (!(index >= 0 && index < tr.length)) throw new Error('transom index out of range');
  const lo = index > 0 ? tr[index - 1] : 0;
  const hi = index + 1 < tr.length ? tr[index + 1] : elev.height;
  if (!(lo + EPS < y && y < hi - EPS)) throw new Error('transom must stay between its neighbours');
  const e = cloneElevation(elev);
  e.bays[bay].transoms[index] = y;
  return e;
}

export function setFill(elev: Elevation, bay: number, field: number, fill: FieldFill): Elevation {
  if (!(bay >= 0 && bay < elev.bays.length) || !(field >= 0 && field <= elev.bays[bay].transoms.length)) throw new Error('field out of range');
  const e = cloneElevation(elev);
  e.fills[fillKey(bay, field)] = { ...fill };
  return e;
}

/** Scale mullion/transom/anchor positions proportionally to a new overall size. */
export function resize(elev: Elevation, width?: number | null, height?: number | null): Elevation {
  const e = cloneElevation(elev);
  if (width != null) {
    if (width <= 0) throw new Error('width must be > 0');
    const sx = width / elev.width;
    e.mullions = elev.mullions.map((mx) => mx * sx);
    e.mullions[e.mullions.length - 1] = width;
    e.width = width;
  }
  if (height != null) {
    if (height <= 0) throw new Error('height must be > 0');
    const sy = height / elev.height;
    e.bays = e.bays.map((b) => ({ ...b, transoms: b.transoms.map((t) => t * sy) }));
    e.anchor_levels = e.anchor_levels.map((a) => a * sy);
    e.height = height;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Structural parsing (pydantic-equivalent shape validation for JSON import)
// ---------------------------------------------------------------------------
const FILL_TYPES = ['glass', 'spandrel', 'panel', 'none', 'opening'];

export function parseElevationJson(input: unknown): { elevation: Elevation | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const err = (ref: string, message: string) => issues.push({ code: 'SCHEMA_ERROR', severity: 'error', message, ref });
  const o = (input && typeof input === 'object' ? input : null) as Record<string, unknown> | null;
  if (!o) return { elevation: null, issues: [{ code: 'SCHEMA_ERROR', severity: 'error', message: 'Root must be a JSON object', ref: null }] };
  // allow a wrapper { elevation: {...} } (e.g. a CalcRequest)
  const src = (o.elevation && typeof o.elevation === 'object' ? o.elevation : o) as Record<string, unknown>;
  const num = (k: string, gt0 = false): number => {
    const v = src[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      err(k, `${k} must be a number`);
      return NaN;
    }
    if (gt0 && !(v > 0)) err(k, `${k} must be > 0`);
    return v;
  };
  const width = num('width', true);
  const height = num('height', true);
  const mullions = Array.isArray(src.mullions) && src.mullions.every((x) => typeof x === 'number') ? (src.mullions as number[]) : (err('mullions', 'mullions must be an array of numbers'), []);
  const baysRaw = Array.isArray(src.bays) ? src.bays : (err('bays', 'bays must be an array'), []);
  const bays: Bay[] = [];
  baysRaw.forEach((b: unknown, i: number) => {
    const bo = b as Record<string, unknown> | null;
    const tr = bo && Array.isArray(bo.transoms) ? bo.transoms : bo && bo.transoms === undefined ? [] : null;
    if (!bo || tr === null || !tr.every((t: unknown) => typeof t === 'number')) err(`bays.${i}`, 'bay.transoms must be an array of numbers');
    else bays.push({ transoms: tr as number[], transom_profile_id: typeof bo.transom_profile_id === 'string' ? bo.transom_profile_id : null });
  });
  const fills: Record<string, FieldFill> = {};
  if (src.fills !== undefined && (typeof src.fills !== 'object' || src.fills === null)) err('fills', 'fills must be an object');
  else
    for (const [k, v] of Object.entries((src.fills as Record<string, unknown>) ?? {})) {
      const fo = v as Record<string, unknown> | null;
      if (!fo || !FILL_TYPES.includes(String(fo.type ?? 'glass'))) {
        err(`fills.${k}`, `fill type must be one of ${FILL_TYPES.join(', ')}`);
        continue;
      }
      fills[k] = {
        type: (fo.type ?? 'glass') as FieldFill['type'],
        glass_type_id: typeof fo.glass_type_id === 'string' ? fo.glass_type_id : null,
        panel_type_id: typeof fo.panel_type_id === 'string' ? fo.panel_type_id : null,
        note: typeof fo.note === 'string' ? fo.note : null,
      };
    }
  let top_shape: Elevation['top_shape'] = { type: 'flat' };
  const tsRaw = src.top_shape as Record<string, unknown> | undefined;
  if (tsRaw && tsRaw.type === 'arch') {
    if (typeof tsRaw.rise !== 'number' || !(tsRaw.rise > 0)) err('top_shape.rise', 'arch rise must be a number > 0');
    else top_shape = { type: 'arch', rise: tsRaw.rise };
  } else if (tsRaw && tsRaw.type !== 'flat') err('top_shape', "top_shape.type must be 'flat' or 'arch'");
  const quantity = src.quantity === undefined ? 1 : src.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) err('quantity', 'quantity must be an integer >= 1');
  const anchors = src.anchor_levels === undefined ? [] : src.anchor_levels;
  if (!Array.isArray(anchors) || !anchors.every((a) => typeof a === 'number')) err('anchor_levels', 'anchor_levels must be an array of numbers');
  if (src.units !== undefined && src.units !== 'mm') err('units', "units must be 'mm'");
  const str = (k: string) => (typeof src[k] === 'string' ? (src[k] as string) : null);
  if (issues.length) return { elevation: null, issues };
  return {
    elevation: {
      id: str('id'),
      name: str('name') ?? 'Imported elevation',
      units: 'mm',
      width,
      height,
      mullions,
      bays,
      fills,
      top_shape,
      system_id: str('system_id'),
      mullion_profile_id: str('mullion_profile_id'),
      transom_profile_id: str('transom_profile_id'),
      colour_id: str('colour_id'),
      default_glass_type_id: str('default_glass_type_id'),
      anchor_levels: anchors as number[],
      quantity: quantity as number,
    },
    issues,
  };
}
