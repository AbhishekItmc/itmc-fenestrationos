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
