# Golden reference cases (engines)

**APPROVED golden reference cases from a qualified fenestration domain expert are REQUIRED before any
rule set may be marked `approved: true` / `golden_cases_passed: true` and before any result can carry
`validation_status = "VALIDATED"`.**

`golden_cases.json` has two sections:

1. `expert_cases` — placeholders for real reference elevations with expert-supplied expected values
   (cut lengths, glass sizes, BOM quantities) for a specific, approved system/rule set. All expected
   values are currently `null` and each case has `"status": "AWAITING_EXPERT_VALUES"`. The test suite
   reports these as **SKIPPED** (never passed). To activate a case: fill in the inputs and expected
   values from approved manufacturer/fabrication data, set `"status": "APPROVED"`, and record the approver
   and source document in `approved_by` / `source`.

2. `arithmetic_consistency_cases` — "hand-checked arithmetic" cases whose expected values follow trivially
   from the stated DEMO params. They are labelled **"arithmetic consistency, not engineering validation"**:
   they prove the engine applies the documented formula correctly, nothing more.

Nothing in this folder is manufacturer data.
