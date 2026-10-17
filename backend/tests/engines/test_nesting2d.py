import random

import pytest

from app.engines.models import (EdgeTrim, Nesting2DRequest, Nesting2DResult, Piece2D, Placement2D, SheetLayout,
                                Sheet2D, Summary2D, ValidationReport)
from app.engines.nesting2d import ENGINE_VERSION, optimize_2d
from app.engines.validators import validate_2d


def req(pieces, sheets=None, **kw):
    sheets = sheets or [Sheet2D(id="S", width=3210, height=2250)]
    return Nesting2DRequest(sheets=sheets, pieces=pieces, **kw)


def P(id, w, h, q=1, **kw):
    return Piece2D(id=id, width=w, height=h, quantity=q, **kw)


def codes(r):
    return {i.code for i in r.issues}


def test_simple_fit_and_optimal():
    r = optimize_2d(req([P("a", 1000, 1000, 6)], kerf=3))
    assert r.engine_version == ENGINE_VERSION
    assert r.summary.sheets_used == 1 and r.status == "OPTIMAL" and r.validation_status == "OPTIMAL_PROVEN"
    assert r.validation.passed and r.lower_bound_sheets == 1
    assert r.summary.total_piece_area_m2 == pytest.approx(6.0)
    assert r.summary.utilization == pytest.approx(6.0 / (3.21 * 2.25))


def test_rotation_forbidden_vs_allowed():
    sheets = [Sheet2D(id="S", width=1000, height=3000)]
    r = optimize_2d(req([P("a", 2500, 800, can_rotate=False)], sheets))
    assert r.status == "INFEASIBLE" and "PIECE_TOO_LARGE" in codes(r) and r.validation.passed
    r = optimize_2d(req([P("a", 2500, 800, can_rotate=True)], sheets))
    assert r.status == "OPTIMAL" and r.layouts[0].placements[0].rotated
    pl = r.layouts[0].placements[0]
    assert (pl.width, pl.height) == (800, 2500)
    # non-rotatable pieces are never rotated in mixed jobs
    r = optimize_2d(req([P("a", 900, 400, 6, can_rotate=False), P("b", 700, 300, 5)], sheets))
    assert all(not p.rotated for l in r.layouts for p in l.placements if p.piece_id == "a")
    assert r.validation.passed


def test_kerf_gap():
    sheets = [Sheet2D(id="S", width=2000, height=1000)]
    assert optimize_2d(req([P("a", 1000, 1000, 2)], sheets, kerf=0)).summary.sheets_used == 1
    r = optimize_2d(req([P("a", 1000, 1000, 2)], sheets, kerf=3))
    assert r.summary.sheets_used == 2 and r.validation.passed
    r = optimize_2d(req([P("a", 998.5, 1000, 2)], sheets, kerf=3))
    assert r.summary.sheets_used == 1
    a, b = sorted(r.layouts[0].placements, key=lambda p: p.x)
    assert b.x - (a.x + a.width) >= 3 - 1e-9


def test_edge_trim():
    sheets = [Sheet2D(id="S", width=1020, height=1020)]
    r = optimize_2d(req([P("a", 1000, 1000)], sheets, edge_trim=EdgeTrim(left=10, right=10, top=10, bottom=10)))
    assert r.summary.sheets_used == 1
    pl = r.layouts[0].placements[0]
    assert (pl.x, pl.y) == (10, 10)
    r = optimize_2d(req([P("a", 1000, 1000)], sheets, edge_trim=EdgeTrim(left=11, right=10)))
    assert r.status == "INFEASIBLE" and r.validation.passed


def _manual_result(rq, placements, sheet):
    area = sum(p.width * p.height for p in placements)
    sa = sheet.width * sheet.height
    lay = SheetLayout(layout_id="L1", sheet_id=sheet.id, width=sheet.width, height=sheet.height,
                      placements=placements, residuals=[], used_area=area, utilization=area / sa)
    return Nesting2DResult(engine_version="manual", method="manual", status="FEASIBLE",
                           validation_status="FEASIBLE_HEURISTIC", layouts=[lay],
                           summary=Summary2D(sheets_used=1, total_sheet_area_m2=sa / 1e6, total_piece_area_m2=area / 1e6,
                                             waste_area_m2=(sa - area) / 1e6, reusable_residual_area_m2=0,
                                             utilization=area / sa),
                           validation=ValidationReport(passed=True, validator="x"), request=rq, runtime_ms=0)


