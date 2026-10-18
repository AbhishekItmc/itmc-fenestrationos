import { api, ApiError } from '../api/client';
import type {
  CalcResult,
  CalcRun,
  Catalogue,
  Customer,
  Cutting1DResult,
  CuttingJob,
  ElevationRecord,
  InventoryItem,
  Issue,
  Nesting2DResult,
  NestingImportResult,
  NestingJob,
  Part,
  PartDetail,
  ProductionBoard,
  ProductionOrder,
  Project,
  ProjectMember,
  PurchaseOrder,
  Quote,
  Revision,
  Stock1D,
  User,
} from '../api/types';
import type { AuditPage, Backend, JobSummary } from './backend';

/** REST implementation of the backend contract (docs/ARCHITECTURE.md §6). */
export const serverBackend: Backend = {
  mode: 'server',
  canEditCatalogue: true,
  reportsAvailable: true,

  me: () => api.get<User>('/auth/me'),

  listCustomers: () => api.get<Customer[]>('/customers'),
  createCustomer: (input) => api.post<Customer>('/customers', input),
  updateCustomer: (id, input) => api.put<Customer>(`/customers/${id}`, input),

  listProjects: (q) => api.get<Project[]>('/projects', { query: { q } }),
  getProject: (id) => api.get<Project>(`/projects/${id}`),
  createProject: (input) => api.post<Project>('/projects', input),
  updateProject: (id, input) => api.put<Project>(`/projects/${id}`, input),
  deleteProject: (id) => api.del<void>(`/projects/${id}`),
  listMembers: (pid) => api.get<ProjectMember[]>(`/projects/${pid}/members`),
  listRevisions: (pid) => api.get<Revision[]>(`/projects/${pid}/revisions`),
  createRevision: (pid, label, note) => api.post<Revision>(`/projects/${pid}/revisions`, { label: label || null, note: note || null }),

  listElevations: (pid) => api.get<ElevationRecord[]>(`/projects/${pid}/elevations`),
  getElevation: (id) => api.get<ElevationRecord>(`/elevations/${id}`),
  createElevation: (pid, data) => api.post<ElevationRecord>(`/projects/${pid}/elevations`, { name: data.name, data: { ...data, id: null } }),
  updateElevation: (id, data, version) => api.put<ElevationRecord>(`/elevations/${id}`, { version, name: data.name, data }),
  deleteElevation: (id) => api.del<void>(`/elevations/${id}`),

  getCatalogue: () => api.get<Catalogue>('/catalogue'),
  updateCatalogueItem: (collection, id, item) => api.put<unknown>(`/catalogue/${collection}/${encodeURIComponent(id)}`, item),

  calcStateless: (req) => api.post<CalcResult>('/calc/elevation', req),
  calculateElevation: (eid) => api.post<CalcRun>(`/elevations/${eid}/calculate`, {}),
  listCalcRuns: (pid) => api.get<CalcRun[]>(`/projects/${pid}/calc-runs`),
  getCalcRun: (id) => api.get<CalcRun>(`/calc-runs/${id}`),

  optimize1D: (req) => api.post<Cutting1DResult>('/cutting/1d/optimize', req),
  createCuttingJob: (projectId, name, request, consume = false) =>
    api.post<CuttingJob>('/cutting/jobs', { project_id: projectId, name, request, optimize: true, consume_inventory: consume }),
  listCuttingJobs: (projectId) => api.get<JobSummary[]>('/cutting/jobs', { query: { project_id: projectId ?? undefined } }),
  getCuttingJob: (id) => api.get<CuttingJob>(`/cutting/jobs/${id}`),
  inventoryAsBarStock: async (material) => {
    const r = await api.get<Stock1D[] | { stocks?: Stock1D[] }>('/inventory/as-stock', { query: { kind: 'bar', material } });
    return Array.isArray(r) ? r : (r.stocks ?? []);
  },

  optimize2D: (req) => api.post<Nesting2DResult>('/nesting/2d/optimize', req),
  createNestingJob: (projectId, name, request) => api.post<NestingJob>('/nesting/jobs', { project_id: projectId, name, request, optimize: true }),
  listNestingJobs: (projectId) => api.get<JobSummary[]>('/nesting/jobs', { query: { project_id: projectId ?? undefined } }),
  getNestingJob: (id) => api.get<NestingJob>(`/nesting/jobs/${id}`),
  importNestingExcel: (file) => api.upload<NestingImportResult>('/nesting/import-excel', file),
  importCuttingExcel: (file) => api.upload<{ pieces: unknown[]; stocks: unknown[]; settings: Record<string, unknown>; issues: Issue[] }>('/cutting/import-excel', file),
  downloadTemplate: (kind) => api.download(`/${kind}/template.xlsx`, `${kind}_template.xlsx`),

  listInventory: (f = {}) =>
    api.get<InventoryItem[]>('/inventory', { query: { kind: f.kind, residual: f.residual, status: f.status, material: f.material } }),
  createInventory: (input) => api.post<InventoryItem>('/inventory', input),
  consumeInventory: (id, quantity) => api.post<InventoryItem>(`/inventory/${id}/consume`, { quantity }),
  residualsFromCutting: (jobId) => api.post<InventoryItem[]>(`/inventory/residuals/from-cutting/${jobId}`, {}),
  residualsFromNesting: (jobId) => api.post<InventoryItem[]>(`/inventory/residuals/from-nesting/${jobId}`, {}),

  listQuotes: (pid) => api.get<Quote[]>(`/projects/${pid}/quotes`),
  createQuote: (pid, calcRunIds, marginPct, notes) => api.post<Quote>(`/projects/${pid}/quotes`, { calc_run_ids: calcRunIds, margin_pct: marginPct, notes: notes || null }),

  listProductionOrders: (projectId) => api.get<ProductionOrder[]>('/production-orders', { query: { project_id: projectId ?? undefined } }),
  createProductionOrder: (input) => api.post<ProductionOrder>('/production-orders', input),
  getProductionOrder: (id) => api.get<ProductionOrder>(`/production-orders/${id}`),
  updateProductionOrder: (id, input) => api.put<ProductionOrder>(`/production-orders/${id}`, input),
  listParts: (orderId, f = {}) => api.get<Part[]>(`/production-orders/${orderId}/parts`, { query: { status: f.status, station: f.station, kind: f.kind } }),
  getBoard: (orderId) => api.get<ProductionBoard>(`/production-orders/${orderId}/board`),
  getPart: (code) => api.get<PartDetail>(`/parts/${encodeURIComponent(code)}`),
  postPartEvent: (code, input) => api.post<Part>(`/parts/${encodeURIComponent(code)}/events`, { station: input.station, action: input.action, note: input.note || null }),

  listPurchaseOrders: (projectId) => api.get<PurchaseOrder[]>('/purchase-orders', { query: { project_id: projectId ?? undefined } }),
  getPurchaseOrder: (id) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
  purchaseOrdersFromCalc: (pid, input) =>
    api.post<PurchaseOrder[]>(`/projects/${pid}/purchase-orders/from-calc`, { calc_run_ids: input.calc_run_ids, cutting_job_ids: input.cutting_job_ids ?? [], split_by_category: input.split_by_category ?? true }),
  updatePurchaseOrder: (id, input) => api.put<PurchaseOrder>(`/purchase-orders/${id}`, input),
  receivePurchaseOrder: (id) => api.post<PurchaseOrder>(`/purchase-orders/${id}/receive`, {}),

  exportDxf: async (elevation) => {
    const r = await api.post<string | { dxf?: string }>('/export/dxf', { elevation });
    return typeof r === 'string' ? r : (r.dxf ?? '');
  },

  downloadReport: (kind, id, fmt, query) => {
    const qs = query?.layout ? `?layout=${encodeURIComponent(query.layout)}` : '';
    const suffix = query?.layout ? `-${query.layout}` : '';
    return api.download(`/reports/${kind}/${id}.${fmt}${qs}`, `${kind}-${id}${suffix}.${fmt}`);
  },

  listUsers: () => api.get<User[]>('/admin/users'),
  createUser: (input) => api.post<User>('/admin/users', input),
  updateUser: (id, input) => api.put<User>(`/admin/users/${id}`, input),
  listAudit: (f) => api.get<AuditPage>('/admin/audit', { query: { action: f.action, entity: f.entity, user_id: f.user_id, limit: f.limit ?? 50, offset: f.offset ?? 0 } }),
};

export { ApiError };
