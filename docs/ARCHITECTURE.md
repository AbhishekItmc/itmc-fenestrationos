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

Roles: `admin`, `engineer`, `estimator`, `viewer`, `operator` (v0.2: read-only + production scan events). Demo users are seeded from env (`SEED_DEMO_USERS=1`),
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
| 2026-10-18 | v0.2 §8.1 (additive): `ProductionOrder.provisional: bool` (true when any source calc run is not `VALIDATED`); `Part.calc_run_id?: int`; `GET …/parts` also takes `limit` (≤ 50 000, default 20 000) / `offset`. | backend | Mirror in `frontend/src/api/types.ts`. |
| 2026-10-18 | v0.2 §8.1 rules made precise: `complete` is allowed on a **pending** part as well (implicit start, one scan per station); `block`/`note` without a (non-blank) note → **422 `NOTE_REQUIRED`**; scans on a `cancelled` work order → 409 `INVALID_TRANSITION`; wrong station → 409 `INVALID_TRANSITION`; `note` on a done part allowed at any station of its route. Board `stations` = only stations occurring in that order's part routes, canonical order. `start`/`complete` move a planned/released order to `in_progress`; last part done → `done`. | backend | Strict superset of the contract for clients that always `start` before `complete`. |
| 2026-10-18 | v0.2 §8.1 labels endpoint: optional filters `status`, `station`, `kind`; response header `X-Label-Count`; labels show "DEMO / PROVISIONAL" when the order is provisional. | backend | |
| 2026-10-18 | v0.2 §8.2 (additive): PO line fields `stock_length?` (profiles, mm), `note?`, `line_no`; PO fields `calc_run_ids`, `cutting_job_ids`, `catalogue_version`, `received_at`. Quantities: glass/panel `qty_to_order` rounded **up to whole m²**, accessories up to whole units; profile `qty_in_stock` counts non-residual available bars of the same code **and the same stock length** (± 0.5 mm); bars cut from `INV-…` stock in a cutting job are not re-ordered. PUT with `status: received` → 409 `INVALID_TRANSITION` (use `/receive`); received/cancelled POs accept only `notes`. | backend | |
| 2026-10-18 | Inventory (additive): `kind: "item"` with new column/field `unit: pcs\|m\|m2` (migration 0002) for accessories and m² stock received from POs; `GET /inventory?kind=item`. | backend | Mirror `InventoryItem.unit`, kind union in `types.ts`. |
| 2026-10-18 | §8.3: additional info issue `DESIGN_CHECK_PARAM_MISSING` when the rule set lacks a design-check param (that check is not run). The seed adds missing DEMO design-check params to an existing **demo** active catalogue revision as a new revision (`…-rN+1`, audited `upgrade catalogue`); non-demo catalogues are never modified. | backend | Existing dev DB moved `DEMO-2026.10-r1` → `-r2`. |
| 2026-10-18 | Role `operator` is part of every read group (`ANY`); `ReportMeta.notices` (extra banner lines when provisional) used for "Demo prices — not a commercial offer". | backend | |

---

## 8. v0.2 modules — contract (production tracking, QR labels, purchasing, design checks, DXF)

Original features, own naming. No vendor product names (no "SimplyTag", "MES" branding) in UI or code.

### 8.1 Production tracking ("Production")
Work orders turn a calc run into individually tracked physical **parts** (one part per physical piece: a
ProfileCut with quantity 4 × elevation quantity 2 → 8 parts; one per glass/panel item × quantity).

```
ProductionOrder { id, number "WO-2026-0001", project_id, name, status: planned|released|in_progress|done|cancelled,
                  calc_run_ids: int[], due_date?: date, notes?, created_by, created_at, updated_at,
                  counts: {total, pending, in_progress, done, blocked} }           (counts computed)
Part { id, production_order_id, code (8 chars, A–Z 2–9 without 0/O/1/I, unique), kind: profile|glass|panel,
       mark, description, item_code (profile_code / glass code), length?, width?, height?, angle_start?, angle_end?,
       elevation_id?, elevation_name?, field_key?, seq (1..n within mark), route: string[], station_index: int,
       current_station: string|null, status: pending|in_progress|done|blocked, updated_at }
PartEvent { id, part_id, station, action: start|complete|block|unblock|note, note?, user_id, user_name, ts }
```
Routes (code constant, documented as configurable later):
`profile: cutting → machining → assembly → qc → dispatch`; `glass` and `panel`: `receiving → glazing → qc → dispatch`.
Station ids/labels: cutting "Cutting", machining "Machining", assembly "Assembly", receiving "Glass receiving",
glazing "Glazing", qc "Quality check", dispatch "Dispatch".
Rules: `start` only on pending part at its current station → in_progress; `complete` → advance station_index,
status pending (or done after last station); `block` (note required) → blocked; `unblock` → previous state;
invalid transitions → 409 `{code:"INVALID_TRANSITION"}`. Every event audited. Order status auto: any started →
in_progress; all done → done.