def test_guillotine_validator_pinwheel():
    # classic pinwheel: no edge-to-edge cut exists
    rects = [(0, 0, 200, 100), (200, 0, 100, 200), (100, 200, 200, 100), (0, 100, 100, 200), (100, 100, 100, 100)]
    pieces = [P(f"r{i}", w, h, can_rotate=False) for i, (x, y, w, h) in enumerate(rects)]
    sheet = Sheet2D(id="S", width=300, height=300)
    pls = [Placement2D(piece_id=f"r{i}", x=x, y=y, width=w, height=h, rotated=False)
           for i, (x, y, w, h) in enumerate(rects)]
    rq_g = req(pieces, [sheet], kerf=0, guillotine=True)
    rep = validate_2d(rq_g, _manual_result(rq_g, pls, sheet))
    assert not rep.passed and "NOT_GUILLOTINE" in {e.code for e in rep.errors}
    rq_n = req(pieces, [sheet], kerf=0, guillotine=False)
    assert validate_2d(rq_n, _manual_result(rq_n, pls, sheet)).passed
    # a guillotine layout passes
    pls2 = [Placement2D(piece_id="r0", x=0, y=0, width=200, height=100, rotated=False)]
    rq2 = req([P("r0", 200, 100)], [sheet], kerf=0)
    assert validate_2d(rq2, _manual_result(rq2, pls2, sheet)).passed


def test_guillotine_validator_respects_kerf():
    # two pieces touching (gap 0) with kerf 3 -> kerf violation
    sheet = Sheet2D(id="S", width=1000, height=1000)
    rq = req([P("a", 400, 400, 2)], [sheet], kerf=3)
    pls = [Placement2D(piece_id="a", x=0, y=0, width=400, height=400, rotated=False),
           Placement2D(piece_id="a", x=401, y=0, width=400, height=400, rotated=False)]
    rep = validate_2d(rq, _manual_result(rq, pls, sheet))
    assert not rep.passed and "OVERLAP_OR_KERF" in {e.code for e in rep.errors}


def test_residual_sheets_used_first_and_residuals_reported():
    sheets = [Sheet2D(id="NEW", width=3210, height=2250),
              Sheet2D(id="RES", width=1500, height=1500, quantity=1, is_residual=True)]
    r = optimize_2d(req([P("a", 1000, 1000)], sheets))
    assert [l.sheet_id for l in r.layouts] == ["RES"] and r.layouts[0].is_residual_sheet
    r = optimize_2d(req([P("a", 1000, 1000)], sheets, prefer_residuals=False))
    assert r.validation.passed
    # reusable residual on a big sheet
    r = optimize_2d(req([P("a", 1000, 1000)], [Sheet2D(id="S", width=3000, height=2000)], kerf=3))
    res = [x for x in r.layouts[0].residuals if x.reusable]
    assert res and r.summary.reusable_residual_area_m2 > 3.0
    assert r.summary.waste_area_m2 == pytest.approx(
        r.summary.total_sheet_area_m2 - r.summary.total_piece_area_m2 - r.summary.reusable_residual_area_m2)


def test_finite_sheets_and_material():
    sheets = [Sheet2D(id="S", width=2000, height=1000, quantity=1, material="ACP")]
    r = optimize_2d(req([P("a", 1000, 1000, 3, material="ACP")], sheets, kerf=0))
    assert r.status == "PARTIAL" and "SHEETS_EXHAUSTED" in codes(r) and r.validation.passed
    assert sum(u.quantity for u in r.unplaced) == 1
    r = optimize_2d(req([P("g", 500, 500, material="DGU")], sheets))
    assert r.status == "INFEASIBLE" and "NO_COMPATIBLE_SHEET" in codes(r)
    sheets = [Sheet2D(id="A", width=2000, height=1000, material="ACP", thickness=4),
              Sheet2D(id="B", width=2000, height=1000, material="ACP", thickness=3)]
    r = optimize_2d(req([P("x", 500, 500, 2, material="acp", thickness=3)], sheets))
    assert {l.sheet_id for l in r.layouts} == {"B"} and r.validation.passed


