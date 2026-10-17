/**
 * INDEPENDENT 2D feasibility validator (TS port of validators.validate_2d, ARCHITECTURE §4).
 * Imports nothing from the nesting optimiser.
 */
import type { Issue, Nesting2DRequest, Nesting2DResult, Piece2D, ValidationReport } from '../api/types';

export const VALIDATOR_2D = 'validate_2d/1.0+ts';
const EPS = 1e-6;
const AREA_TOL_M2 = 1e-6;
type R = [number, number, number, number];

const norm = (s?: string | null) => (typeof s === 'string' && s.trim() ? s.trim().toLowerCase() : null);

/** A rect set is guillotine-separable if it is a single piece or a full straight cut strip of width
 * `kerf` exists touching no piece and splitting it into two non-empty separable subsets. */
export function guillotineOk(rects: R[], kerf: number): boolean {
  const stack: R[][] = [rects];
  while (stack.length) {
    const rs = stack.pop()!;
    if (rs.length <= 1) continue;
    let split: [R[], R[]] | null = null;
    for (const axis of [0, 1] as const) {
      const srt = [...rs].sort((a, b) => a[axis] - b[axis]);
      let maxEnd = -Infinity;
      for (let i = 0; i < srt.length - 1; i++) {
        maxEnd = Math.max(maxEnd, srt[i][axis] + srt[i][axis + 2]);
        if (maxEnd + kerf <= srt[i + 1][axis] + EPS) {
          split = [srt.slice(0, i + 1), srt.slice(i + 1)];
          break;
        }
      }
      if (split) break;
    }
    if (!split) return false;
    stack.push(...split);
  }
  return true;
}