Endpoints (`/api/v1`, writes: admin, engineer; scan/events also allowed for role `operator` — new role, read-only
elsewhere):
- `GET /production-orders?project_id=` · `POST /production-orders {project_id, name, calc_run_ids, due_date?, notes?}`
  (creates parts) · `GET /production-orders/{id}` · `PUT /production-orders/{id} {name?, status?, due_date?, notes?}`
- `GET /production-orders/{id}/parts?status=&station=&kind=` · `GET /production-orders/{id}/board`
  → `{stations:[{id,label, pending, in_progress, done_here, blocked}], counts}`
- `GET /parts/{code}` → `{part, order:{id,number,name}, project:{id,code,name}, events: PartEvent[]}`
- `POST /parts/{code}/events {station, action, note?}` → updated part (station must equal current_station)
- `GET /reports/labels/{order_id}.pdf?layout=a4-24|a4-8|roll-62x29` — QR labels. QR payload =
  `{PUBLIC_BASE_URL}/p/{code}` (setting `PUBLIC_BASE_URL`, default `http://localhost:5173`). Label text: code,
  mark, description, size, project code, WO number.
- `GET /reports/production/{order_id}.pdf` (work order sheet: parts table by station).

### 8.2 Purchasing
```
PurchaseOrder { id, number "PO-2026-0001", project_id, supplier (string, default "To be assigned"),
  category: profiles|glass|accessories|mixed, status: draft|sent|received|cancelled, currency,
  lines: [{item_type, item_id, code, description, unit, qty_required, qty_in_stock, qty_to_order, unit_price, amount}],
  total, provisional: true, notes?, created_by, created_at, updated_at }
```
- `POST /projects/{id}/purchase-orders/from-calc {calc_run_ids, cutting_job_ids?: int[], split_by_category: bool=true}`
  → PurchaseOrder[]. Profiles ordered in **bars**: from cutting jobs' bars_used per stock length when given, else
  ceil(total length / longest catalogue stock length) — line note says "estimate, run cutting for exact bars".
  Glass/panels in m², accessories in their unit. `qty_in_stock` = available inventory (non-residual, same code);
  `qty_to_order = max(0, required − in stock)`. Demo prices → provisional.
- `GET /purchase-orders?project_id=` · `GET /purchase-orders/{id}` · `PUT /purchase-orders/{id} {supplier?, status?, notes?, lines?}`
- `POST /purchase-orders/{id}/receive` → status received, adds ordered quantities to inventory (bars/sheets/items).
- `GET /reports/purchase-order/{id}.(pdf|xlsx)`. Roles: admin, estimator, engineer.

### 8.3 Design checks (engines/checks.py)
`run_design_checks(elev, catalogue, rule_set_id=None) -> list[Issue]`, called by `calc.calculate` (issues appended,
warnings only, never errors unless geometry invalid). All thresholds are rule-set params, DEMO, `approved:false`:
`max_glass_weight_kg` (per pane), `max_field_area_m2`, `max_field_aspect_ratio`, `max_unsupported_mullion_span`
(distance between anchor levels / ends), `min_anchor_levels` (≥1 → warning when anchors missing).
Glass weight = area × glass_type.weight_kg_m2 (demo). Issue codes: GLASS_WEIGHT_HIGH, FIELD_AREA_HIGH,
FIELD_ASPECT_HIGH, MULLION_SPAN_HIGH, ANCHORS_MISSING, NO_COLOUR_SELECTED. Each message ends with
"(demo threshold — requires engineering approval)". Not structural verification.

### 8.4 DXF export
`engines/dxf_export.py: elevation_to_dxf(elev, catalogue) -> str` — ASCII DXF R12, mm units, layers
`FOS-MULLION`, `FOS-TRANSOM`, `FOS-GLASS`, `FOS-PANEL`, `FOS-DIM`, `FOS-TEXT`, member outlines from face widths,
field rectangles + mark text, overall + chained dimension lines drawn as LINE+TEXT (no DIMENSION entities).
`GET /elevations/{id}/export.dxf`, `POST /export/dxf {elevation}`. Frontend ports the same writer to TS for offline.
