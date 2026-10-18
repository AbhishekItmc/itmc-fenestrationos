"""Purchasing (§8.2): bars from cutting jobs vs estimate, stock subtraction, receive -> inventory, totals, roles,
PO documents with the demo-price banner. Plus DXF export endpoints (§8.4)."""
import io
import math

import pytest
from openpyxl import load_workbook
from pypdf import PdfReader

from helpers import assert_error, lobby_elevation, uid

API = "/api/v1"
DEMO = "Demo prices — not a commercial offer"
BANNER = "PROVISIONAL — DEMO RULES/DATA — NOT FOR PRODUCTION"


@pytest.fixture
def calc(client, auth):
    h = auth["engineer"]
    p = client.post(f"{API}/projects", headers=h, json={"code": uid("PO"), "name": "PO test"}).json()
    e = client.post(f"{API}/projects/{p['id']}/elevations", headers=h, json={"data": lobby_elevation()}).json()
    run = client.post(f"{API}/elevations/{e['id']}/calculate", headers=h).json()
    return p, e, run


def from_calc(client, auth, p, body, role="estimator"):
    return client.post(f"{API}/projects/{p['id']}/purchase-orders/from-calc", headers=auth[role], json=body)


def lines_of(pos, item_type=None):
    return [ln for po in pos for ln in po["lines"] if item_type is None or ln["item_type"] == item_type]


def check_totals(po):
    for ln in po["lines"]:
        assert ln["amount"] == pytest.approx(round(ln["qty_to_order"] * ln["unit_price"], 2), abs=0.005)
        assert ln["qty_to_order"] == max(0, math.ceil(ln["qty_required"] - ln["qty_in_stock"] - 1e-9))
    assert po["total"] == pytest.approx(round(sum(ln["amount"] for ln in po["lines"]), 2), abs=0.005)


def test_estimate_split_by_category(client, auth, calc, cat_profiles):
    p, e, run = calc
    r = from_calc(client, auth, p, {"calc_run_ids": [run["id"]]})
    assert r.status_code == 201, r.text
    pos = r.json()
    assert [po["category"] for po in pos] == ["profiles", "glass", "accessories"]
    nums = [po["number"] for po in pos]
    assert len(set(nums)) == 3 and all(n.startswith("PO-") and len(n) == len("PO-2026-0001") for n in nums)
    for po in pos:
        assert po["status"] == "draft" and po["supplier"] == "To be assigned" and po["provisional"] is True
        assert DEMO in po["notes"] and po["calc_run_ids"] == [run["id"]] and po["cutting_job_ids"] == []
        check_totals(po)
    # profiles: bars estimated from the BOM length / longest stock length
    bom = {b["item_id"]: b for b in run["result"]["bom"] if b["item_type"] == "profile"}
    prof = lines_of(pos, "profile")
    assert {ln["item_id"] for ln in prof} == set(bom)
    for ln in prof:
        L = max(cat_profiles[ln["item_id"]]["stock_lengths"])
        assert ln["unit"] == "bar" and ln["stock_length"] == L
        assert ln["qty_required"] == math.ceil(bom[ln["item_id"]]["quantity"] * 1000 / L - 1e-9)
        assert "estimate, run cutting for exact bars" in ln["note"]
        assert ln["unit_price"] == pytest.approx(round(cat_profiles[ln["item_id"]]["price_per_m"] * L / 1000, 2))
    # glass in m² (ordered in whole m²), accessories in their unit
    g = lines_of(pos, "glass")[0]
    assert g["unit"] == "m2" and g["qty_required"] == pytest.approx(run["result"]["totals"]["glass_area_m2"], 1e-4)
    assert {ln["unit"] for ln in pos[2]["lines"]} <= {"pcs", "m"}


def test_bars_from_cutting_jobs(client, auth, calc):
    p, e, run = calc
    items = client.post(f"{API}/cutting/from-calc/{run['id']}", headers=auth["engineer"],
                        params={"optimize": "true"}).json()
    job_ids = [it["job_id"] for it in items]
    assert all(job_ids)
    expected = {}
    for jid in job_ids:
        job = client.get(f"{API}/cutting/jobs/{jid}", headers=auth["viewer"]).json()
        for pat in job["result"]["patterns"]:
            key = (job["request"]["material"], pat["stock_length"])
            expected[key] = expected.get(key, 0) + pat["count"]
    r = from_calc(client, auth, p, {"calc_run_ids": [run["id"]], "cutting_job_ids": job_ids,
                                    "split_by_category": False}, role="engineer")
    assert r.status_code == 201, r.text
    pos = r.json()
    assert len(pos) == 1 and pos[0]["category"] == "mixed" and pos[0]["cutting_job_ids"] == job_ids
    got = {(ln["code"], ln["stock_length"]): ln["qty_required"] for ln in lines_of(pos, "profile")}
    assert got == expected
    assert all("from cutting job" in ln["note"] for ln in lines_of(pos, "profile"))
    check_totals(pos[0])
    # cutting jobs of another project are rejected
    other = client.post(f"{API}/projects", headers=auth["engineer"], json={"code": uid("X"), "name": "x"}).json()
    assert_error(from_calc(client, auth, other, {"calc_run_ids": [run["id"]]}), 404, "CALC_RUN_NOT_FOUND")
    assert_error(from_calc(client, auth, p, {"calc_run_ids": [run["id"]], "cutting_job_ids": [999999]}), 404,
                 "CUTTING_JOB_NOT_FOUND")