def test_identical_layouts_grouped():
    sheets = [Sheet2D(id="S", width=2000, height=1000)]
    r = optimize_2d(req([P("a", 1000, 1000, 8)], sheets, kerf=0))
    assert r.summary.sheets_used == 4 and len(r.layouts) == 1 and r.layouts[0].count == 4


def test_non_guillotine_mode_valid():
    rng = random.Random(5)
    ps = [P(f"p{i}", rng.randint(100, 900), rng.randint(100, 900), rng.randint(1, 3)) for i in range(40)]
    r = optimize_2d(req(ps, kerf=4, guillotine=False))
    assert r.validation.passed and r.status in ("OPTIMAL", "FEASIBLE")


# ---------------------------------------------------------------------------
# randomized property tests
# ---------------------------------------------------------------------------
def random_request(rng: random.Random) -> Nesting2DRequest:
    sheets = [Sheet2D(id=f"S{j}", width=rng.choice([3210, 2440, 1500]), height=rng.choice([2250, 1220, 1500]),
                      quantity=rng.choice([None, None, rng.randint(0, 3)]), is_residual=rng.random() < 0.2,
                      cost_per_sheet=rng.choice([None, 5000.0]),
                      material=rng.choice([None, None, "ACP"])) for j in range(rng.randint(1, 3))]
    pieces = [P(f"P{i}", round(rng.uniform(50, 1800), rng.choice([0, 1])), round(rng.uniform(50, 1800), 0),
                rng.randint(1, 5), can_rotate=rng.random() < 0.6, material=rng.choice([None, None, "ACP", "DGU"]))
              for i in range(rng.randint(1, 18))]
    t = rng.choice([0, 0, 10, 15])
    return Nesting2DRequest(sheets=sheets, pieces=pieces, kerf=rng.choice([0, 3, 4.5]),
                            edge_trim=EdgeTrim(left=t, right=t, top=rng.choice([0, t]), bottom=t),
                            guillotine=rng.random() < 0.6, prefer_residuals=rng.random() < 0.7,
                            min_residual_width=rng.choice([100, 300]), min_residual_height=300, time_limit_s=5)


def corrupt(res, rng):
    bad = res.model_copy(deep=True)
    lay = rng.choice(bad.layouts)
    kind = rng.choice(["overlap", "outside", "size", "count", "summary", "rotate"])
    pls = lay.placements
    if kind == "overlap" and len(pls) >= 2:
        pls[1].x, pls[1].y = pls[0].x, pls[0].y
    elif kind in ("overlap", "outside"):
        pls[0].x = lay.width - pls[0].width + 1
        kind = "outside"
    elif kind == "size":
        pls[0].width += 1
    elif kind == "count":
        lay.count += 1
    elif kind == "summary":
        bad.summary.total_piece_area_m2 += 0.01
    elif kind == "rotate":
        piece = next(p for p in bad.request.pieces if p.id == pls[0].piece_id)
        pls[0].rotated = not pls[0].rotated
        if not piece.can_rotate and pls[0].rotated:
            pls[0].width, pls[0].height = pls[0].height, pls[0].width   # illegal rotation, dims consistent
        elif abs(piece.width - piece.height) < 1e-9:
            pls[0].width += 1                                           # square: flag flip alone is legal
        # otherwise: flag flipped without swapping dims -> size/rotation mismatch
    return bad, kind


def test_randomized_validator_and_corruption():
    rng = random.Random(4242)
    corrupted = 0
    for i in range(200):
        rq = random_request(rng)
        r = optimize_2d(rq)
        assert r.validation.passed, (i, r.validation.errors[:3])
        assert r.validation_status != "INVALID"
        placed = sum(l.count * len(l.placements) for l in r.layouts)
        assert placed + sum(u.quantity for u in r.unplaced) == sum(p.quantity for p in rq.pieces)
        if r.layouts:
            bad, kind = corrupt(r, rng)
            assert not validate_2d(rq, bad).passed, (i, kind)
            corrupted += 1
    assert corrupted > 120
