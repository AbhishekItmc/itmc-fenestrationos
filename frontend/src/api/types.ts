/**
 * Wire types for ITMC FenestrationOS.
 *
 * Section A mirrors `backend/app/engines/models.py` EXACTLY (snake_case, same optionality).
 * Any change there must be reflected here (see docs/ARCHITECTURE.md "Contract changes").
 * Section B: catalogue JSON shape (ARCHITECTURE §5).
 * Section C: API-only DTOs (projects, users, jobs ...) derived from the REST contract (§6) and ORM.
 *
 * Pydantic `Optional[X] = None` -> `x?: X | null` (may be omitted or null on the wire).
 * Pydantic fields with a non-None default -> optional in requests (`x?: T`), always present in responses.
 */

// ===========================================================================
// A. Engine contract (models.py)
// ===========================================================================
export type Units = 'mm';
export type ValidationStatus =
  | 'PROVISIONAL_DEMO_RULES'
  | 'FEASIBLE_HEURISTIC'
  | 'OPTIMAL_PROVEN'
  | 'INVALID'
  | 'VALIDATED';
export type Severity = 'info' | 'warning' | 'error';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  ref?: string | null;
}

export interface ValidationReport {
  passed: boolean;
  validator: string;
  errors: Issue[];
  checked_items: number;
}

// ---- Elevation ------------------------------------------------------------
export type FillType = 'glass' | 'spandrel' | 'panel' | 'none' | 'opening';

export interface FieldFill {
  type: FillType;
  glass_type_id?: string | null;
  panel_type_id?: string | null;
  note?: string | null;
}

export interface Bay {
  /** Internal transom centre-line heights (mm from framework bottom), strictly increasing, inside (0, H). */
  transoms: number[];
  transom_profile_id?: string | null;
}

export interface TopShapeFlat {
  type: 'flat';
}
export interface TopShapeArch {
  type: 'arch';
  /** Arch rise above the springing line (mm), > 0. Geometry/display only in v1. */
  rise: number;
}
export type TopShape = TopShapeFlat | TopShapeArch;

export interface Elevation {
  id?: string | null;
  name: string;
  units: Units;
  width: number;
  height: number;
  /** Mullion centre-line x positions INCLUDING both edges (first 0, last width), strictly increasing. */
  mullions: number[];
  bays: Bay[];
  /** Key "b{bay}-f{field}" (0-based, field 0 = bottom). Missing => default glass. */
  fills: Record<string, FieldFill>;
  top_shape: TopShape;
  system_id?: string | null;
  mullion_profile_id?: string | null;
  transom_profile_id?: string | null;
  colour_id?: string | null;
  default_glass_type_id?: string | null;
  anchor_levels: number[];
  quantity: number;
}

// ---- Calculation ----------------------------------------------------------
export interface CalcRequest {
  elevation: Elevation;
  catalogue_version?: string | null;
  rule_set_id?: string | null;
}

export type ProfileCutRole = 'mullion' | 'transom' | 'sill' | 'head' | 'pressure_plate' | 'cover_cap';

export interface ProfileCut {
  mark: string;
  role: ProfileCutRole;
  profile_id: string;
  profile_code: string;
  description: string;
  length: number;
  angle_start: number;
  angle_end: number;
  quantity: number;
  position?: string | null;
  formula: string;
  rule_ids: string[];
}

export interface GlassItem {
  mark: string;
  field_key: string;
  fill_type: FillType;
  glass_type_id: string | null;
  description: string;
  width: number;
  height: number;
  area_m2: number;
  quantity: number;
  formula: string;
  rule_ids: string[];
  panel_type_id?: string | null;
}

export type BomItemType =
  | 'profile'
  | 'glass'
  | 'panel'
  | 'accessory'
  | 'hardware'
  | 'gasket'
  | 'sealant'
  | 'bracket'
  | 'connector';
export type BomUnit = 'mm' | 'm' | 'm2' | 'pcs' | 'kg';

