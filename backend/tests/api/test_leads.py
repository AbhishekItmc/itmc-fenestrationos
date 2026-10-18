"""Website demo requests: POST /api/v1/leads (public) and /api/v1/admin/leads (admin)."""
from helpers import assert_error, uid


def _lead(**over):
    d = {"name": "Asha Rao", "company": "Facade Works (test)", "email": f"{uid('lead').lower()}@example.com",
         "phone": "+91 00000 00000", "country": "India", "message": "We would like a demo of cutting optimisation.",
         "interest": ["cutting-nesting", "design-calculation"], "source_page": "/contact", "website": "",
         "elapsed_ms": 8500}
    d.update(over)
    return d


def _find(client, auth, email):
    items = client.get("/api/v1/admin/leads?limit=500", headers=auth["admin"]).json()["items"]
    return [x for x in items if x["email"] == email]


def test_valid_lead_is_stored_and_not_echoed(client, auth):
    body = _lead()
    r = client.post("/api/v1/leads", json=body)
    assert r.status_code == 201, r.text
    assert r.json() == {"ok": True}
    rows = _find(client, auth, body["email"])
    assert len(rows) == 1
    lead = rows[0]
    assert lead["status"] == "new" and lead["company"] == body["company"]
    assert lead["interest"] == ["cutting-nesting", "design-calculation"] and lead["source_page"] == "/contact"
    assert "ip_hash" not in lead and "website" not in lead and "elapsed_ms" not in lead
    a = client.get(f"/api/v1/admin/audit?entity=lead&entity_id={lead['id']}", headers=auth["admin"]).json()
    assert a["items"][0]["action"] == "create"
    assert body["email"] not in str(a["items"][0]["detail"])      # no personal data in the audit detail


def test_invalid_input_is_422(client):
    assert_error(client.post("/api/v1/leads", json=_lead(email="not-an-email")), 422)
    assert_error(client.post("/api/v1/leads", json=_lead(name="   ")), 422)
    assert_error(client.post("/api/v1/leads", json=_lead(message="x" * 5001)), 422)
    assert_error(client.post("/api/v1/leads", json=_lead(interest=["teleportation"])), 422)


def test_honeypot_and_too_fast_are_dropped_silently(client, auth):
    hp = _lead(website="http://spam.example")
    r = client.post("/api/v1/leads", json=hp)
    assert r.status_code == 202 and r.json() == {"ok": True}
    assert _find(client, auth, hp["email"]) == []
    fast = _lead(elapsed_ms=900)
    r = client.post("/api/v1/leads", json=fast)
    assert r.status_code == 202 and r.json() == {"ok": True}
    assert _find(client, auth, fast["email"]) == []
    missing = _lead()
    missing.pop("elapsed_ms")
    assert client.post("/api/v1/leads", json=missing).status_code == 202
    assert _find(client, auth, missing["email"]) == []


def test_rate_limit_per_ip(client):
    for _ in range(5):
        assert client.post("/api/v1/leads", json=_lead()).status_code == 201
    r = client.post("/api/v1/leads", json=_lead())
    d = assert_error(r, 429, "RATE_LIMITED")
    assert r.headers.get("retry-after")
    assert "@" not in d["message"]


def test_admin_listing_filter_and_status_update(client, auth):
    body = _lead()
    assert client.post("/api/v1/leads", json=body).status_code == 201
    lead = _find(client, auth, body["email"])[0]
    h = auth["admin"]
    r = client.put(f"/api/v1/admin/leads/{lead['id']}", headers=h, json={"status": "contacted"})
    assert r.status_code == 200 and r.json()["status"] == "contacted"
    page = client.get("/api/v1/admin/leads?status=contacted", headers=h).json()
    assert any(x["id"] == lead["id"] for x in page["items"]) and all(x["status"] == "contacted" for x in page["items"])
    assert all(x["id"] != lead["id"] for x in client.get("/api/v1/admin/leads?status=new", headers=h).json()["items"])
    p2 = client.get("/api/v1/admin/leads?limit=1&offset=0", headers=h).json()
    assert len(p2["items"]) == 1 and p2["limit"] == 1 and p2["total"] >= 1
    assert_error(client.put(f"/api/v1/admin/leads/{lead['id']}", headers=h, json={"status": "won"}), 422)
    assert_error(client.put("/api/v1/admin/leads/999999", headers=h, json={"status": "closed"}), 404)
    a = client.get(f"/api/v1/admin/audit?entity=lead&entity_id={lead['id']}&action=update", headers=h).json()
    assert a["items"][0]["detail"]["status"] == {"from": "new", "to": "contacted"}
    assert a["items"][0]["user_email"] == "admin@demo.local"


def test_leads_admin_only(client, auth):
    assert_error(client.get("/api/v1/admin/leads"), 401)
    for role in ("viewer", "engineer", "estimator", "operator"):
        assert_error(client.get("/api/v1/admin/leads", headers=auth[role]), 403, "FORBIDDEN")
        assert_error(client.put("/api/v1/admin/leads/1", headers=auth[role], json={"status": "closed"}), 403)
