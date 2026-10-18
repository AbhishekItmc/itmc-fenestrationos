/**
 * DXF export (ARCHITECTURE §8.4) — faithful TS port of backend/app/engines/dxf_export.py for offline mode.
 * ASCII DXF R12 (AC1009), millimetres, origin bottom-left of the framework (x right, y up).
 * Layers: FOS-MULLION, FOS-TRANSOM, FOS-GLASS, FOS-PANEL, FOS-DIM, FOS-TEXT.
 * - member outlines from catalogue face widths (mullions x ± face/2 over 0..H; sill/transoms/head per bay between
 *   the mullion faces, clipped to 0..H) as closed POLYLINEs (R12 has no LWPOLYLINE);
 * - fields: clear opening between member faces (glass/spandrel → FOS-GLASS, panel → FOS-PANEL) + mark text;
 * - dimensions drawn as LINE + TEXT (no DIMENSION entities): chained + overall width below, chained levels
 *   (union of all bays) + overall height on the left.
 * Output is byte-identical to the Python writer for the same elevation and catalogue (parity-tested).
 */
import type { Catalogue, Elevation } from '../api/types';
import { getProfile } from './catalogue';
import { bayLevels, effectiveMullionProfileId, effectiveTransomProfileId, fieldRects, resolveFill } from './elevation';

export const DXF_LAYERS: [string, number][] = [
  ['FOS-MULLION', 5],
  ['FOS-TRANSOM', 4],
  ['FOS-GLASS', 3],
  ['FOS-PANEL', 6],
  ['FOS-DIM', 1],
  ['FOS-TEXT', 7],
];
const DEFAULT_FACE = 50;
const DIM_OFFSET_1 = 250; // chained dimensions offset from the framework
const DIM_OFFSET_2 = 500; // overall dimensions offset
const TICK = 40;

/** Python `f"{v:.4f}".rstrip("0").rstrip(".")`, with -0 → 0. */
export function num(v: number): string {
  let s = Number(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0' || s === '') s = '0';
  return s;
}

/** R12 text is single-byte: every non-ASCII code point / control char becomes '?' (Python encode 'replace'). */
export function asciiText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    out += c >= 32 && c < 127 ? ch : '?';
  }
  return out;
}

class Writer {
  readonly lines: string[] = [];
  pair(code: number, value: string | number): void {
    this.lines.push(String(code), typeof value === 'string' ? value : num(value));
  }
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    for (const [c, v] of [[10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]] as const) this.pair(c, v);
  }
  rect(layer: string, x0: number, y0: number, x1: number, y1: number): void {
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, '1');
    for (const [c, v] of [[10, 0], [20, 0], [30, 0]] as const) this.pair(c, v);
    this.pair(70, '1'); // closed
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      for (const [c, v] of [[10, x], [20, y], [30, 0]] as const) this.pair(c, v);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
  }
  text(layer: string, x: number, y: number, h: number, s: string, rot = 0, centred = true): void {
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    for (const [c, v] of [[10, x], [20, y], [30, 0], [40, h]] as const) this.pair(c, v);
    this.pair(1, asciiText(s));
    if (rot) this.pair(50, rot);
    if (centred) {
      // middle-centre alignment: 72=1 (centre), 73=2 (middle) + alignment point 11/21
      this.pair(72, '1');
      for (const [c, v] of [[11, x], [21, y], [31, 0]] as const) this.pair(c, v);
      this.pair(73, '2');
    }
  }
}

function face(cat: Catalogue | null, pid: string | null | undefined): number {
  const p = pid && cat ? getProfile(cat, pid) : null;
  const f = Number(p?.face_width);
  return p && p.face_width && Number.isFinite(f) ? f : DEFAULT_FACE;
}

function mark(elev: Elevation, key: string, bay: number, field: number): [string | null, string] {
  const f = resolveFill(elev, key);
  if (f.type === 'panel') return ['FOS-PANEL', `P${bay + 1}.${field + 1}`];
  if (f.type === 'spandrel') return ['FOS-GLASS', `SP${bay + 1}.${field + 1}`];
  if (f.type === 'glass') return ['FOS-GLASS', `G${bay + 1}.${field + 1}`];
  return [null, `${f.type.toUpperCase()} ${bay + 1}.${field + 1}`];
}

function hdim(w: Writer, xa: number, xb: number, y: number, h: number): void {
  w.line('FOS-DIM', xa, y, xb, y);
  for (const x of [xa, xb]) w.line('FOS-DIM', x, y - TICK, x, y + TICK);
  w.text('FOS-DIM', (xa + xb) / 2, y + h * 0.9, h, num(xb - xa));
}

function vdim(w: Writer, ya: number, yb: number, x: number, h: number): void {
  w.line('FOS-DIM', x, ya, x, yb);
  for (const y of [ya, yb]) w.line('FOS-DIM', x - TICK, y, x + TICK, y);
  w.text('FOS-DIM', x - h * 0.9, (ya + yb) / 2, h, num(yb - ya), 90);
}

