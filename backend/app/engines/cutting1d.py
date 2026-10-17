"""1D cutting-stock optimisation for profile bars.

Semantics (ARCHITECTURE.md section 3, assumption A-04 - requires approval):
    used      = trim_start + sum(p_i) + n * kerf      (one kerf after every piece)
    remainder = L - trim_end - used  (>= 0)
    offset_1  = trim_start ; offset_{i+1} = offset_i + p_i + kerf
A piece of length p therefore consumes (p + kerf) of the usable capacity L - trim_start - trim_end.

Algorithms
    heuristic : First-Fit-Decreasing and Best-Fit-Decreasing, two stock-opening policies, followed by a
                local-improvement pass (empty the least-filled bar) and a stock down-sizing pass.
    exact     : OR-Tools CP-SAT bin packing (integer item-type x bar counts) for small instances.
    auto      : heuristic, then exact with the remaining time if not proven optimal and small.
Every result is checked by the independent validators.validate_1d.
"""
from __future__ import annotations

import math
import time
from collections import Counter, OrderedDict, defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .models import (Cut1D, Cutting1DRequest, Cutting1DResult, Issue, Pattern1D, Piece1D, Proof1D, Stock1D,
                     Summary1D, ValidationReport)
from .validators import validate_1d

ENGINE_VERSION = "cutting1d/0.1.0"
EPS = 1e-6
EXACT_MAX_PIECES = 150
EXACT_MAX_VARS = 20000


@dataclass
class _Bar:
    stock_idx: int
    cap: float                  # usable capacity (L - trim_start - trim_end)
    load: float = 0.0           # sum(p + kerf)
    items: List[int] = field(default_factory=list)   # indices into piece-type list

    @property
    def free(self) -> float:
        return self.cap - self.load


@dataclass
class _Ctx:
    req: Cutting1DRequest
    types: List[Piece1D]                 # unique piece types (merged by id)
    w: List[float]                       # consumption per piece type (p + kerf)
    stocks: List[Stock1D]
    caps: List[float]


def _build_ctx(req: Cutting1DRequest) -> Tuple[_Ctx, List[Issue]]:
    issues: List[Issue] = []
    merged: "OrderedDict[str, Piece1D]" = OrderedDict()
    for p in req.pieces:
        if p.id in merged:
            prev = merged[p.id]
            if abs(prev.length - p.length) > EPS:
                issues.append(Issue(code="DUPLICATE_PIECE_ID", severity="error",
                                    message=f"piece id '{p.id}' appears with different lengths", ref=f"piece:{p.id}"))
            merged[p.id] = prev.model_copy(update={"quantity": prev.quantity + p.quantity})
        else:
            merged[p.id] = p.model_copy()
    types = list(merged.values())
    w = [p.length + req.kerf for p in types]
    caps = [s.length - req.trim_start - req.trim_end for s in req.stocks]
    return _Ctx(req=req, types=types, w=w, stocks=list(req.stocks), caps=caps), issues


# ---------------------------------------------------------------------------
# heuristics
# ---------------------------------------------------------------------------
def _stock_order(ctx: _Ctx, policy: str) -> List[int]:
    """Order in which stock classes are considered when opening a new bar."""
    idx = [i for i, s in enumerate(ctx.stocks) if ctx.caps[i] > EPS]
    off = [i for i in idx if ctx.stocks[i].is_offcut]
    new = [i for i in idx if not ctx.stocks[i].is_offcut]
    off.sort(key=lambda i: (-ctx.stocks[i].priority, ctx.stocks[i].length))   # smallest suitable offcut first
    if policy == "longest":
        new.sort(key=lambda i: (-ctx.stocks[i].priority, -ctx.stocks[i].length))
    else:
        new.sort(key=lambda i: (-ctx.stocks[i].priority, ctx.stocks[i].length))
    if ctx.req.prefer_offcuts:
        return off + new
    allc = off + new
    allc.sort(key=lambda i: (-ctx.stocks[i].priority, -ctx.stocks[i].length if policy == "longest"
                             else ctx.stocks[i].length))
    return allc


