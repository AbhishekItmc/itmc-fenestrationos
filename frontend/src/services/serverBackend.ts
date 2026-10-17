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
  Project,
  ProjectMember,
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

  downloadReport: (kind, id, fmt) => api.download(`/reports/${kind}/${id}.${fmt}`, `${kind}-${id}.${fmt}`),

  listUsers: () => api.get<User[]>('/admin/users'),
  createUser: (input) => api.post<User>('/admin/users', input),
  updateUser: (id, input) => api.put<User>(`/admin/users/${id}`, input),
  listAudit: (f) => api.get<AuditPage>('/admin/audit', { query: { action: f.action, entity: f.entity, user_id: f.user_id, limit: f.limit ?? 50, offset: f.offset ?? 0 } }),
};

export { ApiError };
