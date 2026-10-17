import random

import pytest

from app.engines.cutting1d import ENGINE_VERSION, first_fit_decreasing, optimize_1d
from app.engines.models import Cutting1DRequest, Piece1D, Stock1D
from app.engines.validators import validate_1d


def req(pieces, stocks=None, **kw):
    stocks = stocks or [Stock1D(id="S6000", length=6000)]
    ps = [Piece1D(id=f"p{i}", length=l, quantity=q) for i, (l, q) in enumerate(pieces)]
    return Cutting1DRequest(stocks=stocks, pieces=ps, **kw)


def codes(res):
    return {i.code for i in res.issues}


def test_kerf_and_trim_offsets():
    r = optimize_1d(req([(1000, 2)], kerf=4, trim_start=10, trim_end=5))
    assert r.engine_version == ENGINE_VERSION and r.validation.passed
    (p,) = r.patterns
    assert [c.offset for c in p.cuts] == [10, 1014]
    assert p.used_length == 10 + 2000 + 2 * 4
    assert p.remainder == 6000 - 5 - 2018
    assert p.offcut_reusable and p.waste == 0
    s = r.summary
    assert s.total_kerf_loss == 8 and s.total_trim_loss == 15
    assert s.total_piece_length + s.total_kerf_loss + s.total_trim_loss + s.reusable_offcut_length + s.waste_length \
        == pytest.approx(s.total_stock_length)
    assert s.utilization == pytest.approx(2000 / 6000)


def test_exact_fit_without_kerf_is_one_bar_optimal():
    r = optimize_1d(req([(2000, 3)], kerf=0, trim_start=0))
    assert r.summary.bars_used == 1
    assert r.status == "OPTIMAL" and r.validation_status == "OPTIMAL_PROVEN"
    assert r.patterns[0].remainder == 0 and r.summary.utilization == 1.0
    assert r.proof.lower_bound_bars == 1 and r.proof.is_optimal


def test_exact_fit_with_kerf_needs_two_bars():
    r = optimize_1d(req([(2000, 3)], kerf=4, trim_start=0))
    assert r.summary.bars_used == 2
    assert r.proof.lower_bound_bars == 2 and r.status == "OPTIMAL"


def test_trim_end_is_respected():
    # 2 x 2995 + 2 kerf(5) = 6000 exactly with no trims -> 1 bar; trim_end 1 -> 2 bars
    assert optimize_1d(req([(2995, 2)], kerf=5, trim_start=0, trim_end=0)).summary.bars_used == 1
    assert optimize_1d(req([(2995, 2)], kerf=5, trim_start=0, trim_end=1)).summary.bars_used == 2


def test_oversize_piece():
    r = optimize_1d(req([(7000, 1)]))
    assert r.status == "INFEASIBLE" and "PIECE_TOO_LONG" in codes(r)
    assert r.unplaced[0].id == "p0" and r.validation.passed
    r = optimize_1d(req([(7000, 1), (1000, 2)]))
    assert r.status == "PARTIAL" and r.summary.bars_used == 1
    assert sum(u.quantity for u in r.unplaced) == 1 and r.validation.passed
    assert r.validation_status == "FEASIBLE_HEURISTIC"


def test_finite_stock_exhaustion():
    r = optimize_1d(req([(4000, 3)], stocks=[Stock1D(id="S", length=6000, quantity=1)]))
    assert r.status == "PARTIAL" and r.summary.bars_used == 1
    assert sum(u.quantity for u in r.unplaced) == 2
    assert "STOCK_EXHAUSTED" in codes(r) and r.validation.passed


def test_offcut_reuse_priority():
    stocks = [Stock1D(id="NEW", length=6000), Stock1D(id="OFF", length=1500, quantity=1, is_offcut=True)]
    r = optimize_1d(req([(1000, 1), (5000, 1)], stocks=stocks))
    used = {p.stock_id: p.count for p in r.patterns}
    assert used == {"NEW": 1, "OFF": 1}
    off = next(p for p in r.patterns if p.stock_id == "OFF")
    assert off.is_offcut_stock and [c.piece_id for c in off.cuts] == ["p0"]
    assert r.validation.passed
    # offcut quantity respected
    r2 = optimize_1d(req([(1000, 3)], stocks=stocks))
    assert sum(p.count for p in r2.patterns if p.stock_id == "OFF") <= 1 and r2.validation.passed


def test_multiple_stock_lengths_choose_shorter_when_enough():
    stocks = [Stock1D(id="L6500", length=6500), Stock1D(id="L6000", length=6000)]
    r = optimize_1d(req([(2900, 2)], stocks=stocks, kerf=4, trim_start=10))
    assert r.summary.total_stock_length == 6000 and r.validation.passed


def test_cp_sat_beats_ffd_on_known_instance():
    # Classic FFD worst case (scaled): FFD needs 11 bars, optimum 9 (= area lower bound).
    pieces = [(3060, 6), (1620, 6), (1560, 6), (1380, 12)]
    rq = req(pieces, kerf=0, trim_start=0)
    bars, unpl = first_fit_decreasing(rq)
    assert len(bars) == 11 and not unpl
    h = optimize_1d(rq.model_copy(update={"strategy": "heuristic"}))
    assert h.summary.bars_used > 9 and h.status == "FEASIBLE" and h.validation_status == "FEASIBLE_HEURISTIC"
    for strat in ("exact", "auto"):
        r = optimize_1d(rq.model_copy(update={"strategy": strat, "time_limit_s": 20}))
        assert r.summary.bars_used == 9, strat
        assert r.status == "OPTIMAL" and r.validation_status == "OPTIMAL_PROVEN"
        assert "CP-SAT" in r.method and r.proof.is_optimal and r.validation.passed