export interface BomLine {
  item_type: BomItemType;
  item_id: string;
  code: string;
  description: string;
  unit: BomUnit;
  quantity: number;
  rule_ids: string[];
  demo_data: boolean;
}

export interface CalcResult {
  units: Units;
  engine_version: string;
  catalogue_version: string;
  rule_set_id: string;
  rule_set_version: string;
  rule_set_approved: boolean;
  inputs_hash: string;
  elevation: Elevation;
  profile_cuts: ProfileCut[];
  glass_items: GlassItem[];
  bom: BomLine[];
  issues: Issue[];
  validation_status: ValidationStatus;
  validation: ValidationReport;
  totals: Record<string, number>;
}

// ---- 1D cutting -----------------------------------------------------------
export interface Stock1D {
  id: string;
  label?: string | null;
  length: number;
  /** null/undefined = unlimited */
  quantity?: number | null;
  cost_per_bar?: number | null;
  is_offcut?: boolean;
  priority?: number;
}

export interface Piece1D {
  id: string;
  label?: string | null;
  length: number;
  quantity: number;
  angle_start?: number;
  angle_end?: number;
}

export type Strategy1D = 'auto' | 'heuristic' | 'exact';

export interface Cutting1DRequest {
  units?: Units;
  material?: string | null;
  kerf?: number;
  trim_start?: number;
  trim_end?: number;
  min_reusable_offcut?: number;
  stocks: Stock1D[];
  pieces: Piece1D[];
  strategy?: Strategy1D;
  prefer_offcuts?: boolean;
  time_limit_s?: number;
}

export interface Cut1D {
  piece_id: string;
  label?: string | null;
  length: number;
  offset: number;
  angle_start: number;
  angle_end: number;
}

export interface Pattern1D {
  pattern_id: string;
  stock_id: string;
  stock_length: number;
  is_offcut_stock: boolean;
  count: number;
  cuts: Cut1D[];
  used_length: number;
  remainder: number;
  offcut_reusable: boolean;
  waste: number;
}

export interface Summary1D {
  bars_used: number;
  total_stock_length: number;
  total_piece_length: number;
  total_kerf_loss: number;
  total_trim_loss: number;
  reusable_offcut_length: number;
  waste_length: number;
  utilization: number;
  total_cost?: number | null;
}

export interface Proof1D {
  lower_bound_bars: number;
  bars_used: number;
  gap_bars: number;
  is_optimal: boolean;
  note: string;
}

export type Status1D = 'OPTIMAL' | 'FEASIBLE' | 'PARTIAL' | 'INFEASIBLE';

export interface Cutting1DResult {
  units: Units;
  engine_version: string;
  method: string;
  status: Status1D;
  validation_status: ValidationStatus;
  patterns: Pattern1D[];
  unplaced: Piece1D[];
  summary: Summary1D;
  proof?: Proof1D | null;
  validation: ValidationReport;
  issues: Issue[];
  request: Cutting1DRequest;
  runtime_ms: number;
}

// ---- 2D nesting -----------------------------------------------------------
export interface Sheet2D {
  id: string;
  label?: string | null;
  width: number;
  height: number;
  quantity?: number | null;
  material?: string | null;
  thickness?: number | null;
  is_residual?: boolean;
  cost_per_sheet?: number | null;
}

export interface Piece2D {
  id: string;
  label?: string | null;
  width: number;
  height: number;
  quantity: number;
  material?: string | null;
  thickness?: number | null;
  can_rotate?: boolean;
}

