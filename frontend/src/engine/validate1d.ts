/**
 * INDEPENDENT 1D feasibility validator (TS port of validators.validate_1d, ARCHITECTURE §3).
 * Deliberately imports nothing from the optimiser: everything is re-derived from the request.
 */
import type { Cutting1DRequest, Cutting1DResult, Issue, ValidationReport } from '../api/types';

export const VALIDATOR_1D = 'validate_1d/1.0+ts';
const EPS = 1e-6;
const SUM_TOL = 0.01;

export function validate1D(req: Cutting1DRequest, result: Cutting1DResult): ValidationReport {
  const errors: Issue[] = [];
  let checked = 0;
  const err = (code: string, message: string, ref: string | null = null) => {
    if (errors.length < 500) errors.push({ code, severity: 'error', message, ref });
  };
  const kerf = req.kerf ?? 4;
  const ts = req.trim_start ?? 10;
  const te = req.trim_end ?? 0;
  const minOff = req.min_reusable_offcut ?? 500;

  const demand = new Map<string, number>();
  const plen = new Map<string, number>();
  const pang = new Map<string, [number, number]>();
  for (const p of req.pieces) {
    if (plen.has(p.id) && Math.abs(plen.get(p.id)! - p.length) > EPS) err('REQUEST_DUPLICATE_PIECE_ID', `piece id '${p.id}' used with different lengths`, `piece:${p.id}`);
    plen.set(p.id, p.length);
    pang.set(p.id, [p.angle_start ?? 90, p.angle_end ?? 90]);
    demand.set(p.id, (demand.get(p.id) ?? 0) + p.quantity);
  }
  const stocks = new Map(req.stocks.map((s) => [s.id, s]));
  const placed = new Map<string, number>();
  const stockUsed = new Map<string, number>();
  let totStock = 0,
    totPiece = 0,
    totKerf = 0,
    totTrim = 0,
    totReuse = 0,
    totWaste = 0,
    totCost = 0,
    anyCost = false,
    bars = 0;

  for (const pat of result.patterns) {
    const ref = `pattern:${pat.pattern_id}`;
    checked++;
    const st = stocks.get(pat.stock_id);
    if (!st) {
      err('UNKNOWN_STOCK', `stock '${pat.stock_id}' not in request`, ref);
      continue;
    }
    if (Math.abs(pat.stock_length - st.length) > EPS) err('STOCK_LENGTH_MISMATCH', `pattern stock_length ${pat.stock_length} != stock ${st.length}`, ref);
    if (pat.is_offcut_stock !== !!st.is_offcut) err('OFFCUT_FLAG_MISMATCH', 'is_offcut_stock does not match stock', ref);
    if (!(pat.count >= 1)) {
      err('BAD_PATTERN_COUNT', 'pattern count must be >= 1', ref);
      continue;
    }
    if (!pat.cuts.length) {
      err('EMPTY_PATTERN', 'pattern has no cuts', ref);
      continue;
    }
    const L = st.length;
    let expected = ts;
    let prevEnd: number | null = null;
    let sumP = 0;
    pat.cuts.forEach((cut, i) => {
      const cref = `${ref}/cut:${i}`;
      if (!plen.has(cut.piece_id)) {
        err('UNKNOWN_PIECE', `piece '${cut.piece_id}' not in request`, cref);
        return;
      }
      if (Math.abs(cut.length - plen.get(cut.piece_id)!) > EPS) err('CUT_LENGTH_MISMATCH', `cut length ${cut.length} != piece length ${plen.get(cut.piece_id)}`, cref);
      const [a0, a1] = pang.get(cut.piece_id)!;
      if (Math.abs(cut.angle_start - a0) > EPS || Math.abs(cut.angle_end - a1) > EPS) err('CUT_ANGLE_MISMATCH', 'cut angles differ from piece angles', cref);
      if (i === 0) {
        if (Math.abs(cut.offset - ts) > EPS) err('FIRST_OFFSET_NOT_TRIM', `first offset ${cut.offset} != trim_start ${ts}`, cref);
      } else if (cut.offset < expected - EPS) err('CUT_OVERLAP', `offset ${cut.offset} < previous end + kerf (${expected})`, cref);
      expected = cut.offset + cut.length + kerf;
      prevEnd = cut.offset + cut.length;
      sumP += cut.length;
      placed.set(cut.piece_id, (placed.get(cut.piece_id) ?? 0) + pat.count);
    });
    if (prevEnd === null) continue;
    const used = (prevEnd as number) + kerf;
    if (used + te > L + EPS) err('BAR_OVERFLOW', `last cut end + kerf + trim_end = ${used + te} > stock length ${L}`, ref);
    if (Math.abs(pat.used_length - used) > SUM_TOL) err('USED_LENGTH_MISMATCH', `used_length ${pat.used_length} != recomputed ${used}`, ref);
    const remainder = L - used - te;
    if (Math.abs(pat.remainder - remainder) > SUM_TOL) err('REMAINDER_MISMATCH', `remainder ${pat.remainder} != recomputed ${remainder}`, ref);
    const reusable = remainder + EPS >= minOff;
    if (pat.offcut_reusable !== reusable) err('OFFCUT_FLAG_WRONG', `offcut_reusable should be ${reusable}`, ref);
    const waste = reusable ? 0 : Math.max(remainder, 0);
    if (Math.abs(pat.waste - waste) > SUM_TOL) err('WASTE_MISMATCH', `waste ${pat.waste} != recomputed ${waste}`, ref);
    const k = pat.count;
    bars += k;
    stockUsed.set(st.id, (stockUsed.get(st.id) ?? 0) + k);
    totStock += k * L;
    totPiece += k * sumP;
    totKerf += k * (used - ts - sumP);
    totTrim += k * (ts + te);
    totReuse += k * (reusable ? remainder : 0);
    totWaste += k * waste;
    if (st.cost_per_bar != null) {
      anyCost = true;
      totCost += k * st.cost_per_bar;
    }
  }
  for (const [sid, n] of stockUsed) {
    const q = stocks.get(sid)!.quantity;
    if (q != null && n > q) err('STOCK_QTY_EXCEEDED', `stock '${sid}' used ${n} times, only ${q} available`, `stock:${sid}`);
  }
  const unplaced = new Map<string, number>();
  for (const u of result.unplaced) {
    if (!plen.has(u.id)) err('UNKNOWN_UNPLACED', `unplaced piece '${u.id}' not in request`, `piece:${u.id}`);
    unplaced.set(u.id, (unplaced.get(u.id) ?? 0) + u.quantity);
  }
  for (const [pid, q] of demand) {
    checked++;
    if ((placed.get(pid) ?? 0) + (unplaced.get(pid) ?? 0) !== q)
      err('QUANTITY_MISMATCH', `piece '${pid}': demanded ${q}, placed ${placed.get(pid) ?? 0}, unplaced ${unplaced.get(pid) ?? 0}`, `piece:${pid}`);
  }
  for (const pid of placed.keys()) if (!demand.has(pid)) err('UNKNOWN_PIECE', `placed piece '${pid}' not demanded`, `piece:${pid}`);

  const s = result.summary;
  const checks: [string, number, number, number][] = [
    ['bars_used', s.bars_used, bars, 0],
    ['total_stock_length', s.total_stock_length, totStock, SUM_TOL],
    ['total_piece_length', s.total_piece_length, totPiece, SUM_TOL],
    ['total_kerf_loss', s.total_kerf_loss, totKerf, SUM_TOL],
    ['total_trim_loss', s.total_trim_loss, totTrim, SUM_TOL],
    ['reusable_offcut_length', s.reusable_offcut_length, totReuse, SUM_TOL],
    ['waste_length', s.waste_length, totWaste, SUM_TOL],
  ];
  for (const [name, got, exp, tol] of checks) if (Math.abs(got - exp) > tol) err('SUMMARY_MISMATCH', `summary.${name} = ${got}, recomputed ${exp}`, 'summary');
  const util = totStock > 0 ? totPiece / totStock : 0;
  if (Math.abs(s.utilization - util) > 1e-6) err('SUMMARY_MISMATCH', `summary.utilization = ${s.utilization}, recomputed ${util}`, 'summary');
  const expCost = anyCost ? totCost : null;
  const gotCost = s.total_cost ?? null;
  if ((gotCost === null) !== (expCost === null) || (gotCost !== null && expCost !== null && Math.abs(gotCost - expCost) > SUM_TOL))
    err('SUMMARY_MISMATCH', `summary.total_cost = ${gotCost}, recomputed ${expCost}`, 'summary');

  let nUnplaced = 0;
  for (const v of unplaced.values()) nUnplaced += v;
  if (nUnplaced && (result.status === 'OPTIMAL' || result.status === 'FEASIBLE')) err('STATUS_INCONSISTENT', `status ${result.status} but ${nUnplaced} pieces unplaced`, 'status');
  if (!nUnplaced && (result.status === 'PARTIAL' || result.status === 'INFEASIBLE') && demand.size) err('STATUS_INCONSISTENT', `status ${result.status} but every piece placed`, 'status');
  const caps = req.stocks.filter((st) => st.quantity == null || st.quantity > 0).map((st) => st.length - ts - te);
  if (!nUnplaced && caps.length && Math.max(...caps) > 0) {
    let need = 0;
    for (const [pid, q] of demand) need += (plen.get(pid)! + kerf) * q;
    const lb = Math.ceil(need / Math.max(...caps) - 1e-9);
    if (bars < lb) err('BELOW_LOWER_BOUND', `bars used ${bars} < independent lower bound ${lb}`, 'proof');
    if (result.proof && result.proof.lower_bound_bars > bars) err('PROOF_INCONSISTENT', 'reported lower bound exceeds bars used', 'proof');
    // an OPTIMAL claim must be backed: offline engines may only claim it when bars == independent bound
    if (result.validation_status === 'OPTIMAL_PROVEN' && result.engine_version.includes('offline') && bars !== lb)
      err('OPTIMALITY_UNPROVEN', `OPTIMAL_PROVEN claimed offline but bars ${bars} != lower bound ${lb}`, 'proof');
  }
  return { passed: errors.length === 0, validator: VALIDATOR_1D, errors, checked_items: checked };
}