export function validate2D(req: Nesting2DRequest, result: Nesting2DResult): ValidationReport {
  const errors: Issue[] = [];
  let checked = 0;
  const err = (code: string, message: string, ref: string | null = null) => {
    if (errors.length < 500) errors.push({ code, severity: 'error', message, ref });
  };
  const k = req.kerf ?? 3;
  const tr = { left: 0, right: 0, top: 0, bottom: 0, ...(req.edge_trim ?? {}) };
  const minW = req.min_residual_width ?? 300;
  const minH = req.min_residual_height ?? 300;
  const pieces = new Map<string, Piece2D>();
  const demand = new Map<string, number>();
  for (const p of req.pieces) {
    pieces.set(p.id, p);
    demand.set(p.id, (demand.get(p.id) ?? 0) + p.quantity);
  }
  const sheets = new Map(req.sheets.map((s) => [s.id, s]));
  const placed = new Map<string, number>();
  const sheetUsed = new Map<string, number>();
  let totSheet = 0,
    totPiece = 0,
    totReuse = 0,
    totCost = 0,
    anyCost = false,
    nSheets = 0;

  for (const lay of result.layouts) {
    const ref = `layout:${lay.layout_id}`;
    checked++;
    const sh = sheets.get(lay.sheet_id);
    if (!sh) {
      err('UNKNOWN_SHEET', `sheet '${lay.sheet_id}' not in request`, ref);
      continue;
    }
    if (Math.abs(lay.width - sh.width) > EPS || Math.abs(lay.height - sh.height) > EPS) err('SHEET_SIZE_MISMATCH', 'layout size differs from sheet', ref);
    if (lay.is_residual_sheet !== !!sh.is_residual) err('RESIDUAL_FLAG_MISMATCH', 'is_residual_sheet does not match sheet', ref);
    if (!(lay.count >= 1)) {
      err('BAD_LAYOUT_COUNT', 'layout count must be >= 1', ref);
      continue;
    }
    if (!lay.placements.length) err('EMPTY_LAYOUT', 'layout has no placements', ref);
    const x0 = tr.left;
    const x1 = sh.width - tr.right;
    const y0 = tr.bottom;
    const y1 = sh.height - tr.top;
    const rects: R[] = [];
    let area = 0;
    lay.placements.forEach((pl, i) => {
      const pref = `${ref}/placement:${i}`;
      checked++;
      const p = pieces.get(pl.piece_id);
      if (!p) {
        err('UNKNOWN_PIECE', `piece '${pl.piece_id}' not in request`, pref);
        return;
      }
      let ok: boolean;
      if (pl.rotated) {
        if (p.can_rotate === false) err('ROTATION_NOT_ALLOWED', `piece '${p.id}' rotated but can_rotate is false`, pref);
        ok = Math.abs(pl.width - p.height) <= EPS && Math.abs(pl.height - p.width) <= EPS;
      } else ok = Math.abs(pl.width - p.width) <= EPS && Math.abs(pl.height - p.height) <= EPS;
      if (!ok) err('PLACEMENT_SIZE_MISMATCH', `placed ${pl.width}x${pl.height} does not match piece ${p.width}x${p.height} (rotated=${pl.rotated})`, pref);
      if (pl.x < x0 - EPS || pl.y < y0 - EPS || pl.x + pl.width > x1 + EPS || pl.y + pl.height > y1 + EPS)
        err('OUTSIDE_USABLE_AREA', `placement (${pl.x},${pl.y},${pl.width},${pl.height}) outside usable area [${x0},${x1}]x[${y0},${y1}]`, pref);
      const pm = norm(p.material);
      const sm = norm(sh.material);
      if (pm && sm && pm !== sm) err('MATERIAL_MISMATCH', `piece material '${p.material}' on sheet '${sh.material}'`, pref);
      if (p.thickness != null && sh.thickness != null && Math.abs(p.thickness - sh.thickness) > EPS) err('THICKNESS_MISMATCH', `piece thickness ${p.thickness} on sheet ${sh.thickness}`, pref);
      rects.push([pl.x, pl.y, pl.width, pl.height]);
      area += p.width * p.height;
      placed.set(p.id, (placed.get(p.id) ?? 0) + lay.count);
    });
    const order = rects.map((_, j) => j).sort((a, b) => rects[a][0] - rects[b][0]);
    for (let ai = 0; ai < order.length; ai++) {
      const a = rects[order[ai]];
      for (let bi = ai + 1; bi < order.length; bi++) {
        const b = rects[order[bi]];
        if (b[0] >= a[0] + a[2] + k - EPS) break;
        const gx = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
        const gy = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
        if (gx < k - EPS && gy < k - EPS)
          err('OVERLAP_OR_KERF', `placements ${order[ai]} and ${order[bi]} closer than kerf ${k} (gap x=${gx.toFixed(3)}, y=${gy.toFixed(3)})`, ref);
      }
    }
    if ((req.guillotine ?? true) && rects.length && !guillotineOk(rects, k)) err('NOT_GUILLOTINE', 'layout is not guillotine-separable with the given kerf', ref);
    let reuseArea = 0;
    const mn = Math.min(minW, minH);
    const mx = Math.max(minW, minH);
    lay.residuals.forEach((r, j) => {
      const rref = `${ref}/residual:${j}`;
      if (r.width <= 0 || r.height <= 0) {
        err('BAD_RESIDUAL', 'residual with non-positive size', rref);
        return;
      }
      if (r.x < x0 - EPS || r.y < y0 - EPS || r.x + r.width > x1 + EPS || r.y + r.height > y1 + EPS) err('RESIDUAL_OUTSIDE', 'residual outside usable area', rref);
      for (const q of rects) {
        if (Math.min(r.x + r.width, q[0] + q[2]) - Math.max(r.x, q[0]) > EPS && Math.min(r.y + r.height, q[1] + q[3]) - Math.max(r.y, q[1]) > EPS) {
          err('RESIDUAL_OVERLAPS_PIECE', 'residual overlaps a placed piece', rref);
          break;
        }
      }
      for (const r2 of lay.residuals.slice(j + 1)) {
        if (Math.min(r.x + r.width, r2.x + r2.width) - Math.max(r.x, r2.x) > EPS && Math.min(r.y + r.height, r2.y + r2.height) - Math.max(r.y, r2.y) > EPS)
          err('RESIDUALS_OVERLAP', 'residual rectangles overlap', rref);
      }
      const reusable = Math.min(r.width, r.height) + EPS >= mn && Math.max(r.width, r.height) + EPS >= mx;
      if (r.reusable !== reusable) err('RESIDUAL_FLAG_WRONG', `reusable should be ${reusable}`, rref);
      if (reusable) reuseArea += r.width * r.height;
    });
    const sa = sh.width * sh.height;
    if (Math.abs(lay.used_area - area) > 0.01) err('USED_AREA_MISMATCH', `used_area ${lay.used_area} != ${area}`, ref);
    if (Math.abs(lay.utilization - area / sa) > 1e-6) err('UTILIZATION_MISMATCH', 'layout utilization mismatch', ref);
    nSheets += lay.count;
    sheetUsed.set(sh.id, (sheetUsed.get(sh.id) ?? 0) + lay.count);
    totSheet += lay.count * sa;
    totPiece += lay.count * area;
    totReuse += lay.count * reuseArea;
    if (sh.cost_per_sheet != null) {
      anyCost = true;
      totCost += lay.count * sh.cost_per_sheet;
    }
  }
  for (const [sid, n] of sheetUsed) {
    const q = sheets.get(sid)!.quantity;
    if (q != null && n > q) err('SHEET_QTY_EXCEEDED', `sheet '${sid}' used ${n} times, only ${q} available`, `sheet:${sid}`);
  }
  const unplaced = new Map<string, number>();
  for (const u of result.unplaced) {
    if (!pieces.has(u.id)) err('UNKNOWN_UNPLACED', `unplaced piece '${u.id}' not in request`, `piece:${u.id}`);
    unplaced.set(u.id, (unplaced.get(u.id) ?? 0) + u.quantity);
  }
  for (const [pid, q] of demand) {
    checked++;
    if ((placed.get(pid) ?? 0) + (unplaced.get(pid) ?? 0) !== q)
      err('QUANTITY_MISMATCH', `piece '${pid}': demanded ${q}, placed ${placed.get(pid) ?? 0}, unplaced ${unplaced.get(pid) ?? 0}`, `piece:${pid}`);
  }
  const s = result.summary;
  for (const [name, got, exp] of [
    ['total_sheet_area_m2', s.total_sheet_area_m2, totSheet / 1e6],
    ['total_piece_area_m2', s.total_piece_area_m2, totPiece / 1e6],
    ['reusable_residual_area_m2', s.reusable_residual_area_m2, totReuse / 1e6],
    ['waste_area_m2', s.waste_area_m2, (totSheet - totPiece - totReuse) / 1e6],
  ] as const) {
    if (Math.abs(got - exp) > AREA_TOL_M2 * Math.max(1, Math.abs(exp))) err('SUMMARY_MISMATCH', `summary.${name} = ${got}, recomputed ${exp}`, 'summary');
  }
  if (s.sheets_used !== nSheets) err('SUMMARY_MISMATCH', `summary.sheets_used = ${s.sheets_used}, recomputed ${nSheets}`, 'summary');
  const util = totSheet > 0 ? totPiece / totSheet : 0;
  if (Math.abs(s.utilization - util) > 1e-6) err('SUMMARY_MISMATCH', 'summary.utilization mismatch', 'summary');
  const expCost = anyCost ? totCost : null;
  const gotCost = s.total_cost ?? null;
  if ((gotCost === null) !== (expCost === null) || (gotCost !== null && expCost !== null && Math.abs(gotCost - expCost) > 0.01))
    err('SUMMARY_MISMATCH', 'summary.total_cost mismatch', 'summary');
  let nUnplaced = 0;
  for (const v of unplaced.values()) nUnplaced += v;
  if (nUnplaced && (result.status === 'OPTIMAL' || result.status === 'FEASIBLE')) err('STATUS_INCONSISTENT', `status ${result.status} but pieces unplaced`, 'status');
  const usable = req.sheets
    .filter((sh) => sh.quantity == null || sh.quantity > 0)
    .map((sh) => (sh.width - tr.left - tr.right) * (sh.height - tr.top - tr.bottom))
    .filter((u) => u > 0);
  if (!nUnplaced && usable.length) {
    const lb = Math.ceil(req.pieces.reduce((a, p) => a + p.width * p.height * p.quantity, 0) / Math.max(...usable) - 1e-9);
    if (nSheets < lb) err('BELOW_LOWER_BOUND', `sheets used ${nSheets} < lower bound ${lb}`, 'summary');
    if (result.status === 'OPTIMAL' && nSheets !== lb) err('STATUS_INCONSISTENT', 'OPTIMAL claimed but sheets used != area lower bound', 'status');
  }
  return { passed: errors.length === 0, validator: VALIDATOR_2D, errors, checked_items: checked };
}