def _line(pos, code, item_type="profile"):
    return next(ln for ln in lines_of(pos, item_type) if ln["code"] == code)


def test_stock_subtraction_ignores_residuals(client, auth, calc):
    p, e, run = calc
    h = auth["engineer"]
    created = []

    def add(**body):
        r = client.post(f"{API}/inventory", headers=h, json=body)
        assert r.status_code == 201, r.text
        created.append(r.json()["id"])

    try:
        before = from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}).json()
        ln0 = lines_of(before, "profile")[0]
        code, L = ln0["code"], ln0["stock_length"]
        add(kind="bar", material=code, profile_code=code, length=L, quantity=3)
        # residual offcuts, other lengths and reserved stock do not count
        add(kind="bar", material=code, length=L, quantity=5, is_residual=True)
        add(kind="bar", material=code, length=L - 500, quantity=5)
        add(kind="bar", material=code, length=L, quantity=5, status="reserved")
        after = from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}).json()
        ln1 = _line(after, code)
        assert ln1["qty_in_stock"] == ln0["qty_in_stock"] + 3
        assert ln1["qty_to_order"] == max(0, ln1["qty_required"] - ln1["qty_in_stock"])
        # glass: m² stock from sheets of the same code
        g0 = lines_of(before, "glass")[0]
        add(kind="sheet", material=g0["code"], width=2000, height=1000, quantity=2)
        g1 = _line(from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}).json(), g0["code"], "glass")
        assert g1["qty_in_stock"] == pytest.approx(g0["qty_in_stock"] + 4.0)
        assert g1["qty_to_order"] == max(0, math.ceil(g1["qty_required"] - g1["qty_in_stock"] - 1e-9))
    finally:   # shared test database: leave the inventory as we found it
        for i in created:
            client.delete(f"{API}/inventory/{i}", headers=h)


def _inv_total(client, auth, kind, material, unit=None):
    rows = client.get(f"{API}/inventory", headers=auth["viewer"], params={"kind": kind, "material": material}).json()
    return sum(r["quantity"] for r in rows if r["status"] == "available" and not r["is_residual"]
               and (unit is None or r["unit"] == unit))


def test_receive_adds_inventory(client, auth, calc):
    p, e, run = calc
    pos = from_calc(client, auth, p, {"calc_run_ids": [run["id"]], "split_by_category": False}).json()
    po = pos[0]
    prof = next(ln for ln in po["lines"] if ln["item_type"] == "profile" and ln["qty_to_order"] > 0)
    acc = next(ln for ln in po["lines"] if ln["item_type"] not in ("profile", "glass", "panel")
               and ln["qty_to_order"] > 0)
    glass = next(ln for ln in po["lines"] if ln["item_type"] == "glass")
    bars0 = _inv_total(client, auth, "bar", prof["code"])
    acc0 = _inv_total(client, auth, "item", acc["code"], acc["unit"])
    gl0 = _inv_total(client, auth, "item", glass["code"], "m2")
    # PUT cannot receive; viewer/operator cannot receive
    assert_error(client.put(f"{API}/purchase-orders/{po['id']}", headers=auth["estimator"],
                            json={"status": "received"}), 409, "INVALID_TRANSITION")
    assert_error(client.post(f"{API}/purchase-orders/{po['id']}/receive", headers=auth["viewer"]), 403)
    assert_error(client.post(f"{API}/purchase-orders/{po['id']}/receive", headers=auth["operator"]), 403)
    r = client.post(f"{API}/purchase-orders/{po['id']}/receive", headers=auth["estimator"])
    assert r.status_code == 200 and r.json()["status"] == "received" and r.json()["received_at"]
    assert _inv_total(client, auth, "bar", prof["code"]) == bars0 + prof["qty_to_order"]
    assert _inv_total(client, auth, "item", acc["code"], acc["unit"]) == acc0 + acc["qty_to_order"]
    assert _inv_total(client, auth, "item", glass["code"], "m2") == gl0 + glass["qty_to_order"]
    rows = client.get(f"{API}/inventory", headers=auth["viewer"], params={"kind": "bar",
                                                                           "material": prof["code"]}).json()
    rec = [x for x in rows if x["source_kind"] == "purchase" and x["source_job_id"] == po["id"]]
    assert rec and rec[0]["length"] == prof["stock_length"]
    assert_error(client.post(f"{API}/purchase-orders/{po['id']}/receive", headers=auth["estimator"]), 409,
                 "INVALID_TRANSITION")
    assert_error(client.put(f"{API}/purchase-orders/{po['id']}", headers=auth["estimator"],
                            json={"supplier": "x"}), 409)
    # received stock now reduces what a new PO orders
    again = from_calc(client, auth, p, {"calc_run_ids": [run["id"]], "split_by_category": False}).json()
    assert _line(again, prof["code"])["qty_in_stock"] >= prof["qty_to_order"]
    for kind in ("bar", "item"):   # shared test database: remove the received stock again
        for x in client.get(f"{API}/inventory", headers=auth["viewer"], params={"kind": kind}).json():
            if x["source_kind"] == "purchase" and x["source_job_id"] == po["id"]:
                client.delete(f"{API}/inventory/{x['id']}", headers=auth["engineer"])
    au = client.get(f"{API}/admin/audit", headers=auth["admin"],
                    params={"entity": "purchase_order", "entity_id": str(po["id"])}).json()
    items = au["items"] if isinstance(au, dict) else au
    assert {"create", "receive"} <= {a["action"] for a in items}


