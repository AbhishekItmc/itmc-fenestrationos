/**
 * Offline demo backend: runs the TS demo engines in the browser and keeps data in memory, mirrored to
 * localStorage (best effort). All seeded records are fictitious demo data.
 */
import { ApiError } from '../api/client';
import type {
  CalcRun,
  Catalogue,
  Customer,
  CuttingJob,
  Elevation,
  ElevationRecord,
  Id,
  InventoryItem,
  NestingJob,
  Part,
  PartEvent,
  PartStatus,
  ProductionOrder,
  Project,
  PurchaseOrder,
  Quote,
  QuoteLine,
  Revision,
  Stock1D,
  User,
} from '../api/types';
import { calculate } from '../engine/calc';
import { DEMO_CATALOGUE, getAccessory, getColour, getGlassType, getPanelType, getProfile } from '../engine/catalogue';
import { optimize1D } from '../engine/cutting1d';
import { elevationToDxf } from '../engine/dxf';
import { makeGrid } from '../engine/elevation';
import { applyAction, buildBoard, countParts, explodeParts, newPartCode, orderStatusAfter, TransitionError } from '../engine/production';
import { buildPurchaseLines, DEMO_NOTE, receiptItems, recompute, splitLines } from '../engine/purchasing';
import { optimize2D } from '../engine/nesting2d';
import { loadJson, saveJson } from '../lib/storage';
import type { Backend, JobSummary } from './backend';

const KEY = 'fos.offline.v1';

interface Db {
  seq: number;
  customers: Customer[];
  projects: Project[];
  elevations: ElevationRecord[];
  revisions: Revision[];
  calcRuns: CalcRun[];
  cuttingJobs: CuttingJob[];
  nestingJobs: NestingJob[];
  inventory: InventoryItem[];
  quotes: Quote[];
  productionOrders: Omit<ProductionOrder, 'counts'>[];
  parts: StoredPart[];
  partEvents: PartEvent[];
  purchaseOrders: PurchaseOrder[];
}

type StoredPart = Part & { prev_status?: PartStatus | null };

export const OFFLINE_USER: User = { id: 1, email: 'offline@demo.local', name: 'Offline demo user', role: 'admin', active: true };

const nowIso = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function demoElevations(): Elevation[] {
  const e1 = makeGrid(6000, 4200, 4, 3, {
    name: 'E01 — South podium',
    system_id: 'ser-cw50',
    default_glass_type_id: 'gl-dgu-24',
    colour_id: 'col-ral7016',
    anchor_levels: [0, 4200],
  });
  e1.bays.forEach((b) => (b.transoms = [900, 3300]));
  e1.fills = { 'b0-f0': { type: 'spandrel', glass_type_id: 'gl-spandrel-6' }, 'b1-f0': { type: 'spandrel', glass_type_id: 'gl-spandrel-6' }, 'b2-f0': { type: 'spandrel', glass_type_id: 'gl-spandrel-6' }, 'b3-f0': { type: 'spandrel', glass_type_id: 'gl-spandrel-6' } };
  const e2 = makeGrid(4800, 3600, 3, 2, {
    name: 'E02 — Main entrance',
    system_id: 'ser-cw65',
    default_glass_type_id: 'gl-dgu-28',
    colour_id: 'col-ano-nat',
    anchor_levels: [0, 3600],
  });
  e2.mullions = [0, 1400, 3400, 4800];
  e2.bays[1].transoms = [2700];
  e2.fills = { 'b1-f1': { type: 'panel', panel_type_id: 'pnl-alu-3' } };
  const e3 = makeGrid(3000, 3000, 2, 2, { name: 'E01 — Lobby screen', system_id: 'ser-cw50', default_glass_type_id: 'gl-lam-1352', anchor_levels: [0, 3000], quantity: 2 });
  return [e1, e2, e3];
}