def test_cp_sat_proves_optimality_beyond_lower_bound():
    # 3 pieces of 3500 into 6000 bars: lower bound 2 (10500/6000), but optimum is 3 -> only CP-SAT can prove
    rq = req([(3500, 3)], kerf=0, trim_start=0)
    r = optimize_1d(rq)
    assert r.summary.bars_used == 3 and r.proof.lower_bound_bars == 2
    assert r.status == "OPTIMAL" and r.validation_status == "OPTIMAL_PROVEN"
    rh = optimize_1d(rq.model_copy(update={"strategy": "heuristic"}))
    assert rh.status == "FEASIBLE" and not rh.proof.is_optimal and rh.proof.gap_bars == 1


def test_mitre_warning_and_angles_copied():
    rq = Cutting1DRequest(stocks=[Stock1D(id="S", length=6000)],
                          pieces=[Piece1D(id="m", length=1000, quantity=2, angle_start=45, angle_end=90)])
    r = optimize_1d(rq)
    assert "MITRE_ALLOWANCE_NOT_APPLIED" in codes(r)
    assert all(c.angle_start == 45 and c.angle_end == 90 for c in r.patterns[0].cuts)
    assert r.validation.passed


def test_patterns_grouped_with_count():
    r = optimize_1d(req([(2900, 10)], kerf=4, trim_start=10))
    assert len(r.patterns) == 1 and r.patterns[0].count == 5 and r.summary.bars_used == 5


def test_costs_and_empty_request():
    r = optimize_1d(req([(1000, 7)], stocks=[Stock1D(id="S", length=6000, cost_per_bar=1234.5)]))
    assert r.summary.total_cost == pytest.approx(1234.5 * r.summary.bars_used)


def test_lower_bound_multi_length():
    stocks = [Stock1D(id="A", length=6000), Stock1D(id="B", length=6500)]
    r = optimize_1d(req([(3000, 4)], stocks=stocks, kerf=0, trim_start=0, strategy="heuristic"))
    assert r.proof.lower_bound_bars == 2 and r.validation.passed


# ---------------------------------------------------------------------------
# property-style randomized tests (seeded)
# ---------------------------------------------------------------------------
def random_request(rng: random.Random, small: bool = False) -> Cutting1DRequest:
    n_types = rng.randint(1, 6 if small else 15)
    stocks = []
    for j in range(rng.randint(1, 3)):
        stocks.append(Stock1D(id=f"S{j}", length=rng.choice([6000, 6500, 5000, 3000.5]),
                              quantity=rng.choice([None, None, rng.randint(0, 6)]),
                              is_offcut=rng.random() < 0.2, cost_per_bar=rng.choice([None, 1000.0])))
    pieces = [Piece1D(id=f"P{i}", length=round(rng.uniform(150, 6600), rng.choice([0, 1])),
                      quantity=rng.randint(1, 4 if small else 12),
                      angle_start=rng.choice([90, 90, 45])) for i in range(n_types)]
    return Cutting1DRequest(stocks=stocks, pieces=pieces, kerf=rng.choice([0, 3, 4.2]),
                            trim_start=rng.choice([0, 10, 15.5]), trim_end=rng.choice([0, 20]),
                            min_reusable_offcut=rng.choice([0, 300, 500]),
                            prefer_offcuts=rng.random() < 0.7, strategy="heuristic", time_limit_s=1)


def corrupt(res, rng: random.Random):
    bad = res.model_copy(deep=True)
    pats = bad.patterns
    kind = rng.choice(["drop_cut", "count", "offset", "summary", "length", "stock"])
    p = rng.choice(pats)
    if kind == "drop_cut":
        p.cuts.pop()
    elif kind == "count":
        p.count += 1
    elif kind == "offset":
        if len(p.cuts) >= 2:
            p.cuts[1].offset = p.cuts[0].offset + p.cuts[0].length + bad.request.kerf - 0.5
        else:
            p.cuts[0].offset += 1
    elif kind == "summary":
        bad.summary.waste_length += 1
    elif kind == "length":
        p.cuts[0].length += 1
    elif kind == "stock":
        p.stock_id = "NOT-A-STOCK"
    return bad, kind


def test_randomized_validator_and_corruption():
    rng = random.Random(20261017)
    n_corrupted = 0
    for i in range(200):
        rq = random_request(rng)
        r = optimize_1d(rq)
        assert r.validation.passed, (i, r.validation.errors[:3])
        assert r.validation_status != "INVALID"
        rep = validate_1d(rq, r)
        assert rep.passed
        demanded = sum(p.quantity for p in rq.pieces)
        placed = sum(p.count * len(p.cuts) for p in r.patterns)
        assert placed + sum(u.quantity for u in r.unplaced) == demanded
        if r.patterns:
            bad, kind = corrupt(r, rng)
            assert not validate_1d(rq, bad).passed, (i, kind)
            n_corrupted += 1
    assert n_corrupted > 150


def test_randomized_exact_small_instances():
    rng = random.Random(7)
    for i in range(20):
        rq = random_request(rng, small=True).model_copy(update={"strategy": "auto", "time_limit_s": 2})
        r = optimize_1d(rq)
        h = optimize_1d(rq.model_copy(update={"strategy": "heuristic"}))
        assert r.validation.passed, (i, r.validation.errors[:3])
        if not r.unplaced:
            assert r.summary.total_stock_length <= h.summary.total_stock_length + 1e-6 or rq.prefer_offcuts
