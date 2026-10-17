from app.engines import units
from app.engines.catalogue import (REQUIRED_RULE_PARAMS, find_accessory, get_glass_type, get_profile,
                                   get_rule_set, get_series, load_demo_catalogue, validate_catalogue)


def test_rounding_and_conversions():
    assert units.EPS == 1e-6
    assert units.round_mm(12.34) == 12.3
    assert units.round_mm(12.35) == 12.4
    assert units.round_mm(-12.35) == -12.4
    assert units.round_mm(0.04) == 0.0
    assert units.round_mm(1234.5678, 1) == 1235.0
    assert units.mm_to_m(1500) == 1.5
    assert units.mm2_to_m2(1_000_000) == 1.0
    assert units.rect_area_m2(1000, 2000) == 2.0
    assert units.feq(1.0, 1.0 + 1e-7)
    assert not units.feq(1.0, 1.0 + 1e-5)


def test_demo_catalogue_is_valid_and_labelled(cat):
    assert validate_catalogue(cat) == []
    assert cat["catalogue_version"] == "DEMO-2026.10-r1"
    assert cat["demo_data"] is True and cat["currency"] == "INR"
    assert "DEMO DATA" in cat["disclaimer"]
    assert len(cat["series"]) == 2
    for coll in ("series", "profiles", "glass_types", "panel_types", "accessories", "colours"):
        assert cat[coll], coll
        assert all(item["demo"] is True for item in cat[coll]), coll
    assert all(p["code"].startswith("DEMO-") for p in cat["profiles"])
    assert len(cat["glass_types"]) >= 10 and len(cat["panel_types"]) == 3 and len(cat["colours"]) == 5
    cats = {g["category"] for g in cat["glass_types"]}
    assert {"single", "laminated", "igu", "spandrel", "fire", "special", "project"} <= cats
    assert "none" not in {g["id"] for g in cat["glass_types"]}


def test_fire_glass_has_no_rating(cat):
    fire = [g for g in cat["glass_types"] if g["category"] == "fire"]
    assert fire
    for g in fire:
        assert g["fire_rating"] is None
        assert "certified" in g["notes"].lower()


def test_rule_sets_complete_documented_and_unapproved(cat):
    for rs in cat["rule_sets"]:
        assert rs["approved"] is False
        for p in REQUIRED_RULE_PARAMS:
            assert p in rs["params"]
        for p in rs["params"]:
            assert "requires approval" in rs["param_docs"][p]


def test_lookups(cat):
    s = get_series(cat, "ser-cw50")
    assert s["face_width"] == 50
    assert get_profile(cat, s["mullion_profile_ids"][0])["role"] == "mullion"
    assert get_rule_set(cat, s["default_rule_set_id"])["series_id"] == "ser-cw50"
    assert get_glass_type(cat, "gl-dgu-24")["thickness"] == 24
    assert get_profile(cat, "nope") is None and get_series(cat, None) is None
    assert find_accessory(cat, "bracket", "ser-cw65")["id"] == "acc-cw65-bracket"
    assert find_accessory(cat, "sealant", "ser-cw65")["id"] == "acc-sealant-wx"


def test_validate_catalogue_detects_problems(cat):
    cat["profiles"][0]["series_id"] = "ser-missing"
    del cat["rule_sets"][0]["params"]["max_bar_length"]
    cat["rule_sets"][1]["params"]["undocumented"] = 1
    cat["glass_types"].append(dict(cat["glass_types"][0]))  # duplicate id
    fire = next(g for g in cat["glass_types"] if g["category"] == "fire")
    fire["fire_rating"] = "EI60"
    codes = {i.code for i in validate_catalogue(cat)}
    assert {"CAT_BAD_REF", "CAT_RULE_PARAM_MISSING", "CAT_RULE_PARAM_UNDOCUMENTED", "CAT_DUPLICATE_ID",
            "CAT_FIRE_RATING_IN_DEMO"} <= codes


def test_load_returns_independent_copies():
    a = load_demo_catalogue()
    a["series"].clear()
    assert load_demo_catalogue()["series"]
