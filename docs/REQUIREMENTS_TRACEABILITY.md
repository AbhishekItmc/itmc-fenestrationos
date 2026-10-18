# Requirements Traceability Matrix — ITMC FenestrationOS v0.1 (MVP)

Status legend: **Built+Tested** = implemented and covered by automated tests · **Built** = implemented, manually verified ·
**Partial** = core slice only · **In development** = shown disabled in UI · **Blocked** = needs domain input (see APPROVALS.md)

Source documents (curtain-walling concept, EVA ME CW stick curtain wall, sheet-cut optimisation concept) were **not supplied**
to this build. Terminology follows general stick curtain-wall practice; alignment review against those documents is pending (Q-01).

| ID | Requirement | Implementation | Tests | Status |
|---|---|---|---|---|
| R1.1 | Projects, customers | `api/v1/projects.py`, `customers.py`; UI Projects | tests/api/test_projects*.py | Built+Tested |
| R1.2 | Revisions (immutable snapshots) | ProjectRevision model, `/projects/{id}/revisions` | test_flows, api tests | Built+Tested |
| R1.3 | Permissions / roles | JWT + `require_roles`, roles admin/engineer/estimator/viewer/operator (v0.2: operator = read-only + production scans), project members (read-only UI) | permission tests, test_production::test_roles_operator_and_viewer | Built+Tested (member editing UI: Partial) |
| R2.1 | 2D curtain-wall grid editor: mullions, transoms, fields | `frontend/src/features/editor`, engines/elevation.py | Vitest geometry, e2e editor | Built+Tested |
| R2.2 | Dimensions, zoom/pan, selection, snapping, undo/redo, properties | SVG canvas, store with 200-step history | Vitest store, e2e | Built+Tested |
| R2.3 | Arches | Segmental arch drawn; calc returns ARCH_CALC_UNSUPPORTED | engine tests | Partial (geometry only) — Blocked on rules |
| R2.4 | Import/export | JSON import/export, SVG/PNG export; DXF R12 export (`engines/dxf_export.py`, `GET /elevations/{id}/export.dxf`, `POST /export/dxf`) | e2e (JSON); tests/engines/test_dxf.py (structure, layers, counts, coordinates, ezdxf read-back + audit), test_purchasing::test_dxf_endpoints | Built+Tested (DXF backend; frontend TS port separate) |
| R3 | Configurable catalogues: series, profiles, connections, splices, brackets, accessories, colours, compatibility | seed/demo_catalogue.json, CatalogueRevision, admin PUT | catalogue tests | Built+Tested (DEMO data only) |
| R4 | Glass/panel configuration (none, single, laminated, IGU, spandrel, panel, fire, special, project) | catalogue glass_types/panel_types, field fills, compatibility check | calc/elevation tests | Built (fire ratings = null, Blocked on certified data) |
| R5 | Engineering calc: cut lengths/angles, allowances, glass sizes, BOM; units, inputs, versions, warnings, status | engines/calc.py, validators.validate_calc, CalcRun persistence | engine + API tests | Built+Tested — **PROVISIONAL demo rules** |
| R6 | 1D cutting optimisation (stock, kerf, trims, patterns, offcuts, waste, utilisation) | engines/cutting1d.py (FFD/BFD + local search, OR-Tools CP-SAT exact), validators.validate_1d | 200 randomized + corruption tests, exact-vs-FFD case | Built+Tested |
| R6.1 | Independent feasibility validator, heuristic vs proven-optimal distinction | validators.py (no optimiser imports); status FEASIBLE_HEURISTIC / OPTIMAL_PROVEN | yes | Built+Tested |
| R7 | 2D nesting: Excel import, orientation, kerf, edge trims, guillotine, layouts, waste, residuals, reports; project & standalone | engines/nesting2d.py, excel_io.py, UI 2D Nesting | randomized + guillotine + Excel round-trip | Built+Tested (heuristic only, no exact 2D) |
| R8.1 | Quotation/costing | services/quotes.py, Q-YYYY-NNNN numbering | quote arithmetic tests | Built+Tested (demo prices) |
| R8.2 | Material take-off / BOM | CalcResult.bom, calc reports | yes | Built+Tested |
| R8.3 | Inventory & residual stock (offcuts back to stock, consumed in next run) | services/inventory.py, `/inventory/as-stock` | integration test | Built+Tested |
| R8.4 | PDF/Excel reports, bar drawings, cutting lists | reports/pdf.py, xlsx.py | PDF/XLSX validity tests | Built+Tested |
| R8.5 | Fabrication drawings, machining data, CNC/ERP integration | Data structures only (cut offsets/angles in Excel) | — | In development |
| R10.1 | Production tracking: work orders → one tracked part per physical piece, routes/stations, scan events, board (v0.2, §8.1) | models ProductionOrder/Part/PartEvent (migration 0002), services/production.py, api/v1/production.py | tests/api/test_production.py (explosion counts, codes, route walk, 409 transitions, block note, roles, board) | Built+Tested (backend) |
| R10.2 | QR part labels (A4 3×8, A4 2×4, 62×29 roll) + work order sheet | reports/labels.py (reportlab QrCodeWidget), reports/pdf.py `work_order_pdf` | test_production (3 layouts, page size/count, widget payload, zbar decode of rendered PDF) | Built+Tested |
| R10.3 | Purchasing: POs from calc runs / cutting jobs minus stock, receive into inventory, PDF/XLSX | services/purchasing.py, api/v1/purchasing.py, reports | tests/api/test_purchasing.py | Built+Tested (demo prices — provisional) |
| R10.4 | Design checks (glass weight, field area/aspect, mullion span, anchors, colour) | engines/checks.py wired into calc; DEMO thresholds A-13…A-17 | tests/engines/test_checks.py | Built+Tested — **demo thresholds, not structural verification** |
| R9.1 | Audit trail | AuditLog on all mutations/logins/exports | audit tests | Built+Tested |
| R9.2 | Security, logging, error handling | bcrypt, JWT, rate-limit, security headers, request-id JSON logs, standard error shape | api tests | Built+Tested |
| R9.3 | Backups & deployment | scripts/backup.sh, restore.sh, Dockerfiles, docker-compose | backup run on dev DB | Built (images not built in sandbox — no Docker daemon) |
| Q1 | Automated unit/API/integration/UI tests | pytest 174 (+3 skipped) + Vitest 115 + Playwright 6 | — | Built |
| Q2 | Golden reference cases | tests/engines/golden/golden_cases.json | 3 skipped (AWAITING_EXPERT_VALUES) | Blocked |
