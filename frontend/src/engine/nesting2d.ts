/**
 * Offline 2D rectangular nesting heuristic (port of backend/app/engines/nesting2d.py).
 * Semantics (ARCHITECTURE §4): usable = sheet − edge trims; kerf = min clear gap between pieces;
 * rotation 90° only when can_rotate; guillotine=true → edge-to-edge producible layouts.
 * Kerf via inflation: pieces packed as (w+k)×(h+k) into a usable region enlarged by k (right & top).
 */
import type { Issue, Nesting2DRequest, Nesting2DResult, Piece2D, Placement2D, Residual2D, Sheet2D, SheetLayout } from '../api/types';
import { validate2D } from './validate2d';

export const NESTING_ENGINE_VERSION = 'nesting2d/0.1.0+ts-offline';
const EPS = 1e-6;
type Rect = [number, number, number, number];

export type Req2D = Required<Pick<Nesting2DRequest, 'kerf' | 'edge_trim' | 'guillotine' | 'min_residual_width' | 'min_residual_height' | 'prefer_residuals' | 'time_limit_s'>> &
  Nesting2DRequest;

export function normalize2D(req: Nesting2DRequest): Req2D {
  return {
    units: 'mm',
    kerf: req.kerf ?? 3,
    edge_trim: { left: 0, right: 0, top: 0, bottom: 0, ...(req.edge_trim ?? {}) },
    guillotine: req.guillotine ?? true,
    min_residual_width: req.min_residual_width ?? 300,
    min_residual_height: req.min_residual_height ?? 300,
    prefer_residuals: req.prefer_residuals ?? true,
    time_limit_s: req.time_limit_s ?? 10,
    sheets: req.sheets.map((s) => ({ label: null, quantity: null, material: null, thickness: null, is_residual: false, cost_per_sheet: null, ...s })),
    pieces: req.pieces.map((p) => ({ label: null, material: null, thickness: null, can_rotate: true, ...p })),
  };
}

const norm = (s?: string | null) => (typeof s === 'string' && s.trim() ? s.trim().toLowerCase() : null);

function compatible(p: Piece2D, s: Sheet2D): boolean {
  const pm = norm(p.material);
  const sm = norm(s.material);
  if (pm && sm && pm !== sm) return false;
  if (p.thickness != null && s.thickness != null && Math.abs(p.thickness - s.thickness) > EPS) return false;
  return true;
}

interface Bin {
  find(w: number, h: number): [number, number] | null;
  place(i: number, w: number, h: number): [number, number];
  freeRects(): Rect[];
}

class GuillotineBin implements Bin {
  free: Rect[];
  constructor(
    region: Rect,
    private split: string,
  ) {
    this.free = region[2] > EPS && region[3] > EPS ? [region] : [];
  }
  find(w: number, h: number): [number, number] | null {
    let best: [number, number] | null = null;
    this.free.forEach(([, , fw, fh], i) => {
      if (fw + EPS >= w && fh + EPS >= h) {
        const score = fw * fh - w * h;
        if (best === null || score < best[0] - EPS) best = [score, i];
      }
    });
    return best;
  }
  place(i: number, w: number, h: number): [number, number] {
    const [fx, fy, fw, fh] = this.free.splice(i, 1)[0];
    const dw = fw - w;
    const dh = fh - h;
    const horizontal = this.split === 'slas' ? dw < dh : fw * dh >= dw * fh;
    const top: Rect = horizontal ? [fx, fy + h, fw, dh] : [fx, fy + h, w, dh];
    const right: Rect = horizontal ? [fx + w, fy, dw, h] : [fx + w, fy, dw, fh];
    for (const r of [top, right]) if (r[2] > EPS && r[3] > EPS) this.free.push(r);
    return [fx, fy];
  }
  freeRects(): Rect[] {
    return [...this.free];
  }
}

const overlap = (a: Rect, b: Rect) =>
  Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > EPS && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > EPS;
const contains = (a: Rect, b: Rect) => b[0] >= a[0] - EPS && b[1] >= a[1] - EPS && b[0] + b[2] <= a[0] + a[2] + EPS && b[1] + b[3] <= a[1] + a[3] + EPS;

