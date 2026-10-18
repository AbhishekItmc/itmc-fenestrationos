"""Design checks (§8.3): DEMO thresholds, warnings only — not structural verification."""
import copy

import pytest

from app.engines.calc import calculate
from app.engines.checks import SUFFIX, mullion_spans, run_design_checks
from app.engines.models import Elevation

CODES = {"GLASS_WEIGHT_HIGH", "FIELD_AREA_HIGH", "FIELD_ASPECT_HIGH", "MULLION_SPAN_HIGH", "ANCHORS_MISSING",
         "NO_COLOUR_SELECTED"}


def lobby(**over):
    d = {"name": "Lobby", "width": 6000, "height": 3600, "mullions": [0, 1500, 3000, 4500, 6000],
         "bays": [{"transoms": [1100, 2400]} for _ in range(4)], "system_id": "ser-cw50", "colour_id": "col-ral7016",
         "default_glass_type_id": "gl-dgu-24", "anchor_levels": [0, 3600]}
    d.update(over)
    return Elevation(**d)


def codes(issues):
    return {i.code for i in issues}


CRAFTED = {
    # 1480 x 2380 laminated DGU at 78.8 kg/m² (demo) ≈ 277 kg > 250 kg; area 3.6 m², aspect 1.6 -> only weight
    "GLASS_WEIGHT_HIGH": dict(width=1500, mullions=[0, 1500], bays=[{"transoms": [2400]}],
                              fills={"b0-f0": {"type": "glass", "glass_type_id": "gl-dgu-lam-3152"}}),
    # 2400 x 2000 axis field = 4.8 m² > 4.5 m² with light 6 mm glass (≈ 70 kg)
    "FIELD_AREA_HIGH": dict(width=2400, height=3600, mullions=[0, 2400], bays=[{"transoms": [2000]}],
                            default_glass_type_id="gl-sgl-6"),
    # 1500 x 300 field: aspect 5.0 > 4.0
    "FIELD_ASPECT_HIGH": dict(width=1500, height=2000, mullions=[0, 1500], bays=[{"transoms": [300]}],
                              anchor_levels=[0, 2000]),
    # 4500 mm between the only two anchor levels > 4000 mm
    "MULLION_SPAN_HIGH": dict(width=1500, height=4500, mullions=[0, 1500], bays=[{"transoms": [2250]}],
                              anchor_levels=[0, 4500]),
    "ANCHORS_MISSING": dict(anchor_levels=[0]),
    "NO_COLOUR_SELECTED": dict(colour_id=None),
}


def test_normal_elevation_has_no_design_warnings(cat):
    issues = run_design_checks(lobby(), cat)
    assert issues == []
    r = calculate(lobby(), cat)
    assert not (codes(r.issues) & CODES)


@pytest.mark.parametrize("code", sorted(CRAFTED))
def test_each_check_triggers_only_its_code(cat, code):
    e = lobby(**CRAFTED[code])
    issues = run_design_checks(e, cat)
    assert codes(issues) == {code}, [i.message for i in issues]
    for i in issues:
        assert i.severity == "warning"
        assert i.message.endswith(SUFFIX)
        assert i.message.endswith("(demo threshold — requires engineering approval)")
    # wired into calc.calculate: appended to issues, never blocking
    r = calculate(e, cat)
    assert code in codes(r.issues)
    assert r.validation_status == "PROVISIONAL_DEMO_RULES" and r.profile_cuts


def test_thresholds_are_documented_demo_params(cat):
    for rs in cat["rule_sets"]:
        assert rs["approved"] is False
        for p in ("max_glass_weight_kg", "max_field_area_m2", "max_field_aspect_ratio",
                  "max_unsupported_mullion_span", "min_anchor_levels"):
            assert isinstance(rs["params"][p], (int, float))
            assert "DEMO placeholder" in rs["param_docs"][p] and "requires approval" in rs["param_docs"][p]


def test_threshold_comes_from_rule_set(cat):
    e = lobby(**CRAFTED["GLASS_WEIGHT_HIGH"])
    c2 = copy.deepcopy(cat)
    next(r for r in c2["rule_sets"] if r["id"] == "rs-cw50-demo")["params"]["max_glass_weight_kg"] = 300
    assert run_design_checks(e, c2) == []


def test_missing_params_reported_not_silently_skipped(cat):
    c2 = copy.deepcopy(cat)
    rs = next(r for r in c2["rule_sets"] if r["id"] == "rs-cw50-demo")
    del rs["params"]["max_field_area_m2"]
    issues = run_design_checks(lobby(**CRAFTED["FIELD_AREA_HIGH"]), c2)
    assert codes(issues) == {"DESIGN_CHECK_PARAM_MISSING"}
    assert issues[0].severity == "info" and "max_field_area_m2" in issues[0].message


def test_invalid_geometry_skips_checks(cat):
    e = lobby(mullions=[0, 1500, 3000, 6000], colour_id=None)   # bays/mullions mismatch
    assert run_design_checks(e, cat) == []


def test_mullion_spans():
    assert mullion_spans(lobby(anchor_levels=[])) == [3600]
    assert mullion_spans(lobby(anchor_levels=[1000, 3000])) == [1000, 2000, 600]
    assert mullion_spans(lobby(anchor_levels=[0, 3600])) == [3600]