function seed(): Db {
  const t = nowIso();
  const db: Db = { seq: 100, customers: [], projects: [], elevations: [], revisions: [], calcRuns: [], cuttingJobs: [], nestingJobs: [], inventory: [], quotes: [], productionOrders: [], parts: [], partEvents: [], purchaseOrders: [] };
  db.customers = [
    { id: 1, name: 'Northwind Facades Pvt Ltd (fictitious)', contact_name: 'A. Rao', email: 'estimating@northwind.example', phone: '+91 00000 00001', address: 'Demo address, Pune', demo: true, created_at: t },
    { id: 2, name: 'Meridian Developers (fictitious)', contact_name: 'S. Mehta', email: 'projects@meridian.example', phone: '+91 00000 00002', address: 'Demo address, Mumbai', demo: true, created_at: t },
  ];
  db.projects = [
    { id: 1, code: 'DEMO-TWR-01', name: 'Harbourview Office Tower — podium curtain wall', customer_id: 2, customer_name: db.customers[1].name, site: 'Demo site, Navi Mumbai', status: 'design', description: 'Demo project — fictitious. Stick curtain wall podium elevations.', demo: true, created_at: t, updated_at: t },
    { id: 2, code: 'DEMO-RES-07', name: 'Lakeside Residences — lobby glazing', customer_id: 1, customer_name: db.customers[0].name, site: 'Demo site, Pune', status: 'enquiry', description: 'Demo project — fictitious.', demo: true, created_at: t, updated_at: t },
  ];
  const [e1, e2, e3] = demoElevations();
  db.elevations = [
    { id: 11, project_id: 1, name: e1.name, data: { ...e1, id: '11' }, version: 1, created_at: t, updated_at: t },
    { id: 12, project_id: 1, name: e2.name, data: { ...e2, id: '12' }, version: 1, created_at: t, updated_at: t },
    { id: 21, project_id: 2, name: e3.name, data: { ...e3, id: '21' }, version: 1, created_at: t, updated_at: t },
  ];
  const inv = (i: Partial<InventoryItem>): InventoryItem => ({ id: 0, kind: 'bar', quantity: 1, is_residual: false, status: 'available', demo: true, created_at: t, ...i });
  db.inventory = [
    inv({ id: 31, kind: 'bar', material: 'DEMO-CW50-M150', profile_code: 'DEMO-CW50-M150', length: 6000, quantity: 24, location: 'Rack A1', notes: 'Demo stock' }),
    inv({ id: 32, kind: 'bar', material: 'DEMO-CW50-M150', profile_code: 'DEMO-CW50-M150', length: 2350, quantity: 2, is_residual: true, source_kind: 'manual', location: 'Offcut rack', notes: 'Demo offcut' }),
    inv({ id: 33, kind: 'bar', material: 'DEMO-CW50-T100', profile_code: 'DEMO-CW50-T100', length: 1820, quantity: 3, is_residual: true, source_kind: 'manual', location: 'Offcut rack', notes: 'Demo offcut' }),
    inv({ id: 34, kind: 'sheet', material: 'DEMO-GL-DGU24', width: 6000, height: 3210, thickness: 24, quantity: 6, location: 'Glass bay', notes: 'Demo jumbo sheets' }),
    inv({ id: 35, kind: 'sheet', material: 'DEMO-PNL-ACP4', width: 1450, height: 980, thickness: 4, quantity: 1, is_residual: true, source_kind: 'manual', location: 'Panel store', notes: 'Demo residual' }),
  ];
  return db;
}

/** Older offline stores (v0.1) lack the v0.2 collections. */
function normalise(d: Db): Db {
  d.productionOrders ??= [];
  d.parts ??= [];
  d.partEvents ??= [];
  d.purchaseOrders ??= [];
  return d;
}

let db: Db = normalise(loadJson<Db | null>(KEY, null) ?? seed());
const persist = () => saveJson(KEY, db);
const nextId = () => ++db.seq;
const delay = <T>(v: T, ms = 60): Promise<T> => new Promise((r) => setTimeout(() => r(clone(v)), ms));
const notFound = (what: string, id: Id) => new ApiError(404, 'NOT_FOUND', `${what} ${id} not found`);

export function resetOfflineData(): void {
  db = seed();
  persist();
}

/** Re-read the store (another tab may have written parts/events). */
function refresh(): void {
  const d = loadJson<Db | null>(KEY, null);
  if (d) db = normalise(d);
}

/** WO-YYYY-NNNN / PO-YYYY-NNNN: max existing + 1 (same scheme as the server). */
const yearSeq = (prefix: string, numbers: string[]) => {
  const pre = `${prefix}-${new Date().getFullYear()}-`;
  const n = Math.max(0, ...numbers.filter((x) => x.startsWith(pre)).map((x) => Number(x.slice(pre.length))).filter(Number.isFinite)) + 1;
  return `${pre}${String(n).padStart(4, '0')}`;
};

function withCounts(o: Omit<ProductionOrder, 'counts'>): ProductionOrder {
  return { ...o, counts: countParts(db.parts.filter((p) => p.production_order_id === o.id)) };
}

function publicPart(p: StoredPart): Part {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prev_status, ...rest } = p;
  return rest;
}

/** Calc runs of a project (404 when missing, 400 when INVALID) — mirrors services/production.load_runs. */
function loadRuns(projectId: Id, ids: Id[]): CalcRun[] {
  const uniq = [...new Set(ids.map(Number))];
  const runs = uniq.map((i) => db.calcRuns.find((r) => r.id === i && r.project_id === Number(projectId)));
  const missing = uniq.filter((_, k) => !runs[k]);
  if (missing.length) throw new ApiError(404, 'CALC_RUN_NOT_FOUND', `Calc run(s) [${missing.join(', ')}] not found in project ${projectId}`);
  const ok = runs as CalcRun[];
  const bad = ok.filter((r) => (r.validation_status ?? r.result.validation_status) === 'INVALID').map((r) => r.id);
  if (bad.length) throw new ApiError(400, 'CALC_RUN_INVALID', `Calc run(s) [${bad.join(', ')}] are INVALID and cannot be used`);
  return ok;
}