export interface EdgeTrim {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Nesting2DRequest {
  units?: Units;
  kerf?: number;
  edge_trim?: EdgeTrim;
  sheets: Sheet2D[];
  pieces: Piece2D[];
  guillotine?: boolean;
  min_residual_width?: number;
  min_residual_height?: number;
  prefer_residuals?: boolean;
  time_limit_s?: number;
}

export interface Placement2D {
  piece_id: string;
  label?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}

export interface Residual2D {
  x: number;
  y: number;
  width: number;
  height: number;
  reusable: boolean;
}

export interface SheetLayout {
  layout_id: string;
  sheet_id: string;
  sheet_label?: string | null;
  width: number;
  height: number;
  is_residual_sheet: boolean;
  count: number;
  placements: Placement2D[];
  residuals: Residual2D[];
  used_area: number;
  utilization: number;
}

export interface Summary2D {
  sheets_used: number;
  total_sheet_area_m2: number;
  total_piece_area_m2: number;
  waste_area_m2: number;
  reusable_residual_area_m2: number;
  utilization: number;
  total_cost?: number | null;
}

export type Status2D = 'FEASIBLE' | 'PARTIAL' | 'INFEASIBLE' | 'OPTIMAL';

export interface Nesting2DResult {
  units: Units;
  engine_version: string;
  method: string;
  status: Status2D;
  validation_status: ValidationStatus;
  layouts: SheetLayout[];
  unplaced: Piece2D[];
  summary: Summary2D;
  lower_bound_sheets?: number | null;
  validation: ValidationReport;
  issues: Issue[];
  request: Nesting2DRequest;
  runtime_ms: number;
}

// ===========================================================================
// B. Catalogue JSON (ARCHITECTURE §5 + contract changes)
// ===========================================================================
export type ProfileRole = 'mullion' | 'transom' | 'pressure_plate' | 'cover_cap' | 'extension' | 'splice_sleeve';
export type GlassCategory = 'single' | 'laminated' | 'igu' | 'spandrel' | 'fire' | 'special' | 'project';

export interface CatSeries {
  id: string;
  code: string;
  name: string;
  system_type: string;
  description?: string;
  default_rule_set_id?: string | null;
  mullion_profile_ids: string[];
  transom_profile_ids: string[];
  pressure_plate_profile_id?: string | null;
  cover_cap_profile_id?: string | null;
  splice_sleeve_profile_id?: string | null;
  default_mullion_profile_id?: string | null;
  default_transom_profile_id?: string | null;
  glass_thickness_min?: number | null;
  glass_thickness_max?: number | null;
  face_width?: number | null;
  demo?: boolean;
}

export interface CatProfile {
  id: string;
  series_id: string;
  code: string;
  name: string;
  role: ProfileRole;
  face_width: number;
  depth: number;
  weight_kg_m?: number | null;
  stock_lengths: number[];
  price_per_m?: number | null;
  demo?: boolean;
  notes?: string;
}

export interface CatGlassType {
  id: string;
  code: string;
  name: string;
  category: GlassCategory;
  build_up?: string | null;
  thickness: number | null;
  weight_kg_m2?: number | null;
  price_per_m2?: number | null;
  fire_rating: string | null;
  notes?: string;
  demo?: boolean;
}

export interface CatPanelType {
  id: string;
  code: string;
  name: string;
  category: string;
  thickness: number | null;
  price_per_m2?: number | null;
  notes?: string;
  demo?: boolean;
}

export interface CatAccessory {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  price?: number | null;
  series_ids: string[];
  demo?: boolean;
}

export interface CatColour {
  id: string;
  code: string;
  name: string;
  finish: string;
  hex: string;
  surcharge_pct?: number | null;
  demo?: boolean;
}

export interface CatRuleSet {
  id: string;
  series_id: string;
  version: string;
  approved: boolean;
  golden_cases_passed?: boolean;
  description?: string;
  params: Record<string, number>;
  param_docs: Record<string, string>;
  demo?: boolean;
}

export interface CatCompatibility {
  id: string;
  kind: string;
  series_id: string | null;
  params: Record<string, number>;
  message: string;
}

export interface Catalogue {
  catalogue_version: string;
  demo_data: boolean;
  disclaimer: string;
  currency?: string;
  price_note?: string;
  series: CatSeries[];
  profiles: CatProfile[];
  glass_types: CatGlassType[];
  panel_types: CatPanelType[];
  accessories: CatAccessory[];
  colours: CatColour[];
  rule_sets: CatRuleSet[];
  compatibility: CatCompatibility[];
}

export type CatalogueCollection =
  | 'series'
  | 'profiles'
  | 'glass_types'
  | 'panel_types'
  | 'accessories'
  | 'colours'
  | 'rule_sets'
  | 'compatibility';

// ===========================================================================
// C. API DTOs (REST contract §6)
// ===========================================================================
export type Role = 'admin' | 'engineer' | 'estimator' | 'viewer';
export type Id = number;

export interface ApiErrorBody {
  detail: { code: string; message: string; issues?: Issue[] } | string;
}

export interface Health {
  status: string;
  version: string;
  db: string | boolean;
}

export interface User {
  id: Id;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Customer {
  id: Id;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  demo?: boolean;
  created_at?: string;
}
export type CustomerInput = Omit<Customer, 'id' | 'created_at' | 'demo'>;

export type ProjectStatus = 'enquiry' | 'design' | 'quoted' | 'won' | 'production' | 'closed';
export const PROJECT_STATUSES: ProjectStatus[] = ['enquiry', 'design', 'quoted', 'won', 'production', 'closed'];

export interface Project {
  id: Id;
  code: string;
  name: string;
  customer_id?: Id | null;
  customer?: Customer | null;
  customer_name?: string | null;
  site?: string | null;
  status: ProjectStatus;
  description?: string | null;
  demo?: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface ProjectInput {
  code: string;
  name: string;
  customer_id?: Id | null;
  site?: string | null;
  status: ProjectStatus;
  description?: string | null;
}

export interface ProjectMember {
  user_id: Id;
  email?: string;
  name?: string;
  role: string;
}

export interface Revision {
  id: Id;
  project_id: Id;
  rev_no: number;
  label: string;
  note?: string | null;
  created_at?: string;
  created_by?: Id | null;
  snapshot?: unknown;
}

export interface ElevationRecord {
  id: Id;
  project_id: Id;
  name: string;
  data: Elevation;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface CalcRun {
  id: Id;
  elevation_id?: Id | null;
  project_id?: Id | null;
  result: CalcResult;
  validation_status?: ValidationStatus;
  created_at?: string;
}

export interface CuttingJob {
  id: Id;
  project_id?: Id | null;
  name: string;
  request: Cutting1DRequest;
  result?: Cutting1DResult | null;
  status?: string;
  validation_status?: ValidationStatus | null;
  created_at?: string;
}

export interface NestingJob {
  id: Id;
  project_id?: Id | null;
  name: string;
  request: Nesting2DRequest;
  result?: Nesting2DResult | null;
  status?: string;
  validation_status?: ValidationStatus | null;
  created_at?: string;
}

export interface InventoryItem {
  id: Id;
  kind: 'bar' | 'sheet';
  material?: string | null;
  profile_code?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  thickness?: number | null;
  quantity: number;
  is_residual: boolean;
  source_kind?: string | null;
  source_job_id?: Id | null;
  location?: string | null;
  status: string;
  demo?: boolean;
  notes?: string | null;
  created_at?: string;
}

export interface QuoteLine {
  item_type?: string;
  item_id?: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
  note?: string | null;
}

export interface Quote {
  id: Id;
  project_id: Id;
  number: string;
  status: string;
  currency: string;
  calc_run_ids: Id[];
  lines: QuoteLine[];
  subtotal: number;
  margin_pct: number;
  margin_amount: number;
  total: number;
  validation_status: ValidationStatus;
  provisional: boolean;
  catalogue_version?: string | null;
  notes?: string | null;
  issues: Issue[];
  created_at?: string;
}

export interface AuditEntry {
  id: Id;
  ts: string;
  user_id?: Id | null;
  user_email?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  detail?: unknown;
}

export interface NestingImportResult {
  pieces: Piece2D[];
  sheets: Sheet2D[];
  issues: Issue[];
}