class MaxRectsBin implements Bin {
  free: Rect[];
  constructor(region: Rect) {
    this.free = region[2] > EPS && region[3] > EPS ? [region] : [];
  }
  find(w: number, h: number): [number, number] | null {
    let best: [number, number] | null = null;
    this.free.forEach(([, , fw, fh], i) => {
      if (fw + EPS >= w && fh + EPS >= h) {
        const score = Math.min(fw - w, fh - h) * 1e7 + Math.max(fw - w, fh - h);
        if (best === null || score < best[0] - EPS) best = [score, i];
      }
    });
    return best;
  }
  place(i: number, w: number, h: number): [number, number] {
    const [fx, fy] = this.free[i];
    const used: Rect = [fx, fy, w, h];
    const nf: Rect[] = [];
    for (const f of this.free) {
      if (!overlap(f, used)) {
        nf.push(f);
        continue;
      }
      const [x, y, fw, fh] = f;
      const [ux, uy, uw, uh] = used;
      if (ux > x + EPS) nf.push([x, y, ux - x, fh]);
      if (ux + uw < x + fw - EPS) nf.push([ux + uw, y, x + fw - (ux + uw), fh]);
      if (uy > y + EPS) nf.push([x, y, fw, uy - y]);
      if (uy + uh < y + fh - EPS) nf.push([x, uy + uh, fw, y + fh - (uy + uh)]);
    }
    nf.sort((a, b) => b[2] * b[3] - a[2] * a[3]);
    const pruned: Rect[] = [];
    for (const r of nf) {
      if (r[2] <= EPS || r[3] <= EPS) continue;
      if (!pruned.some((q) => contains(q, r))) pruned.push(r);
    }
    this.free = pruned;
    return [fx, fy];
  }
  freeRects(): Rect[] {
    const chosen: Rect[] = [];
    for (const r of [...this.free].sort((a, b) => b[2] * b[3] - a[2] * a[3])) if (!chosen.some((q) => overlap(r, q))) chosen.push(r);
    return chosen;
  }
}

interface OpenSheet {
  sheetIdx: number;
  bin: Bin;
  placements: [number, number, number, boolean][];
}

function orientations(p: Piece2D, k: number): [number, number, boolean][] {
  const o: [number, number, boolean][] = [[p.width + k, p.height + k, false]];
  if (p.can_rotate !== false && Math.abs(p.width - p.height) > EPS) o.push([p.height + k, p.width + k, true]);
  return o;
}

class Packer {
  regions: Rect[];
  constructor(public req: Req2D) {
    const t = req.edge_trim;
    const k = req.kerf;
    this.regions = req.sheets.map((s) => {
      const uw = s.width - t.left - t.right;
      const uh = s.height - t.top - t.bottom;
      return uw > EPS && uh > EPS ? ([t.left, t.bottom, uw + k, uh + k] as Rect) : ([t.left, t.bottom, 0, 0] as Rect);
    });
  }
  sheetOrder(): number[] {
    const sh = this.req.sheets;
    const area = (i: number) => sh[i].width * sh[i].height;
    const res = sh.map((_, i) => i).filter((i) => sh[i].is_residual);
    const nw = sh.map((_, i) => i).filter((i) => !sh[i].is_residual);
    res.sort((a, b) => area(a) - area(b));
    nw.sort((a, b) => area(b) - area(a));
    if (this.req.prefer_residuals) return [...res, ...nw];
    return [...res, ...nw].sort((a, b) => area(b) - area(a));
  }
  newBin(si: number, algo: string, split: string): Bin {
    return algo === 'maxrects' ? new MaxRectsBin(this.regions[si]) : new GuillotineBin(this.regions[si], split);
  }
  run(items: number[], algo: string, split: string): [OpenSheet[], number[]] {
    const req = this.req;
    const order = this.sheetOrder();
    const remaining = new Map<number, number>(order.map((i) => [i, req.sheets[i].quantity ?? Infinity]));
    const sheets: OpenSheet[] = [];
    const unplaced: number[] = [];
    for (const pi of items) {
      const p = req.pieces[pi];
      const ors = orientations(p, req.kerf);
      let done = false;
      for (const os of sheets) {
        if (!compatible(p, req.sheets[os.sheetIdx])) continue;
        let best: [number, number, number, number, boolean] | null = null;
        for (const [w, h, rot] of ors) {
          const f = os.bin.find(w, h);
          if (f && (best === null || f[0] < best[0] - EPS)) best = [f[0], f[1], w, h, rot];
        }
        if (best) {
          const [x, y] = os.bin.place(best[1], best[2], best[3]);
          os.placements.push([pi, x, y, best[4]]);
          done = true;
          break;
        }
      }
      if (done) continue;
      for (const si of order) {
        if ((remaining.get(si) ?? 0) < 1 || !compatible(p, req.sheets[si])) continue;
        const reg = this.regions[si];
        const fits = ors.filter(([w, h]) => reg[2] + EPS >= w && reg[3] + EPS >= h);
        if (!fits.length) continue;
        remaining.set(si, (remaining.get(si) ?? 0) - 1);
        const b = this.newBin(si, algo, split);
        let best: [number, number, number, number, boolean] | null = null;
        for (const [w, h, rot] of fits) {
          const f = b.find(w, h);
          if (f && (best === null || f[0] < best[0] - EPS)) best = [f[0], f[1], w, h, rot];
        }
        const [x, y] = b.place(best![1], best![2], best![3]);
        sheets.push({ sheetIdx: si, bin: b, placements: [[pi, x, y, best![4]]] });
        done = true;
        break;
      }
      if (!done) unplaced.push(pi);
    }
    return [sheets, unplaced];
  }
}

