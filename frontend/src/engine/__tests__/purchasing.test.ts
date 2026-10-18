import { describe, expect, it } from 'vitest';
import type { CalcRun, CuttingJob, InventoryItem, PurchaseOrderLine } from '../../api/types';
import { calculate } from '../calc';
import { DEMO_CATALOGUE, getProfile } from '../catalogue';
import { optimize1D } from '../cutting1d';
import { makeGrid } from '../elevation';
import { buildPurchaseLines, ESTIMATE_NOTE, purchaseOrderCsv, receiptItems, recompute, splitLines, stockAreaM2, stockBars, stockItems } from '../purchasing';

const e = makeGrid(4500, 3600, 3, 2, { name: 'P', system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24', colour_id: 'col-ral7016', anchor_levels: [0, 3600] });
const run: CalcRun = { id: 1, elevation_id: 1, project_id: 1, result: calculate(e, DEMO_CATALOGUE) };
const inv = (i: Partial<InventoryItem>): InventoryItem => ({ id: 1, kind: 'bar', quantity: 1, is_residual: false, status: 'available', ...i });
const M = 'DEMO-CW50-M150';
const mBom = run.result.bom.find((b) => b.code === M)!;
const L = Math.max(...getProfile(DEMO_CATALOGUE, mBom.item_id)!.stock_lengths);
const lineOf = (lines: PurchaseOrderLine[], code: string) => lines.find((l) => l.code === code)!;

describe('purchasing math (port of services/purchasing.py)', () => {
  it('profiles: bars estimated from total length ÷ longest stock length', () => {
    const l = lineOf(buildPurchaseLines([run], [], [], DEMO_CATALOGUE), M);
    expect(l).toMatchObject({ unit: 'bar', stock_length: L, qty_required: Math.ceil((mBom.quantity * 1000) / L), qty_in_stock: 0 });
    expect(l.qty_to_order).toBe(l.qty_required);
    expect(l.note!.startsWith(ESTIMATE_NOTE)).toBe(true);
    expect(l.unit_price).toBeCloseTo((getProfile(DEMO_CATALOGUE, mBom.item_id)!.price_per_m! * L) / 1000, 2);
    expect(l.amount).toBeCloseTo(l.qty_to_order * l.unit_price, 2);
    expect(l.description).toBe(`${getProfile(DEMO_CATALOGUE, mBom.item_id)!.name} — bar ${L} mm`);
  });
  it('subtracts available non-residual stock of the same code and bar length; never negative', () => {
    const base = lineOf(buildPurchaseLines([run], [], [], DEMO_CATALOGUE), M);
    const stock = [
      inv({ profile_code: M, material: M, length: L, quantity: 2 }),
      inv({ profile_code: M, length: L, quantity: 5, is_residual: true }), // residual: ignored
      inv({ profile_code: M, length: L, quantity: 9, status: 'consumed' }), // not available
      inv({ profile_code: M, length: L - 500, quantity: 7 }), // other bar length
      inv({ profile_code: 'OTHER', length: L, quantity: 50 }),
    ];
    expect(stockBars(stock, M, L)).toBe(2);
    expect(stockBars(stock, M, L + 0.4)).toBe(2); // ±0.5 mm tolerance
    const l = lineOf(buildPurchaseLines([run], [], stock, DEMO_CATALOGUE), M);
    expect(l.qty_in_stock).toBe(2);
    expect(l.qty_to_order).toBe(base.qty_required - 2);
    expect(l.amount).toBeCloseTo((base.qty_required - 2) * l.unit_price, 2);
    const lots = lineOf(buildPurchaseLines([run], [], [inv({ profile_code: M, length: L, quantity: 500 })], DEMO_CATALOGUE), M);
    expect(lots.qty_to_order).toBe(0);
    expect(lots.amount).toBe(0);
  });
  it('glass in m² net of sheet area + m² items; ordered in whole m²', () => {
    const stock = [inv({ kind: 'sheet', material: 'DEMO-GL-D24', width: 2000, height: 1000, quantity: 2 }), inv({ kind: 'item', material: 'DEMO-GL-D24', unit: 'm2', quantity: 1.5 })];
    expect(stockAreaM2(stock, 'DEMO-GL-D24')).toBeCloseTo(5.5, 9);
    const g = buildPurchaseLines([run], [], stock, DEMO_CATALOGUE).find((l) => l.item_type === 'glass')!;
    expect(g.unit).toBe('m2');
    expect(g.qty_required).toBeCloseTo(run.result.totals.glass_area_m2, 4);
    expect(g.qty_in_stock).toBeCloseTo(5.5, 6);
    expect(g.qty_to_order).toBe(Math.ceil(g.qty_required - 5.5));
    expect(g.note).toBe('ordered in whole m² (demo)');
  });
  it('accessories in their unit, net of items in the same unit, rounded up', () => {
    const lines = buildPurchaseLines([run], [], [inv({ kind: 'item', material: 'DEMO-CW50-BRK', unit: 'pcs', quantity: 3 }), inv({ kind: 'item', material: 'DEMO-CW50-BRK', unit: 'm', quantity: 99 })], DEMO_CATALOGUE);
    const brk = lineOf(lines, 'DEMO-CW50-BRK');
    expect(brk.unit).toBe('pcs');
    expect(brk.qty_in_stock).toBe(3);
    expect(brk.qty_to_order).toBe(Math.max(0, Math.ceil(brk.qty_required - 3)));
    const gsk = lineOf(lines, 'DEMO-CW50-GSK');
    expect(gsk.unit).toBe('m');
    expect(Number.isInteger(gsk.qty_to_order)).toBe(true);
    expect(stockItems([inv({ kind: 'item', material: 'X', unit: 'pcs', quantity: 3, is_residual: true })], 'X', 'pcs')).toBe(0);
  });
  it('exact bars per stock length from cutting jobs (inventory stock excluded); covered codes are not estimated', () => {
    const cuts = run.result.profile_cuts.filter((c) => c.profile_code === M);
    const req = { material: M, kerf: 4, stocks: [{ id: 'S6000', length: 6000 }, { id: 'S6500', length: 6500 }, { id: 'INV-31', length: 6000, quantity: 1 }], pieces: cuts.map((c) => ({ id: c.mark, length: c.length, quantity: c.quantity })) };
    const result = optimize1D(req);
    const job: CuttingJob = { id: 9, name: 'j', request: req, result, validation_status: result.validation_status };
    const lines = buildPurchaseLines([run], [job], [inv({ profile_code: M, length: 6000, quantity: 1 })], DEMO_CATALOGUE).filter((l) => l.code === M);
    const bars = result.patterns.filter((p) => !p.stock_id.startsWith('INV-')).reduce((a, p) => a + p.count, 0);
    expect(lines.reduce((a, l) => a + l.qty_required, 0)).toBe(bars);
    expect(lines.every((l) => l.note === 'from cutting job(s) 9')).toBe(true);
    for (const l of lines) expect(l.qty_in_stock).toBe(l.stock_length === 6000 ? 1 : 0);
  });
  it('recompute numbers lines and sums amounts', () => {
    const { lines, total } = recompute([
      { item_type: 'bracket', item_id: 'x', code: 'X', description: '', unit: 'pcs', qty_required: 10, qty_in_stock: 3, qty_to_order: 8, unit_price: 2.5, amount: 0 },
      { item_type: 'bracket', item_id: 'y', code: 'Y', description: '', unit: 'pcs', qty_required: 1, qty_in_stock: 0, qty_to_order: 3, unit_price: 0.105, amount: 0 },
    ]);
    expect(lines.map((l) => [l.line_no, l.amount])).toEqual([[1, 20], [2, 0.32]]);
    expect(total).toBe(20.32);
  });
  it('split by category (or one mixed PO)', () => {
    const lines = buildPurchaseLines([run], [], [], DEMO_CATALOGUE);
    expect(splitLines(lines, true).map((g) => g.category)).toEqual(['profiles', 'glass', 'accessories']);
    const mixed = splitLines(lines, false);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].category).toBe('mixed');
    expect(mixed[0].lines).toHaveLength(lines.length);
    expect(splitLines([], true)).toEqual([]);
  });
  it('receipt books bars for profiles and counted items otherwise (whole units)', () => {
    const lines = buildPurchaseLines([run], [], [], DEMO_CATALOGUE);
    const items = receiptItems({ number: 'PO-1', lines: recompute(lines).lines });
    const bar = items.find((i) => i.material === M)!;
    expect(bar).toMatchObject({ kind: 'bar', profile_code: M, length: L, is_residual: false, status: 'available', source_kind: 'purchase' });
    const glass = items.find((i) => i.material === 'DEMO-GL-D24')!;
    expect(glass).toMatchObject({ kind: 'item', unit: 'm2' });
    expect(Number.isInteger(glass.quantity)).toBe(true);
    // received stock is then subtracted from a new requirement
    const after = buildPurchaseLines([run], [], items.map((x, i) => ({ ...x, id: i + 1 })), DEMO_CATALOGUE);
    expect(after.every((l) => l.qty_to_order === 0)).toBe(true);
  });
  it('CSV export quotes fields and carries the demo note', () => {
    const csv = purchaseOrderCsv({ number: 'PO-1', supplier: 'A, "B"', currency: 'INR', status: 'draft', lines: [], total: 0 });
    expect(csv).toContain('Supplier,"A, ""B"""');
    expect(csv).toContain('Demo prices — not a commercial offer');
  });
});
