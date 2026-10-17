"""Calc tests. Expected values are ARITHMETIC CONSISTENCY checks against the stated DEMO params,
not engineering validation."""
import copy

import pytest

from app.engines.calc import ENGINE_VERSION, calculate
from app.engines.elevation import add_mullion, make_grid, set_fill
from app.engines.models import FieldFill, TopShapeArch
from app.engines.validators import validate_calc


def one_bay(**kw):
    base = dict(system_id="ser-cw50", default_glass_type_id="gl-dgu-24", anchor_levels=[0, 2000])
    base.update(kw)
    return make_grid(1000, 2000, 1, 1, **base)


def cut(res, role):
    return [c for c in res.profile_cuts if c.role == role]


def bom(res, item_type):
    return [b for b in res.bom if b.item_type == item_type]


def test_single_bay_arithmetic(cat):
    P = cat["rule_sets"][0]["params"]
    assert (P["mullion_ext_top"], P["mullion_ext_bottom"], P["transom_clearance"], P["glass_deduction_x"]) == \
        (50, 50, 1, 20)
    r = calculate(one_bay(), cat)
    assert r.validation_status == "PROVISIONAL_DEMO_RULES"
    assert r.validation.passed and r.engine_version == ENGINE_VERSION
    assert r.rule_set_id == "rs-cw50-demo" and r.rule_set_approved is False
    (m,) = cut(r, "mullion")
    assert m.length == 2000 + 50 + 50 and m.quantity == 2 and m.profile_id == "prf-cw50-m150"
    (s,) = cut(r, "sill")
    (h,) = cut(r, "head")
    assert s.length == h.length == 1000 - 25 - 25 - 2 * 1 == 948
    assert not cut(r, "transom")
    (g,) = r.glass_items
    assert (g.width, g.height) == (980, 1980) and g.area_m2 == pytest.approx(0.98 * 1.98)
    assert r.totals["glass_area_m2"] == pytest.approx(1.9404)
    (gk,) = bom(r, "gasket")
    assert gk.quantity == pytest.approx(2 * (980 + 1980) / 1000 * 2)
    (cn,) = bom(r, "connector")
    assert cn.quantity == 2 * 2  # 2 per horizontal member x (sill + head)
    (br,) = bom(r, "bracket")
    assert br.quantity == 1 * 2 * 2  # per anchor x 2 levels x 2 mullions
    (sl,) = bom(r, "sealant")
    assert sl.quantity == pytest.approx(2 * (1000 + 2000) / 1000)
    prof = {b.item_id: b.quantity for b in bom(r, "profile")}
    assert prof["prf-cw50-m150"] == pytest.approx(2 * 2.1)
    assert prof["prf-cw50-t100"] == pytest.approx(2 * 0.948)
    pp = {c.length for c in cut(r, "pressure_plate")}
    assert pp == {2000, 1000}
    assert all(c.formula and c.rule_ids for c in r.profile_cuts)
    assert all(b.demo_data for b in r.bom)
    assert any(i.code == "PROVISIONAL_DEMO_RULES" for i in r.issues)


def test_quantity_multiplier(cat):
    r1 = calculate(one_bay(), cat)
    r3 = calculate(one_bay(quantity=3), cat)
    for a, b in zip(r1.profile_cuts, r3.profile_cuts):
        assert b.quantity == 3 * a.quantity and a.length == b.length
    assert r3.totals["glass_area_m2"] == pytest.approx(3 * r1.totals["glass_area_m2"])
    assert r3.glass_items[0].quantity == 3
    assert r3.validation.passed