def _greedy(ctx: _Ctx, fit: str, policy: str) -> Tuple[List[_Bar], List[int]]:
    """FFD ('first') or BFD ('best'). Returns bars and list of unplaced type indices (one per piece)."""
    order = _stock_order(ctx, policy)
    remaining = {i: (ctx.stocks[i].quantity if ctx.stocks[i].quantity is not None else math.inf) for i in order}
    items = sorted((t for t, p in enumerate(ctx.types) for _ in range(p.quantity)),
                   key=lambda t: (-ctx.types[t].length, t))
    bars: List[_Bar] = []
    unplaced: List[int] = []
    for t in items:
        wt = ctx.w[t]
        chosen = None
        if fit == "first":
            for b in bars:
                if b.free + EPS >= wt:
                    chosen = b
                    break
        else:
            best = math.inf
            for b in bars:
                f = b.free - wt
                if f >= -EPS and f < best:
                    best, chosen = f, b
        if chosen is None:
            for si in order:
                if remaining[si] >= 1 and ctx.caps[si] + EPS >= wt:
                    remaining[si] -= 1
                    chosen = _Bar(stock_idx=si, cap=ctx.caps[si])
                    bars.append(chosen)
                    break
        if chosen is None:
            unplaced.append(t)
            continue
        chosen.items.append(t)
        chosen.load += wt
    return bars, unplaced


def _improve(ctx: _Ctx, bars: List[_Bar]) -> List[_Bar]:
    """Local improvement: repeatedly try to empty the least-filled bar by moving its pieces (largest first,
    best fit) into the free space of the other bars."""
    bars = [(_Bar(b.stock_idx, b.cap, b.load, list(b.items))) for b in bars]
    tried = set()
    while len(bars) > 1:
        cand = [b for b in bars if id(b) not in tried]
        if not cand:
            break
        victim = min(cand, key=lambda b: (b.load / b.cap if b.cap > 0 else 1, b.load))
        tried.add(id(victim))
        others = [b for b in bars if b is not victim]
        free = {id(b): b.free for b in others}
        moves = []
        ok = True
        for t in sorted(victim.items, key=lambda t: -ctx.w[t]):
            best, target = math.inf, None
            for b in others:
                f = free[id(b)] - ctx.w[t]
                if f >= -EPS and f < best:
                    best, target = f, b
            if target is None:
                ok = False
                break
            free[id(target)] -= ctx.w[t]
            moves.append((t, target))
        if ok:
            for t, target in moves:
                target.items.append(t)
                target.load += ctx.w[t]
            bars = others
            tried = set()
    return bars


def _downsize(ctx: _Ctx, bars: List[_Bar]) -> List[_Bar]:
    """Move each bar's content to the cheapest (shortest) stock class that holds it, respecting quantities
    (and offcut preference: offcuts are only taken, never released in favour of new stock)."""
    count = Counter(b.stock_idx for b in bars)
    avail = {i: (s.quantity if s.quantity is not None else math.inf) - count.get(i, 0)
             for i, s in enumerate(ctx.stocks)}
    prefer_off = ctx.req.prefer_offcuts
    for b in sorted(bars, key=lambda b: -b.load):
        cur = ctx.stocks[b.stock_idx]
        best = None
        for i, s in enumerate(ctx.stocks):
            if i == b.stock_idx or avail[i] < 1 or ctx.caps[i] + EPS < b.load:
                continue
            if prefer_off and cur.is_offcut and not s.is_offcut:
                continue
            better = (s.length < cur.length - EPS) or (prefer_off and s.is_offcut and not cur.is_offcut)
            if prefer_off and not s.is_offcut and cur.is_offcut:
                better = False
            if better and (best is None or s.length < ctx.stocks[best].length):
                best = i
        if best is not None:
            avail[best] -= 1
            avail[b.stock_idx] += 1
            b.stock_idx = best
            b.cap = ctx.caps[best]
    return bars


