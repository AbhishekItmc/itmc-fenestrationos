/**
 * Offline 1D cutting-stock heuristic (port of the heuristic part of backend/app/engines/cutting1d.py).
 *
 * Semantics (ARCHITECTURE §3): used = trim_start + Σp + n·kerf ; remainder = L − trim_end − used ≥ 0.
 * Algorithms: FFD and BFD × two stock-opening policies, local improvement (empty the least-filled bar),
 * stock down-sizing. NO exact solver offline: OPTIMAL is claimed only when single stock length and
 * bars used == lower bound. Every result is checked by the independent validator (validate1d.ts).
 */
import type { Cut1D, Cutting1DRequest, Cutting1DResult, Issue, Pattern1D, Piece1D, Stock1D } from '../api/types';
import { validate1D } from './validate1d';

export const CUTTING_ENGINE_VERSION = 'cutting1d/0.1.0+ts-offline';
const EPS = 1e-6;

export type Req1D = Required<Pick<Cutting1DRequest, 'kerf' | 'trim_start' | 'trim_end' | 'min_reusable_offcut' | 'strategy' | 'prefer_offcuts' | 'time_limit_s'>> &
  Cutting1DRequest;

/** Apply pydantic defaults so every downstream consumer sees concrete numbers. */
export function normalize1D(req: Cutting1DRequest): Req1D {
  return {
    units: 'mm',
    material: req.material ?? null,
    kerf: req.kerf ?? 4,
    trim_start: req.trim_start ?? 10,
    trim_end: req.trim_end ?? 0,
    min_reusable_offcut: req.min_reusable_offcut ?? 500,
    strategy: req.strategy ?? 'auto',
    prefer_offcuts: req.prefer_offcuts ?? true,
    time_limit_s: req.time_limit_s ?? 10,
    stocks: req.stocks.map((s) => ({ label: null, quantity: null, cost_per_bar: null, is_offcut: false, priority: 0, ...s })),
    pieces: req.pieces.map((p) => ({ label: null, angle_start: 90, angle_end: 90, ...p })),
  };
}

interface Bar {
  stockIdx: number;
  cap: number;
  load: number;
  items: number[];
}
const free = (b: Bar) => b.cap - b.load;

interface Ctx {
  req: Req1D;
  types: Piece1D[];
  w: number[];
  stocks: Stock1D[];
  caps: number[];
}

function buildCtx(req: Req1D): [Ctx, Issue[]] {
  const issues: Issue[] = [];
  const merged = new Map<string, Piece1D>();
  for (const p of req.pieces) {
    const prev = merged.get(p.id);
    if (prev) {
      if (Math.abs(prev.length - p.length) > EPS)
        issues.push({ code: 'DUPLICATE_PIECE_ID', severity: 'error', message: `piece id '${p.id}' appears with different lengths`, ref: `piece:${p.id}` });
      merged.set(p.id, { ...prev, quantity: prev.quantity + p.quantity });
    } else merged.set(p.id, { ...p });
  }
  const types = [...merged.values()];
  return [
    { req, types, w: types.map((p) => p.length + req.kerf), stocks: req.stocks, caps: req.stocks.map((s) => s.length - req.trim_start - req.trim_end) },
    issues,
  ];
}