function partByCode(code: string): StoredPart {
  const p = db.parts.find((x) => x.code === String(code).toUpperCase());
  if (!p) throw new ApiError(404, 'NOT_FOUND', `Part ${code} not found`);
  return p;
}

function findOr404<T extends { id: Id }>(arr: T[], id: Id, what: string): T {
  const x = arr.find((a) => a.id === Number(id));
  if (!x) throw notFound(what, id);
  return x;
}

function jobSummary(j: CuttingJob | NestingJob, kind: 'cutting' | 'nesting'): JobSummary {
  const r = j.result as { summary?: Record<string, unknown> } | null | undefined;
  return { id: j.id, project_id: j.project_id, name: j.name, status: j.status ?? 'completed', validation_status: j.validation_status, engine_version: kind, created_at: j.created_at, summary: r?.summary ?? null };
}

function priceRuns(runs: CalcRun[], cat: Catalogue, marginPct: number) {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const issues: Quote['issues'] = [];
  const agg = new Map<string, QuoteLine & { calc_run_ids: Id[] }>();
  const surcharge = new Map<string, { base: number; pct: number; name: string; code: string; runs: Id[] }>();
  const unitPrice = (t: string, id: string, unit: string): number | null => {
    if (t === 'profile') {
      const p = getProfile(cat, id);
      return p?.price_per_m == null ? null : p.price_per_m * (unit === 'mm' ? 0.001 : 1);
    }
    if (t === 'glass') return getGlassType(cat, id)?.price_per_m2 ?? null;
    if (t === 'panel') return getPanelType(cat, id)?.price_per_m2 ?? null;
    return getAccessory(cat, id)?.price ?? null;
  };
  for (const run of runs) {
    const res = run.result;
    const colour = res.elevation.colour_id ? getColour(cat, res.elevation.colour_id) : null;
    const pct = Number(colour?.surcharge_pct ?? 0);
    let runProfile = 0;
    for (const b of res.bom) {
      const price = unitPrice(b.item_type, b.item_id, b.unit);
      const key = `${b.item_type}|${b.item_id}|${b.unit}`;
      let line = agg.get(key);
      if (!line) {
        line = { item_type: b.item_type, item_id: b.item_id, code: b.code, description: b.description, unit: b.unit, quantity: 0, unit_price: price ?? 0, amount: 0, calc_run_ids: [] };
        agg.set(key, line);
        if (price === null) issues.push({ code: 'PRICE_MISSING', severity: 'warning', message: `No demo price for ${b.item_type} ${b.code}; priced at 0`, ref: `bom:${b.item_id}` });
      }
      line.quantity += b.quantity;
      if (!line.calc_run_ids.includes(run.id)) line.calc_run_ids.push(run.id);
      if (b.item_type === 'profile' && price !== null) runProfile += b.quantity * price;
    }
    if (pct && colour) {
      const s = surcharge.get(colour.id) ?? { base: 0, pct, name: colour.name, code: colour.code, runs: [] };
      s.base += runProfile;
      s.runs.push(run.id);
      surcharge.set(colour.id, s);
    }
  }
  const lines: QuoteLine[] = [];
  for (const l of agg.values()) {
    l.quantity = Math.round(l.quantity * 1e4) / 1e4;
    l.amount = r2(l.quantity * (l.unit_price ?? 0));
    lines.push(l);
  }
  for (const [cid, s] of surcharge)
    lines.push({ item_type: 'colour_surcharge', item_id: cid, code: s.code, description: `Colour surcharge ${s.name} (${s.pct}% on profiles)`, unit: '%', quantity: s.pct, unit_price: r2(s.base), amount: r2((r2(s.base) * s.pct) / 100) });
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const marginAmount = r2((subtotal * marginPct) / 100);
  return { lines, subtotal, margin_amount: marginAmount, total: r2(subtotal + marginAmount), issues };
}