function residuals(req: Req2D, si: number, bin: Bin): Residual2D[] {
  const s = req.sheets[si];
  const t = req.edge_trim;
  const X1 = s.width - t.right;
  const Y1 = s.height - t.top;
  const rects: Rect[] = [];
  for (const [x, y, w, h] of bin.freeRects()) {
    const w2 = Math.min(x + w, X1) - x;
    const h2 = Math.min(y + h, Y1) - y;
    if (w2 > EPS && h2 > EPS) rects.push([x, y, w2, h2]);
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (Math.abs(a[1] - b[1]) <= EPS && Math.abs(a[3] - b[3]) <= EPS && (Math.abs(a[0] + a[2] - b[0]) <= EPS || Math.abs(b[0] + b[2] - a[0]) <= EPS))
          rects[i] = [Math.min(a[0], b[0]), a[1], a[2] + b[2], a[3]];
        else if (Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[2] - b[2]) <= EPS && (Math.abs(a[1] + a[3] - b[1]) <= EPS || Math.abs(b[1] + b[3] - a[1]) <= EPS))
          rects[i] = [a[0], Math.min(a[1], b[1]), a[2], a[3] + b[3]];
        else continue;
        rects.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  const mn = Math.min(req.min_residual_width, req.min_residual_height);
  const mx = Math.max(req.min_residual_width, req.min_residual_height);
  const out: Residual2D[] = [];
  for (const [x, y, w, h] of [...rects].sort((a, b) => b[2] * b[3] - a[2] * a[3])) {
    const reusable = Math.min(w, h) + EPS >= mn && Math.max(w, h) + EPS >= mx;
    if (reusable || Math.min(w, h) >= 10) out.push({ x, y, width: w, height: h, reusable });
  }
  return out;
}

