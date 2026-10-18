/**
 * Purchasing — pure logic (ARCHITECTURE §8.2), TS port of backend/app/services/purchasing.py for offline mode.
 * DEMO prices → every PO is provisional. Server results are authoritative.
 *
 * Quantities
 * - profiles: whole bars per (profile code, stock length). With cutting jobs: Σ pattern.count per stock length of
 *   non-inventory stock (bars cut from INV-<id> stock are already in stock). Without: estimate
 *   ceil(total cut length / longest catalogue stock length) — note "estimate, run cutting for exact bars".
 * - glass / panels: m² (required = BOM area), ordered in whole m² (rounded up).
 * - accessories: catalogue unit (pcs / m), ordered rounded up to whole units.
 * - qty_in_stock = available non-residual inventory of the same code (bars: same length ±0.5 mm; m²: sheet areas +
 *   m² items; accessories: items in the same unit). qty_to_order = max(0, required − in stock), rounded up.
 */
import type { CalcRun, Catalogue, CatProfile, CuttingJob, InventoryItem, PurchaseCategory, PurchaseOrderLine } from '../api/types';
import { getAccessory, getGlassType, getPanelType, getProfile } from './catalogue';

export const DEMO_NOTE = 'Demo prices — not a commercial offer';
export const ESTIMATE_NOTE = 'estimate, run cutting for exact bars';
const LEN_TOL = 0.5;