def _key(ctx: _Ctx, bars: List[_Bar], unplaced: List[int]) -> Tuple:
    total = sum(ctx.stocks[b.stock_idx].length for b in bars)
    new = sum(ctx.stocks[b.stock_idx].length for b in bars if not ctx.stocks[b.stock_idx].is_offcut)
    reuse = 0.0
    for b in bars:
        rem = b.free
        if rem + EPS >= ctx.req.min_reusable_offcut:
            reuse += rem
    primary = new if ctx.req.prefer_offcuts else total
    return (len(unplaced), round(primary, 6), round(total, 6), -round(reuse, 6), len(bars))


def first_fit_decreasing(req: Cutting1DRequest) -> Tuple[List[_Bar], List[int]]:
    """Plain FFD (no improvement) - exposed for tests / comparison."""
    ctx, _ = _build_ctx(req)
    return _greedy(ctx, "first", "longest")


def _heuristic(ctx: _Ctx) -> Tuple[List[_Bar], List[int], str]:
    best = None
    for fit in ("first", "best"):
        for policy in ("longest", "shortest"):
            bars, unpl = _greedy(ctx, fit, policy)
            bars = _downsize(ctx, _improve(ctx, bars))
            k = _key(ctx, bars, unpl)
            name = f"{'FFD' if fit == 'first' else 'BFD'}({policy}-stock)+local-search"
            if best is None or k < best[0]:
                best = (k, bars, unpl, name)
    return best[1], best[2], best[3]


# ---------------------------------------------------------------------------
# exact CP-SAT
# ---------------------------------------------------------------------------
def _scale_ok(values: List[float], scale: int) -> bool:
    return all(abs(v * scale - round(v * scale)) < 1e-6 for v in values)


