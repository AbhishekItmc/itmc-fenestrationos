"""
Shared, typed data contract for ITMC FenestrationOS engines.

These Pydantic models are THE contract between:
  * the pure-Python engines (app/engines/*)  -- geometry, calc, 1D cutting, 2D nesting
  * the FastAPI layer (app/api/*)            -- request/response bodies
  * the frontend (frontend/src/api/types.ts)  -- mirrored TypeScript types

Conventions
-----------
* All lengths are millimetres (float). `units` is always "mm" in v1 and is echoed on every result.
* Angles are degrees.
* Coordinates for elevations: origin at bottom-left of the framework, x to the right, y up.
* Every engine result carries: engine_version, rule/catalogue version (where applicable),
  echoed inputs (or an inputs hash), warnings and a validation block.
* validation_status semantics:
    "PROVISIONAL_DEMO_RULES"  -- computed with demo/unapproved rule sets; NOT for production
    "FEASIBLE_HEURISTIC"      -- optimisation result that passed the independent feasibility
                                 validator but is not proven optimal
    "OPTIMAL_PROVEN"          -- feasible and proven optimal (e.g. bars used == lower bound,
                                 or exact solver returned OPTIMAL)
    "INVALID"                 -- the independent validator rejected the result (should never ship)
    "VALIDATED"               -- reserved: only when a domain expert has approved the rule set
                                 AND golden reference cases pass. Not used by demo data.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

Units = Literal["mm"]
ValidationStatus = Literal[
    "PROVISIONAL_DEMO_RULES", "FEASIBLE_HEURISTIC", "OPTIMAL_PROVEN", "INVALID", "VALIDATED"
]
Severity = Literal["info", "warning", "error"]


class Issue(BaseModel):
    code: str                      # machine-readable, e.g. "FIELD_TOO_NARROW"
    severity: Severity
    message: str
    ref: Optional[str] = None      # element reference, e.g. "bay:2/field:1" or "piece:T-03"


class ValidationReport(BaseModel):
    passed: bool
    validator: str                 # name+version of the validator that produced this
    errors: List[Issue] = []
    checked_items: int = 0


# ---------------------------------------------------------------------------
# Elevation (curtain-wall framework) model
# ---------------------------------------------------------------------------
FillType = Literal["glass", "spandrel", "panel", "none", "opening"]


class FieldFill(BaseModel):
    type: FillType = "glass"
    glass_type_id: Optional[str] = None     # catalogue GlassType.id when type == glass/spandrel
    panel_type_id: Optional[str] = None     # catalogue panel id when type == panel
    note: Optional[str] = None


class Bay(BaseModel):
    """A vertical bay between mullion i and mullion i+1."""
    transoms: List[float] = Field(
        default_factory=list,
        description="Internal transom centre-line heights (y, mm from framework bottom), "
                    "strictly increasing, each strictly inside (0, height). "
                    "Sill (y=0) and head (y=height) members are implicit perimeter members.",
    )
    transom_profile_id: Optional[str] = None  # override; else elevation default


class TopShapeFlat(BaseModel):
    type: Literal["flat"] = "flat"


class TopShapeArch(BaseModel):
    """Segmental arch over the full framework width. Geometry/display only in v1 -
    calculation of arched members is NOT supported and produces an error-level issue."""
    type: Literal["arch"] = "arch"
    rise: float = Field(gt=0, description="Arch rise above the springing line (mm)")


class Elevation(BaseModel):
    id: Optional[str] = None
    name: str = "Elevation"
    units: Units = "mm"
    width: float = Field(gt=0)
    height: float = Field(gt=0, description="Height to the springing line / head")
    mullions: List[float] = Field(
        description="Mullion centre-line x positions INCLUDING both edges: first == 0, last == width, "
                    "strictly increasing. Bays = len(mullions) - 1."
    )
    bays: List[Bay]
    fills: Dict[str, FieldFill] = Field(
        default_factory=dict,
        description='Key "b{bay}-f{field}" (0-based, field 0 = bottom). Missing key => default glass.',
    )
    top_shape: Union[TopShapeFlat, TopShapeArch] = Field(default_factory=TopShapeFlat, discriminator="type")
    system_id: Optional[str] = None            # catalogue Series id
    mullion_profile_id: Optional[str] = None
    transom_profile_id: Optional[str] = None
    colour_id: Optional[str] = None
    default_glass_type_id: Optional[str] = None
    anchor_levels: List[float] = Field(
        default_factory=list,
        description="Heights (mm from bottom) of slab/anchor brackets per mullion. Demo input.",
    )
    quantity: int = Field(default=1, ge=1, description="Number of identical elevations (multiplier for BOM)")


# ---------------------------------------------------------------------------
# Calculation (geometry -> cut list / glass / BOM)
# ---------------------------------------------------------------------------
class CalcRequest(BaseModel):
    elevation: Elevation
    catalogue_version: Optional[str] = None   # defaults to active
    rule_set_id: Optional[str] = None         # defaults to series default


class ProfileCut(BaseModel):
    mark: str                    # e.g. "M1", "T2.3"
    role: Literal["mullion", "transom", "sill", "head", "pressure_plate", "cover_cap"]
    profile_id: str
    profile_code: str
    description: str
    length: float                # cut length mm
    angle_start: float = 90.0
    angle_end: float = 90.0
    quantity: int
    position: Optional[str] = None   # e.g. "bay 2, y=1500"
    formula: str                     # human readable derivation, e.g. "H + ext_top + ext_bottom"
    rule_ids: List[str] = []


class GlassItem(BaseModel):
    mark: str
    field_key: str
    fill_type: FillType
    glass_type_id: Optional[str]
    description: str
    width: float
    height: float
    area_m2: float
    quantity: int
    formula: str
    rule_ids: List[str] = []
    panel_type_id: Optional[str] = None   # added (engines): catalogue panel id when fill_type == "panel"


class BomLine(BaseModel):
    item_type: Literal["profile", "glass", "panel", "accessory", "hardware", "gasket", "sealant", "bracket", "connector"]
    item_id: str
    code: str
    description: str
    unit: Literal["mm", "m", "m2", "pcs", "kg"]
    quantity: float
    rule_ids: List[str] = []
    demo_data: bool = True


class CalcResult(BaseModel):
    units: Units = "mm"
    engine_version: str
    catalogue_version: str
    rule_set_id: str
    rule_set_version: str
    rule_set_approved: bool
    inputs_hash: str
    elevation: Elevation
    profile_cuts: List[ProfileCut]
    glass_items: List[GlassItem]
    bom: List[BomLine]
    issues: List[Issue]
    validation_status: ValidationStatus
    validation: ValidationReport
    totals: Dict[str, float] = {}     # e.g. {"glass_area_m2":..., "profile_length_m":...}


# ---------------------------------------------------------------------------
# 1D cutting optimisation
# ---------------------------------------------------------------------------
class Stock1D(BaseModel):
    id: str
    label: Optional[str] = None
    length: float = Field(gt=0)
    quantity: Optional[int] = Field(default=None, ge=0, description="None = unlimited")
    cost_per_bar: Optional[float] = None
    is_offcut: bool = False          # reusable residual from inventory; used first when prefer_offcuts
    priority: int = 0


class Piece1D(BaseModel):
    id: str
    label: Optional[str] = None
    length: float = Field(gt=0)
    quantity: int = Field(ge=1)
    angle_start: float = 90.0
    angle_end: float = 90.0


class Cutting1DRequest(BaseModel):
    units: Units = "mm"
    material: Optional[str] = None   # profile code / description for reports
    kerf: float = Field(default=4.0, ge=0)
    trim_start: float = Field(default=10.0, ge=0, description="Squaring cut removed at bar start (includes its kerf)")
    trim_end: float = Field(default=0.0, ge=0, description="Unusable length at bar end (clamp zone)")
    min_reusable_offcut: float = Field(default=500.0, ge=0)
    stocks: List[Stock1D]
    pieces: List[Piece1D]
    strategy: Literal["auto", "heuristic", "exact"] = "auto"
    prefer_offcuts: bool = True
    time_limit_s: float = Field(default=10.0, gt=0, le=120)


class Cut1D(BaseModel):
    piece_id: str
    label: Optional[str] = None
    length: float
    offset: float                    # start position of the piece on the bar (mm from bar start)
    angle_start: float = 90.0
    angle_end: float = 90.0


class Pattern1D(BaseModel):
    pattern_id: str
    stock_id: str
    stock_length: float
    is_offcut_stock: bool = False
    count: int                       # number of bars cut with this identical pattern
    cuts: List[Cut1D]
    used_length: float               # trim_start + sum(pieces) + kerfs
    remainder: float                 # stock_length - used_length - trim_end  (>= 0)
    offcut_reusable: bool            # remainder >= min_reusable_offcut
    waste: float                     # remainder if not reusable, else 0 ; plus trims and kerf counted separately


class Summary1D(BaseModel):
    bars_used: int
    total_stock_length: float
    total_piece_length: float
    total_kerf_loss: float
    total_trim_loss: float
    reusable_offcut_length: float
    waste_length: float
    utilization: float               # total_piece_length / total_stock_length (0..1)
    total_cost: Optional[float] = None


class Proof1D(BaseModel):
    lower_bound_bars: int            # valid lower bound on number of bars (single stock length case)
    bars_used: int
    gap_bars: int
    is_optimal: bool
    note: str


class Cutting1DResult(BaseModel):
    units: Units = "mm"
    engine_version: str
    method: str                      # e.g. "FFD+local-search", "CP-SAT exact"
    status: Literal["OPTIMAL", "FEASIBLE", "PARTIAL", "INFEASIBLE"]
    validation_status: ValidationStatus
    patterns: List[Pattern1D]
    unplaced: List[Piece1D] = []
    summary: Summary1D
    proof: Optional[Proof1D] = None
    validation: ValidationReport
    issues: List[Issue] = []
    request: Cutting1DRequest
    runtime_ms: float


# ---------------------------------------------------------------------------
# 2D sheet nesting (glass / ACP / sheet)
# ---------------------------------------------------------------------------
class Sheet2D(BaseModel):
    id: str
    label: Optional[str] = None
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    quantity: Optional[int] = Field(default=None, ge=0, description="None = unlimited")
    material: Optional[str] = None
    thickness: Optional[float] = None
    is_residual: bool = False
    cost_per_sheet: Optional[float] = None


class Piece2D(BaseModel):
    id: str
    label: Optional[str] = None
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    quantity: int = Field(ge=1)
    material: Optional[str] = None
    thickness: Optional[float] = None
    can_rotate: bool = True          # False when grain/coating direction or orientation is locked


class EdgeTrim(BaseModel):
    left: float = 0.0
    right: float = 0.0
    top: float = 0.0
    bottom: float = 0.0


class Nesting2DRequest(BaseModel):
    units: Units = "mm"
    kerf: float = Field(default=3.0, ge=0)
    edge_trim: EdgeTrim = Field(default_factory=EdgeTrim)
    sheets: List[Sheet2D]
    pieces: List[Piece2D]
    guillotine: bool = True          # glass is normally scored/broken edge-to-edge
    min_residual_width: float = 300.0
    min_residual_height: float = 300.0
    prefer_residuals: bool = True
    time_limit_s: float = Field(default=10.0, gt=0, le=120)


class Placement2D(BaseModel):
    piece_id: str
    label: Optional[str] = None
    x: float                         # from sheet bottom-left (mm), includes edge trim offset
    y: float
    width: float                     # as placed (after rotation)
    height: float
    rotated: bool


class Residual2D(BaseModel):
    x: float
    y: float
    width: float
    height: float
    reusable: bool


class SheetLayout(BaseModel):
    layout_id: str
    sheet_id: str
    sheet_label: Optional[str] = None
    width: float
    height: float
    is_residual_sheet: bool = False
    count: int = 1                   # identical layouts repeated
    placements: List[Placement2D]
    residuals: List[Residual2D]
    used_area: float                 # sum of piece areas (mm2)
    utilization: float               # used_area / sheet area


class Summary2D(BaseModel):
    sheets_used: int
    total_sheet_area_m2: float
    total_piece_area_m2: float
    waste_area_m2: float
    reusable_residual_area_m2: float
    utilization: float
    total_cost: Optional[float] = None


class Nesting2DResult(BaseModel):
    units: Units = "mm"
    engine_version: str
    method: str
    status: Literal["FEASIBLE", "PARTIAL", "INFEASIBLE", "OPTIMAL"]
    validation_status: ValidationStatus
    layouts: List[SheetLayout]
    unplaced: List[Piece2D] = []
    summary: Summary2D
    lower_bound_sheets: Optional[int] = None
    validation: ValidationReport
    issues: List[Issue] = []
    request: Nesting2DRequest
    runtime_ms: float
