# ITMC FenestrationOS — REST API reference (v1)

Base path `/api/v1`. JSON everywhere (except uploads/documents). Interactive docs: `/docs` (Swagger UI),
`/redoc`, schema at `/api/v1/openapi.json`. Engine payloads (`Elevation`, `CalcResult`, `Cutting1DRequest`, …)
are defined in `backend/app/engines/models.py` and mirrored in `frontend/src/api/types.ts`.

* Units: lengths **mm**, areas m², angles degrees. Every engine result echoes `units`, engine version and
  `validation_status`.
* Auth: `Authorization: Bearer <JWT>` from `POST /auth/login` (HS256, default 8 h).
* Every response carries `X-Request-ID` (send your own `X-Request-ID` to correlate; it is also stored in the
  audit log).
* Errors (all statuses 400/401/403/404/405/409/413/415/422/429/500):

```json
{"detail": {"code": "VERSION_CONFLICT", "message": "Elevation was modified by someone else ...",
            "issues": [{"code": "...", "severity": "error", "message": "...", "ref": "body.width"}]}}
```
  Request-validation errors are `422 VALIDATION_ERROR`; each FastAPI error becomes an issue with
  `code` (= pydantic type, upper-case), `ref` (dotted location), plus the original `loc`, `type`, `ctx`.

## Roles

| Role | Can |
|---|---|
| `admin` | everything, incl. catalogue edits, users, audit, project members |
| `engineer` | customers, projects, elevations, revisions, calc runs, cutting/nesting jobs, inventory |
| `estimator` | customers, projects, quotes |
| `viewer` | read-only + stateless engines (`/calc/elevation`, `/cutting/1d/optimize`, `/nesting/2d/optimize`, imports, templates, reports) |

Optional per-project permission: if a project has members (`/projects/{id}/members`), non-admin writes to
that project additionally require an `editor` membership.

## Endpoints

| Method & path | Roles | Notes |
|---|---|---|
| GET `/health` | public | `{status, version, db, env, engines{calc,cutting1d,nesting2d,validate_calc}, catalogue_version}`; 503 when DB is down |
| POST `/auth/login` | public | `{email, password}` → `{access_token, token_type, expires_in, user}`; generic 401 `INVALID_CREDENTIALS`; 429 `RATE_LIMITED` + `Retry-After` after 5 failures/e-mail or 20/IP in 5 min |
| GET `/auth/me` | any | current user |
| GET/POST `/customers`, GET/PUT/DELETE `/customers/{id}` | write: admin, engineer, estimator | `?q=` search; DELETE → 409 `CUSTOMER_IN_USE` if projects reference it |
| GET/POST `/projects`, GET/PUT/DELETE `/projects/{id}` | write: admin, engineer, estimator | `?status=&customer_id=&q=`; duplicate code → 409 `DUPLICATE_CODE`; DELETE cascades elevations, revisions, runs, jobs, quotes |
| GET/POST `/projects/{id}/members`, DELETE `/projects/{id}/members/{user_id}` | write: admin | `{user_id, role: editor\|viewer}` |
| GET/POST `/projects/{id}/elevations` | write: admin, engineer | body `{name?, data: Elevation}` → `ElevationRecord` incl. `issues` (non-blocking) |
| GET/PUT/DELETE `/elevations/{id}` | write: admin, engineer | PUT `{version, name?, data?}`; stale `version` → 409 `VERSION_CONFLICT`; returns new `version` + `issues` |
| POST `/elevations/{id}/calculate` | admin, engineer | `{rule_set_id?}` → `CalcRun {id, validation_status, inputs_hash, catalogue_version, rule_set_id, rule_set_version, result: CalcResult}` |
| GET `/elevations/{id}/calc-runs` | any | `?include_result=false` |
| GET `/projects/{id}/calc-runs` | any | `?include_result=true&limit=50` |
| GET `/calc-runs/{id}` | any | full run |
| GET/POST `/projects/{id}/revisions`, GET `/projects/{id}/revisions/{rev_id}` | write: admin, engineer | `{label?, note?}` → immutable snapshot of project + all elevations; `rev_no` sequential; no PUT/DELETE (405) |
| GET `/catalogue` | any | active catalogue JSON (`?version=` for a historic revision) |
| GET `/catalogue/revisions` | any | revision history |
| PUT `/catalogue/{collection}/{id}` | admin | upsert one item; validated by `validate_catalogue` (422 `CATALOGUE_INVALID`); creates revision `…-rN+1`, audited with before/after |
| POST `/calc/elevation` | any | `CalcRequest` → `CalcResult` (stateless) |
| POST `/cutting/1d/optimize` | any | `Cutting1DRequest` → `Cutting1DResult` |
| GET/POST `/cutting/jobs`, GET/DELETE `/cutting/jobs/{id}`, POST `/cutting/jobs/{id}/optimize` | write: admin, engineer | create `{project_id?, name, request, optimize=true, consume_inventory=false}`; list returns summaries |
| POST `/cutting/from-calc/{calc_run_id}` | admin, engineer | body `{kerf?, trim_start?, trim_end?, min_reusable_offcut?, use_inventory=false}`; `?optimize=true` persists one job per profile → `[{profile_id, profile_code, request, job_id?, validation_status?, summary?}]` |
| GET `/cutting/template.xlsx`, POST `/cutting/import-excel` | any | multipart `file` → `{pieces, stocks, settings, issues}` |
| POST `/nesting/2d/optimize` | any | `Nesting2DRequest` → `Nesting2DResult` |
| GET/POST `/nesting/jobs`, GET/DELETE `/nesting/jobs/{id}`, POST `/nesting/jobs/{id}/optimize` | write: admin, engineer | as cutting |
| GET `/nesting/template.xlsx`, POST `/nesting/import-excel` | any | → `{pieces, sheets, settings, issues}`; max 5 MB (413), non-xlsx 415 |
| GET/POST `/inventory`, GET/PUT/DELETE `/inventory/{id}` | write: admin, engineer | `?kind=bar\|sheet&material=&status=&residual=` |
| GET `/inventory/as-stock?kind=bar&material=X` | any | available items as `Stock1D[]` (`id="INV-<id>"`, `is_offcut`) or `Sheet2D[]` (`is_residual`) — prepend to a request's stocks so residuals are used first |
| POST `/inventory/{id}/consume` | admin, engineer | `{quantity=1, job_id?, note?}`; 409 when exhausted |
| POST `/inventory/residuals/from-cutting/{job_id}`, `/from-nesting/{job_id}` | admin, engineer | `{location?}`; reusable offcuts (× pattern count) / reusable residual rectangles → inventory; 409 if already added; blocked for INVALID jobs |
| GET/POST `/projects/{id}/quotes`, GET/PUT `/quotes/{id}` | write: admin, estimator | `{calc_run_ids, margin_pct, notes}` → priced lines, `subtotal`, `margin_amount`, `total`, number `Q-YYYY-NNNN`, `provisional: true`, `validation_status: PROVISIONAL_DEMO_RULES` |
| GET `/reports/cutting/{id}.pdf\|xlsx`, `/reports/nesting/{id}.pdf\|xlsx`, `/reports/calc/{id}.pdf\|xlsx`, `/reports/quote/{id}.pdf\|xlsx` | any | headers `X-Validation-Status`, `X-Provisional`; provisional docs carry banner + watermark |
| GET/POST `/admin/users`, PUT/DELETE `/admin/users/{id}` | admin | PUT `{name?, role?, active?, password?}`; DELETE = deactivate; last active admin protected (409) |
| GET `/admin/audit` | admin | `?action=&entity=&entity_id=&user_id=&since=&until=&limit=50&offset=0` → `{items, total, limit, offset}` |

