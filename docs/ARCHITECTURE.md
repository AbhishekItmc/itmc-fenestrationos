# ITMC FenestrationOS — Architecture & Interface Contract (v0.1)

Status: **living document** — owned by the Solution Architect. Changes to any contract below must update
this file, `backend/app/engines/models.py` and `frontend/src/api/types.ts` together.

## 1. Shape of the system

Modular monolith (no microservices needed at this stage):

```
fos/
  backend/                    Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (SQLite for unit tests)
    app/
      engines/                PURE python, no FastAPI/DB imports. Deterministic, unit-tested.
        models.py             Shared Pydantic contract (THE source of truth for engine I/O)
        units.py              mm helpers, rounding, tolerance (EPS = 1e-6 mm)
        elevation.py          validate_elevation(elev, catalogue) -> list[Issue]; field geometry helpers
        catalogue.py          load/validate catalogue JSON; lookup helpers
        calc.py               calculate(elev, catalogue, rule_set) -> CalcResult   (PROVISIONAL demo rules)
        cutting1d.py          optimize_1d(req) -> Cutting1DResult
        nesting2d.py          optimize_2d(req) -> Nesting2DResult
        validators.py         INDEPENDENT feasibility validators (validate_1d, validate_2d, validate_calc)
        excel_io.py           parse nesting/cutting Excel imports; build template workbooks
      models/                 SQLAlchemy ORM
      schemas/                API-only Pydantic schemas (projects, users, ...)
      api/                    routers (v1)
      services/               orchestration (calc runs, jobs, residual stock, quotes, audit)
      reports/                PDF (reportlab) + Excel (openpyxl) generators
      seed/demo_catalogue.json  DEMO catalogue (clearly labelled, not manufacturer data)
    alembic/                  migrations
    tests/                    pytest (engines, API, integration)
  frontend/                   React 18 + TypeScript + Vite + Tailwind
  e2e/                        Playwright
  docs/
  docker-compose.yml
```

## 2. Engineering-integrity rules (binding on every role)

1. No invented manufacturer dimensions, prices, formulas, structural/thermal/fire claims. All catalogue
   values ship as `demo: true` with the label "DEMO DATA — not manufacturer data".
2. Calculation rules are **parameterised rule sets** (`rule_sets[].params`), each param documented with
   its meaning and source. Demo rule sets have `approved: false` → every CalcResult is
   `validation_status = "PROVISIONAL_DEMO_RULES"` and the UI shows a provisional banner.
3. Optimisation results must pass the independent validator in `validators.py` (written separately from
   the optimiser, re-derives everything from the request). If validation fails → status `INVALID`, the API
   returns the result with HTTP 200 but the UI blocks export/release.
4. `OPTIMAL_PROVEN` only when proven (exact solver OPTIMAL, or bars used == valid lower bound).
   Otherwise `FEASIBLE_HEURISTIC`.
5. Unsupported geometry (arches in calc, mitre allowances, vents) → explicit error/warning issue, never
   silently approximated.

## 3. 1D cutting semantics (documented assumption — requires approval, see APPROVALS.md A-04)

For one bar of length `L`, with pieces `p1..pn` cut in order:
```
used      = trim_start + Σ p_i + n · kerf          (one kerf after every piece — conservative)
remainder = L − trim_end − used                    must be ≥ 0  (feasibility)
offset_1  = trim_start ;  offset_{i+1} = offset_i + p_i + kerf
offcut reusable  ⇔ remainder ≥ min_reusable_offcut   (else remainder counted as waste)
utilization = Σ piece length / Σ stock length used
```
Mitre angles are recorded but **no mitre allowance is added** (profile-specific; flagged warning).
Lower bound (single stock length class): `ceil( Σ (p_i + kerf) / (L − trim_start − trim_end) )`.

## 4. 2D nesting semantics (assumption A-05)

Usable sheet area = sheet minus edge trims. Pieces are axis-aligned rectangles; rotation 90° only when
`can_rotate`. Kerf is the minimum clear gap between two pieces and between nothing else (pieces may touch
the trimmed edge). With `guillotine=true` every layout must be producible by edge-to-edge cuts
(validator checks recursively). Residual rectangles ≥ min_residual_width × min_residual_height are
reusable and can be returned to inventory.

## 5. Catalogue JSON shape (`backend/app/seed/demo_catalogue.json`)

```jsonc
{
  "catalogue_version": "DEMO-2026.10-r1", "demo_data": true, "disclaimer": "...",
  "series":   [{ "id","code","name","system_type":"stick_curtain_wall","description",
                 "default_rule_set_id","mullion_profile_ids":[],"transom_profile_ids":[],
                 "glass_thickness_min","glass_thickness_max","demo":true }],
  "profiles": [{ "id","series_id","code","name",
                 "role":"mullion|transom|pressure_plate|cover_cap|extension|splice_sleeve",
                 "face_width","depth","weight_kg_m","stock_lengths":[6000,6500],"price_per_m","demo":true }],
  "glass_types": [{ "id","code","name","category":"single|laminated|igu|spandrel|fire|special|project",
                 "build_up","thickness","weight_kg_m2","price_per_m2","fire_rating":null,"notes","demo":true }],
  "panel_types": [{ "id","code","name","category":"acp|aluminium_sheet|insulated","thickness","price_per_m2","demo":true }],
  "accessories": [{ "id","code","name","kind":"bracket|connector|splice|gasket|sealant|hardware|end_cap",
                 "unit":"pcs|m","price","series_ids":[],"demo":true }],
  "colours":  [{ "id","code","name","finish":"powder|anodised|pvdf","hex","surcharge_pct","demo":true }],
  "rule_sets":[{ "id","series_id","version","approved":false,"description",
                 "params": { "<name>": number }, "param_docs": { "<name>": "meaning — source: DEMO" } }],
  "compatibility": [{ "id","kind","series_id","params":{},"message" }]
}
```
Required rule-set params (demo values): `mullion_ext_top`, `mullion_ext_bottom`, `transom_clearance`
(each end), `glass_deduction_x`, `glass_deduction_y` (axis dimension − deduction = glass size),
`gasket_runs_per_field_edge`, `connectors_per_transom`, `brackets_per_anchor`, `max_bar_length`
(splice warning above), `min_field_width`, `min_field_height`, `max_field_width`, `max_field_height`.

