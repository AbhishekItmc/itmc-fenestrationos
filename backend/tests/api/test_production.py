"""Production tracking (§8.1): work orders, parts, scan events, board, labels, work order sheet."""
import io
import math
import re

import pytest
from pypdf import PdfReader
from sqlalchemy import select

from app.models import Part

from helpers import assert_error, lobby_elevation, uid

API = "/api/v1"
CODE_RE = re.compile(r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$")
PROFILE_ROUTE = ["cutting", "machining", "assembly", "qc", "dispatch"]
GLASS_ROUTE = ["receiving", "glazing", "qc", "dispatch"]
GLASS_CODE = "DEMO-GL-D24"   # demo catalogue code of gl-dgu-24


def _project(client, auth, **elev):
    h = auth["engineer"]
    p = client.post(f"{API}/projects", headers=h, json={"code": uid("WO"), "name": "WO test"}).json()
    e = client.post(f"{API}/projects/{p['id']}/elevations", headers=h, json={"data": lobby_elevation(**elev)}).json()
    run = client.post(f"{API}/elevations/{e['id']}/calculate", headers=h).json()
    assert run["validation_status"] == "PROVISIONAL_DEMO_RULES"
    return p, e, run


def _order(client, auth, p, run, role="engineer", **kw):
    r = client.post(f"{API}/production-orders", headers=auth[role],
                    json={"project_id": p["id"], "name": "Fab", "calc_run_ids": [run["id"]], **kw})
    return r


@pytest.fixture
def small(client, auth):
    """1 bay, no transoms -> 2 mullions, sill, head, PP/CC verticals+horizontals and 1 glass pane."""
    p, e, run = _project(client, auth, width=1500, height=3000, mullions=[0, 1500], bays=[{"transoms": []}],
                         anchor_levels=[0, 3000])
    o = _order(client, auth, p, run).json()
    return p, e, run, o


def _parts(client, auth, oid, **q):
    r = client.get(f"{API}/production-orders/{oid}/parts", headers=auth["viewer"], params=q)
    assert r.status_code == 200, r.text
    return r.json()


def ev(client, auth, code, station, action, note=None, role="operator"):
    body = {"station": station, "action": action}
    if note is not None:
        body["note"] = note
    return client.post(f"{API}/parts/{code}/events", headers=auth[role], json=body)


def test_part_explosion_counts_quantity_times_elevation_quantity(client, auth):
    p, e, run = _project(client, auth, quantity=2)
    r = _order(client, auth, p, run, due_date="2026-12-01", notes="n")
    assert r.status_code == 201, r.text
    o = r.json()
    assert re.match(r"^WO-\d{4}-\d{4}$", o["number"])
    assert o["status"] == "planned" and o["calc_run_ids"] == [run["id"]] and o["due_date"] == "2026-12-01"
    assert o["provisional"] is True
    res = run["result"]
    expected = sum(c["quantity"] for c in res["profile_cuts"]) + sum(g["quantity"] for g in res["glass_items"])
    assert o["counts"] == {"total": expected, "pending": expected, "in_progress": 0, "done": 0, "blocked": 0}
    parts = _parts(client, auth, o["id"])
    assert len(parts) == expected
    # 5 mullion lines x elevation quantity 2 -> 10 physical mullions; 12 fields x 2 -> 24 panes
    assert sum(1 for x in parts if x["mark"].startswith("M")) == 5 * 2
    assert sum(1 for x in parts if x["kind"] == "glass") == 12 * 2
    m1 = sorted((x for x in parts if x["mark"] == "M1"), key=lambda x: x["seq"])
    assert [x["seq"] for x in m1] == list(range(1, 11))
    cut = next(c for c in res["profile_cuts"] if c["mark"] == "M1")
    assert all(x["length"] == cut["length"] and x["item_code"] == cut["profile_code"] for x in m1)
    g = next(x for x in parts if x["kind"] == "glass")
    gi = next(x for x in res["glass_items"] if x["mark"] == g["mark"])
    assert (g["width"], g["height"], g["field_key"]) == (gi["width"], gi["height"], gi["field_key"])
    assert g["item_code"] == GLASS_CODE
    for x in parts:
        assert x["route"] == (PROFILE_ROUTE if x["kind"] == "profile" else GLASS_ROUTE)
        assert x["current_station"] == x["route"][0] and x["station_index"] == 0 and x["status"] == "pending"
    # filters
    assert len(_parts(client, auth, o["id"], kind="glass")) == 24
    assert len(_parts(client, auth, o["id"], station="receiving")) == 24
    assert len(_parts(client, auth, o["id"], status="done")) == 0
    lst = client.get(f"{API}/production-orders", headers=auth["viewer"], params={"project_id": p["id"]}).json()
    assert [x["id"] for x in lst] == [o["id"]] and lst[0]["counts"]["total"] == expected


def test_codes_unique_and_format(client, auth, small, db):
    p, e, run, o = small
    o2 = _order(client, auth, p, run).json()
    codes = [x["code"] for x in _parts(client, auth, o["id"]) + _parts(client, auth, o2["id"])]
    assert all(CODE_RE.match(c) for c in codes)
    assert len(set(codes)) == len(codes)
    assert o2["number"] != o["number"]


def test_code_collision_is_redrawn(small, db):
    from app.services import production as svc
    taken = db.scalars(select(Part.code).limit(1)).first()
    assert taken
    seq = iter([taken, taken, "AAAAAAA2", "AAAAAAA2", "AAAAAAA3", "AAAAAAA4"])
    out = svc.new_codes(db, 3, gen=lambda: next(seq))
    assert out == ["AAAAAAA2", "AAAAAAA3", "AAAAAAA4"] and taken not in out
    assert svc.is_valid_code("ABCDEFGH") and not svc.is_valid_code("ABCDEFG0") and not svc.is_valid_code("ABC")
    assert all(svc.is_valid_code(svc.random_code()) for _ in range(200))


def test_full_route_walk_to_done_and_order_status(client, auth, small):
    p, e, run, o = small
    parts = _parts(client, auth, o["id"])
    for i, part in enumerate(parts):
        for st in part["route"]:
            if i == 0:   # first part: explicit start + complete at every station
                r = ev(client, auth, part["code"], st, "start")
                assert r.status_code == 200 and r.json()["status"] == "in_progress", r.text
            r = ev(client, auth, part["code"], st, "complete")
            assert r.status_code == 200, r.text
        assert r.json()["status"] == "done" and r.json()["current_station"] is None
        if i == 0:
            od = client.get(f"{API}/production-orders/{o['id']}", headers=auth["viewer"]).json()
            assert od["status"] == "in_progress" and od["counts"]["done"] == 1
    od = client.get(f"{API}/production-orders/{o['id']}", headers=auth["viewer"]).json()
    assert od["status"] == "done" and od["counts"]["done"] == od["counts"]["total"] == len(parts)
    d = client.get(f"{API}/parts/{parts[0]['code'].lower()}", headers=auth["viewer"]).json()
    assert d["order"] == {"id": o["id"], "number": o["number"], "name": "Fab"}
    assert d["project"]["code"] == p["code"]
    assert [x["action"] for x in d["events"]] == ["start", "complete"] * len(PROFILE_ROUTE)
    assert [x["station"] for x in d["events"][::2]] == PROFILE_ROUTE
    assert d["events"][0]["user_name"] == "Demo Operator"
    # note on a done part at a station of its route is allowed; anything else is not
    assert ev(client, auth, parts[0]["code"], "qc", "note", "re-inspected").status_code == 200
    assert_error(ev(client, auth, parts[0]["code"], "dispatch", "complete"), 409, "INVALID_TRANSITION")
    # every event audited
    au = client.get(f"{API}/admin/audit", headers=auth["admin"],
                    params={"entity": "part", "entity_id": parts[0]["code"], "limit": 100}).json()
    items = au["items"] if isinstance(au, dict) else au
    assert len(items) == len(PROFILE_ROUTE) * 2 + 1
    assert {a["action"] for a in items} == {"part_start", "part_complete", "part_note"}


def test_invalid_transitions_409(client, auth, small):
    p, e, run, o = small
    part = _parts(client, auth, o["id"], kind="profile")[0]
    c = part["code"]
    assert_error(ev(client, auth, c, "machining", "start"), 409, "INVALID_TRANSITION")      # wrong station
    assert_error(ev(client, auth, c, "cutting", "unblock"), 409, "INVALID_TRANSITION")     # not blocked
    assert ev(client, auth, c, "cutting", "start").status_code == 200
    assert_error(ev(client, auth, c, "cutting", "start"), 409, "INVALID_TRANSITION")       # already started
    assert ev(client, auth, c, "cutting", "block", "saw down").status_code == 200
    assert_error(ev(client, auth, c, "cutting", "start"), 409, "INVALID_TRANSITION")       # blocked
    assert_error(ev(client, auth, c, "cutting", "complete"), 409, "INVALID_TRANSITION")
    assert_error(ev(client, auth, c, "cutting", "block", "again"), 409, "INVALID_TRANSITION")
    assert_error(client.post(f"{API}/parts/{c}/events", headers=auth["operator"],
                             json={"station": "cutting", "action": "teleport"}), 422)
    assert_error(client.get(f"{API}/parts/ZZZZZZZZ", headers=auth["viewer"]), 404)
    assert_error(client.get(f"{API}/parts/not-a-code", headers=auth["viewer"]), 404)
    # cancelled order: no more scans
    assert client.put(f"{API}/production-orders/{o['id']}", headers=auth["engineer"],
                      json={"status": "cancelled"}).json()["status"] == "cancelled"
    other = _parts(client, auth, o["id"], kind="glass")[0]
    assert_error(ev(client, auth, other["code"], "receiving", "start"), 409, "INVALID_TRANSITION")


def test_block_requires_note_and_unblock_restores(client, auth, small):
    p, e, run, o = small
    c = _parts(client, auth, o["id"], kind="glass")[0]["code"]
    assert_error(ev(client, auth, c, "receiving", "block"), 422, "NOTE_REQUIRED")
    assert_error(ev(client, auth, c, "receiving", "block", "   "), 422, "NOTE_REQUIRED")
    assert_error(ev(client, auth, c, "receiving", "note"), 422, "NOTE_REQUIRED")
    assert ev(client, auth, c, "receiving", "start").json()["status"] == "in_progress"
    r = ev(client, auth, c, "receiving", "block", "chipped edge")
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert client.get(f"{API}/production-orders/{o['id']}", headers=auth["viewer"]).json()["counts"]["blocked"] == 1
    r = ev(client, auth, c, "receiving", "unblock")
    assert r.json()["status"] == "in_progress"           # previous state restored
    d = client.get(f"{API}/parts/{c}", headers=auth["operator"]).json()
    assert [(x["action"], x["note"]) for x in d["events"]] == [("start", None), ("block", "chipped edge"),
                                                               ("unblock", None)]


def test_roles_operator_and_viewer(client, auth, small):
    p, e, run, o = small
    c = _parts(client, auth, o["id"])[0]["code"]
    # operator: scan yes, create/update orders no, read yes
    assert ev(client, auth, c, "cutting", "start", role="operator").status_code == 200
    assert_error(_order(client, auth, p, run, role="operator"), 403, "FORBIDDEN")
    assert_error(client.put(f"{API}/production-orders/{o['id']}", headers=auth["operator"], json={"name": "x"}), 403)
    assert client.get(f"{API}/production-orders/{o['id']}/board", headers=auth["operator"]).status_code == 200
    assert_error(client.post(f"{API}/projects", headers=auth["operator"], json={"code": uid("X"), "name": "x"}), 403)
    # viewer: read-only
    assert_error(ev(client, auth, c, "cutting", "complete", role="viewer"), 403, "FORBIDDEN")
    assert_error(_order(client, auth, p, run, role="viewer"), 403)
    assert client.get(f"{API}/parts/{c}", headers=auth["viewer"]).status_code == 200
    # estimator may not create work orders; engineer/admin can scan
    assert_error(_order(client, auth, p, run, role="estimator"), 403)
    assert ev(client, auth, c, "cutting", "complete", role="engineer").status_code == 200
    # operator user exists with the new role
    me = client.get(f"{API}/auth/me", headers=auth["operator"]).json()
    assert me["role"] == "operator"


def test_order_validation(client, auth, small):
    p, e, run, o = small
    assert_error(client.post(f"{API}/production-orders", headers=auth["engineer"],
                             json={"project_id": p["id"], "name": "x", "calc_run_ids": [999999]}), 404,
                 "CALC_RUN_NOT_FOUND")
    assert_error(client.post(f"{API}/production-orders", headers=auth["engineer"],
                             json={"project_id": 999999, "name": "x", "calc_run_ids": [run["id"]]}), 404)
    r = client.put(f"{API}/production-orders/{o['id']}", headers=auth["engineer"],
                   json={"name": "Renamed", "due_date": "2027-01-15", "status": "released"})
    assert r.status_code == 200 and r.json()["name"] == "Renamed" and r.json()["status"] == "released"
    assert_error(client.put(f"{API}/production-orders/{o['id']}", headers=auth["engineer"], json={"status": "x"}), 422)


def test_board_counts(client, auth, small):
    p, e, run, o = small
    prof = _parts(client, auth, o["id"], kind="profile")
    glass = _parts(client, auth, o["id"], kind="glass")
    n_p, n_g = len(prof), len(glass)
    a, b, c, d = (x["code"] for x in prof[:4])
    ev(client, auth, a, "cutting", "complete")                       # -> machining pending
    ev(client, auth, b, "cutting", "complete")
    ev(client, auth, b, "machining", "start")                        # machining in progress
    ev(client, auth, c, "cutting", "block", "bar missing")           # blocked at cutting
    for st in PROFILE_ROUTE:
        ev(client, auth, d, st, "complete")                          # done
    ev(client, auth, glass[0]["code"], "receiving", "start")
    bd = client.get(f"{API}/production-orders/{o['id']}/board", headers=auth["viewer"]).json()
    st = {s["id"]: s for s in bd["stations"]}
    assert [s["id"] for s in bd["stations"]] == ["cutting", "machining", "assembly", "receiving", "glazing", "qc",
                                                 "dispatch"]
    assert st["cutting"]["label"] == "Cutting" and st["receiving"]["label"] == "Glass receiving"
    assert st["qc"]["label"] == "Quality check"
    assert st["cutting"] == {**st["cutting"], "pending": n_p - 4, "in_progress": 0, "blocked": 1, "done_here": 3}
    assert st["machining"] == {**st["machining"], "pending": 1, "in_progress": 1, "blocked": 0, "done_here": 1}
    assert st["dispatch"]["done_here"] == 1 and st["qc"]["done_here"] == 1
    assert st["receiving"] == {**st["receiving"], "pending": n_g - 1, "in_progress": 1, "done_here": 0}
    assert bd["counts"] == {"total": n_p + n_g, "pending": n_p + n_g - 4, "in_progress": 2, "done": 1, "blocked": 1}


def _pdf(data):
    assert data[:5] == b"%PDF-"
    return PdfReader(io.BytesIO(data))


@pytest.mark.parametrize("layout,per_page,size_mm", [("a4-24", 24, (210, 297)), ("a4-8", 8, (210, 297)),
                                                     ("roll-62x29", 1, (62, 29))])
def test_labels_pdf_layouts(client, auth, small, layout, per_page, size_mm):
    p, e, run, o = small
    parts = _parts(client, auth, o["id"])
    r = client.get(f"{API}/reports/labels/{o['id']}.pdf", headers=auth["viewer"], params={"layout": layout})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["X-Label-Count"] == str(len(parts))
    pdf = _pdf(r.content)
    assert len(pdf.pages) == math.ceil(len(parts) / per_page)
    w, h = (float(x) / 72 * 25.4 for x in pdf.pages[0].mediabox[2:])
    assert (round(w), round(h)) == size_mm
    txt = "\n".join(pg.extract_text() or "" for pg in pdf.pages)
    for part in parts[:per_page]:
        assert part["code"] in txt
    assert o["number"] in txt and p["code"] in txt and "DEMO / PROVISIONAL" in txt
    assert "L=" in txt and " mm" in txt


def test_labels_filters_and_bad_layout(client, auth, small):
    p, e, run, o = small
    r = client.get(f"{API}/reports/labels/{o['id']}.pdf", headers=auth["viewer"],
                   params={"layout": "a4-8", "kind": "glass"})
    assert r.headers["X-Label-Count"] == "1"
    assert_error(client.get(f"{API}/reports/labels/{o['id']}.pdf", headers=auth["viewer"],
                            params={"layout": "a5"}), 422)


def test_label_qr_payload(settings):
    from app.reports.labels import labels_pdf, qr_payload
    parts = [{"code": "ABCD2345", "kind": "profile", "mark": "M1", "seq": 1, "description": "Mullion",
              "length": 3700.0, "angle_start": 90.0, "angle_end": 90.0},
             {"code": "WXYZ6789", "kind": "glass", "mark": "G1.1", "seq": 2, "description": "Glass",
              "width": 1480.0, "height": 1080.0}]
    widgets = []
    data = labels_pdf(parts, {"project_code": "P1", "order_number": "WO-2026-0001"}, "roll-62x29",
                      "https://fos.example/", widgets)
    assert [w.value for w in widgets] == ["https://fos.example/p/ABCD2345", "https://fos.example/p/WXYZ6789"]
    assert qr_payload(settings.public_base_url, "ABCD2345") == "http://localhost:5173/p/ABCD2345"
    txt = "\n".join(pg.extract_text() for pg in _pdf(data).pages)
    assert "L=3700 mm" in txt and "1480 × 1080 mm" in txt


def test_label_qr_decodes_from_rendered_pdf(client, auth, small, settings):
    """Rasterise the label PDF and decode the QR with zbar (skipped when pyzbar/libzbar/pypdfium2 are missing)."""
    pytest.importorskip("pypdfium2")
    pyzbar = pytest.importorskip("pyzbar.pyzbar")
    import pypdfium2 as pdfium
    p, e, run, o = small
    part = _parts(client, auth, o["id"])[0]
    for layout in ("roll-62x29", "a4-24"):
        r = client.get(f"{API}/reports/labels/{o['id']}.pdf", headers=auth["viewer"], params={"layout": layout})
        page = pdfium.PdfDocument(r.content)[0]
        img = page.render(scale=300 / 72).to_pil().convert("L")
        found = {d.data.decode() for d in pyzbar.decode(img)}
        assert f"{settings.public_base_url}/p/{part['code']}" in found, (layout, found)


def test_work_order_sheet_pdf(client, auth, small):
    p, e, run, o = small
    c = _parts(client, auth, o["id"])[0]["code"]
    ev(client, auth, c, "cutting", "complete")
    r = client.get(f"{API}/reports/production/{o['id']}.pdf", headers=auth["viewer"])
    assert r.status_code == 200 and r.headers["X-Provisional"] == "true"
    txt = "\n".join(pg.extract_text() or "" for pg in _pdf(r.content).pages)
    for needle in (o["number"], "PROVISIONAL", "Stations", "At station: Cutting", "At station: Machining",
                   "At station: Glass receiving", c, "Quality check"):
        assert needle in txt, needle
    assert_error(client.get(f"{API}/reports/production/999999.pdf", headers=auth["viewer"]), 404)


def test_seeded_demo_order_shows_progress(client, auth):
    projects = client.get(f"{API}/projects", headers=auth["viewer"]).json()
    pid = next(x["id"] for x in projects if x["code"] == "DEMO-P001")
    orders = client.get(f"{API}/production-orders", headers=auth["viewer"], params={"project_id": pid}).json()
    assert len(orders) == 1
    c = orders[0]["counts"]
    assert c["done"] > 0 and c["in_progress"] > 0 and c["blocked"] == 1 and c["pending"] > 0
    assert orders[0]["status"] == "in_progress"
    pos = client.get(f"{API}/purchase-orders", headers=auth["viewer"], params={"project_id": pid}).json()
    assert len(pos) == 1 and pos[0]["category"] == "mixed" and pos[0]["provisional"] is True


def test_old_demo_catalogue_revision_gets_design_check_params(client, db):
    """Existing databases seeded before v0.2: the seed adds the missing DEMO design-check params in a new revision."""
    import copy

    from app.engines.checks import CHECK_PARAMS
    from app.models import CatalogueRevision
    from app.services.catalogue import active_revision, ensure_design_check_params, next_version
    cur = active_revision(db)
    old = copy.deepcopy(cur.data)
    for rs in old["rule_sets"]:
        for k in CHECK_PARAMS:
            rs["params"].pop(k, None)
        rs["params"]["max_glass_weight_kg"] = 999.0            # custom value must survive
    cur.active = False
    legacy = CatalogueRevision(version=next_version(db, cur.version), data=old, active=True, demo=True, note="t")
    db.add(legacy)
    db.flush()
    rev = ensure_design_check_params(db)
    assert rev is not None and rev.active and rev.version != legacy.version
    for rs in rev.data["rule_sets"]:
        assert set(CHECK_PARAMS) <= set(rs["params"]) and rs["params"]["max_glass_weight_kg"] == 999.0
        assert "DEMO placeholder" in rs["param_docs"]["max_field_area_m2"]
    assert ensure_design_check_params(db) is None              # idempotent
    db.rollback()