export const offlineBackend: Backend = {
  mode: 'offline',
  canEditCatalogue: false,
  reportsAvailable: false,

  me: () => delay(OFFLINE_USER, 0),

  listCustomers: () => delay(db.customers),
  createCustomer: async (input) => {
    if (!input.name?.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Customer name is required');
    const c: Customer = { ...input, id: nextId(), demo: false, created_at: nowIso() };
    db.customers.push(c);
    persist();
    return delay(c);
  },
  updateCustomer: async (id, input) => {
    const c = findOr404(db.customers, id, 'Customer');
    Object.assign(c, input);
    db.projects.filter((p) => p.customer_id === c.id).forEach((p) => (p.customer_name = c.name));
    persist();
    return delay(c);
  },

  listProjects: (q) => {
    const s = (q ?? '').toLowerCase();
    const list = db.projects.filter((p) => !s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s));
    return delay([...list].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || b.id - a.id));
  },
  getProject: async (id) => delay(findOr404(db.projects, id, 'Project')),
  createProject: async (input) => {
    if (db.projects.some((p) => p.code === input.code)) throw new ApiError(409, 'DUPLICATE_CODE', `Project code '${input.code}' already exists`);
    const t = nowIso();
    const p: Project = { ...input, id: nextId(), customer_name: db.customers.find((c) => c.id === input.customer_id)?.name ?? null, demo: false, created_at: t, updated_at: t };
    db.projects.push(p);
    persist();
    return delay(p);
  },
  updateProject: async (id, input) => {
    const p = findOr404(db.projects, id, 'Project');
    if (input.code && input.code !== p.code && db.projects.some((x) => x.code === input.code)) throw new ApiError(409, 'DUPLICATE_CODE', `Project code '${input.code}' already exists`);
    Object.assign(p, input, { updated_at: nowIso() });
    p.customer_name = db.customers.find((c) => c.id === p.customer_id)?.name ?? null;
    persist();
    return delay(p);
  },
  deleteProject: async (id) => {
    findOr404(db.projects, id, 'Project');
    const pid = Number(id);
    db.projects = db.projects.filter((p) => p.id !== pid);
    db.elevations = db.elevations.filter((e) => e.project_id !== pid);
    db.revisions = db.revisions.filter((e) => e.project_id !== pid);
    db.calcRuns = db.calcRuns.filter((e) => e.project_id !== pid);
    db.quotes = db.quotes.filter((e) => e.project_id !== pid);
    persist();
    return delay(undefined);
  },
  listMembers: () => delay([{ user_id: OFFLINE_USER.id, email: OFFLINE_USER.email, name: OFFLINE_USER.name, role: 'editor' }]),
  listRevisions: (pid) => delay(db.revisions.filter((r) => r.project_id === Number(pid)).sort((a, b) => a.rev_no - b.rev_no)),
  createRevision: async (pid, label, note) => {
    const p = findOr404(db.projects, pid, 'Project');
    const last = Math.max(0, ...db.revisions.filter((r) => r.project_id === p.id).map((r) => r.rev_no));
    const rev: Revision = {
      id: nextId(),
      project_id: p.id,
      rev_no: last + 1,
      label: label || `R${last + 1}`,
      note: note || null,
      created_at: nowIso(),
      snapshot: { project: clone(p), elevations: clone(db.elevations.filter((e) => e.project_id === p.id)) },
    };
    db.revisions.push(rev);
    persist();
    return delay(rev);
  },

  listElevations: (pid) => delay(db.elevations.filter((e) => e.project_id === Number(pid)).sort((a, b) => a.id - b.id)),
  getElevation: async (id) => delay(findOr404(db.elevations, id, 'Elevation')),
  createElevation: async (pid, data) => {
    findOr404(db.projects, pid, 'Project');
    const id = nextId();
    const t = nowIso();
    const rec: ElevationRecord = { id, project_id: Number(pid), name: data.name, data: { ...clone(data), id: String(id) }, version: 1, created_at: t, updated_at: t };
    db.elevations.push(rec);
    persist();
    return delay(rec);
  },
  updateElevation: async (id, data, version) => {
    const rec = findOr404(db.elevations, id, 'Elevation');
    if (rec.version !== version)
      throw new ApiError(409, 'VERSION_CONFLICT', `Elevation was modified elsewhere (current version ${rec.version}, yours ${version}). Reload and re-apply.`);
    rec.data = { ...clone(data), id: String(rec.id) };
    rec.name = data.name;
    rec.version += 1;
    rec.updated_at = nowIso();
    persist();
    return delay(rec);
  },
  deleteElevation: async (id) => {
    findOr404(db.elevations, id, 'Elevation');
    db.elevations = db.elevations.filter((e) => e.id !== Number(id));
    persist();
    return delay(undefined);
  },

  getCatalogue: () => delay(DEMO_CATALOGUE, 0),
  updateCatalogueItem: async () => {
    throw new ApiError(403, 'SERVER_ONLY', 'Catalogue editing requires server mode (audited, versioned).');
  },

  calcStateless: async (req) => delay(calculate(req.elevation, DEMO_CATALOGUE, req.rule_set_id ?? null), 30),
  calculateElevation: async (eid) => {
    const rec = findOr404(db.elevations, eid, 'Elevation');
    const result = calculate(rec.data, DEMO_CATALOGUE);
    const run: CalcRun = { id: nextId(), elevation_id: rec.id, project_id: rec.project_id, result, validation_status: result.validation_status, created_at: nowIso() };
    db.calcRuns.push(run);
    persist();
    return delay(run);
  },
  listCalcRuns: (pid) => delay(db.calcRuns.filter((r) => r.project_id === Number(pid)).sort((a, b) => b.id - a.id)),
  getCalcRun: async (id) => delay(findOr404(db.calcRuns, id, 'Calc run')),

  optimize1D: async (req) => delay(optimize1D(req), 30),
  createCuttingJob: async (projectId, name, request) => {
    const result = optimize1D(request);
    const job: CuttingJob = { id: nextId(), project_id: projectId, name, request, result, status: result.validation_status === 'INVALID' ? 'invalid' : 'completed', validation_status: result.validation_status, created_at: nowIso() };
    db.cuttingJobs.push(job);
    persist();
    return delay(job);
  },
  listCuttingJobs: (pid) => delay(db.cuttingJobs.filter((j) => pid == null || j.project_id === Number(pid)).sort((a, b) => b.id - a.id).map((j) => jobSummary(j, 'cutting'))),
  getCuttingJob: async (id) => delay(findOr404(db.cuttingJobs, id, 'Cutting job')),
  inventoryAsBarStock: async (material) =>
    delay(
      db.inventory
        .filter((i) => i.kind === 'bar' && i.status === 'available' && i.quantity > 0 && i.length && (i.material === material || i.profile_code === material))
        .map<Stock1D>((i) => ({ id: `INV-${i.id}`, label: `${i.is_residual ? 'Offcut' : 'Stock bar'} ${i.length} mm${i.location ? ` @ ${i.location}` : ''}`, length: i.length!, quantity: i.quantity, is_offcut: i.is_residual, priority: i.is_residual ? 1 : 0 })),
    ),

  optimize2D: async (req) => delay(optimize2D(req), 30),
  createNestingJob: async (projectId, name, request) => {
    const result = optimize2D(request);
    const job: NestingJob = { id: nextId(), project_id: projectId, name, request, result, status: result.validation_status === 'INVALID' ? 'invalid' : 'completed', validation_status: result.validation_status, created_at: nowIso() };
    db.nestingJobs.push(job);
    persist();
    return delay(job);
  },
  listNestingJobs: (pid) => delay(db.nestingJobs.filter((j) => pid == null || j.project_id === Number(pid)).sort((a, b) => b.id - a.id).map((j) => jobSummary(j, 'nesting'))),
  getNestingJob: async (id) => delay(findOr404(db.nestingJobs, id, 'Nesting job')),
  importNestingExcel: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'Excel import is parsed by the server; use paste-from-Excel offline.');
  },
  importCuttingExcel: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'Excel import is parsed by the server; use paste-from-Excel offline.');
  },
  downloadTemplate: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'Excel templates are generated by the server.');
  },

  listInventory: (f = {}) =>
    delay(
      db.inventory
        .filter((i) => (!f.kind || i.kind === f.kind) && (f.residual === undefined || i.is_residual === f.residual) && (!f.status || i.status === f.status) && (!f.material || i.material === f.material))
        .sort((a, b) => b.id - a.id),
    ),
  createInventory: async (input) => {
    if (input.kind === 'bar' && !input.length) throw new ApiError(422, 'VALIDATION_ERROR', "Bar inventory requires 'length'");
    if (input.kind === 'sheet' && !(input.width && input.height)) throw new ApiError(422, 'VALIDATION_ERROR', "Sheet inventory requires 'width' and 'height'");
    const it: InventoryItem = { ...input, id: nextId(), status: 'available', source_kind: 'manual', demo: false, created_at: nowIso() };
    db.inventory.push(it);
    persist();
    return delay(it);
  },
  consumeInventory: async (id, quantity) => {
    const it = findOr404(db.inventory, id, 'Inventory item');
    if (it.status === 'consumed' || it.quantity <= 0) throw new ApiError(409, 'ALREADY_CONSUMED', `Inventory item ${id} is already consumed`);
    if (quantity > it.quantity) throw new ApiError(409, 'INSUFFICIENT_QUANTITY', `Only ${it.quantity} available for inventory item ${id}`);
    it.quantity -= quantity;
    if (it.quantity === 0) it.status = 'consumed';
    persist();
    return delay(it);
  },
  residualsFromCutting: async (jobId) => {
    const job = findOr404(db.cuttingJobs, jobId, 'Cutting job');
    if (!job.result) throw new ApiError(400, 'JOB_NOT_OPTIMISED', `cutting job ${jobId} has no result yet`);
    if (job.validation_status === 'INVALID') throw new ApiError(400, 'JOB_INVALID', 'Job failed independent validation; residuals blocked');
    if (db.inventory.some((i) => i.source_kind === 'cutting' && i.source_job_id === job.id)) throw new ApiError(409, 'RESIDUALS_ALREADY_ADDED', `Residuals of cutting job ${job.id} are already in inventory`);
    const agg = new Map<number, number>();
    for (const p of job.result.patterns) if (p.offcut_reusable && p.remainder > 0) agg.set(Math.round(p.remainder * 10) / 10, (agg.get(Math.round(p.remainder * 10) / 10) ?? 0) + p.count);
    const material = job.request.material ?? null;
    const items = [...agg.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([L, q]) => ({ id: nextId(), kind: 'bar' as const, material, profile_code: material, length: L, quantity: q, is_residual: true, source_kind: 'cutting', source_job_id: job.id, status: 'available', demo: true, notes: `Reusable offcut from cutting job ${job.id}`, created_at: nowIso() }));
    db.inventory.push(...items);
    persist();
    return delay(items);
  },
  residualsFromNesting: async (jobId) => {
    const job = findOr404(db.nestingJobs, jobId, 'Nesting job');
    if (!job.result) throw new ApiError(400, 'JOB_NOT_OPTIMISED', `nesting job ${jobId} has no result yet`);
    if (job.validation_status === 'INVALID') throw new ApiError(400, 'JOB_INVALID', 'Job failed independent validation; residuals blocked');
    if (db.inventory.some((i) => i.source_kind === 'nesting' && i.source_job_id === job.id)) throw new ApiError(409, 'RESIDUALS_ALREADY_ADDED', `Residuals of nesting job ${job.id} are already in inventory`);
    const sheets = new Map(job.request.sheets.map((s) => [s.id, s]));
    const agg = new Map<string, { w: number; h: number; m: string | null; t: number | null; q: number }>();
    for (const lay of job.result.layouts) {
      const s = sheets.get(lay.sheet_id);
      for (const r of lay.residuals) {
        if (!r.reusable) continue;
        const w = Math.round(r.width * 10) / 10;
        const h = Math.round(r.height * 10) / 10;
        const k = `${w}|${h}|${s?.material}|${s?.thickness}`;
        const cur = agg.get(k) ?? { w, h, m: s?.material ?? null, t: s?.thickness ?? null, q: 0 };
        cur.q += lay.count;
        agg.set(k, cur);
      }
    }
    const items: InventoryItem[] = [...agg.values()].map((a) => ({ id: nextId(), kind: 'sheet', material: a.m, width: a.w, height: a.h, thickness: a.t, quantity: a.q, is_residual: true, source_kind: 'nesting', source_job_id: job.id, status: 'available', demo: true, notes: `Reusable residual from nesting job ${job.id}`, created_at: nowIso() }));
    db.inventory.push(...items);
    persist();
    return delay(items);
  },

  listQuotes: (pid) => delay(db.quotes.filter((q) => q.project_id === Number(pid)).sort((a, b) => b.id - a.id)),
  createQuote: async (pid, ids, marginPct, notes) => {
    findOr404(db.projects, pid, 'Project');
    if (!ids.length) throw new ApiError(422, 'VALIDATION_ERROR', 'Select at least one calc run');
    const runs = ids.map((id) => findOr404(db.calcRuns, id, 'Calc run'));
    const bad = runs.filter((r) => r.result.validation_status === 'INVALID').map((r) => r.id);
    if (bad.length) throw new ApiError(400, 'CALC_RUN_INVALID', `Calc run(s) ${bad.join(', ')} are INVALID and cannot be quoted`);
    const priced = priceRuns(runs, DEMO_CATALOGUE, marginPct);
    const year = new Date().getFullYear();
    const n = db.quotes.filter((q) => q.number.startsWith(`Q-${year}-`)).length + 1;
    const q: Quote = {
      id: nextId(),
      project_id: Number(pid),
      number: `Q-${year}-${String(n).padStart(4, '0')}-OFFLINE`,
      status: 'draft',
      currency: DEMO_CATALOGUE.currency ?? 'INR',
      calc_run_ids: ids,
      lines: priced.lines,
      subtotal: priced.subtotal,
      margin_pct: marginPct,
      margin_amount: priced.margin_amount,
      total: priced.total,
      validation_status: 'PROVISIONAL_DEMO_RULES',
      provisional: true,
      catalogue_version: DEMO_CATALOGUE.catalogue_version,
      notes: notes || 'Demo prices — not a commercial offer',
      issues: priced.issues,
      created_at: nowIso(),
    };
    db.quotes.push(q);
    persist();
    return delay(q);
  },

  // ---- production (§8.1) --------------------------------------------------------
  listProductionOrders: (pid) => {
    refresh();
    return delay(db.productionOrders.filter((o) => pid == null || o.project_id === Number(pid)).sort((a, b) => b.id - a.id).map(withCounts));
  },
  createProductionOrder: async (input) => {
    const project = findOr404(db.projects, input.project_id, 'Project');
    if (!input.name?.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Work order name is required');
    if (!input.calc_run_ids?.length) throw new ApiError(422, 'VALIDATION_ERROR', 'Select at least one calc run');
    const runs = loadRuns(project.id, input.calc_run_ids);
    const t = nowIso();
    const order: Omit<ProductionOrder, 'counts'> = {
      id: nextId(),
      number: yearSeq('WO', db.productionOrders.map((o) => o.number)),
      project_id: project.id,
      name: input.name.trim(),
      status: 'planned',
      calc_run_ids: [...new Set(input.calc_run_ids)],
      due_date: input.due_date || null,
      notes: input.notes || null,
      provisional: runs.some((r) => r.result.validation_status !== 'VALIDATED'),
      created_by: OFFLINE_USER.id,
      created_at: t,
      updated_at: t,
    };
    const taken = new Set(db.parts.map((p) => p.code));
    const drafts = explodeParts(runs, (r) => db.elevations.find((e) => e.id === r.elevation_id)?.name ?? r.result.elevation.name ?? null, DEMO_CATALOGUE);
    if (!drafts.length) throw new ApiError(400, 'NO_PARTS', 'The calc runs contain no profile cuts or fills to produce');
    const parts: StoredPart[] = drafts.map((d) => ({ ...d, id: nextId(), production_order_id: order.id, code: newPartCode(taken), updated_at: t }));
    db.productionOrders.push(order);
    db.parts.push(...parts);
    persist();
    return delay(withCounts(order));
  },
  getProductionOrder: async (id) => {
    refresh();
    return delay(withCounts(findOr404(db.productionOrders, id, 'Production order')));
  },
  updateProductionOrder: async (id, input) => {
    const o = findOr404(db.productionOrders, id, 'Production order');
    if (input.name !== undefined && !input.name.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Work order name is required');
    // the server accepts any status here (manual override, audited); part events drive the automation
    for (const [k, v] of Object.entries(input)) if (v !== undefined && !(v === null && (k === 'name' || k === 'status'))) (o as Record<string, unknown>)[k] = k === 'name' ? String(v).trim() : v;
    o.updated_at = nowIso();
    persist();
    return delay(withCounts(o));
  },
  listParts: async (orderId, f = {}) => {
    refresh();
    findOr404(db.productionOrders, orderId, 'Production order');
    return delay(
      db.parts
        .filter((p) => p.production_order_id === Number(orderId) && (!f.status || p.status === f.status) && (!f.station || p.current_station === f.station) && (!f.kind || p.kind === f.kind))
        .map(publicPart),
    );
  },
  getBoard: async (orderId) => {
    refresh();
    findOr404(db.productionOrders, orderId, 'Production order');
    return delay(buildBoard(db.parts.filter((p) => p.production_order_id === Number(orderId))));
  },
  getPart: async (code) => {
    refresh();
    const p = partByCode(code);
    const o = findOr404(db.productionOrders, p.production_order_id, 'Production order');
    const pr = db.projects.find((x) => x.id === o.project_id);
    return delay({
      part: publicPart(p),
      order: { id: o.id, number: o.number, name: o.name },
      project: { id: o.project_id, code: pr?.code ?? '—', name: pr?.name ?? '—' },
      events: db.partEvents.filter((e) => e.part_id === p.id).sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id),
    });
  },
  postPartEvent: async (code, input) => {
    refresh();
    const p = partByCode(code);
    const o = findOr404(db.productionOrders, p.production_order_id, 'Production order');
    if (o.status === 'cancelled') throw new ApiError(409, 'INVALID_TRANSITION', `Work order ${o.number} is cancelled`);
    let next: StoredPart;
    try {
      next = applyAction(p, input.station, input.action, input.note);
    } catch (e) {
      if (e instanceof TransitionError) throw new ApiError(e.status, e.code, `${e.message} (${p.code})`);
      throw e;
    }
    const t = nowIso();
    Object.assign(p, next, { updated_at: t });
    db.partEvents.push({ id: nextId(), part_id: p.id, station: input.station, action: input.action, note: input.note?.trim() || null, user_id: OFFLINE_USER.id, user_name: OFFLINE_USER.name, ts: t });
    const st = orderStatusAfter(o.status, input.action, db.parts.filter((x) => x.production_order_id === o.id));
    if (st !== o.status) {
      o.status = st;
      o.updated_at = t;
    }
    persist();
    return delay(publicPart(p));
  },

  // ---- purchasing (§8.2) ---------------------------------------------------------
  listPurchaseOrders: (pid) => delay(db.purchaseOrders.filter((o) => pid == null || o.project_id === Number(pid)).sort((a, b) => b.id - a.id)),
  getPurchaseOrder: async (id) => delay(findOr404(db.purchaseOrders, id, 'Purchase order')),
  purchaseOrdersFromCalc: async (pid, input) => {
    const project = findOr404(db.projects, pid, 'Project');
    if (!input.calc_run_ids?.length) throw new ApiError(422, 'VALIDATION_ERROR', 'Select at least one calc run');
    const runs = loadRuns(project.id, input.calc_run_ids);
    const jobIds = [...new Set(input.cutting_job_ids ?? [])];
    const jobs = jobIds.map((id) => {
      const j = db.cuttingJobs.find((x) => x.id === Number(id) && x.project_id === project.id);
      if (!j) throw new ApiError(404, 'CUTTING_JOB_NOT_FOUND', `Cutting job(s) [${id}] not found in project ${project.id}`);
      if (!j.result) throw new ApiError(400, 'JOB_NOT_OPTIMISED', `Cutting job ${j.id} has no result yet`);
      if (j.validation_status === 'INVALID') throw new ApiError(400, 'JOB_INVALID', `Cutting job ${j.id} failed independent validation`);
      return j;
    });
    const groups = splitLines(buildPurchaseLines(runs, jobs, db.inventory, DEMO_CATALOGUE), input.split_by_category ?? true);
    if (!groups.length) throw new ApiError(400, 'NOTHING_TO_ORDER', 'The calc runs have no BOM lines');
    const t = nowIso();
    const pos: PurchaseOrder[] = groups.map((g) => {
      const { lines, total } = recompute(g.lines);
      const po: PurchaseOrder = {
        id: nextId(),
        number: yearSeq('PO', db.purchaseOrders.map((o) => o.number)),
        project_id: project.id,
        supplier: 'To be assigned',
        category: g.category,
        status: 'draft',
        currency: DEMO_CATALOGUE.currency ?? 'INR',
        lines,
        total,
        provisional: true,
        notes: DEMO_NOTE,
        calc_run_ids: runs.map((r) => r.id),
        cutting_job_ids: jobs.map((j) => j.id),
        catalogue_version: DEMO_CATALOGUE.catalogue_version,
        created_by: OFFLINE_USER.id,
        created_at: t,
        updated_at: t,
      };
      db.purchaseOrders.push(po);
      return po;
    });
    persist();
    return delay(pos);
  },
  updatePurchaseOrder: async (id, input) => {
    const po = findOr404(db.purchaseOrders, id, 'Purchase order');
    const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null)) as typeof input;
    if (changes.status === 'received') throw new ApiError(409, 'INVALID_TRANSITION', 'Use “Mark received” (receive) to book the quantities into inventory');
    if ((po.status === 'received' || po.status === 'cancelled') && Object.keys(changes).some((k) => k !== 'notes'))
      throw new ApiError(409, 'INVALID_TRANSITION', `Purchase order ${po.number} is ${po.status}; only notes can change`);
    if (changes.supplier !== undefined && !changes.supplier.trim()) throw new ApiError(422, 'VALIDATION_ERROR', 'Supplier must not be empty');
    if (changes.lines) {
      for (const l of changes.lines) if (!(Number(l.qty_to_order) >= 0)) throw new ApiError(422, 'VALIDATION_ERROR', `Quantity for ${l.code} must be ≥ 0`);
      const r = recompute(changes.lines.map((l) => ({ ...l, qty_to_order: Number(l.qty_to_order) })));
      po.lines = r.lines;
      po.total = r.total;
    }
    if (changes.supplier !== undefined) po.supplier = changes.supplier.trim();
    if (changes.notes != null) po.notes = changes.notes.includes(DEMO_NOTE) ? changes.notes : `${DEMO_NOTE}\n${changes.notes}`;
    if (changes.status) po.status = changes.status;
    po.updated_at = nowIso();
    persist();
    return delay(po);
  },
  receivePurchaseOrder: async (id) => {
    const po = findOr404(db.purchaseOrders, id, 'Purchase order');
    if (po.status !== 'draft' && po.status !== 'sent') throw new ApiError(409, 'INVALID_TRANSITION', `Purchase order ${po.number} is ${po.status}; only draft/sent orders can be received`);
    const t = nowIso();
    for (const it of receiptItems(po)) db.inventory.push({ ...it, id: nextId(), source_job_id: po.id, location: 'Goods-in', created_at: t });
    po.status = 'received';
    po.received_at = t;
    po.updated_at = t;
    persist();
    return delay(po);
  },

  exportDxf: async (elevation) => delay(elevationToDxf(elevation, DEMO_CATALOGUE), 0),

  downloadReport: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'PDF/XLSX reports are rendered by the server.');
  },

  listUsers: () => delay([OFFLINE_USER]),
  createUser: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'User administration requires server mode.');
  },
  updateUser: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'User administration requires server mode.');
  },
  listAudit: async () => {
    throw new ApiError(501, 'SERVER_ONLY', 'The audit trail is recorded by the server only.');
  },
};