## 6. REST API (prefix `/api/v1`, JSON, JWT bearer)

| Method & path | Roles | Purpose |
|---|---|---|
| GET `/health` | public | `{status, version, db}` |
| POST `/auth/login` `{email,password}` | public | `{access_token, token_type, user}` |
| GET `/auth/me` | any | current user |
| GET/POST `/customers`, GET/PUT/DELETE `/customers/{id}` | write: admin, estimator, engineer | customers |
| GET/POST `/projects`, GET/PUT/DELETE `/projects/{id}` | write: admin, engineer, estimator | projects (code, name, customer_id, site, status) |
| GET/POST `/projects/{id}/revisions` | write: admin, engineer | immutable snapshot of all elevations `{rev_no,label,note}` |
| GET/POST `/projects/{id}/elevations`; GET/PUT/DELETE `/elevations/{id}` | write: admin, engineer | `data` = `Elevation` JSON, optimistic `version` |
| GET `/catalogue` | any | full active catalogue JSON |
| PUT `/catalogue/{collection}/{id}` | admin | edit catalogue item (audited, bumps catalogue revision) |
| POST `/calc/elevation` `CalcRequest` | any | stateless calc → `CalcResult` |
| POST `/elevations/{id}/calculate` | admin, engineer | persisted calc run → `{id, result: CalcResult}` |
| POST `/cutting/1d/optimize` `Cutting1DRequest` | any | stateless → `Cutting1DResult` |
| POST `/cutting/jobs` `{project_id?, name, request}` ; GET `/cutting/jobs[/id]` | write: admin, engineer | persisted job |
| POST `/cutting/from-calc/{calc_run_id}` | admin, engineer | build `Cutting1DRequest`s per profile from a calc run |
| POST `/nesting/2d/optimize` `Nesting2DRequest` | any | stateless → `Nesting2DResult` |
| POST `/nesting/jobs`; GET `/nesting/jobs[/id]` | write: admin, engineer | persisted job (project or standalone) |
| POST `/nesting/import-excel` (multipart file) | any | → `{pieces:Piece2D[], sheets:Sheet2D[], issues}` |
| GET `/nesting/template.xlsx` | any | import template |
| GET/POST `/inventory`; POST `/inventory/residuals/from-cutting/{job_id}` and `/from-nesting/{job_id}` | write: admin, engineer | stock & reusable residuals |
| POST `/projects/{id}/quotes` `{calc_run_ids, margin_pct, notes}`; GET `/quotes/{id}` | admin, estimator | quotation from calc BOM × demo prices |
| GET `/reports/cutting/{job_id}.(pdf|xlsx)`, `/reports/nesting/{job_id}.(pdf|xlsx)`, `/reports/calc/{run_id}.(pdf|xlsx)`, `/reports/quote/{id}.pdf` | any | documents (PDF carries status + DEMO watermark when provisional) |
| GET `/admin/audit`; GET/POST `/admin/users` | admin | audit trail, user admin |

Errors: `{"detail": {"code": "...", "message": "...", "issues": [Issue]}}` with 400/401/403/404/409/422.

Roles: `admin`, `engineer`, `estimator`, `viewer`. Demo users are seeded from env (`SEED_DEMO_USERS=1`),
password from `DEMO_PASSWORD` (default only in dev compose file, never in code paths for production).

## 7. Frontend

React 18 + TS + Vite + Tailwind; Zustand for state; SVG CAD canvas (custom, no heavy drawing library —
grid elevations are rectilinear and SVG gives crisp dimensions, hit-testing and print/export for free).
Vite dev proxy `/api → http://localhost:8000`. Offline demo engine (`src/engine/`) mirrors calc/1D for a
static demo build and is labelled "Offline demo engine" in the UI; server results are authoritative.

## Contract changes

| Date | Change | By | Notes |
|---|---|---|---|
| 2026-10-17 | `GlassItem.panel_type_id: Optional[str] = None` (added, optional) | engines | Set when `fill_type == "panel"`; `glass_type_id` is then `null`. Mirror in `frontend/src/api/types.ts`. |
| 2026-10-17 | Catalogue JSON (additive, optional keys): `currency`, `price_note` (root); series `face_width`, `pressure_plate_profile_id`, `cover_cap_profile_id`, `splice_sleeve_profile_id`, `default_mullion_profile_id`, `default_transom_profile_id`; rule set `golden_cases_passed` (bool), `demo`; optional rule params `end_caps_per_mullion`, `splice_sleeves_per_splice`, `sealant_runs_per_perimeter`; compatibility kinds `glass_thickness_range` {min,max}, `profile_in_series` {}, `max_field_size` {max_width,max_height,max_area_m2}. | engines | `validation_status = "VALIDATED"` only when rule set `approved` AND `golden_cases_passed` are both true. |
| 2026-10-17 | `validate_elevation(elev, catalogue=None, rule_set_id=None)` — optional third arg. | engines | |
