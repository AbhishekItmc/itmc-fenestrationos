from helpers import assert_error, lobby_elevation


def test_catalogue_get(client, auth):
    r = client.get("/api/v1/catalogue", headers=auth["viewer"])
    assert r.status_code == 200
    c = r.json()
    assert c["demo_data"] is True and c["profiles"] and c["catalogue_version"]


def test_stateless_calc_is_provisional(client, auth):
    r = client.post("/api/v1/calc/elevation", headers=auth["estimator"], json={"elevation": lobby_elevation()})
    assert r.status_code == 200
    res = r.json()
    assert res["validation_status"] == "PROVISIONAL_DEMO_RULES"
    assert res["units"] == "mm" and res["profile_cuts"] and res["glass_items"] and res["bom"]
    assert any(i["code"] == "PROVISIONAL_DEMO_RULES" for i in res["issues"])


def test_stateless_calc_unknown_catalogue_version(client, auth):
    assert_error(client.post("/api/v1/calc/elevation", headers=auth["viewer"],
                             json={"elevation": lobby_elevation(), "catalogue_version": "NOPE"}), 404,
                 "CATALOGUE_VERSION_NOT_FOUND")


def test_persisted_calc_run(client, auth, project):
    p, e = project
    r = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["engineer"])
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["validation_status"] == "PROVISIONAL_DEMO_RULES"
    assert run["result"]["validation_status"] == "PROVISIONAL_DEMO_RULES"
    assert run["elevation_version"] == 1 and run["project_id"] == p["id"]
    assert run["rule_set_id"] == "rs-cw50-demo" and run["catalogue_version"]
    got = client.get(f"/api/v1/calc-runs/{run['id']}", headers=auth["viewer"]).json()
    assert got["inputs_hash"] == run["inputs_hash"] and got["result"]["profile_cuts"]
    lst = client.get(f"/api/v1/elevations/{e['id']}/calc-runs", headers=auth["viewer"]).json()
    assert lst[0]["id"] == run["id"] and lst[0]["result"] is None


def test_calc_invalid_elevation_persists_invalid(client, auth, project):
    p, e = project
    bad = lobby_elevation(system_id="ser-unknown")
    client.put(f"/api/v1/elevations/{e['id']}", headers=auth["engineer"], json={"version": 1, "data": bad})
    run = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["engineer"]).json()
    assert run["validation_status"] == "INVALID"
    assert_error(client.post(f"/api/v1/cutting/from-calc/{run['id']}", headers=auth["engineer"]), 400,
                 "CALC_RUN_INVALID")


def test_catalogue_edit_creates_revision_and_audit(client, auth):
    before = client.get("/api/v1/catalogue", headers=auth["admin"]).json()
    col = next(c for c in before["colours"] if c["id"] == "col-ral9010")
    new = {**col, "surcharge_pct": 3}
    r = client.put("/api/v1/catalogue/colours/col-ral9010", headers=auth["admin"], json=new)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["previous_version"] == before["catalogue_version"] and b["catalogue_version"] != b["previous_version"]
    assert b["catalogue_version"].endswith(str(int(before["catalogue_version"].rsplit("-r", 1)[1]) + 1))
    after = client.get("/api/v1/catalogue", headers=auth["viewer"]).json()
    assert after["catalogue_version"] == b["catalogue_version"]
    assert next(c for c in after["colours"] if c["id"] == "col-ral9010")["surcharge_pct"] == 3
    # previous revision still retrievable
    old = client.get(f"/api/v1/catalogue?version={before['catalogue_version']}", headers=auth["viewer"]).json()
    assert next(c for c in old["colours"] if c["id"] == "col-ral9010")["surcharge_pct"] == col["surcharge_pct"]
    revs = client.get("/api/v1/catalogue/revisions", headers=auth["viewer"]).json()
    assert revs[0]["active"] and revs[0]["version"] == b["catalogue_version"]
    audit = client.get("/api/v1/admin/audit?entity=catalogue_item&entity_id=colours/col-ral9010",
                       headers=auth["admin"]).json()
    assert audit["total"] >= 1 and audit["items"][0]["detail"]["to_version"] == b["catalogue_version"]
    # restore original
    client.put("/api/v1/catalogue/colours/col-ral9010", headers=auth["admin"], json=col)


def test_catalogue_edit_validation(client, auth):
    cat = client.get("/api/v1/catalogue", headers=auth["admin"]).json()
    prof = dict(cat["profiles"][0])
    prof["role"] = "not-a-role"
    d = assert_error(client.put(f"/api/v1/catalogue/profiles/{prof['id']}", headers=auth["admin"], json=prof), 422,
                     "CATALOGUE_INVALID")
    assert d["issues"]
    assert client.get("/api/v1/catalogue", headers=auth["admin"]).json()["catalogue_version"] == cat["catalogue_version"]
    assert_error(client.put("/api/v1/catalogue/bogus/x", headers=auth["admin"], json={}), 404, "UNKNOWN_COLLECTION")
    assert_error(client.put("/api/v1/catalogue/colours/a", headers=auth["admin"], json={"id": "b"}), 400, "ID_MISMATCH")