def _exact(ctx: _Ctx, hint_bars: List[_Bar], time_limit: float) -> Optional[Tuple[List[_Bar], bool, str]]:
    """Returns (bars, proven_optimal, note) or None if not applicable / no solution."""
    try:
        from ortools.sat.python import cp_model
    except Exception:  # pragma: no cover
        return None
    T = len(ctx.types)
    demand = [p.quantity for p in ctx.types]
    n_items = sum(demand)
    if n_items == 0 or n_items > EXACT_MAX_PIECES or time_limit <= 0.05:
        return None
    SCALE = 1000
    vals = [p.length for p in ctx.types] + [ctx.req.kerf] + ctx.caps
    exact_scaling = _scale_ok(vals, SCALE) and _scale_ok([s.length for s in ctx.stocks], 1)
    wi = [int(math.ceil(ctx.w[t] * SCALE - 1e-6)) for t in range(T)]
    hint_count = Counter(b.stock_idx for b in hint_bars)
    heur_total = sum(ctx.stocks[b.stock_idx].length for b in hint_bars)
    heur_new = sum(ctx.stocks[b.stock_idx].length for b in hint_bars if not ctx.stocks[b.stock_idx].is_offcut)
    bins: List[int] = []   # stock idx per candidate bin
    for i, s in enumerate(ctx.stocks):
        if ctx.caps[i] <= EPS:
            continue
        if not any(ctx.caps[i] + EPS >= ctx.w[t] for t in range(T)):
            continue
        # Valid upper bound on bars of this class in ANY optimal solution (optimal solutions have no empty
        # bars, and their objective never exceeds the heuristic's):
        ub = sum(demand[t] for t in range(T) if ctx.caps[i] + EPS >= ctx.w[t])
        if s.quantity is not None:
            ub = min(ub, s.quantity)
        if not (ctx.req.prefer_offcuts and s.is_offcut):
            ref_len = heur_new if ctx.req.prefer_offcuts else heur_total
            ub = min(ub, int(math.floor(ref_len / s.length + 1e-9)))
        ub = max(ub, hint_count.get(i, 0))
        bins += [i] * ub
    if not bins or len(bins) * T > EXACT_MAX_VARS:
        return None
    m = cp_model.CpModel()
    B = len(bins)
    x = [[m.NewIntVar(0, demand[t] if ctx.caps[bins[b]] + EPS >= ctx.w[t] else 0, f"x{t}_{b}") for b in range(B)]
         for t in range(T)]
    y = [m.NewBoolVar(f"y{b}") for b in range(B)]
    for t in range(T):
        m.Add(sum(x[t][b] for b in range(B)) == demand[t])
    for b in range(B):
        capi = int(math.floor(ctx.caps[bins[b]] * SCALE + 1e-6))
        m.Add(sum(wi[t] * x[t][b] for t in range(T)) <= capi * y[b])
        if b > 0 and bins[b] == bins[b - 1]:
            m.Add(y[b] <= y[b - 1])   # symmetry breaking within a stock class
    big = int(sum(round(ctx.stocks[i].length) for i in bins)) + 1
    obj = []
    for b in range(B):
        s = ctx.stocks[bins[b]]
        coef = int(round(s.length))
        if ctx.req.prefer_offcuts and not s.is_offcut:
            coef = coef * big + coef
        obj.append(coef * y[b])
    m.Minimize(sum(obj))
    # hint from heuristic
    used_slots: Dict[int, int] = defaultdict(int)
    slot_of_class: Dict[int, List[int]] = defaultdict(list)
    for b, si in enumerate(bins):
        slot_of_class[si].append(b)
    hint_x = [[0] * B for _ in range(T)]
    hint_y = [0] * B
    hint_ok = True
    for hb in hint_bars:
        slots = slot_of_class.get(hb.stock_idx, [])
        k = used_slots[hb.stock_idx]
        if k >= len(slots):
            hint_ok = False
            break
        b = slots[k]
        used_slots[hb.stock_idx] += 1
        hint_y[b] = 1
        for t in hb.items:
            hint_x[t][b] += 1
    if hint_ok:
        for b in range(B):
            m.AddHint(y[b], hint_y[b])
            for t in range(T):
                m.AddHint(x[t][b], hint_x[t][b])
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit)
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 1
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    bars: List[_Bar] = []
    for b in range(B):
        if solver.Value(y[b]):
            bar = _Bar(stock_idx=bins[b], cap=ctx.caps[bins[b]])
            for t in range(T):
                for _ in range(solver.Value(x[t][b])):
                    bar.items.append(t)
                    bar.load += ctx.w[t]
            if bar.items:
                bars.append(bar)
    proven = st == cp_model.OPTIMAL and exact_scaling
    note = "CP-SAT " + ("OPTIMAL" if st == cp_model.OPTIMAL else "FEASIBLE (time limit)")
    if st == cp_model.OPTIMAL and not exact_scaling:
        note += " on conservatively rounded lengths (optimality not claimed)"
    return bars, proven, note


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
def _lower_bound(ctx: _Ctx, placed_types: List[int]) -> Tuple[int, str]:
    caps = [ctx.caps[i] for i, s in enumerate(ctx.stocks) if (s.quantity is None or s.quantity > 0) and ctx.caps[i] > 0]
    if not caps:
        return 0, "no usable stock"
    need = sum(ctx.w[t] for t in placed_types)
    lb = math.ceil(need / max(caps) - 1e-9) if need > 0 else 0
    lens = {round(s.length, 6) for s in ctx.stocks}
    kind = ("single stock length: ceil(sum(p_i + kerf) / (L - trim_start - trim_end))" if len(lens) == 1 else
            "multiple stock lengths: ceil(sum(p_i + kerf) / longest usable length) (bar-count bound only)")
    return lb, kind


