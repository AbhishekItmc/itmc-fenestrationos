import pytest
from pydantic import ValidationError

from app.engines.elevation import (add_mullion, add_transom, add_transom_all_bays, field_rects, make_grid,
                                   move_mullion, move_transom, remove_mullion, remove_transom, resize, set_fill,
                                   validate_elevation)
from app.engines.models import Bay, Elevation, FieldFill, TopShapeArch


def codes(issues, severity=None):
    return {i.code for i in issues if severity is None or i.severity == severity}


def grid(**kw):
    base = dict(system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    base.update(kw)
    return make_grid(3000, 3600, 3, 2, **base)


def test_make_grid_and_field_rects():
    e = make_grid(3000, 3600, 3, 2)
    assert e.mullions == [0, 1000, 2000, 3000]
    assert len(e.bays) == 3 and all(b.transoms == [1800] for b in e.bays)
    rects = field_rects(e)
    assert len(rects) == 6
    r = next(r for r in rects if r["key"] == "b1-f1")
    assert (r["x0"], r["x1"], r["y0"], r["y1"]) == (1000, 2000, 1800, 3600)
    assert validate_elevation(e) == []


def test_valid_elevation_with_catalogue(cat):
    issues = validate_elevation(grid(), cat)
    assert not codes(issues, "error"), issues


def test_invalid_dimensions_rejected():
    with pytest.raises(ValidationError):
        Elevation(width=0, height=1000, mullions=[0, 0], bays=[Bay()])
    e = Elevation.model_construct(width=-5, height=1000, mullions=[0, 1000], bays=[Bay()], fills={},
                                  anchor_levels=[], quantity=1)
    assert "INVALID_WIDTH" in codes(validate_elevation(e))


def test_mullion_rules():
    e = make_grid(3000, 3000, 3, 1)
    bad = e.model_copy(update={"mullions": [0, 2000, 1000, 3000]})
    assert "MULLIONS_NOT_INCREASING" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"mullions": [10, 1000, 2000, 3000]})
    assert "MULLION_FIRST_NOT_ZERO" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"mullions": [0, 1000, 2000, 2990]})
    assert "MULLION_LAST_NOT_WIDTH" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"mullions": [0, 1000, 1000, 3000]})
    assert "MULLIONS_NOT_INCREASING" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"bays": e.bays[:2]})
    assert "BAY_COUNT_MISMATCH" in codes(validate_elevation(bad))


def test_transom_rules():
    e = make_grid(2000, 3000, 2, 1)
    bad = e.model_copy(update={"bays": [Bay(transoms=[3000]), Bay()]})
    assert "TRANSOM_OUTSIDE" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"bays": [Bay(transoms=[0]), Bay()]})
    assert "TRANSOM_OUTSIDE" in codes(validate_elevation(bad))
    bad = e.model_copy(update={"bays": [Bay(transoms=[2000, 1000]), Bay()]})
    assert "TRANSOMS_NOT_INCREASING" in codes(validate_elevation(bad))