Audited actions: `create/update/delete/deactivate/consume` on all entities, `calculate`, `optimize`, `build`,
`import`, `report`, `login`, `login_failed`, `login_blocked`, `seed`.

## Examples

```bash
API=http://localhost:8000/api/v1
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"engineer@demo.local","password":"'"$DEMO_PASSWORD"'"}' | jq -r .access_token)
H="Authorization: Bearer $TOKEN"

# project + elevation (4 bays 6000 x 3600, transoms at 1100 / 2400)
curl -s -X POST $API/projects -H "$H" -H 'Content-Type: application/json' \
  -d '{"code":"P-100","name":"Lobby","status":"design"}'
curl -s -X POST $API/projects/1/elevations -H "$H" -H 'Content-Type: application/json' -d '{
  "data":{"name":"E1","width":6000,"height":3600,"mullions":[0,1500,3000,4500,6000],
          "bays":[{"transoms":[1100,2400]},{"transoms":[1100,2400]},{"transoms":[1100,2400]},{"transoms":[1100,2400]}],
          "system_id":"ser-cw50","default_glass_type_id":"gl-dgu-24","colour_id":"col-ral7016","anchor_levels":[0,3600]}}'

# optimistic update (send the version you loaded)
curl -s -X PUT $API/elevations/1 -H "$H" -H 'Content-Type: application/json' -d '{"version":1,"name":"E1 rev"}'

# calculate → cutting jobs per profile → reports
curl -s -X POST $API/elevations/1/calculate -H "$H"
curl -s -X POST "$API/cutting/from-calc/1?optimize=true" -H "$H" -H 'Content-Type: application/json' -d '{"kerf":4}'
curl -s -o cut.pdf $API/reports/cutting/1.pdf -H "$H"

# stateless 1D optimisation
curl -s -X POST $API/cutting/1d/optimize -H "$H" -H 'Content-Type: application/json' -d '{
  "kerf":4,"trim_start":10,"stocks":[{"id":"S6000","length":6000}],
  "pieces":[{"id":"T1","length":1448,"quantity":12},{"id":"M1","length":3700,"quantity":5}]}'

# residual offcuts → inventory → reuse first
curl -s -X POST $API/inventory/residuals/from-cutting/1 -H "$H" -H 'Content-Type: application/json' -d '{"location":"Rack A"}'
curl -s "$API/inventory/as-stock?kind=bar&material=DEMO-CW50-M150" -H "$H"
curl -s -X POST "$API/cutting/from-calc/1?optimize=true" -H "$H" -H 'Content-Type: application/json' -d '{"use_inventory":true}'

# Excel import
curl -s -o nest.xlsx $API/nesting/template.xlsx -H "$H"
curl -s -X POST $API/nesting/import-excel -H "$H" -F file=@nest.xlsx

# quote (estimator)
curl -s -X POST $API/projects/1/quotes -H "Authorization: Bearer $EST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"calc_run_ids":[1],"margin_pct":12.5}'
```

**All prices, catalogue data and calculation rules are DEMO / PROVISIONAL — not manufacturer data and not
a commercial offer.**