def _build_result(ctx: _Ctx, bars: List[_Bar], unplaced_types: List[int], issues: List[Issue], method: str,
                  exact_proven: bool, t0: float) -> Cutting1DResult:
    req = ctx.req
    k, ts, te = req.kerf, req.trim_start, req.trim_end
    # build concrete bar patterns
    groups: "OrderedDict[Tuple, Dict]" = OrderedDict()
    for b in bars:
        items = sorted(b.items, key=lambda t: (-ctx.types[t].length, ctx.types[t].id))
        key = (b.stock_idx, tuple(items))
        if key in groups:
            groups[key]["count"] += 1
        else:
            groups[key] = {"stock_idx": b.stock_idx, "items": items, "count": 1}
    patterns: List[Pattern1D] = []
    tot = defaultdict(float)
    any_cost = False
    cost = 0.0
    bars_used = 0
    ordered = sorted(groups.values(), key=lambda g: (ctx.stocks[g["stock_idx"]].is_offcut is False, -g["count"]))
    for n, g in enumerate(ordered, 1):
        s = ctx.stocks[g["stock_idx"]]
        cuts = []
        off = ts
        sp = 0.0
        for t in g["items"]:
            p = ctx.types[t]
            cuts.append(Cut1D(piece_id=p.id, label=p.label, length=p.length, offset=off, angle_start=p.angle_start,
                              angle_end=p.angle_end))
            off += p.length + k
            sp += p.length
        used = ts + sp + len(cuts) * k
        rem = s.length - te - used
        reusable = rem + EPS >= req.min_reusable_offcut
        waste = 0.0 if reusable else max(rem, 0.0)
        c = g["count"]
        patterns.append(Pattern1D(pattern_id=f"P{n}", stock_id=s.id, stock_length=s.length, is_offcut_stock=s.is_offcut,
                                  count=c, cuts=cuts, used_length=used, remainder=rem, offcut_reusable=reusable,
                                  waste=waste))
        bars_used += c
        tot["stock"] += c * s.length
        tot["piece"] += c * sp
        tot["kerf"] += c * len(cuts) * k
        tot["trim"] += c * (ts + te)
        tot["reuse"] += c * (rem if reusable else 0.0)
        tot["waste"] += c * waste
        if s.cost_per_bar is not None:
            any_cost = True
            cost += c * s.cost_per_bar
    summary = Summary1D(bars_used=bars_used, total_stock_length=tot["stock"], total_piece_length=tot["piece"],
                        total_kerf_loss=tot["kerf"], total_trim_loss=tot["trim"],
                        reusable_offcut_length=tot["reuse"], waste_length=tot["waste"],
                        utilization=(tot["piece"] / tot["stock"]) if tot["stock"] > 0 else 0.0,
                        total_cost=cost if any_cost else None)
    # unplaced (grouped by type)
    uc = Counter(unplaced_types)
    unplaced = [ctx.types[t].model_copy(update={"quantity": q}) for t, q in sorted(uc.items())]
    placed_types = [t for b in bars for t in b.items]
    lb, lb_kind = _lower_bound(ctx, placed_types)
    single_len = len({round(s.length, 6) for s in ctx.stocks}) == 1
    all_placed = not unplaced
    is_opt = all_placed and bars_used > 0 and (exact_proven or (single_len and bars_used == lb))
    if all_placed and bars_used == 0 and not ctx.types:
        is_opt = True
    note = f"Lower bound ({lb_kind}) = {lb}; bars used = {bars_used}."
    if exact_proven:
        note += " Optimality proven by CP-SAT (minimum total stock length)."
    elif single_len and bars_used == lb and all_placed:
        note += " Bars used equals the lower bound: optimal."
    elif not single_len:
        note += " Multiple stock lengths: lower bound proves bar count only, not minimum stock length."
    if not all_placed:
        note += " Some pieces unplaced: bound computed over placed pieces only, optimality not claimed."
    proof = Proof1D(lower_bound_bars=lb, bars_used=bars_used, gap_bars=max(0, bars_used - lb), is_optimal=is_opt,
                    note=note)
    if unplaced and bars_used == 0:
        status = "INFEASIBLE"
    elif unplaced:
        status = "PARTIAL"
    elif is_opt:
        status = "OPTIMAL"
    else:
        status = "FEASIBLE"
    res = Cutting1DResult(engine_version=ENGINE_VERSION, method=method, status=status,
                          validation_status="FEASIBLE_HEURISTIC", patterns=patterns, unplaced=unplaced,
                          summary=summary, proof=proof,
                          validation=ValidationReport(passed=True, validator="pending"), issues=issues, request=req,
                          runtime_ms=0.0)
    res.validation = validate_1d(req, res)
    if not res.validation.passed:
        res.validation_status = "INVALID"
    elif status == "OPTIMAL":
        res.validation_status = "OPTIMAL_PROVEN"
    res.runtime_ms = (time.perf_counter() - t0) * 1000.0
    return res