def test_field_size_limits(cat):
    e = grid()
    small = add_mullion(e, 1200)  # bay of 200 mm < min 300
    assert "FIELD_TOO_NARROW" in codes(validate_elevation(small, cat), "error")
    short = add_transom(e, 0, 100)
    assert "FIELD_TOO_SHORT" in codes(validate_elevation(short, cat), "error")
    wide = make_grid(2600, 3000, 1, 1, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    assert "FIELD_TOO_WIDE" in codes(validate_elevation(wide, cat), "error")
    tall = make_grid(2000, 4100, 1, 1, system_id="ser-cw50", default_glass_type_id="gl-dgu-24")
    assert "FIELD_TOO_TALL" in codes(validate_elevation(tall, cat), "error")
    # no catalogue => no rule-set checks
    assert "FIELD_TOO_NARROW" not in codes(validate_elevation(small))


def test_arch_geometry_valid_but_calc_unsupported():
    e = make_grid(3000, 3000, 3, 1).model_copy(update={"top_shape": TopShapeArch(rise=1500)})
    c = codes(validate_elevation(e))
    assert "ARCH_CALC_UNSUPPORTED" in c and "ARCH_RISE_INVALID" not in c
    e2 = e.model_copy(update={"top_shape": TopShapeArch(rise=1600)})
    assert "ARCH_RISE_INVALID" in codes(validate_elevation(e2))


def test_anchor_levels():
    e = make_grid(2000, 3000, 2, 1, anchor_levels=[0, 3000])
    assert validate_elevation(e) == []
    assert "ANCHOR_OUTSIDE" in codes(validate_elevation(e.model_copy(update={"anchor_levels": [3100]})))


def test_profile_and_system_checks(cat):
    assert "PROFILE_NOT_IN_SERIES" in codes(validate_elevation(grid(mullion_profile_id="prf-cw65-m175"), cat))
    assert "PROFILE_WRONG_ROLE" in codes(validate_elevation(grid(mullion_profile_id="prf-cw50-t100"), cat))
    assert "PROFILE_NOT_FOUND" in codes(validate_elevation(grid(transom_profile_id="prf-x"), cat))
    assert "SYSTEM_NOT_FOUND" in codes(validate_elevation(grid(system_id="ser-x"), cat))
    assert "SYSTEM_NOT_SET" in codes(validate_elevation(grid(system_id=None), cat))
    assert "COLOUR_NOT_FOUND" in codes(validate_elevation(grid(colour_id="col-x"), cat))
    assert "RULE_SET_SERIES_MISMATCH" in codes(validate_elevation(grid(), cat, rule_set_id="rs-cw65-demo"))


def test_glass_compatibility(cat):
    # 33.52 mm acoustic DGU exceeds the CW-50 demo range (6-32) but fits CW-65 (6-42)
    e = grid(default_glass_type_id="gl-acoustic-demo")
    assert "GLASS_THICKNESS_INCOMPATIBLE" in codes(validate_elevation(e, cat), "error")
    e65 = e.model_copy(update={"system_id": "ser-cw65"})
    assert "GLASS_THICKNESS_INCOMPATIBLE" not in codes(validate_elevation(e65, cat))
    fire = set_fill(grid(), 0, 0, FieldFill(type="glass", glass_type_id="gl-fire-demo"))
    assert "FIRE_RATING_NOT_CERTIFIED" in codes(validate_elevation(fire, cat), "warning")
    proj = set_fill(grid(), 0, 0, FieldFill(type="glass", glass_type_id="gl-project"))
    assert "FILL_THICKNESS_UNKNOWN" in codes(validate_elevation(proj, cat), "warning")
    missing = set_fill(grid(), 0, 0, FieldFill(type="glass", glass_type_id="gl-nope"))
    assert "GLASS_TYPE_NOT_FOUND" in codes(validate_elevation(missing, cat), "error")
    panel = set_fill(grid(), 0, 0, FieldFill(type="panel"))
    assert "PANEL_TYPE_MISSING" in codes(validate_elevation(panel, cat), "error")


def test_fill_keys_and_openings(cat):
    e = grid()
    e2 = e.model_copy(update={"fills": {"bad": FieldFill(), "b9-f0": FieldFill(), "b0-f1": FieldFill(type="opening")}})
    c = validate_elevation(e2, cat)
    assert "FILL_KEY_INVALID" in codes(c, "error")
    assert "FILL_KEY_ORPHAN" in codes(c, "warning")
    assert "VENT_NOT_SUPPORTED_IN_V1" in codes(c, "warning")


def test_editing_helpers_are_pure_and_remap_fills():
    e = make_grid(3000, 3000, 3, 2)
    e = set_fill(e, 1, 0, FieldFill(type="panel", panel_type_id="pnl-acp-4"))
    e = set_fill(e, 2, 1, FieldFill(type="none"))
    snapshot = e.model_dump()

    a = add_mullion(e, 1500)
    assert a.mullions == [0, 1000, 1500, 2000, 3000] and len(a.bays) == 4
    assert a.fills["b1-f0"].type == "panel" and a.fills["b2-f0"].type == "panel"
    assert a.fills["b3-f1"].type == "none"
    assert e.model_dump() == snapshot  # input untouched
    assert validate_elevation(a) == []

    r = remove_mullion(a, 2)
    assert r.mullions == [0, 1000, 2000, 3000] and r.fills["b1-f0"].type == "panel" and r.fills["b2-f1"].type == "none"

    t = add_transom(e, 1, 600)
    assert t.bays[1].transoms == [600, 1500]
    assert t.fills["b1-f0"].type == "panel" and t.fills["b1-f1"].type == "panel"
    t2 = remove_transom(t, 1, 0)
    assert t2.bays[1].transoms == [1500] and t2.fills["b1-f0"].type == "panel"

    allb = add_transom_all_bays(e, 2500)
    assert all(b.transoms == [1500, 2500] for b in allb.bays)
    assert allb.fills["b2-f1"].type == "none" and allb.fills["b2-f2"].type == "none"

    assert move_mullion(e, 1, 900).mullions[1] == 900
    assert move_transom(e, 0, 0, 1200).bays[0].transoms == [1200]
    for bad in (lambda: add_mullion(e, 1000), lambda: add_mullion(e, 0), lambda: remove_mullion(e, 0),
                lambda: add_transom(e, 0, 3000), lambda: move_mullion(e, 1, 2500),
                lambda: move_transom(e, 0, 0, 3100)):
        with pytest.raises(ValueError):
            bad()

    z = resize(e, width=6000, height=4500)
    assert z.mullions == [0, 2000, 4000, 6000] and z.bays[0].transoms == [2250]
    assert validate_elevation(z) == []