def test_grouping_of_identical_members(cat):
    e = make_grid(3000, 3600, 3, 2, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    r = calculate(e, cat)
    assert len(cut(r, "mullion")) == 1 and cut(r, "mullion")[0].quantity == 4
    assert len(cut(r, "transom")) == 1 and cut(r, "transom")[0].quantity == 3
    assert cut(r, "sill")[0].quantity == 3
    # unequal bays -> different transom lengths -> separate groups
    e2 = add_mullion(make_grid(2000, 3600, 1, 2, system_id="ser-cw50", default_glass_type_id="gl-dgu-24"), 800)
    r2 = calculate(e2, cat)
    lengths = sorted(c.length for c in cut(r2, "transom"))
    assert lengths == [800 - 52, 1200 - 52]
    assert r2.validation.passed


def test_splice_warning(cat):
    e = make_grid(1500, 6500, 1, 2, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    r = calculate(e, cat)
    assert cut(r, "mullion")[0].length == 6600
    sp = [i for i in r.issues if i.code == "SPLICE_REQUIRED"]
    assert sp and sp[0].severity == "warning"
    assert r.validation_status == "PROVISIONAL_DEMO_RULES"
    assert any(b.item_id == "acc-cw50-splice" for b in r.bom)


def test_none_and_opening_fields(cat):
    e = make_grid(2000, 3000, 2, 1, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    e = set_fill(e, 0, 0, FieldFill(type="none"))
    e = set_fill(e, 1, 0, FieldFill(type="opening"))
    r = calculate(e, cat)
    assert r.glass_items == []
    assert any(i.code == "VENT_NOT_SUPPORTED_IN_V1" for i in r.issues)
    assert r.validation.passed and r.totals["glass_area_m2"] == 0


def test_panel_and_spandrel(cat):
    e = make_grid(2000, 3000, 2, 2, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    e = set_fill(e, 0, 0, FieldFill(type="panel", panel_type_id="pnl-ins-25"))
    e = set_fill(e, 1, 0, FieldFill(type="spandrel", glass_type_id="gl-spandrel-6"))
    r = calculate(e, cat)
    assert r.validation.passed
    p = [g for g in r.glass_items if g.fill_type == "panel"]
    assert len(p) == 1 and p[0].panel_type_id == "pnl-ins-25" and p[0].glass_type_id is None
    assert bom(r, "panel")[0].quantity == pytest.approx(p[0].area_m2)
    assert {b.item_id for b in bom(r, "glass")} == {"gl-dgu-24", "gl-spandrel-6"}


def test_invalid_elevation_returns_invalid_with_no_cuts(cat):
    e = one_bay().model_copy(update={"mullions": [0, 900]})
    r = calculate(e, cat)
    assert r.validation_status == "INVALID"
    assert r.profile_cuts == [] and r.glass_items == [] and r.bom == []
    assert any(i.code == "MULLION_LAST_NOT_WIDTH" for i in r.issues)
    arch = calculate(one_bay().model_copy(update={"top_shape": TopShapeArch(rise=300)}), cat)
    assert arch.validation_status == "INVALID" and any(i.code == "ARCH_CALC_UNSUPPORTED" for i in arch.issues)
    nosys = calculate(one_bay(system_id=None), cat)
    assert nosys.validation_status == "INVALID"


def test_validated_status_requires_approval_and_golden(cat):
    c2 = copy.deepcopy(cat)
    c2["rule_sets"][0]["approved"] = True
    assert calculate(one_bay(), c2).validation_status == "PROVISIONAL_DEMO_RULES"
    c2["rule_sets"][0]["golden_cases_passed"] = True
    r = calculate(one_bay(), c2)
    assert r.validation_status == "VALIDATED" and r.rule_set_approved


def test_explicit_rule_set_and_missing(cat):
    r = calculate(one_bay(), cat, rule_set_id="rs-nope")
    assert r.validation_status == "INVALID"
    assert any(i.code == "RULE_SET_NOT_FOUND" for i in r.issues)


def test_inputs_hash(cat):
    a = calculate(one_bay(), cat).inputs_hash
    assert a == calculate(one_bay(), cat).inputs_hash and len(a) == 64
    assert a != calculate(one_bay(quantity=2), cat).inputs_hash
    c2 = copy.deepcopy(cat)
    c2["catalogue_version"] = "DEMO-other"
    assert a != calculate(one_bay(), c2).inputs_hash


def test_validate_calc_detects_corruption(cat):
    e = make_grid(3000, 3600, 3, 2, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    r = calculate(e, cat)
    assert validate_calc(r).passed
    bad = r.model_copy(deep=True)
    bad.glass_items.pop()
    assert not validate_calc(bad).passed
    bad = r.model_copy(deep=True)
    bad.bom[0].quantity += 0.5
    assert not validate_calc(bad).passed
    bad = r.model_copy(deep=True)
    bad.profile_cuts[0].length = 0
    assert not validate_calc(bad).passed
    bad = r.model_copy(deep=True)
    bad.glass_items[0].area_m2 *= 1.1
    assert not validate_calc(bad).passed
    bad = r.model_copy(deep=True)
    bad.profile_cuts[0].quantity -= 1
    assert not validate_calc(bad).passed
