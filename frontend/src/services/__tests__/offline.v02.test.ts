import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { makeGrid } from '../../engine/elevation';
import { isPartCode } from '../../engine/production';
import { offlineBackend as be, resetOfflineData } from '../offlineBackend';

const expectApiError = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
  expect((e as ApiError).code).toBe(code);
};

describe('offline backend — production (§8.1)', () => {
  beforeEach(() => resetOfflineData());

  it('creates a work order with one part per physical piece and walks a part through its route', async () => {
    const run = await be.calculateElevation(21); // E01 — Lobby screen, quantity 2
    const pieces = run.result.profile_cuts.reduce((a, c) => a + c.quantity, 0) + run.result.glass_items.reduce((a, g) => a + g.quantity, 0);
    const wo = await be.createProductionOrder({ project_id: 2, name: 'Lobby batch', calc_run_ids: [run.id] });
    expect(wo.number).toMatch(/^WO-\d{4}-0001$/);
    expect(wo.status).toBe('planned');
    expect(wo.counts).toEqual({ total: pieces, pending: pieces, in_progress: 0, done: 0, blocked: 0 });
    const parts = await be.listParts(wo.id);
    expect(parts).toHaveLength(pieces);
    expect(new Set(parts.map((p) => p.code)).size).toBe(pieces);
    expect(parts.every((p) => isPartCode(p.code))).toBe(true);
    expect(await be.listParts(wo.id, { kind: 'glass' })).toHaveLength(run.result.glass_items.reduce((a, g) => a + g.quantity, 0));

    const glass = parts.find((p) => p.kind === 'glass')!;
    // invalid: wrong station, complete-before-anything is allowed (implicit start) but start twice is not
    await expectApiError(be.postPartEvent(glass.code, { station: 'cutting', action: 'start' }), 409, 'INVALID_TRANSITION');
    await expectApiError(be.postPartEvent(glass.code, { station: 'receiving', action: 'block' }), 422, 'NOTE_REQUIRED');
    let p = await be.postPartEvent(glass.code, { station: 'receiving', action: 'start' });
    expect(p.status).toBe('in_progress');
    expect((await be.getProductionOrder(wo.id)).status).toBe('in_progress');
    await expectApiError(be.postPartEvent(glass.code, { station: 'receiving', action: 'start' }), 409, 'INVALID_TRANSITION');
    p = await be.postPartEvent(glass.code, { station: 'receiving', action: 'complete' });
    expect(p).toMatchObject({ current_station: 'glazing', status: 'pending', station_index: 1 });
    p = await be.postPartEvent(glass.code.toLowerCase(), { station: 'glazing', action: 'block', note: 'chipped edge' });
    expect(p.status).toBe('blocked');
    await expectApiError(be.postPartEvent(glass.code, { station: 'glazing', action: 'complete' }), 409, 'INVALID_TRANSITION');
    p = await be.postPartEvent(glass.code, { station: 'glazing', action: 'unblock' });
    expect(p.status).toBe('pending');
    for (const st of ['glazing', 'qc', 'dispatch']) p = await be.postPartEvent(glass.code, { station: st, action: 'complete' });
    expect(p).toMatchObject({ status: 'done', current_station: null });
    await expectApiError(be.postPartEvent(glass.code, { station: 'dispatch', action: 'start' }), 409, 'INVALID_TRANSITION');

    const detail = await be.getPart(glass.code);
    expect(detail.events.map((e) => e.action)).toEqual(['start', 'complete', 'block', 'unblock', 'complete', 'complete', 'complete']);
    expect(detail.events[2].note).toBe('chipped edge');
    expect(detail.order.number).toBe(wo.number);
    expect(detail.project.code).toBe('DEMO-RES-07');

    const board = await be.getBoard(wo.id);
    const by = Object.fromEntries(board.stations.map((s) => [s.id, s]));
    expect(by.dispatch.done_here).toBe(1);
    expect(board.counts.done).toBe(1);
    await expectApiError(be.getPart('ZZZZZZZZ'), 404, 'NOT_FOUND');
  });

  it('completing every part finishes the order; cancelled orders refuse scans', { timeout: 30_000 }, async () => {
    const small = await be.createElevation(2, makeGrid(1200, 2400, 1, 1, { name: 'Small', system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24', colour_id: 'col-ral7016', anchor_levels: [0, 2400] }));
    const run = await be.calculateElevation(small.id);
    const wo = await be.createProductionOrder({ project_id: 2, name: 'All', calc_run_ids: [run.id] });
    for (const part of await be.listParts(wo.id)) for (const st of part.route) await be.postPartEvent(part.code, { station: st, action: 'complete' });
    expect((await be.getProductionOrder(wo.id)).status).toBe('done');
    const wo2 = await be.createProductionOrder({ project_id: 2, name: 'Cancel me', calc_run_ids: [run.id] });
    expect(wo2.number).toMatch(/-0002$/);
    await be.updateProductionOrder(wo2.id, { status: 'cancelled' });
    const part = (await be.listParts(wo2.id))[0];
    await expectApiError(be.postPartEvent(part.code, { station: part.current_station!, action: 'start' }), 409, 'INVALID_TRANSITION');
  });

  it('validates work-order input', async () => {
    await expectApiError(be.createProductionOrder({ project_id: 2, name: 'x', calc_run_ids: [] }), 422, 'VALIDATION_ERROR');
    const run = await be.calculateElevation(11); // project 1
    await expectApiError(be.createProductionOrder({ project_id: 2, name: 'x', calc_run_ids: [run.id] }), 404, 'CALC_RUN_NOT_FOUND');
  });
});

describe('offline backend — purchasing (§8.2)', () => {
  beforeEach(() => resetOfflineData());

  it('generates split POs, edits, receives into stock, and the next PO subtracts it', async () => {
    const run = await be.calculateElevation(21);
    const pos = await be.purchaseOrdersFromCalc(2, { calc_run_ids: [run.id], split_by_category: true });
    expect(pos.map((p) => p.category)).toEqual(['profiles', 'glass', 'accessories']);
    expect(pos.every((p) => p.provisional && p.status === 'draft' && p.supplier === 'To be assigned')).toBe(true);
    for (const p of pos) expect(p.total).toBeCloseTo(p.lines.reduce((a, l) => a + l.amount, 0), 2);

    const prof = pos[0];
    const edited = await be.updatePurchaseOrder(prof.id, { supplier: 'Demo Extrusions', lines: prof.lines.map((l, i) => ({ ...l, qty_to_order: i === 0 ? l.qty_to_order + 1 : l.qty_to_order })) });
    expect(edited.supplier).toBe('Demo Extrusions');
    expect(edited.total).toBeCloseTo(prof.total + prof.lines[0].unit_price, 2);
    await expectApiError(be.updatePurchaseOrder(prof.id, { status: 'received' }), 409, 'INVALID_TRANSITION');
    expect((await be.updatePurchaseOrder(prof.id, { status: 'sent' })).status).toBe('sent');

    const before = (await be.listInventory({ kind: 'bar' })).length;
    const rec = await be.receivePurchaseOrder(prof.id);
    expect(rec.status).toBe('received');
    expect((await be.listInventory({ kind: 'bar' })).length).toBe(before + edited.lines.filter((l) => l.qty_to_order > 0).length);
    await expectApiError(be.receivePurchaseOrder(prof.id), 409, 'INVALID_TRANSITION');
    await expectApiError(be.updatePurchaseOrder(prof.id, { supplier: 'x' }), 409, 'INVALID_TRANSITION');
    await be.receivePurchaseOrder(pos[1].id);
    await be.receivePurchaseOrder(pos[2].id);
    expect((await be.listInventory({ kind: 'item' })).length).toBeGreaterThan(0);

    const again = await be.purchaseOrdersFromCalc(2, { calc_run_ids: [run.id], split_by_category: false });
    expect(again).toHaveLength(1);
    expect(again[0].category).toBe('mixed');
    expect(again[0].number).toMatch(/-0004$/);
    expect(again[0].lines.every((l) => l.qty_to_order === 0)).toBe(true);
    expect(again[0].lines.every((l) => l.qty_in_stock >= l.qty_required)).toBe(true);
    expect(again[0].total).toBe(0);
  });
});

describe('offline backend — DXF (§8.4)', () => {
  it('exports the elevation as R12 DXF text', async () => {
    const rec = await be.getElevation(11);
    const dxf = await be.exportDxf(rec.data);
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER\n')).toBe(true);
    expect(dxf.endsWith('0\nEOF\n')).toBe(true);
  });
});
