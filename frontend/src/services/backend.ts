/**
 * Backend abstraction: the UI talks to `Backend`; two implementations exist —
 * `serverBackend` (REST /api/v1, authoritative) and `offlineBackend` (in-browser demo engine + localStorage).
 */
import type {
  AuditEntry,
  CalcRequest,
  CalcResult,
  CalcRun,
  Catalogue,
  CatalogueCollection,
  Customer,
  CustomerInput,
  Cutting1DRequest,
  Cutting1DResult,
  CuttingJob,
  Elevation,
  ElevationRecord,
  Id,
  InventoryItem,
  Issue,
  LabelLayout,
  Nesting2DRequest,
  Nesting2DResult,
  NestingImportResult,
  NestingJob,
  Part,
  PartDetail,
  PartEventInput,
  PartFilter,
  ProductionBoard,
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderUpdate,
  Project,
  ProjectInput,
  ProjectMember,
  PurchaseFromCalcInput,
  PurchaseOrder,
  PurchaseOrderUpdate,
  Quote,
  Revision,
  Role,
  Stock1D,
  User,
} from '../api/types';

export type Mode = 'server' | 'offline';

export interface JobSummary {
  id: Id;
  project_id?: Id | null;
  name: string;
  status: string;
  validation_status?: string | null;
  engine_version?: string | null;
  created_at?: string;
  summary?: Record<string, unknown> | null;
}

export interface InventoryFilter {
  kind?: 'bar' | 'sheet' | 'item';
  residual?: boolean;
  status?: string;
  material?: string;
}

export interface InventoryInput {
  kind: 'bar' | 'sheet' | 'item';
  unit?: string | null;
  material?: string | null;
  profile_code?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  thickness?: number | null;
  quantity: number;
  is_residual: boolean;
  location?: string | null;
  notes?: string | null;
}

export interface AuditFilter {
  action?: string;
  entity?: string;
  user_id?: number;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export type ReportKind = 'calc' | 'cutting' | 'nesting' | 'quote' | 'labels' | 'production' | 'purchase-order';

export interface ReportLink {
  key: string;
  title: string;
  kind: ReportKind;
  id: Id;
  formats: ('pdf' | 'xlsx')[];
  /** e.g. label layout for `labels` */
  query?: { layout?: LabelLayout };
  /** client-side alternative available in every mode (printable page route) */
  href?: string;
  status?: string | null;
  created_at?: string;
}

export interface Backend {
  readonly mode: Mode;
  // auth
  me(): Promise<User>;
  // customers & projects
  listCustomers(): Promise<Customer[]>;
  createCustomer(input: CustomerInput): Promise<Customer>;
  updateCustomer(id: Id, input: Partial<CustomerInput>): Promise<Customer>;
  listProjects(q?: string): Promise<Project[]>;
  getProject(id: Id): Promise<Project>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: Id, input: Partial<ProjectInput>): Promise<Project>;
  deleteProject(id: Id): Promise<void>;
  listMembers(projectId: Id): Promise<ProjectMember[]>;
  listRevisions(projectId: Id): Promise<Revision[]>;
  createRevision(projectId: Id, label: string, note: string): Promise<Revision>;
  // elevations
  listElevations(projectId: Id): Promise<ElevationRecord[]>;
  getElevation(id: Id): Promise<ElevationRecord>;
  createElevation(projectId: Id, data: Elevation): Promise<ElevationRecord>;
  updateElevation(id: Id, data: Elevation, version: number): Promise<ElevationRecord>;
  deleteElevation(id: Id): Promise<void>;
  // catalogue
  getCatalogue(): Promise<Catalogue>;
  updateCatalogueItem(collection: CatalogueCollection, id: string, item: Record<string, unknown>): Promise<unknown>;
  readonly canEditCatalogue: boolean;
  // calc
  calcStateless(req: CalcRequest): Promise<CalcResult>;
  calculateElevation(elevationId: Id): Promise<CalcRun>;
  listCalcRuns(projectId: Id): Promise<CalcRun[]>;
  getCalcRun(id: Id): Promise<CalcRun>;
  // cutting
  optimize1D(req: Cutting1DRequest): Promise<Cutting1DResult>;
  createCuttingJob(projectId: Id | null, name: string, req: Cutting1DRequest, consumeInventory?: boolean): Promise<CuttingJob>;
  listCuttingJobs(projectId?: Id | null): Promise<JobSummary[]>;
  getCuttingJob(id: Id): Promise<CuttingJob>;
  inventoryAsBarStock(material: string): Promise<Stock1D[]>;
  // nesting
  optimize2D(req: Nesting2DRequest): Promise<Nesting2DResult>;
  createNestingJob(projectId: Id | null, name: string, req: Nesting2DRequest): Promise<NestingJob>;
  listNestingJobs(projectId?: Id | null): Promise<JobSummary[]>;
  getNestingJob(id: Id): Promise<NestingJob>;
  importNestingExcel(file: File): Promise<NestingImportResult>;
  importCuttingExcel(file: File): Promise<{ pieces: unknown[]; stocks: unknown[]; settings: Record<string, unknown>; issues: Issue[] }>;
  downloadTemplate(kind: 'cutting' | 'nesting'): Promise<void>;
  // inventory
  listInventory(f?: InventoryFilter): Promise<InventoryItem[]>;
  createInventory(input: InventoryInput): Promise<InventoryItem>;
  consumeInventory(id: Id, quantity: number): Promise<InventoryItem>;
  residualsFromCutting(jobId: Id): Promise<InventoryItem[]>;
  residualsFromNesting(jobId: Id): Promise<InventoryItem[]>;
  // quotes
  listQuotes(projectId: Id): Promise<Quote[]>;
  createQuote(projectId: Id, calcRunIds: Id[], marginPct: number, notes: string): Promise<Quote>;
  // production (§8.1)
  listProductionOrders(projectId?: Id | null): Promise<ProductionOrder[]>;
  createProductionOrder(input: ProductionOrderInput): Promise<ProductionOrder>;
  getProductionOrder(id: Id): Promise<ProductionOrder>;
  updateProductionOrder(id: Id, input: ProductionOrderUpdate): Promise<ProductionOrder>;
  listParts(orderId: Id, f?: PartFilter): Promise<Part[]>;
  getBoard(orderId: Id): Promise<ProductionBoard>;
  getPart(code: string): Promise<PartDetail>;
  postPartEvent(code: string, input: PartEventInput): Promise<Part>;
  // purchasing (§8.2)
  listPurchaseOrders(projectId?: Id | null): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: Id): Promise<PurchaseOrder>;
  purchaseOrdersFromCalc(projectId: Id, input: PurchaseFromCalcInput): Promise<PurchaseOrder[]>;
  updatePurchaseOrder(id: Id, input: PurchaseOrderUpdate): Promise<PurchaseOrder>;
  receivePurchaseOrder(id: Id): Promise<PurchaseOrder>;
  // DXF (§8.4): returns the DXF text
  exportDxf(elevation: Elevation): Promise<string>;
  // reports
  downloadReport(kind: ReportKind, id: Id, fmt: 'pdf' | 'xlsx', query?: { layout?: LabelLayout }): Promise<void>;
  readonly reportsAvailable: boolean;
  // admin
  listUsers(): Promise<User[]>;
  createUser(input: { email: string; name: string; role: Role; password: string }): Promise<User>;
  updateUser(id: Id, input: { role?: Role; active?: boolean; name?: string }): Promise<User>;
  listAudit(f: AuditFilter): Promise<AuditPage>;
}
