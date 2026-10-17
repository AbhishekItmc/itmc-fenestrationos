from helpers import assert_error, lobby_elevation, uid


def test_customer_crud(client, auth):
    h = auth["estimator"]
    r = client.post("/api/v1/customers", headers=h, json={"name": "ACME Facades (fictitious)",
                                                          "email": "Buyer@Acme.Example"})
    assert r.status_code == 201
    c = r.json()
    assert c["email"] == "buyer@acme.example"
    assert client.get(f"/api/v1/customers/{c['id']}", headers=auth["viewer"]).json()["name"].startswith("ACME")
    r = client.put(f"/api/v1/customers/{c['id']}", headers=h, json={"phone": "+00 1"})
    assert r.status_code == 200 and r.json()["phone"] == "+00 1" and r.json()["name"].startswith("ACME")
    assert any(x["id"] == c["id"] for x in client.get("/api/v1/customers?q=acme", headers=h).json())
    assert_error(client.post("/api/v1/customers", headers=h, json={"name": "x", "email": "not-an-email"}), 422)
    # in-use customers cannot be deleted
    p = client.post("/api/v1/projects", headers=h, json={"code": uid("C"), "name": "p", "customer_id": c["id"]}).json()
    assert_error(client.delete(f"/api/v1/customers/{c['id']}", headers=h), 409, "CUSTOMER_IN_USE")
    assert client.delete(f"/api/v1/projects/{p['id']}", headers=h).status_code == 204
    assert client.delete(f"/api/v1/customers/{c['id']}", headers=h).status_code == 204
    assert_error(client.get(f"/api/v1/customers/{c['id']}", headers=h), 404)


def test_project_crud(client, auth):
    h = auth["engineer"]
    code = uid("PRJ")
    r = client.post("/api/v1/projects", headers=h, json={"code": code, "name": "Tower", "site": "Somewhere"})
    assert r.status_code == 201
    p = r.json()
    assert p["status"] == "enquiry" and p["owner_id"]
    assert_error(client.post("/api/v1/projects", headers=h, json={"code": code, "name": "dup"}), 409, "DUPLICATE_CODE")
    assert_error(client.post("/api/v1/projects", headers=h, json={"code": uid(), "name": "x", "status": "bogus"}), 422)
    assert_error(client.post("/api/v1/projects", headers=h, json={"code": uid(), "name": "x", "customer_id": 99999}),
                 400, "CUSTOMER_NOT_FOUND")
    r = client.put(f"/api/v1/projects/{p['id']}", headers=h, json={"status": "won"})
    assert r.json()["status"] == "won"
    assert any(x["id"] == p["id"] for x in client.get("/api/v1/projects?status=won", headers=h).json())
    assert client.delete(f"/api/v1/projects/{p['id']}", headers=h).status_code == 204
    assert_error(client.get(f"/api/v1/projects/{p['id']}", headers=h), 404)


def test_elevation_create_returns_issues_and_locking(client, auth, project):
    p, e = project
    assert e["version"] == 1 and e["data"]["width"] == 6000 and e["data"]["id"] == str(e["id"])
    assert isinstance(e["issues"], list)
    h = auth["engineer"]
    # update with correct version
    data = lobby_elevation(width=6000, mullions=[0, 1500, 3000, 4500, 6000])
    data["bays"][0]["transoms"] = [1100]
    r = client.put(f"/api/v1/elevations/{e['id']}", headers=h, json={"version": 1, "data": data, "name": "Renamed"})
    assert r.status_code == 200, r.text
    e2 = r.json()
    assert e2["version"] == 2 and e2["name"] == "Renamed" and e2["data"]["name"] == "Renamed"
    # stale version -> 409
    d = assert_error(client.put(f"/api/v1/elevations/{e['id']}", headers=h, json={"version": 1, "name": "late"}),
                     409, "VERSION_CONFLICT")
    assert "current version 2" in d["message"]
    assert client.get(f"/api/v1/elevations/{e['id']}", headers=h).json()["name"] == "Renamed"


def test_elevation_non_blocking_warnings(client, auth, project):
    p, e = project
    data = lobby_elevation(mullions=[0, 200, 3000, 4500, 6000])   # 200 mm bay -> too narrow (warning/error issue)
    r = client.put(f"/api/v1/elevations/{e['id']}", headers=auth["engineer"], json={"version": 1, "data": data})
    assert r.status_code == 200
    assert any(i["code"] for i in r.json()["issues"])   # saved, issues reported


def test_invalid_elevation_422(client, auth, project):
    p, e = project
    h = auth["engineer"]
    assert_error(client.post(f"/api/v1/projects/{p['id']}/elevations", headers=h,
                             json={"data": lobby_elevation(width=-5)}), 422, "VALIDATION_ERROR")
    d = assert_error(client.post(f"/api/v1/projects/{p['id']}/elevations", headers=h,
                                 json={"data": {"width": 1000}}), 422)
    assert any("mullions" in (i.get("ref") or "") for i in d["issues"])
    assert_error(client.put(f"/api/v1/elevations/{e['id']}", headers=h,
                            json={"version": 1, "data": lobby_elevation(top_shape={"type": "circle"})}), 422)
    assert_error(client.put(f"/api/v1/elevations/{e['id']}", headers=h, json={"name": "no version"}), 422)


def test_revisions_are_immutable_snapshots(client, auth, project):
    p, e = project
    h = auth["engineer"]
    r = client.post(f"/api/v1/projects/{p['id']}/revisions", headers=h, json={"label": "Tender", "note": "first"})
    assert r.status_code == 201
    rev1 = r.json()
    assert rev1["rev_no"] == 1 and rev1["snapshot"]["elevations"][0]["data"]["width"] == 6000
    client.put(f"/api/v1/elevations/{e['id']}", headers=h,
               json={"version": 1, "data": lobby_elevation(width=7500, mullions=[0, 1500, 3000, 4500, 7500])})
    rev2 = client.post(f"/api/v1/projects/{p['id']}/revisions", headers=h, json={}).json()
    assert rev2["rev_no"] == 2 and rev2["label"] == "R2"
    assert rev2["snapshot"]["elevations"][0]["data"]["width"] == 7500
    again = client.get(f"/api/v1/projects/{p['id']}/revisions/{rev1['id']}", headers=h).json()
    assert again["snapshot"]["elevations"][0]["data"]["width"] == 6000      # unchanged
    assert [x["rev_no"] for x in client.get(f"/api/v1/projects/{p['id']}/revisions", headers=h).json()] == [1, 2]
    # no update/delete API exists
    assert client.put(f"/api/v1/projects/{p['id']}/revisions/{rev1['id']}", headers=auth["admin"],
                      json={"label": "x"}).status_code == 405
    assert client.delete(f"/api/v1/projects/{p['id']}/revisions/{rev1['id']}",
                         headers=auth["admin"]).status_code == 405


def test_delete_elevation(client, auth, project):
    p, e = project
    client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["engineer"])
    assert client.delete(f"/api/v1/elevations/{e['id']}", headers=auth["engineer"]).status_code == 204
    assert client.get(f"/api/v1/projects/{p['id']}/elevations", headers=auth["viewer"]).json() == []
    assert len(client.get(f"/api/v1/projects/{p['id']}/calc-runs", headers=auth["viewer"]).json()) == 1