const SORTS: Record<string, (p: Piece2D) => number[]> = {
  area: (p) => [-(p.width * p.height), -Math.max(p.width, p.height)],
  'max-side': (p) => [-Math.max(p.width, p.height), -Math.min(p.width, p.height)],
  height: (p) => [-p.height, -p.width],
  width: (p) => [-p.width, -p.height],
  perimeter: (p) => [-(p.width + p.height), -Math.max(p.width, p.height)],
};

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}
const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function optimize2D(input: Nesting2DRequest): Nesting2DResult {
  const t0 = now();
  const req = normalize2D(input);
  const issues: Issue[] = [];
  const packer = new Packer(req);
  const k = req.kerf;
  const seen = new Map<string, Piece2D>();
  for (const p of req.pieces) {
    const s = seen.get(p.id);
    if (s && (Math.abs(s.width - p.width) > EPS || Math.abs(s.height - p.height) > EPS))
      issues.push({ code: 'DUPLICATE_PIECE_ID', severity: 'error', message: `piece id '${p.id}' used with different sizes`, ref: `piece:${p.id}` });
    seen.set(p.id, p);
  }
  if (!req.sheets.length) issues.push({ code: 'NO_STOCK', severity: 'error', message: 'no sheets supplied', ref: null });
  const impossible = new Set<number>();
  req.pieces.forEach((p, pi) => {
    let ok = false;
    let compatAny = false;
    for (let si = 0; si < req.sheets.length; si++) {
      const s = req.sheets[si];
      if (s.quantity != null && s.quantity < 1) continue;
      if (!compatible(p, s)) continue;
      compatAny = true;
      const reg = packer.regions[si];
      if (orientations(p, k).some(([w, h]) => reg[2] + EPS >= w && reg[3] + EPS >= h)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      impossible.add(pi);
      issues.push(
        compatAny
          ? { code: 'PIECE_TOO_LARGE', severity: 'error', message: `piece '${p.id}' (${p.width}x${p.height}${p.can_rotate === false ? ', no rotation' : ''}) does not fit the usable area of any available sheet`, ref: `piece:${p.id}` }
          : { code: 'NO_COMPATIBLE_SHEET', severity: 'error', message: `piece '${p.id}' has no sheet with matching material/thickness`, ref: `piece:${p.id}` },
      );
    }
  });
  const expanded: number[] = [];
  req.pieces.forEach((p, pi) => {
    if (!impossible.has(pi)) for (let q = 0; q < p.quantity; q++) expanded.push(pi);
  });
  let algos: [string, string][] = [
    ['guillotine', 'slas'],
    ['guillotine', 'maxarea'],
  ];
  if (!req.guillotine) algos = [['maxrects', '-'], ...algos];
  const sheetArea = req.sheets.map((s) => s.width * s.height);

  let best: { key: number[]; sheets: OpenSheet[]; unpl: number[]; res: Residual2D[][]; method: string } | null = null;
  let timedOut = false;
  for (const [sname, skey] of Object.entries(SORTS)) {
    const items = [...expanded].sort((a, b) => cmp([...skey(req.pieces[a]), a], [...skey(req.pieces[b]), b]));
    for (const [algo, split] of algos) {
      const [sheets, unpl] = packer.run(items, algo, split);
      let nNew = 0;
      let tot = 0;
      let reuse = 0;
      const resCache: Residual2D[][] = [];
      for (const s of sheets) {
        if (!req.sheets[s.sheetIdx].is_residual) nNew += sheetArea[s.sheetIdx];
        tot += sheetArea[s.sheetIdx];
        const rs = residuals(req, s.sheetIdx, s.bin);
        resCache.push(rs);
        reuse += rs.filter((r) => r.reusable).reduce((a, r) => a + r.width * r.height, 0);
      }
      const key = [unpl.length, r3(req.prefer_residuals ? nNew : 0), sheets.length, r3(tot), -r3(reuse)];
      if (best === null || cmp(key, best.key) < 0)
        best = { key, sheets, unpl, res: resCache, method: `${algo === 'maxrects' ? 'MaxRects-BSSF' : `guillotine-BAF-${split}`} / sort:${sname}` };
      if (now() - t0 > req.time_limit_s * 1000) break;
    }
    if (now() - t0 > req.time_limit_s * 1000) {
      timedOut = true;
      break;
    }
  }
  if (timedOut) issues.push({ code: 'TIME_LIMIT_REACHED', severity: 'info', message: 'time limit reached before all heuristic variants were tried', ref: null });
  const sheets = best?.sheets ?? [];
  const unpl = best?.unpl ?? [];
  const resCache = best?.res ?? [];
  const method = `offline ${best?.method ?? 'none'}`;
  const unplacedIdx = [...unpl];
  for (const pi of impossible) for (let q = 0; q < req.pieces[pi].quantity; q++) unplacedIdx.push(pi);
  const exhausted = unpl.filter((pi) => !impossible.has(pi));
  if (exhausted.length) issues.push({ code: 'SHEETS_EXHAUSTED', severity: 'error', message: `${exhausted.length} piece(s) unplaced: finite sheet quantities exhausted`, ref: 'sheets' });

  const groups = new Map<string, { si: number; pls: [number, number, number, boolean][]; res: Residual2D[]; count: number }>();
  sheets.forEach((s, i) => {
    const pls = [...s.placements].sort((a, b) => cmp([a[2], a[1]], [b[2], b[1]]));
    const sig = `${s.sheetIdx}|${pls.map(([pi, x, y, rot]) => `${req.pieces[pi].id}@${Math.round(x * 1e6)},${Math.round(y * 1e6)},${rot}`).join(';')}`;
    const g = groups.get(sig);
    if (g) g.count += 1;
    else groups.set(sig, { si: s.sheetIdx, pls, res: resCache[i], count: 1 });
  });
  const layouts: SheetLayout[] = [];
  let totSheet = 0,
    totPiece = 0,
    totReuse = 0,
    cost = 0,
    anyCost = false,
    nSheets = 0;
  [...groups.values()].forEach((g, n) => {
    const sh = req.sheets[g.si];
    const placements: Placement2D[] = [];
    let area = 0;
    for (const [pi, x, y, rot] of g.pls) {
      const p = req.pieces[pi];
      const [w, h] = rot ? [p.height, p.width] : [p.width, p.height];
      placements.push({ piece_id: p.id, label: p.label ?? null, x, y, width: w, height: h, rotated: rot });
      area += p.width * p.height;
    }
    const sa = sh.width * sh.height;
    const reuse = g.res.filter((r) => r.reusable).reduce((a, r) => a + r.width * r.height, 0);
    const c = g.count;
    layouts.push({
      layout_id: `L${n + 1}`,
      sheet_id: sh.id,
      sheet_label: sh.label ?? null,
      width: sh.width,
      height: sh.height,
      is_residual_sheet: !!sh.is_residual,
      count: c,
      placements,
      residuals: g.res,
      used_area: area,
      utilization: area / sa,
    });
    nSheets += c;
    totSheet += c * sa;
    totPiece += c * area;
    totReuse += c * reuse;
    if (sh.cost_per_sheet != null) {
      anyCost = true;
      cost += c * sh.cost_per_sheet;
    }
  });
  const uc = new Map<number, number>();
  for (const pi of unplacedIdx) uc.set(pi, (uc.get(pi) ?? 0) + 1);
  const unplaced = [...uc.entries()].sort((a, b) => a[0] - b[0]).map(([pi, q]) => ({ ...req.pieces[pi], quantity: q }));
  const t = req.edge_trim;
  const usable = req.sheets
    .filter((s) => s.quantity == null || s.quantity > 0)
    .map((s) => (s.width - t.left - t.right) * (s.height - t.top - t.bottom))
    .filter((u) => u > 0);
  const lb = usable.length ? Math.ceil(req.pieces.reduce((a, p) => a + p.width * p.height * p.quantity, 0) / Math.max(...usable) - 1e-9) : null;
  const sameSize = new Set(req.sheets.map((s) => `${s.width}x${s.height}`)).size === 1;
  const status: Nesting2DResult['status'] =
    unplaced.length && nSheets === 0 ? 'INFEASIBLE' : unplaced.length ? 'PARTIAL' : lb !== null && nSheets === lb && sameSize ? 'OPTIMAL' : 'FEASIBLE';
  const res: Nesting2DResult = {
    units: 'mm',
    engine_version: NESTING_ENGINE_VERSION,
    method,
    status,
    validation_status: 'FEASIBLE_HEURISTIC',
    layouts,
    unplaced,
    summary: {
      sheets_used: nSheets,
      total_sheet_area_m2: totSheet / 1e6,
      total_piece_area_m2: totPiece / 1e6,
      waste_area_m2: (totSheet - totPiece - totReuse) / 1e6,
      reusable_residual_area_m2: totReuse / 1e6,
      utilization: totSheet > 0 ? totPiece / totSheet : 0,
      total_cost: anyCost ? cost : null,
    },
    lower_bound_sheets: lb,
    validation: { passed: true, validator: 'pending', errors: [], checked_items: 0 },
    issues,
    request: req,
    runtime_ms: 0,
  };
  res.validation = validate2D(req, res);
  if (!res.validation.passed) res.validation_status = 'INVALID';
  else if (status === 'OPTIMAL') res.validation_status = 'OPTIMAL_PROVEN';
  res.runtime_ms = now() - t0;
  return res;
}