export function elevationToDxf(elev: Elevation, cat: Catalogue | null = null): string {
  const W = Number(elev.width);
  const H = Number(elev.height);
  const m = elev.mullions.map(Number);
  const mfw = face(cat, cat ? effectiveMullionProfileId(elev, cat) : elev.mullion_profile_id);
  const transomFace = (b: number) => face(cat, cat ? effectiveTransomProfileId(elev, b, cat) : (elev.bays[b].transom_profile_id ?? elev.transom_profile_id));
  const th = Math.max(40, Math.min(150, Math.min(W, H) / 40)); // text height (mm)
  const extMin = [-DIM_OFFSET_2 - 2 * th, -DIM_OFFSET_2 - 2 * th];
  const extMax = [W + DIM_OFFSET_2 + 2 * th, H + 3 * th];

  const w = new Writer();
  // HEADER
  w.pair(0, 'SECTION');
  w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER');
  w.pair(1, 'AC1009');
  w.pair(9, '$INSUNITS');
  w.pair(70, '4'); // millimetres
  w.pair(9, '$MEASUREMENT');
  w.pair(70, '1'); // metric
  w.pair(9, '$EXTMIN');
  w.pair(10, extMin[0]);
  w.pair(20, extMin[1]);
  w.pair(30, 0);
  w.pair(9, '$EXTMAX');
  w.pair(10, extMax[0]);
  w.pair(20, extMax[1]);
  w.pair(30, 0);
  w.pair(0, 'ENDSEC');
  // TABLES
  w.pair(0, 'SECTION');
  w.pair(2, 'TABLES');
  w.pair(0, 'TABLE');
  w.pair(2, 'LTYPE');
  w.pair(70, '1');
  w.pair(0, 'LTYPE');
  w.pair(2, 'CONTINUOUS');
  w.pair(70, '0');
  w.pair(3, 'Solid line');
  w.pair(72, '65');
  w.pair(73, '0');
  w.pair(40, 0);
  w.pair(0, 'ENDTAB');
  w.pair(0, 'TABLE');
  w.pair(2, 'LAYER');
  w.pair(70, String(DXF_LAYERS.length + 1));
  for (const [name, colour] of [['0', 7] as [string, number], ...DXF_LAYERS]) {
    w.pair(0, 'LAYER');
    w.pair(2, name);
    w.pair(70, '0');
    w.pair(62, String(colour));
    w.pair(6, 'CONTINUOUS');
  }
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');
  // ENTITIES
  w.pair(0, 'SECTION');
  w.pair(2, 'ENTITIES');
  for (const x of m) w.rect('FOS-MULLION', x - mfw / 2, 0, x + mfw / 2, H);
  for (let b = 0; b < Math.min(elev.bays.length, m.length - 1); b++) {
    const tfw = transomFace(b);
    const xa = m[b] + mfw / 2;
    const xb = m[b + 1] - mfw / 2;
    for (const y of bayLevels(elev, b)) w.rect('FOS-TRANSOM', xa, Math.max(0, y - tfw / 2), xb, Math.min(H, y + tfw / 2));
  }
  for (const r of fieldRects(elev)) {
    const tfw = transomFace(r.bay);
    const x0 = r.x0 + mfw / 2;
    const x1 = r.x1 - mfw / 2;
    const y0 = r.y0 + tfw / 2;
    const y1 = r.y1 - tfw / 2;
    const [layer, mk] = mark(elev, r.key, r.bay, r.field);
    if (layer && x1 > x0 && y1 > y0) w.rect(layer, x0, y0, x1, y1);
    w.text('FOS-TEXT', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, th, mk);
  }
  for (let i = 0; i + 1 < m.length; i++) hdim(w, m[i], m[i + 1], -DIM_OFFSET_1, th);
  hdim(w, 0, W, -DIM_OFFSET_2, th);
  const lv = new Set<number>([0, H]);
  for (const bay of elev.bays) for (const t of bay.transoms) lv.add(Number(t));
  const levels = [...lv].sort((a, b) => a - b);
  for (let i = 0; i + 1 < levels.length; i++) vdim(w, levels[i], levels[i + 1], -DIM_OFFSET_1, th);
  vdim(w, 0, H, -DIM_OFFSET_2, th);
  const title = `${elev.name} - ${num(W)} x ${num(H)} mm` + (elev.quantity > 1 ? ` - qty ${elev.quantity}` : '');
  w.text('FOS-TEXT', W / 2, H + 1.8 * th, th * 1.2, title);
  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.lines.join('\n') + '\n';
}

export interface DxfEntity {
  type: string;
  layer: string | null;
  codes: [number, string][];
  vertices?: [number, number][];
}

/** Tiny DXF reader (tests / diagnostics), mirrors `parse_dxf_entities`: VERTEX/SEQEND fold into their POLYLINE. */
export function parseDxfEntities(text: string): DxfEntity[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2) throw new Error('odd number of DXF lines');
  const pairs: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const c = Number(lines[i].trim());
    if (!Number.isInteger(c)) throw new Error(`bad group code '${lines[i]}' at line ${i + 1}`);
    pairs.push([c, lines[i + 1].trim()]);
  }
  const out: DxfEntity[] = [];
  let inEnt = false;
  let cur: DxfEntity | null = null;
  let poly: DxfEntity | null = null;
  pairs.forEach(([c, v], i) => {
    if (c === 0) {
      if (cur) {
        if (cur.type === 'VERTEX' && poly) {
          const d = new Map(cur.codes);
          poly.vertices!.push([Number(d.get(10)), Number(d.get(20))]);
        } else if (cur.type === 'SEQEND') poly = null;
        else {
          out.push(cur);
          if (cur.type === 'POLYLINE') {
            cur.vertices = [];
            poly = cur;
          }
        }
        cur = null;
      }
      if (v === 'SECTION' && pairs[i + 1]?.[0] === 2 && pairs[i + 1]?.[1] === 'ENTITIES') {
        inEnt = true;
        return;
      }
      if (v === 'ENDSEC') {
        inEnt = false;
        return;
      }
      if (inEnt) cur = { type: v, layer: null, codes: [] };
    } else if (cur) {
      if (c === 8) cur.layer = v;
      cur.codes.push([c, v]);
    }
  });
  return out;
}
