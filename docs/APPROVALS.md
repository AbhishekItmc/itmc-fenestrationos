# Domain Decisions & Approvals Register

Nothing below is approved. Until a named domain expert signs off, all calculation output is `PROVISIONAL_DEMO_RULES`.

| ID | Item | Current (demo) behaviour | Needed from domain expert |
|---|---|---|---|
| A-01 | Catalogue data | Generic DEMO profiles/glass/accessories/prices (INR), `demo: true` | Real system catalogue (profile dims, stock lengths, prices) under licence |
| A-02 | Mullion cut length | H + ext_top + ext_bottom (demo params) | Approved formula & allowances per system/anchor type |
| A-03 | Transom cut length | axis width − ½ face (each side) − 2 × clearance | Approved connection deductions per connector type |
| A-04 | 1D kerf model | One kerf after every piece incl. last; trim_start includes its kerf | Confirm saw practice; mitre allowance per profile depth (currently NOT applied, warned) |
| A-05 | 2D nesting | Kerf = min gap between pieces; guillotine default for glass; residuals reusable in either orientation | Confirm glass cutting table rules, edge deletion, coated-glass orientation |
| A-06 | Glass size | axis dimension − deduction_x/y | Approved glass bite / deduction per system & glass thickness |
| A-07 | BOM rules | Gasket = field perimeter × runs; connectors on every horizontal incl. sill/head; sealant = perimeter × runs; pressure plate/cap = full axis run | Approved accessory take-off rules |
| A-08 | Splices | Count only when member > max_bar_length; no positions | Splice positioning rules (relative to anchors) |
| A-09 | Fire / special glass | `fire_rating: null` | Certified product data only |
| A-10 | Arches, vents | Geometry/markers only; calc returns error/warning | Arch member rules; vent/sash systems |
| A-11 | Offcut priority | `prefer_offcuts` uses offcuts only when this reduces new-bar length; ties keep offcuts in stock | Business rule: always consume offcuts first? |
| A-12 | Golden cases | Structure only, values null | Approved reference elevations with expected cut/glass/BOM outputs |
| Q-01 | Source documents | Curtain-walling, EVA ME CW, sheet-cut concepts not received | Supply documents for terminology/workflow alignment review |
| A-13 | Design check: max glass weight | `max_glass_weight_kg` = 250 kg (CW-50) / 350 kg (CW-65) per pane; weight = pane area × demo `weight_kg_m2` → `GLASS_WEIGHT_HIGH` warning | Approved pane-weight limits per system, setting-block/transom capacity |
| A-14 | Design check: field area | `max_field_area_m2` = 4.5 m² (CW-50) / 6.0 m² (CW-65), axis area → `FIELD_AREA_HIGH` | Approved max infill size per system / wind load |
| A-15 | Design check: aspect ratio | `max_field_aspect_ratio` = 4.0 (long/short axis side) → `FIELD_ASPECT_HIGH` | Approved glass aspect-ratio limits (glass type dependent) |
| A-16 | Design check: mullion span | `max_unsupported_mullion_span` = 4000 mm (CW-50) / 4500 mm (CW-65) between anchor levels or anchor-to-end → `MULLION_SPAN_HIGH`. **Not a structural check** | Structural engineer: span tables per profile, wind load, anchor type |
| A-17 | Design check: anchors | `min_anchor_levels` = 2 → `ANCHORS_MISSING`; missing colour → `NO_COLOUR_SELECTED` | Confirm minimum anchorage rules |
| A-18 | Production routes | Code constants: profile `cutting → machining → assembly → qc → dispatch`; glass/panel `receiving → glazing → qc → dispatch`; `complete` from pending allowed (implicit start) | Real workshop routing per part type (configurable later), whether QC may reject/rework back to a station |
| A-19 | Purchasing quantities | Bars from cutting-job patterns (excluding INV-stock) or `ceil(total length / longest stock length)` estimate; glass/panels ordered in whole m² (rounded up); accessories rounded up to whole units; stock = available non-residual inventory of the same code (bars: same length ± 0.5 mm) | Supplier ordering units (pack sizes, cut-to-size glass orders), whether residual offcuts may offset orders, real prices |
| A-20 | Part labels | QR = `{PUBLIC_BASE_URL}/p/{code}`, 8-char code (A–Z 2–9 without 0/O/1/I); layouts 70 × 37 mm (3 × 8 A4), 105 × 74 mm (2 × 4 A4), 62 × 29 mm roll | Confirm label stock / printer models and label content |
