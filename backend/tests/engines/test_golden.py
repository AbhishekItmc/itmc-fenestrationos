"""Golden cases. Expert cases are SKIPPED until approved values exist (never reported as passed)."""
import json
from pathlib import Path

import pytest

from app.engines.calc import calculate
from app.engines.cutting1d import optimize_1d
from app.engines.elevation import make_grid
from app.engines.models import Cutting1DRequest

DATA = json.loads((Path(__file__).parent / "golden" / "golden_cases.json").read_text(encoding="utf-8"))


def _all_null(d):
    if isinstance(d, dict):
        return all(_all_null(v) for v in d.values())
    return d is None


@pytest.mark.parametrize("case", DATA["expert_cases"], ids=lambda c: c["id"])
def test_expert_golden_case(case, cat):
    if case.get("status") != "APPROVED" or _all_null(case.get("expected")):
        pytest.skip(f"{case['id']}: AWAITING_EXPERT_VALUES - approved golden reference values from a domain "
                    f"expert are required")
    pytest.fail(f"{case['id']} marked APPROVED but no runner is implemented for it yet")  # pragma: no cover


@pytest.mark.parametrize("case", [c for c in DATA["arithmetic_consistency_cases"] if c["id"].startswith("ARITH-CALC")],
                         ids=lambda c: c["id"])
def test_arithmetic_consistency_calc(case, cat):
    """arithmetic consistency, not engineering validation"""
    assert case["label"] == "arithmetic consistency, not engineering validation"
    g = dict(case["grid"])
    e = make_grid(g.pop("width"), g.pop("height"), g.pop("n_bays"), g.pop("n_rows"), **g)
    r = calculate(e, cat, case["rule_set_id"])
    assert r.validation_status == "PROVISIONAL_DEMO_RULES" and r.validation.passed
    x = case["expected"]
    by = {}
    for c in r.profile_cuts:
        by.setdefault(c.role, []).append(c)
    assert by["mullion"][0].length == x["mullion_cut_length"]
    assert by["mullion"][0].quantity == x["mullion_quantity"]
    for role in ("sill", "head", "transom"):
        if f"{role}_cut_length" in x:
            assert by[role][0].length == pytest.approx(x[f"{role}_cut_length"])
        if f"{role}_quantity" in x:
            assert sum(c.quantity for c in by[role]) == x[f"{role}_quantity"]
    gi = r.glass_items[0]
    assert (gi.width, gi.height) == (x["glass_width"], x["glass_height"])
    assert r.totals["glass_area_m2"] == pytest.approx(x["glass_area_m2"])
    bom = {b.item_type: b.quantity for b in r.bom}
    if "gasket_length_m" in x:
        assert bom["gasket"] == pytest.approx(x["gasket_length_m"])
    assert bom["connector"] == x["transom_connectors"]
    assert bom["bracket"] == x["brackets"]


def test_arithmetic_consistency_1d():
    """arithmetic consistency, not engineering validation"""
    case = next(c for c in DATA["arithmetic_consistency_cases"] if c["id"] == "ARITH-1D-001")
    r = optimize_1d(Cutting1DRequest(**case["request"]))
    x = case["expected"]
    assert r.summary.bars_used == x["bars_used"]
    assert r.summary.total_kerf_loss == x["total_kerf_loss"]
    assert r.summary.total_piece_length == x["total_piece_length"]
    assert r.validation.passed