const r2 = (x: number) => Math.round((x + 0) * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const ceilQ = (x: number) => (x > 0 ? Math.ceil(x - 1e-9) : 0);
/** Python `:g` for lengths. */
const g = (v: number) => String(Number(v.toPrecision(6)));
const grouped2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function lineCategory(itemType: string): Exclude<PurchaseCategory, 'mixed'> {
  if (itemType === 'profile') return 'profiles';
  if (itemType === 'glass' || itemType === 'panel') return 'glass';
  return 'accessories';
}

const avail = (inv: InventoryItem[], kind: InventoryItem['kind']) => inv.filter((i) => i.kind === kind && i.status === 'available' && !i.is_residual && i.quantity > 0);

export function stockBars(inv: InventoryItem[], code: string, length: number): number {
  return avail(inv, 'bar')
    .filter((i) => (i.profile_code === code || i.material === code) && i.length && Math.abs(i.length - length) <= LEN_TOL)
    .reduce((a, i) => a + i.quantity, 0);
}

export function stockAreaM2(inv: InventoryItem[], code: string): number {
  let a = 0;
  for (const i of avail(inv, 'sheet')) if (i.material === code && i.width && i.height) a += ((i.width * i.height) / 1e6) * i.quantity;
  for (const i of avail(inv, 'item')) if (i.material === code && i.unit === 'm2') a += i.quantity;
  return a;
}

export function stockItems(inv: InventoryItem[], code: string, unit: string): number {
  return avail(inv, 'item')
    .filter((i) => i.material === code && i.unit === unit)
    .reduce((a, i) => a + i.quantity, 0);
}

function profileLine(inv: InventoryItem[], prof: CatProfile | null, code: string, L: number, bars: number, note: string): PurchaseOrderLine {
  const have = stockBars(inv, code, L);
  const order = Math.max(0, bars - have);
  const ppm = prof?.price_per_m;
  const unitPrice = ppm != null ? r2((Number(ppm) * L) / 1000) : 0;
  return {
    item_type: 'profile',
    item_id: prof?.id ?? '',
    code,
    description: `${prof?.name ?? code} — bar ${g(L)} mm`,
    unit: 'bar',
    qty_required: bars,
    qty_in_stock: have,
    qty_to_order: order,
    unit_price: unitPrice,
    amount: r2(order * unitPrice),
    stock_length: L,
    note: ppm != null ? note : `${note}; no demo price`,
  };
}

/** Lines in backend order: job-based profile bars, estimated profile bars, then glass/panels/accessories (BOM order). */
export function buildPurchaseLines(runs: CalcRun[], jobs: CuttingJob[], inv: InventoryItem[], cat: Catalogue): PurchaseOrderLine[] {
  const bom = new Map<string, { item_type: string; item_id: string; code: string; description: string; unit: string; quantity: number }>();
  for (const run of runs)
    for (const b of run.result.bom) {
      const k = `${b.item_type}|${b.item_id}|${b.unit}`;
      const d = bom.get(k) ?? { item_type: b.item_type, item_id: b.item_id, code: b.code, description: b.description.split(' (bar lower-bound')[0], unit: b.unit, quantity: 0 };
      d.quantity += b.quantity;
      bom.set(k, d);
    }
  const lines: PurchaseOrderLine[] = [];
  // bars from cutting jobs (non-inventory stock only)
  const jobBars = new Map<string, { code: string; L: number; bars: number; jobs: number[] }>();
  for (const job of jobs) {
    if (!job.result) continue;
    const code = job.result.request?.material || job.request.material || `job-${job.id}`;
    for (const p of job.result.patterns) {
      if (p.is_offcut_stock || p.stock_id.startsWith('INV-')) continue;
      const k = `${code}|${p.stock_length}`;
      const d = jobBars.get(k) ?? { code, L: p.stock_length, bars: 0, jobs: [] };
      d.bars += p.count;
      if (!d.jobs.includes(job.id)) d.jobs.push(job.id);
      jobBars.set(k, d);
    }
  }
  const covered = new Set([...jobBars.values()].map((d) => d.code));
  for (const d of jobBars.values()) {
    const prof = cat.profiles.find((p) => p.code === d.code) ?? null;
    lines.push(profileLine(inv, prof, d.code, d.L, d.bars, `from cutting job(s) ${d.jobs.join(', ')}`));
  }
  for (const d of bom.values()) {
    if (d.item_type !== 'profile' || covered.has(d.code)) continue;
    const prof = getProfile(cat, d.item_id);
    const lengths = (prof?.stock_lengths ?? []).map(Number);
    const totalMm = d.quantity * (d.unit === 'm' ? 1000 : 1);
    if (!lengths.length) {
      lines.push({ item_type: 'profile', item_id: d.item_id, code: d.code, description: d.description, unit: 'bar', qty_required: 0, qty_in_stock: 0, qty_to_order: 0, unit_price: 0, amount: 0, stock_length: null, note: 'no stock lengths in catalogue — quantity not computed' });
      continue;
    }
    const L = Math.max(...lengths);
    lines.push(profileLine(inv, prof, d.code, L, ceilQ(totalMm / L), `${ESTIMATE_NOTE} (total ${grouped2(totalMm / 1000)} m / ${g(L)} mm bars)`));
  }
  for (const d of bom.values()) {
    if (d.item_type === 'profile') continue;
    const req = r4(d.quantity);
    let price: number | null | undefined;
    let have: number;
    let note: string | null;
    if (d.item_type === 'glass' || d.item_type === 'panel') {
      price = d.item_type === 'glass' ? getGlassType(cat, d.item_id)?.price_per_m2 : getPanelType(cat, d.item_id)?.price_per_m2;
      have = r4(stockAreaM2(inv, d.code));
      note = 'ordered in whole m² (demo)';
    } else {
      price = getAccessory(cat, d.item_id)?.price;
      have = stockItems(inv, d.code, d.unit);
      note = null;
    }
    const order = ceilQ(Math.max(0, req - have));
    lines.push({
      item_type: d.item_type,
      item_id: d.item_id,
      code: d.code,
      description: d.description,
      unit: d.unit,
      qty_required: req,
      qty_in_stock: have,
      qty_to_order: order,
      unit_price: price != null ? Number(price) : 0,
      amount: r2(order * Number(price ?? 0)),
      stock_length: null,
      note: price != null ? note : `${note ? `${note}; ` : ''}no demo price`,
    });
  }
  return lines;
}

/** Re-number lines and recompute amounts/total (also used after manual edits). */
export function recompute(lines: PurchaseOrderLine[]): { lines: PurchaseOrderLine[]; total: number } {
  const out = lines.map((l, i) => ({ ...l, line_no: i + 1, amount: r2(Number(l.qty_to_order || 0) * Number(l.unit_price || 0)) }));
  return { lines: out, total: r2(out.reduce((a, l) => a + l.amount, 0)) };
}

/** Group lines into purchase orders (one per category when `split`, else one "mixed"). Empty groups are dropped. */
export function splitLines(lines: PurchaseOrderLine[], split: boolean): { category: PurchaseCategory; lines: PurchaseOrderLine[] }[] {
  const out: { category: PurchaseCategory; lines: PurchaseOrderLine[] }[] = [];
  for (const c of ['profiles', 'glass', 'accessories'] as const) {
    const sel = lines.filter((x) => lineCategory(x.item_type) === c);
    if (!sel.length) continue;
    if (split) out.push({ category: c, lines: sel });
    else if (out.length) out[0].lines.push(...sel);
    else out.push({ category: 'mixed', lines: [...sel] });
  }
  return out;
}

/** Inventory records booked when a PO is received (bars for profiles, counted items otherwise). */
export function receiptItems(po: { number: string; lines: PurchaseOrderLine[] }): Omit<InventoryItem, 'id' | 'created_at'>[] {
  const out: Omit<InventoryItem, 'id' | 'created_at'>[] = [];
  po.lines.forEach((l, i) => {
    const q = ceilQ(Number(l.qty_to_order || 0));
    if (q <= 0) return;
    const base = { is_residual: false, status: 'available', source_kind: 'purchase', demo: true, notes: `Received on ${po.number} line ${l.line_no ?? i + 1}`, quantity: q };
    if (l.item_type === 'profile') {
      if (!l.stock_length) return;
      out.push({ ...base, kind: 'bar', material: l.code, profile_code: l.code, length: Number(l.stock_length) });
    } else out.push({ ...base, kind: 'item', material: l.code, unit: l.unit });
  });
  return out;
}

/** CSV export of a PO (offline download). RFC 4180 quoting. */
export function purchaseOrderCsv(po: { number: string; supplier: string; currency: string; status: string; lines: PurchaseOrderLine[]; total: number }): string {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: unknown[][] = [
    ['Purchase order', po.number],
    ['Supplier', po.supplier],
    ['Status', po.status],
    ['Note', DEMO_NOTE],
    [],
    ['Line', 'Code', 'Description', 'Unit', 'Bar length (mm)', 'Required', 'In stock', 'To order', `Unit price (${po.currency})`, `Amount (${po.currency})`, 'Note'],
    ...po.lines.map((l, i) => [l.line_no ?? i + 1, l.code, l.description, l.unit, l.stock_length ?? '', l.qty_required, l.qty_in_stock, l.qty_to_order, l.unit_price, l.amount, l.note ?? '']),
    [],
    ['', '', '', '', '', '', '', '', 'Total', po.total],
  ];
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