def optimize_1d(req: Cutting1DRequest) -> Cutting1DResult:
    t0 = time.perf_counter()
    ctx, issues = _build_ctx(req)
    if any(i.severity == "error" for i in issues):
        bars, unpl = [], [t for t, p in enumerate(ctx.types) for _ in range(p.quantity)]
        return _build_result(ctx, bars, unpl, issues, "none (invalid request)", False, t0)

    max_cap = max([c for i, c in enumerate(ctx.caps)
                   if ctx.stocks[i].quantity is None or ctx.stocks[i].quantity > 0] or [0.0])
    for t, p in enumerate(ctx.types):
        if ctx.w[t] > max_cap + EPS:
            issues.append(Issue(code="PIECE_TOO_LONG", severity="error",
                                message=f"piece '{p.id}' ({p.length} mm + kerf {req.kerf}) exceeds the longest usable "
                                        f"stock capacity ({max_cap:g} mm after trims)", ref=f"piece:{p.id}"))
        if abs(p.angle_start - 90) > EPS or abs(p.angle_end - 90) > EPS:
            if not any(i.code == "MITRE_ALLOWANCE_NOT_APPLIED" for i in issues):
                issues.append(Issue(code="MITRE_ALLOWANCE_NOT_APPLIED", severity="warning",
                                    message="Non-90 degree cut angles are recorded but no mitre allowance is added "
                                            "(profile-specific; requires approval)", ref=f"piece:{p.id}"))
    if not req.stocks:
        issues.append(Issue(code="NO_STOCK", severity="error", message="no stock lengths supplied"))

    bars, unpl, method = _heuristic(ctx)
    exact_proven = False
    exhausted = [t for t in unpl if ctx.w[t] <= max_cap + EPS]
    if exhausted:
        issues.append(Issue(code="STOCK_EXHAUSTED", severity="error",
                            message=f"{len(exhausted)} piece(s) could not be placed: finite stock quantities exhausted",
                            ref="stocks"))

    want_exact = req.strategy == "exact" or req.strategy == "auto"
    if want_exact and not unpl and bars:
        placed = [t for b in bars for t in b.items]
        lb, _ = _lower_bound(ctx, placed)
        single_len = len({round(s.length, 6) for s in ctx.stocks}) == 1
        proven_by_lb = single_len and len(bars) == lb
        if req.strategy == "exact" or not proven_by_lb:
            remaining = req.time_limit_s - (time.perf_counter() - t0)
            ex = _exact(ctx, bars, remaining)
            if ex is None:
                if req.strategy == "exact":
                    issues.append(Issue(code="EXACT_SKIPPED", severity="info",
                                        message=f"Exact solver not applied (instance > {EXACT_MAX_PIECES} pieces, "
                                                f"too many variables or no time left); heuristic result returned"))
            else:
                ebars, proven, note = ex
                if not proven:
                    ebars = _downsize(ctx, ebars)
                ek, hk = _key(ctx, ebars, []), _key(ctx, bars, [])
                if proven and hk[:3] <= ek[:3]:
                    # heuristic attains the proven optimum of the stock objective (and may have better offcuts)
                    method += f"; optimality proven by {note}"
                elif ek <= hk or proven:
                    bars, method = ebars, f"{note} (after {method})"
                else:
                    method += f"; {note} (heuristic kept)"
                exact_proven = proven
    elif req.strategy == "exact" and unpl:
        issues.append(Issue(code="EXACT_SKIPPED", severity="info",
                            message="Exact solver not applied because some pieces cannot be placed"))
    return _build_result(ctx, bars, unpl, issues, method, exact_proven, t0)