def test_update_lines_recomputes_totals(client, auth, calc):
    p, e, run = calc
    po = from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}).json()[0]
    lines = po["lines"]
    lines[0]["qty_to_order"] = 7
    lines[0]["unit_price"] = 123.45
    lines[0]["amount"] = 1                      # ignored: recomputed server-side
    r = client.put(f"{API}/purchase-orders/{po['id']}", headers=auth["engineer"],
                   json={"supplier": "Demo Supplier (fictitious)", "status": "sent", "notes": "call first",
                         "lines": lines})
    assert r.status_code == 200, r.text
    po2 = r.json()
    assert po2["supplier"] == "Demo Supplier (fictitious)" and po2["status"] == "sent"
    assert po2["lines"][0]["amount"] == pytest.approx(864.15)
    assert po2["total"] == pytest.approx(round(sum(ln["amount"] for ln in po2["lines"]), 2))
    assert DEMO in po2["notes"] and "call first" in po2["notes"]
    bad = [dict(lines[0], qty_to_order=-1)]
    assert_error(client.put(f"{API}/purchase-orders/{po['id']}", headers=auth["engineer"], json={"lines": bad}), 422)
    assert client.get(f"{API}/purchase-orders/{po['id']}", headers=auth["viewer"]).json()["total"] == po2["total"]
    lst = client.get(f"{API}/purchase-orders", headers=auth["viewer"], params={"project_id": p["id"]}).json()
    assert po["id"] in [x["id"] for x in lst]


def test_roles(client, auth, calc):
    p, e, run = calc
    for role in ("viewer", "operator"):
        assert_error(from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}, role=role), 403, "FORBIDDEN")
    for role in ("estimator", "engineer", "admin"):
        assert from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}, role=role).status_code == 201
    assert client.get(f"{API}/purchase-orders", headers=auth["operator"]).status_code == 200


def test_po_documents_carry_demo_price_banner(client, auth, calc):
    p, e, run = calc
    po = from_calc(client, auth, p, {"calc_run_ids": [run["id"]]}).json()[0]
    r = client.get(f"{API}/reports/purchase-order/{po['id']}.pdf", headers=auth["viewer"])
    assert r.status_code == 200 and r.headers["X-Provisional"] == "true"
    txt = "\n".join(pg.extract_text() or "" for pg in PdfReader(io.BytesIO(r.content)).pages)
    assert DEMO in txt and "PROVISIONAL" in txt and po["number"] in txt and f"{po['total']:,.2f}" in txt
    r = client.get(f"{API}/reports/purchase-order/{po['id']}.xlsx", headers=auth["viewer"])
    wb = load_workbook(io.BytesIO(r.content))
    assert wb["Info"]["A1"].value == BANNER and wb["Info"]["A2"].value == DEMO
    assert wb["Lines"]["A1"].value == BANNER and wb["Lines"]["A2"].value == DEMO
    vals = [c for row in wb["Lines"].iter_rows(values_only=True) for c in row]
    assert po["total"] in vals


def test_dxf_endpoints(client, auth, calc):
    from app.engines.dxf_export import parse_dxf_entities
    p, e, run = calc
    r = client.get(f"{API}/elevations/{e['id']}/export.dxf", headers=auth["viewer"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/dxf")
    assert "attachment" in r.headers["content-disposition"] and ".dxf" in r.headers["content-disposition"]
    ents = parse_dxf_entities(r.text)
    assert sum(1 for x in ents if x["layer"] == "FOS-MULLION") == 5
    r2 = client.post(f"{API}/export/dxf", headers=auth["viewer"], json={"elevation": lobby_elevation()})
    assert r2.status_code == 200 and r2.text.rstrip().endswith("EOF")
    assert_error(client.get(f"{API}/elevations/999999/export.dxf", headers=auth["viewer"]), 404)
    assert_error(client.post(f"{API}/export/dxf", headers=auth["viewer"], json={"elevation": {"width": -1}}), 422)


@pytest.fixture(scope="module")
def cat_profiles():
    from app.engines.catalogue import load_demo_catalogue
    return {pr["id"]: pr for pr in load_demo_catalogue()["profiles"]}