function cmpTuple(a: (number | boolean)[], b: (number | boolean)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

function stockOrder(ctx: Ctx, policy: 'longest' | 'shortest'): number[] {
  const S = ctx.stocks;
  const idx = S.map((_, i) => i).filter((i) => ctx.caps[i] > EPS);
  const off = idx.filter((i) => S[i].is_offcut);
  const nw = idx.filter((i) => !S[i].is_offcut);
  off.sort((a, b) => cmpTuple([-(S[a].priority ?? 0), S[a].length], [-(S[b].priority ?? 0), S[b].length]));
  const lenKey = (i: number) => (policy === 'longest' ? -S[i].length : S[i].length);
  nw.sort((a, b) => cmpTuple([-(S[a].priority ?? 0), lenKey(a)], [-(S[b].priority ?? 0), lenKey(b)]));
  if (ctx.req.prefer_offcuts) return [...off, ...nw];
  const all = [...off, ...nw];
  all.sort((a, b) => cmpTuple([-(S[a].priority ?? 0), lenKey(a)], [-(S[b].priority ?? 0), lenKey(b)]));
  return all;
}

function greedy(ctx: Ctx, fit: 'first' | 'best', policy: 'longest' | 'shortest'): [Bar[], number[]] {
  const order = stockOrder(ctx, policy);
  const remaining = new Map<number, number>(order.map((i) => [i, ctx.stocks[i].quantity ?? Infinity]));
  const items: number[] = [];
  ctx.types.forEach((p, t) => {
    for (let k = 0; k < p.quantity; k++) items.push(t);
  });
  items.sort((a, b) => cmpTuple([-ctx.types[a].length, a], [-ctx.types[b].length, b]));
  const bars: Bar[] = [];
  const unplaced: number[] = [];
  for (const t of items) {
    const wt = ctx.w[t];
    let chosen: Bar | null = null;
    if (fit === 'first') {
      for (const b of bars) if (free(b) + EPS >= wt) {
        chosen = b;
        break;
      }
    } else {
      let best = Infinity;
      for (const b of bars) {
        const f = free(b) - wt;
        if (f >= -EPS && f < best) {
          best = f;
          chosen = b;
        }
      }
    }
    if (!chosen) {
      for (const si of order) {
        if ((remaining.get(si) ?? 0) >= 1 && ctx.caps[si] + EPS >= wt) {
          remaining.set(si, (remaining.get(si) ?? 0) - 1);
          chosen = { stockIdx: si, cap: ctx.caps[si], load: 0, items: [] };
          bars.push(chosen);
          break;
        }
      }
    }
    if (!chosen) {
      unplaced.push(t);
      continue;
    }
    chosen.items.push(t);
    chosen.load += wt;
  }
  return [bars, unplaced];
}

function improve(ctx: Ctx, input: Bar[]): Bar[] {
  let bars = input.map((b) => ({ ...b, items: [...b.items] }));
  let tried = new Set<Bar>();
  while (bars.length > 1) {
    const cand = bars.filter((b) => !tried.has(b));
    if (!cand.length) break;
    let victim = cand[0];
    const vkey = (b: Bar) => [b.cap > 0 ? b.load / b.cap : 1, b.load];
    for (const b of cand) if (cmpTuple(vkey(b), vkey(victim)) < 0) victim = b;
    tried.add(victim);
    const others = bars.filter((b) => b !== victim);
    const fr = new Map<Bar, number>(others.map((b) => [b, free(b)]));
    const moves: [number, Bar][] = [];
    let ok = true;
    const vitems = [...victim.items].sort((a, b) => ctx.w[b] - ctx.w[a]);
    for (const t of vitems) {
      let best = Infinity;
      let target: Bar | null = null;
      for (const b of others) {
        const f = fr.get(b)! - ctx.w[t];
        if (f >= -EPS && f < best) {
          best = f;
          target = b;
        }
      }
      if (!target) {
        ok = false;
        break;
      }
      fr.set(target, fr.get(target)! - ctx.w[t]);
      moves.push([t, target]);
    }
    if (ok) {
      for (const [t, target] of moves) {
        target.items.push(t);
        target.load += ctx.w[t];
      }
      bars = others;
      tried = new Set();
    }
  }
  return bars;
}

function downsize(ctx: Ctx, bars: Bar[]): Bar[] {
  const count = new Map<number, number>();
  for (const b of bars) count.set(b.stockIdx, (count.get(b.stockIdx) ?? 0) + 1);
  const avail = ctx.stocks.map((s, i) => (s.quantity ?? Infinity) - (count.get(i) ?? 0));
  const preferOff = ctx.req.prefer_offcuts;
  const sorted = [...bars].sort((a, b) => b.load - a.load);
  for (const b of sorted) {
    const cur = ctx.stocks[b.stockIdx];
    let best: number | null = null;
    ctx.stocks.forEach((s, i) => {
      if (i === b.stockIdx || avail[i] < 1 || ctx.caps[i] + EPS < b.load) return;
      if (preferOff && cur.is_offcut && !s.is_offcut) return;
      let better = s.length < cur.length - EPS || (preferOff && !!s.is_offcut && !cur.is_offcut);
      if (preferOff && !s.is_offcut && cur.is_offcut) better = false;
      if (better && (best === null || s.length < ctx.stocks[best].length)) best = i;
    });
    if (best !== null) {
      avail[best] -= 1;
      avail[b.stockIdx] += 1;
      b.stockIdx = best;
      b.cap = ctx.caps[best];
    }
  }
  return bars;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function key(ctx: Ctx, bars: Bar[], unplaced: number[]): number[] {
  let total = 0;
  let nw = 0;
  let reuse = 0;
  for (const b of bars) {
    const s = ctx.stocks[b.stockIdx];
    total += s.length;
    if (!s.is_offcut) nw += s.length;
    const rem = free(b);
    if (rem + EPS >= ctx.req.min_reusable_offcut) reuse += rem;
  }
  const primary = ctx.req.prefer_offcuts ? nw : total;
  return [unplaced.length, r6(primary), r6(total), -r6(reuse), bars.length];
}

function heuristic(ctx: Ctx): [Bar[], number[], string] {
  let best: [number[], Bar[], number[], string] | null = null;
  for (const fit of ['first', 'best'] as const) {
    for (const policy of ['longest', 'shortest'] as const) {
      const [b0, unpl] = greedy(ctx, fit, policy);
      const bars = downsize(ctx, improve(ctx, b0));
      const k = key(ctx, bars, unpl);
      const name = `${fit === 'first' ? 'FFD' : 'BFD'}(${policy}-stock)+local-search`;
      if (best === null || cmpTuple(k, best[0]) < 0) best = [k, bars, unpl, name];
    }
  }
  return [best![1], best![2], best![3]];
}

function lowerBound(ctx: Ctx, placed: number[]): [number, string] {
  const caps = ctx.stocks.map((s, i) => ((s.quantity == null || s.quantity > 0) && ctx.caps[i] > 0 ? ctx.caps[i] : -1)).filter((c) => c > 0);
  if (!caps.length) return [0, 'no usable stock'];
  const need = placed.reduce((s, t) => s + ctx.w[t], 0);
  const lb = need > 0 ? Math.ceil(need / Math.max(...caps) - 1e-9) : 0;
  const lens = new Set(ctx.stocks.map((s) => r6(s.length)));
  const kind =
    lens.size === 1
      ? 'single stock length: ceil(sum(p_i + kerf) / (L - trim_start - trim_end))'
      : 'multiple stock lengths: ceil(sum(p_i + kerf) / longest usable length) (bar-count bound only)';
  return [lb, kind];
}

function buildResult(ctx: Ctx, bars: Bar[], unplacedTypes: number[], issues: Issue[], method: string, t0: number): Cutting1DResult {
  const req = ctx.req;
  const k = req.kerf;
  const ts = req.trim_start;
  const te = req.trim_end;
  const groups = new Map<string, { stockIdx: number; items: number[]; count: number }>();
  for (const b of bars) {
    const items = [...b.items].sort((x, y) => {
      const d = ctx.types[y].length - ctx.types[x].length;
      if (d) return d;
      return ctx.types[x].id < ctx.types[y].id ? -1 : ctx.types[x].id > ctx.types[y].id ? 1 : 0;
    });
    const gk = `${b.stockIdx}|${items.join(',')}`;
    const g = groups.get(gk);
    if (g) g.count += 1;
    else groups.set(gk, { stockIdx: b.stockIdx, items, count: 1 });
  }
  const ordered = [...groups.values()].sort((a, b) =>
    cmpTuple([ctx.stocks[a.stockIdx].is_offcut ? 0 : 1, -a.count], [ctx.stocks[b.stockIdx].is_offcut ? 0 : 1, -b.count]),
  );
  const patterns: Pattern1D[] = [];
  const tot = { stock: 0, piece: 0, kerf: 0, trim: 0, reuse: 0, waste: 0 };
  let anyCost = false;
  let cost = 0;
  let barsUsed = 0;
  ordered.forEach((g, n) => {
    const s = ctx.stocks[g.stockIdx];
    const cuts: Cut1D[] = [];
    let off = ts;
    let sp = 0;
    for (const t of g.items) {
      const p = ctx.types[t];
      cuts.push({ piece_id: p.id, label: p.label ?? null, length: p.length, offset: off, angle_start: p.angle_start ?? 90, angle_end: p.angle_end ?? 90 });
      off += p.length + k;
      sp += p.length;
    }
    const used = ts + sp + cuts.length * k;
    const rem = s.length - te - used;
    const reusable = rem + EPS >= req.min_reusable_offcut;
    const waste = reusable ? 0 : Math.max(rem, 0);
    const c = g.count;
    patterns.push({
      pattern_id: `P${n + 1}`,
      stock_id: s.id,
      stock_length: s.length,
      is_offcut_stock: !!s.is_offcut,
      count: c,
      cuts,
      used_length: used,
      remainder: rem,
      offcut_reusable: reusable,
      waste,
    });
    barsUsed += c;
    tot.stock += c * s.length;
    tot.piece += c * sp;
    tot.kerf += c * cuts.length * k;
    tot.trim += c * (ts + te);
    tot.reuse += c * (reusable ? rem : 0);
    tot.waste += c * waste;
    if (s.cost_per_bar != null) {
      anyCost = true;
      cost += c * s.cost_per_bar;
    }
  });
  const uc = new Map<number, number>();
  for (const t of unplacedTypes) uc.set(t, (uc.get(t) ?? 0) + 1);
  const unplaced = [...uc.entries()].sort((a, b) => a[0] - b[0]).map(([t, q]) => ({ ...ctx.types[t], quantity: q }));
  const placed = bars.flatMap((b) => b.items);
  const [lb, lbKind] = lowerBound(ctx, placed);
  const singleLen = new Set(ctx.stocks.map((s) => r6(s.length))).size === 1;
  const allPlaced = unplaced.length === 0;
  let isOpt = allPlaced && barsUsed > 0 && singleLen && barsUsed === lb;
  if (allPlaced && barsUsed === 0 && ctx.types.length === 0) isOpt = true;
  let note = `Lower bound (${lbKind}) = ${lb}; bars used = ${barsUsed}.`;
  if (singleLen && barsUsed === lb && allPlaced) note += ' Bars used equals the lower bound: optimal.';
  else if (!singleLen) note += ' Multiple stock lengths: lower bound proves bar count only, not minimum stock length.';
  else if (allPlaced) note += ' Offline heuristic: optimality not proven (no exact solver offline).';
  if (!allPlaced) note += ' Some pieces unplaced: bound computed over placed pieces only, optimality not claimed.';
  const status: Cutting1DResult['status'] = unplaced.length && barsUsed === 0 ? 'INFEASIBLE' : unplaced.length ? 'PARTIAL' : isOpt ? 'OPTIMAL' : 'FEASIBLE';
  const res: Cutting1DResult = {
    units: 'mm',
    engine_version: CUTTING_ENGINE_VERSION,
    method,
    status,
    validation_status: 'FEASIBLE_HEURISTIC',
    patterns,
    unplaced,
    summary: {
      bars_used: barsUsed,
      total_stock_length: tot.stock,
      total_piece_length: tot.piece,
      total_kerf_loss: tot.kerf,
      total_trim_loss: tot.trim,
      reusable_offcut_length: tot.reuse,
      waste_length: tot.waste,
      utilization: tot.stock > 0 ? tot.piece / tot.stock : 0,
      total_cost: anyCost ? cost : null,
    },
    proof: { lower_bound_bars: lb, bars_used: barsUsed, gap_bars: Math.max(0, barsUsed - lb), is_optimal: isOpt, note },
    validation: { passed: true, validator: 'pending', errors: [], checked_items: 0 },
    issues,
    request: req,
    runtime_ms: 0,
  };
  res.validation = validate1D(req, res);
  if (!res.validation.passed) res.validation_status = 'INVALID';
  else if (status === 'OPTIMAL') res.validation_status = 'OPTIMAL_PROVEN';
  res.runtime_ms = now() - t0;
  return res;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function optimize1D(input: Cutting1DRequest): Cutting1DResult {
  const t0 = now();
  const req = normalize1D(input);
  const [ctx, issues] = buildCtx(req);
  if (issues.some((i) => i.severity === 'error')) {
    const unpl = ctx.types.flatMap((p, t) => Array<number>(p.quantity).fill(t));
    return buildResult(ctx, [], unpl, issues, 'none (invalid request)', t0);
  }
  const usable = ctx.caps.filter((_, i) => ctx.stocks[i].quantity == null || (ctx.stocks[i].quantity ?? 0) > 0);
  const maxCap = Math.max(0, ...usable);
  ctx.types.forEach((p, t) => {
    if (ctx.w[t] > maxCap + EPS)
      issues.push({
        code: 'PIECE_TOO_LONG',
        severity: 'error',
        message: `piece '${p.id}' (${p.length} mm + kerf ${req.kerf}) exceeds the longest usable stock capacity (${maxCap} mm after trims)`,
        ref: `piece:${p.id}`,
      });
    if (Math.abs((p.angle_start ?? 90) - 90) > EPS || Math.abs((p.angle_end ?? 90) - 90) > EPS) {
      if (!issues.some((i) => i.code === 'MITRE_ALLOWANCE_NOT_APPLIED'))
        issues.push({
          code: 'MITRE_ALLOWANCE_NOT_APPLIED',
          severity: 'warning',
          message: 'Non-90 degree cut angles are recorded but no mitre allowance is added (profile-specific; requires approval)',
          ref: `piece:${p.id}`,
        });
    }
  });
  if (!req.stocks.length) issues.push({ code: 'NO_STOCK', severity: 'error', message: 'no stock lengths supplied', ref: null });
  const [bars, unpl, method] = heuristic(ctx);
  const exhausted = unpl.filter((t) => ctx.w[t] <= maxCap + EPS);
  if (exhausted.length)
    issues.push({ code: 'STOCK_EXHAUSTED', severity: 'error', message: `${exhausted.length} piece(s) could not be placed: finite stock quantities exhausted`, ref: 'stocks' });
  if (req.strategy === 'exact')
    issues.push({ code: 'EXACT_UNAVAILABLE_OFFLINE', severity: 'info', message: 'Exact solver (CP-SAT) is only available in server mode; offline heuristic result returned', ref: null });
  return buildResult(ctx, bars, unpl, issues, `offline ${method}`, t0);
}
