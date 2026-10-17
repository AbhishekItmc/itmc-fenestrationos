/**
 * Elevation CAD canvas (SVG, screen-space rendering with an explicit world→screen mapping so strokes,
 * dimension text and hit areas stay crisp at every zoom level).
 */
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalogue, Elevation, FieldFill, Issue } from '../../api/types';
import { getGlassType, getPanelType, getSeries } from '../../engine/catalogue';
import { addMullion, addTransom, addTransomAllBays, fillKey, moveMullion, moveTransom, removeMullion, removeTransom, resolveFill, setFill } from '../../engine/elevation';
import { fmtDim } from '../../lib/format';
import { useApp } from '../../store/app';
import { useStatus } from '../../store/status';
import { toast } from '../../store/toast';
import { DimH, DimV, Tag } from './Dimensions';
import {
  bayAt,
  checkAddMullion,
  checkAddTransom,
  clamp,
  faceWidths,
  fieldAt,
  minFieldSize,
  mullionRange,
  mullionTargets,
  refToElement,
  snapValue,
  splitBayColumns,
  splitFieldRows,
  transomRange,
  transomTargets,
} from './geometry';
import { useEditor, type Selection } from './store';
import { drawingScaleLabel, useView } from './view';

type Hit = { kind: 'mullion'; index: number } | { kind: 'transom'; bay: number; index: number } | { kind: 'field'; key: string; bay: number; field: number };

interface PendingDrag {
  hit: Extract<Hit, { kind: 'mullion' } | { kind: 'transom' }>;
  sx: number;
  sy: number;
  started: boolean;
}

const SNAP_PX = 9;

function hitFromEl(el: Element | null): Hit | null {
  const h = el?.closest('[data-hit]') as HTMLElement | SVGElement | null;
  if (!h) return null;
  const d = h.dataset;
  if (d.hit === 'mullion') return { kind: 'mullion', index: Number(d.index) };
  if (d.hit === 'transom') return { kind: 'transom', bay: Number(d.bay), index: Number(d.index) };
  if (d.hit === 'field') return { kind: 'field', key: String(d.key), bay: Number(d.bay), field: Number(d.field) };
  return null;
}

function fillLabel(f: FieldFill, cat: Catalogue): string {
  if (f.type === 'glass' || f.type === 'spandrel') {
    const g = getGlassType(cat, f.glass_type_id);
    return g ? g.code.replace(/^DEMO-/, '') : f.type === 'spandrel' ? 'SPANDREL' : 'GLASS ?';
  }
  if (f.type === 'panel') return getPanelType(cat, f.panel_type_id)?.code.replace(/^DEMO-/, '') ?? 'PANEL ?';
  if (f.type === 'none') return 'NO FILL';
  return 'VENT';
}

function activeBay(sel: Selection, nBays: number): number {
  if (sel.kind === 'mullion') return Math.min(sel.index, nBays - 1);
  if (sel.kind === 'transom') return sel.bay;
  if (sel.kind === 'fields') return Number(/^b(\d+)/.exec(sel.keys[0])?.[1] ?? 0);
  return 0;
}

export function CadCanvas({ issues }: { issues: Issue[] }) {
  const cat = useApp((s) => s.catalogue);
  const ed = useEditor();
  const view = useView();
  const e = ed.elevation;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [cursor, setCursor] = useState<{ sx: number; sy: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<{ clamped: boolean; snapped: string } | null>(null);
  const pending = useRef<PendingDrag | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const { scale: s, tx, ty, w: vw, h: vh } = view;
  const X = useCallback((x: number) => tx + x * s, [tx, s]);
  const Y = useCallback((y: number) => ty - y * s, [ty, s]);
  const toWorld = useCallback((sx: number, sy: number) => ({ x: (sx - tx) / s, y: (ty - sy) / s }), [tx, ty, s]);

  // ---- sizing & fit ---------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      useView.getState().setSize(Math.max(100, r.width), Math.max(100, r.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sizeKnown = vw > 100 && vh > 100;
  useEffect(() => {
    const st = useEditor.getState();
    if (st.elevation && sizeKnown) useView.getState().fit(st.elevation);
  }, [ed.loadSeq, sizeKnown]);

  // ---- wheel zoom (non-passive) & space pan ---------------------------------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.pow(1.0018, -ev.deltaY * (ev.deltaMode === 1 ? 20 : 1));
      useView.getState().zoomAt(factor, ev.clientX - r.left, ev.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && !isTyping()) {
        setSpace(true);
        ev.preventDefault();
      }
    };
    const up = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const fw = useMemo(() => (e ? faceWidths(e, cat) : { mullion: 50, transomByBay: [] }), [e, cat]);
  const minF = useMemo(() => (e ? minFieldSize(e, cat) : { minW: 100, minH: 100, source: '' }), [e, cat]);
  const highlight = useMemo(() => refToElement(ed.highlightRef), [ed.highlightRef]);
  const issueFields = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const i of issues) {
      const el = refToElement(i.ref);
      if (el?.kind === 'field' && i.severity !== 'info') m.set(el.key, m.get(el.key) === 'error' ? 'error' : (i.severity as 'error' | 'warning'));
    }
    return m;
  }, [issues]);

  if (!e) return <div ref={wrapRef} className="h-full w-full" />;

  const W = e.width;
  const H = e.height;
  const nb = e.bays.length;
  const fwM = fw.mullion;
  const fwTmax = Math.max(50, ...fw.transomByBay);
  const px = (mm: number, min = 1.5) => Math.max(min, mm * s);
  const tol = SNAP_PX / s;
  const isLight = ed.theme === 'light';

  const snapX = (x: number, targets: number[] = []) => snapValue(x, { step: ed.snapStep, grid: ed.snapGrid, targets: ed.snapMembers ? targets : [], tol });
  const snapY = (y: number, targets: number[] = []) => snapValue(y, { step: ed.snapStep, grid: ed.snapGrid, targets: ed.snapMembers ? targets : [], tol });

  const run = (fn: (el: Elevation) => Elevation, label: string) => {
    const r = useEditor.getState().edit(fn, label);
    if (!r.ok) toast.error(`Cannot ${label}`, r.error);
    return r.ok;
  };

  // ---- pointer handling --------------------------------------------------------
  const local = (ev: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  };

  const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = local(ev);
    const st = useEditor.getState();
    if (ev.button === 1 || st.tool === 'hand' || space) {
      panRef.current = { x: ev.clientX, y: ev.clientY };
      setPanning(true);
      svgRef.current?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    const hit = hitFromEl(ev.target as Element);
    const w = toWorld(sx, sy);
    switch (st.tool) {
      case 'select': {
        if (hit?.kind === 'mullion' || hit?.kind === 'transom') {
          const internal = hit.kind === 'transom' || (hit.index > 0 && hit.index < e.mullions.length - 1);
          st.setSelection(hit);
          if (internal) {
            pending.current = { hit, sx, sy, started: false };
            svgRef.current?.setPointerCapture(ev.pointerId);
          }
        } else if (hit?.kind === 'field') st.toggleField(hit.key, ev.shiftKey);
        else st.setSelection({ kind: 'elevation' });
        break;
      }
      case 'mullion': {
        const { value } = snapX(w.x, []);
        const why = checkAddMullion(e, value, minF.minW);
        if (why) toast.warning('Mullion not added', why);
        else if (run((el) => addMullion(el, value), 'add mullion')) st.setSelection({ kind: 'mullion', index: [...e.mullions, value].sort((a, b) => a - b).indexOf(value) });
        break;
      }
      case 'transom': {
        const b = bayAt(e, w.x);
        if (b < 0 || w.y <= 0 || w.y >= H) {
          toast.info('Click inside a bay to add a transom');
          break;
        }
        const { value } = snapY(w.y, transomTargets(e, b));
        if (st.transomAllBays) {
          const bad = e.bays.map((_, bi) => (e.bays[bi].transoms.some((t) => Math.abs(t - value) < 1e-6) ? null : checkAddTransom(e, bi, value, minF.minH))).find((x) => x);
          if (bad) toast.warning('Transom not added', bad);
          else run((el) => addTransomAllBays(el, value), 'add transom in all bays');
        } else {
          const why = checkAddTransom(e, b, value, minF.minH);
          if (why) toast.warning('Transom not added', why);
          else if (run((el) => addTransom(el, b, value), 'add transom')) st.setSelection({ kind: 'transom', bay: b, index: [...e.bays[b].transoms, value].sort((a, c) => a - c).indexOf(value) });
        }
        break;
      }
      case 'delete': {
        if (hit?.kind === 'mullion') {
          if (hit.index === 0 || hit.index === e.mullions.length - 1) toast.warning('Edge mullions cannot be deleted', 'Change the overall width in the properties panel instead.');
          else run((el) => removeMullion(el, hit.index), 'delete mullion');
        } else if (hit?.kind === 'transom') run((el) => removeTransom(el, hit.bay, hit.index), 'delete transom');
        else toast.info('Click a mullion or transom to delete it');
        break;
      }
      case 'split': {
        const f = hit?.kind === 'field' ? hit : fieldAt(e, w.x, w.y);
        if (!f) break;
        const n = st.splitN;
        if (st.splitDir === 'rows') run((el) => splitFieldRows(el, f.bay, f.field, n), `split field into ${n} rows`);
        else run((el) => splitBayColumns(el, f.bay, n), `split bay into ${n} columns`);
        break;
      }
      case 'fill': {
        if (hit?.kind === 'field') {
          const brush = st.brush;
          run((el) => setFill(el, hit.bay, hit.field, brush), 'set fill');
          st.setSelection({ kind: 'fields', keys: [hit.key] });
        }
        break;
      }
      default:
        break;
    }
  };

  const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = local(ev);
    setCursor({ sx, sy });
    const w = toWorld(sx, sy);
    useStatus.getState().set({ cursor: w });
    if (panRef.current) {
      useView.getState().panBy(ev.clientX - panRef.current.x, ev.clientY - panRef.current.y);
      panRef.current = { x: ev.clientX, y: ev.clientY };
      return;
    }
    const pd = pending.current;
    if (pd) {
      const st = useEditor.getState();
      if (!pd.started) {
        if (Math.hypot(sx - pd.sx, sy - pd.sy) < 3) return;
        pd.started = true;
        st.beginDrag();
      }
      const base = st.dragBase ?? e;
      if (pd.hit.kind === 'mullion') {
        const idx = pd.hit.index;
        const r = mullionRange(base, idx, minF.minW);
        const sn = snapX(w.x, mullionTargets(base, idx));
        const v = clamp(sn.value, r.lo, r.hi);
        st.dragTo(moveMullion(base, idx, v));
        setDragFeedback({ clamped: v !== sn.value, snapped: v !== sn.value ? 'limit' : sn.kind });
      } else {
        const { bay, index } = pd.hit;
        const r = transomRange(base, bay, index, minF.minH);
        const sn = snapY(w.y, transomTargets(base, bay));
        const v = clamp(sn.value, r.lo, r.hi);
        st.dragTo(moveTransom(base, bay, index, v));
        setDragFeedback({ clamped: v !== sn.value, snapped: v !== sn.value ? 'limit' : sn.kind });
      }
      return;
    }
    const hit = hitFromEl(ev.target as Element);
    setHover(hit);
  };

  const onPointerUp = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
      svgRef.current?.releasePointerCapture(ev.pointerId);
      return;
    }
    const pd = pending.current;
    if (pd) {
      pending.current = null;
      svgRef.current?.releasePointerCapture(ev.pointerId);
      if (pd.started) {
        const st = useEditor.getState();
        st.endDrag(pd.hit.kind === 'mullion' ? 'move mullion' : 'move transom');
        if (dragFeedback?.clamped) toast.info('Movement limited', `Constraint: neighbours and minimum field size ${pd.hit.kind === 'mullion' ? minF.minW : minF.minH} mm (${minF.source}).`);
      }
      setDragFeedback(null);
    }
  };

  const onPointerLeave = () => {
    setCursor(null);
    setHover(null);
    useStatus.getState().set({ cursor: null });
  };

  // ---- derived drawing data ----------------------------------------------------
  const world = cursor ? toWorld(cursor.sx, cursor.sy) : null;
  const sel = ed.selection;
  const isSel = (h: Hit) =>
    (h.kind === 'mullion' && sel.kind === 'mullion' && sel.index === h.index) ||
    (h.kind === 'transom' && sel.kind === 'transom' && sel.bay === h.bay && sel.index === h.index) ||
    (h.kind === 'field' && sel.kind === 'fields' && sel.keys.includes(h.key));
  const isHover = (h: Hit) => hover !== null && JSON.stringify(hover) === JSON.stringify(h);
  const isHi = (h: Hit) =>
    highlight !== null &&
    ((highlight.kind === 'field' && h.kind === 'field' && highlight.key === h.key) ||
      (highlight.kind === 'mullion' && h.kind === 'mullion' && highlight.index === h.index) ||
      (highlight.kind === 'transom' && h.kind === 'transom' && highlight.bay === h.bay && highlight.index === h.index));

  // grid
  const gridLines: JSX.Element[] = [];
  if (ed.showGrid) {
    let minor = ed.snapStep > 0 ? ed.snapStep : 10;
    while (minor * s < 9) minor *= minor % 3 === 0 || String(minor).startsWith('5') ? 2 : 5;
    const major = minor * 10;
    const x0 = Math.floor(toWorld(0, 0).x / minor) * minor;
    const x1 = toWorld(vw, 0).x;
    const y0 = Math.floor(toWorld(0, vh).y / minor) * minor;
    const y1 = toWorld(0, 0).y;
    let n = 0;
    for (let x = x0; x <= x1 && n < 600; x += minor, n++) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      gridLines.push(<line key={`gx${n}`} x1={X(x)} y1={0} x2={X(x)} y2={vh} stroke={isMajor ? 'var(--cad-grid-major)' : 'var(--cad-grid-minor)'} strokeWidth={1} />);
    }
    for (let y = y0; y <= y1 && n < 1200; y += minor, n++) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      gridLines.push(<line key={`gy${n}`} x1={0} y1={Y(y)} x2={vw} y2={Y(y)} stroke={isMajor ? 'var(--cad-grid-major)' : 'var(--cad-grid-minor)'} strokeWidth={1} />);
    }
  }

  // fields
  const fieldEls: JSX.Element[] = [];
  const fieldHits: JSX.Element[] = [];
  const fieldOverlays: JSX.Element[] = [];
  e.bays.forEach((bay, b) => {
    const ys = [0, ...bay.transoms, H];
    const fwT = fw.transomByBay[b] ?? 50;
    for (let f = 0; f < ys.length - 1; f++) {
      const key = fillKey(b, f);
      const fill = resolveFill(e, key);
      const x0 = X(e.mullions[b] + fwM / 2);
      const x1 = X(e.mullions[b + 1] - fwM / 2);
      const yTop = Y(ys[f + 1] - fwT / 2);
      const yBot = Y(ys[f] + fwT / 2);
      const wpx = Math.max(0, x1 - x0);
      const hpx = Math.max(0, yBot - yTop);
      const hit: Hit = { kind: 'field', key, bay: b, field: f };
      const axisW = e.mullions[b + 1] - e.mullions[b];
      const axisH = ys[f + 1] - ys[f];
      let body: JSX.Element;
      if (fill.type === 'glass') {
        const L = clamp(Math.min(wpx, hpx) * 0.16, 6, 48);
        const bx = x0 + Math.min(wpx * 0.12, 26);
        const by = yTop + Math.min(hpx * 0.12, 22) + L;
        body = (
          <g>
            <rect x={x0} y={yTop} width={wpx} height={hpx} fill="var(--cad-glass)" stroke="var(--cad-glass-edge)" strokeWidth={0.8} />
            {wpx > 20 && hpx > 20 && (
              <g stroke="var(--cad-glass-mark)" strokeWidth={0.9}>
                <line x1={bx} y1={by} x2={bx + L} y2={by - L} />
                <line x1={bx + L * 0.32} y1={by + L * 0.32} x2={bx + L * 0.32 + L * 0.68} y2={by + L * 0.32 - L * 0.68} />
              </g>
            )}
          </g>
        );
      } else if (fill.type === 'spandrel') {
        body = <rect x={x0} y={yTop} width={wpx} height={hpx} fill="url(#hatch-spandrel)" stroke="var(--cad-member)" strokeWidth={0.8} />;
      } else if (fill.type === 'panel') {
        body = <rect x={x0} y={yTop} width={wpx} height={hpx} fill="var(--cad-panel)" stroke="var(--cad-member-edge)" strokeWidth={0.8} />;
      } else if (fill.type === 'none') {
        body = (
          <g stroke="var(--cad-label)" strokeWidth={0.8} fill="none">
            <rect x={x0} y={yTop} width={wpx} height={hpx} strokeDasharray="5 4" />
            <line x1={x0} y1={yTop} x2={x0 + wpx} y2={yTop + hpx} />
            <line x1={x0 + wpx} y1={yTop} x2={x0} y2={yTop + hpx} />
          </g>
        );
      } else {
        body = (
          <g fill="none">
            <rect x={x0} y={yTop} width={wpx} height={hpx} fill="var(--cad-glass)" stroke="#fb923c" strokeWidth={1} strokeDasharray="6 4" />
            <path d={`M${x0 + 4} ${yBot - 4} L${x0 + wpx / 2} ${yTop + 4} L${x1 - 4} ${yBot - 4}`} stroke="#fb923c" strokeWidth={0.9} strokeDasharray="6 4" />
          </g>
        );
      }
      fieldEls.push(<g key={`f-${key}`}>{body}</g>);
      if (wpx > 64 && hpx > 26) {
        const big = wpx > 108 && hpx > 110;
        const tag = `B${b + 1}·F${f + 1}  ${fillLabel(fill, cat)}`;
        fieldEls.push(
          big ? (
            <g key={`fl-${key}`} pointerEvents="none" textAnchor="middle" className="cad-halo">
              <text x={x0 + wpx / 2} y={yTop + hpx / 2 - 3} fontSize={12.5} fill="var(--cad-label)" letterSpacing={0.4}>
                {tag}
              </text>
              <text x={x0 + wpx / 2} y={yTop + hpx / 2 + 11} fontSize={11.5} fill="var(--cad-label)" opacity={0.85}>
                {fill.type === 'opening' ? 'vent – in development' : `${fmtDim(axisW)} × ${fmtDim(axisH)} axis`}
              </text>
            </g>
          ) : (
            <text key={`fl-${key}`} className="cad-halo" x={x0 + 6} y={yBot - 6} fontSize={11.5} fill="var(--cad-label)" pointerEvents="none" letterSpacing={0.3}>
              {wpx > tag.length * 6 + 12 ? tag : `B${b + 1}·F${f + 1}`}
            </text>
          ),
        );
      }
      fieldHits.push(<rect key={`fh-${key}`} data-hit="field" data-key={key} data-bay={b} data-field={f} data-testid={`field-${key}`} x={X(e.mullions[b])} y={Y(ys[f + 1])} width={Math.max(1, X(e.mullions[b + 1]) - X(e.mullions[b]))} height={Math.max(1, Y(ys[f]) - Y(ys[f + 1]))} fill="transparent" />);
      const issue = issueFields.get(key);
      if (isSel(hit)) fieldOverlays.push(<rect key={`fs-${key}`} x={x0 + 1} y={yTop + 1} width={Math.max(0, wpx - 2)} height={Math.max(0, hpx - 2)} fill="var(--cad-select)" fillOpacity={0.09} stroke="var(--cad-select)" strokeWidth={2} pointerEvents="none" />);
      else if (isHover(hit) && ed.tool !== 'hand') fieldOverlays.push(<rect key={`fo-${key}`} x={x0 + 1} y={yTop + 1} width={Math.max(0, wpx - 2)} height={Math.max(0, hpx - 2)} fill="none" stroke="var(--cad-hover)" strokeWidth={1.2} strokeDasharray="4 3" pointerEvents="none" />);
      if (isHi(hit) || issue === 'error') fieldOverlays.push(<rect key={`fi-${key}`} x={x0 + 3} y={yTop + 3} width={Math.max(0, wpx - 6)} height={Math.max(0, hpx - 6)} fill={isHi(hit) ? 'var(--cad-error)' : 'none'} fillOpacity={0.08} stroke="var(--cad-error)" strokeWidth={isHi(hit) ? 2 : 1} strokeDasharray={isHi(hit) ? undefined : '3 3'} pointerEvents="none" />);
    }
  });

  // members
  const memberEls: JSX.Element[] = [];
  const memberHits: JSX.Element[] = [];
  const memberOverlays: JSX.Element[] = [];
  const memberStyle = (h: Hit) => (isHi(h) ? { stroke: 'var(--cad-error)', sw: 2 } : isSel(h) ? { stroke: 'var(--cad-select)', sw: 2 } : { stroke: 'var(--cad-member-edge)', sw: 0.9 });
  // horizontals (sill, transoms, head) per bay
  e.bays.forEach((bay, b) => {
    const fwT = fw.transomByBay[b] ?? 50;
    const levels = [0, ...bay.transoms, H];
    const xa = X(e.mullions[b] + fwM / 2);
    const xb = X(e.mullions[b + 1] - fwM / 2);
    levels.forEach((y, li) => {
      const isTransom = li > 0 && li < levels.length - 1;
      const hit: Hit | null = isTransom ? { kind: 'transom', bay: b, index: li - 1 } : null;
      const hpx = px(fwT, 2);
      const st = hit ? memberStyle(hit) : { stroke: 'var(--cad-member-edge)', sw: 0.9 };
      memberEls.push(<rect key={`h-${b}-${li}`} x={xa} y={Y(y) - hpx / 2} width={Math.max(0, xb - xa)} height={hpx} fill={hit && isSel(hit) ? 'var(--cad-select)' : 'var(--cad-member-fill)'} fillOpacity={hit && isSel(hit) ? 0.35 : 1} stroke={st.stroke} strokeWidth={st.sw} />);
      if (hit) {
        const hh = Math.max(10, hpx + 4);
        memberHits.push(<rect key={`th-${b}-${li}`} data-hit="transom" data-bay={b} data-index={li - 1} data-testid={`transom-${b}-${li - 1}`} x={xa} y={Y(y) - hh / 2} width={Math.max(0, xb - xa)} height={hh} fill="transparent" style={{ cursor: ed.tool === 'select' ? 'ns-resize' : undefined }} />);
        if (isHover(hit) && !isSel(hit)) memberOverlays.push(<rect key={`tho-${b}-${li}`} x={xa} y={Y(y) - hpx / 2 - 1} width={Math.max(0, xb - xa)} height={hpx + 2} fill="none" stroke="var(--cad-hover)" strokeWidth={1.4} pointerEvents="none" />);
      }
    });
  });
  // mullions (continuous)
  e.mullions.forEach((x, i) => {
    const wpx = px(fwM, 2);
    const yTop = Y(H + fwTmax / 2);
    const yBot = Y(-fwTmax / 2);
    const hit: Hit = { kind: 'mullion', index: i };
    const st = memberStyle(hit);
    memberEls.push(<rect key={`m-${i}`} x={X(x) - wpx / 2} y={yTop} width={wpx} height={yBot - yTop} fill={isSel(hit) ? 'var(--cad-select)' : 'var(--cad-member-fill)'} fillOpacity={isSel(hit) ? 0.35 : 1} stroke={st.stroke} strokeWidth={st.sw} />);
    const hw = Math.max(10, wpx + 4);
    const internal = i > 0 && i < e.mullions.length - 1;
    memberHits.push(<rect key={`mh-${i}`} data-hit="mullion" data-index={i} data-testid={`mullion-${i}`} x={X(x) - hw / 2} y={yTop} width={hw} height={yBot - yTop} fill="transparent" style={{ cursor: ed.tool === 'select' && internal ? 'ew-resize' : undefined }} />);
    if (isHover(hit) && !isSel(hit)) memberOverlays.push(<rect key={`mho-${i}`} x={X(x) - wpx / 2 - 1} y={yTop} width={wpx + 2} height={yBot - yTop} fill="none" stroke="var(--cad-hover)" strokeWidth={1.4} pointerEvents="none" />);
  });
  // centre lines
  const axisEls: JSX.Element[] = [];
  if (s * fwM > 5) {
    e.mullions.forEach((x, i) => axisEls.push(<line key={`ax-${i}`} x1={X(x)} y1={Y(H) - 14} x2={X(x)} y2={Y(0) + 14} stroke="var(--cad-dim)" strokeWidth={0.5} strokeDasharray="14 3 2 3" opacity={0.7} />));
    e.bays.forEach((bay, b) => bay.transoms.forEach((y, j) => axisEls.push(<line key={`ay-${b}-${j}`} x1={X(e.mullions[b])} y1={Y(y)} x2={X(e.mullions[b + 1])} y2={Y(y)} stroke="var(--cad-dim)" strokeWidth={0.5} strokeDasharray="14 3 2 3" opacity={0.7} />)));
  }

  // arch
  let archEl: JSX.Element | null = null;
  if (e.top_shape?.type === 'arch' && e.top_shape.rise > 0) {
    const r = Math.min(e.top_shape.rise, W / 2);
    const R = (r * r + (W / 2) ** 2) / (2 * r);
    const arc = `M${X(0)} ${Y(H)} A ${R * s} ${R * s} 0 0 1 ${X(W)} ${Y(H)}`;
    archEl = (
      <g data-testid="arch">
        <path d={`${arc} Z`} fill="var(--cad-glass)" stroke="none" />
        <path d={arc} fill="none" stroke="var(--cad-member-edge)" strokeWidth={px(fwM, 2) + 1.8} />
        <path d={arc} fill="none" stroke="var(--cad-member-fill)" strokeWidth={px(fwM, 2)} />
        <text x={X(W / 2)} y={Y(H + r * 0.42)} fontSize={12} fill="#f5b428" textAnchor="middle">
          ARCH · geometry only
        </text>
      </g>
    );
  }

  // anchor levels
  const anchorEls: JSX.Element[] = [];
  e.anchor_levels.forEach((ay, k) => {
    const xr = X(W) + px(fwM) / 2 + 12;
    anchorEls.push(
      <g key={`al-${k}`} pointerEvents="none">
        {e.mullions.map((mx, i) => (
          <rect key={i} x={X(mx) - 3.5} y={Y(ay) - 3.5} width={7} height={7} fill="none" stroke="#f5b428" strokeWidth={1} />
        ))}
        <line x1={xr} y1={Y(ay)} x2={xr + 38} y2={Y(ay)} stroke="#f5b428" strokeWidth={0.8} strokeDasharray="3 2" />
        <path d={`M${xr + 4} ${Y(ay) - 7} l5 7 l5 -7 z`} fill="#f5b428" />
        <text x={xr + 16} y={Y(ay) - 3} fontSize={11.5} fill="#f5b428">
          {`AL ${fmtDim(ay)}`}
        </text>
      </g>,
    );
  });

  // dimensions
  const dimEls: JSX.Element[] = [];
  if (ed.showDims) {
    const yBase = Y(0) + px(fwTmax) / 2;
    const yChain = yBase + 30;
    const yOverall = yBase + 62;
    for (let b = 0; b < nb; b++) {
      dimEls.push(<DimH key={`db-${b}`} testId={`dim-bay-${b}`} x0={X(e.mullions[b])} x1={X(e.mullions[b + 1])} y={yChain} refY={yBase} value={e.mullions[b + 1] - e.mullions[b]} />);
    }
    dimEls.push(<DimH key="dW" testId="dim-overall-w" x0={X(0)} x1={X(W)} y={yOverall} refY={yChain} value={W} style={{ emphasis: true }} />);
    const ab = clamp(activeBay(sel, nb), 0, nb - 1);
    const xBase = X(0) - px(fwM) / 2;
    const xChain = xBase - 34;
    const xOverall = xBase - 66;
    const ys = [0, ...e.bays[ab].transoms, H];
    for (let f = 0; f < ys.length - 1; f++) dimEls.push(<DimV key={`df-${f}`} testId={`dim-field-${f}`} y0={Y(ys[f])} y1={Y(ys[f + 1])} x={xChain} refX={ab === 0 ? xBase : xChain + 12} value={ys[f + 1] - ys[f]} />);
    dimEls.push(
      <text key="dlab" x={xChain} y={Y(H) - 16} fontSize={11.5} fill="var(--cad-label)" textAnchor="middle" letterSpacing={0.6}>
        {`BAY ${ab + 1}`}
      </text>,
    );
    dimEls.push(<DimV key="dH" testId="dim-overall-h" y0={Y(0)} y1={Y(H)} x={xOverall} refX={xChain} value={H} style={{ emphasis: true }} />);
    if (e.top_shape?.type === 'arch') {
      const r = e.top_shape.rise;
      dimEls.push(<DimV key="dR" y0={Y(H)} y1={Y(H + r)} x={X(W) + px(fwM) / 2 + 60} refX={X(W)} value={r} label={`R ${fmtDim(r)}`} />);
    }
    // selected member: position dimension from origin
    if (sel.kind === 'mullion' && sel.index > 0 && sel.index < e.mullions.length - 1 && !pending.current?.started) {
      const yTopDim = Y(H) - px(fwTmax) / 2 - 26;
      dimEls.push(<DimH key="dsel" x0={X(0)} x1={X(e.mullions[sel.index])} y={yTopDim} refY={Y(H) - px(fwTmax) / 2} value={e.mullions[sel.index]} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)' }} />);
    }
    if (sel.kind === 'transom' && !pending.current?.started) {
      const xr = X(e.mullions[sel.bay + 1]) + px(fwM) / 2 + 26;
      const yv = e.bays[sel.bay].transoms[sel.index];
      if (yv !== undefined) dimEls.push(<DimV key="dselt" y0={Y(0)} y1={Y(yv)} x={xr} refX={X(e.mullions[sel.bay + 1])} value={yv} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)' }} />);
    }
  }

  // live drag feedback
  const dragEls: JSX.Element[] = [];
  const pd = pending.current;
  if (pd?.started) {
    const base = ed.dragBase ?? e;
    if (pd.hit.kind === 'mullion') {
      const i = pd.hit.index;
      const r = mullionRange(base, i, minF.minW);
      const x = e.mullions[i];
      const yTop = Y(H) - px(fwTmax) / 2;
      dragEls.push(
        <g key="dz" pointerEvents="none">
          <rect x={X(base.mullions[i - 1])} y={Y(H)} width={Math.max(0, X(r.lo) - X(base.mullions[i - 1]))} height={Y(0) - Y(H)} fill="url(#hatch-forbidden)" />
          <rect x={X(r.hi)} y={Y(H)} width={Math.max(0, X(base.mullions[i + 1]) - X(r.hi))} height={Y(0) - Y(H)} fill="url(#hatch-forbidden)" />
          <line x1={X(x)} y1={Y(H) - 40} x2={X(x)} y2={Y(0) + 40} stroke="var(--cad-select)" strokeWidth={1} strokeDasharray="6 4" />
          <DimH x0={X(e.mullions[i - 1])} x1={X(x)} y={yTop - 22} refY={yTop} value={x - e.mullions[i - 1]} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)', emphasis: true }} />
          <DimH x0={X(x)} x1={X(e.mullions[i + 1])} y={yTop - 22} refY={yTop} value={e.mullions[i + 1] - x} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)', emphasis: true }} />
          <Tag x={X(x)} y={yTop - 44} text={`x = ${fmtDim(x)}${dragFeedback?.clamped ? '  LIMIT' : dragFeedback?.snapped === 'member' ? '  ⌖' : ''}`} tone={dragFeedback?.clamped ? 'warn' : 'accent'} />
        </g>,
      );
    } else {
      const { bay, index } = pd.hit;
      const r = transomRange(base, bay, index, minF.minH);
      const tr = base.bays[bay].transoms;
      const prev = index > 0 ? tr[index - 1] : 0;
      const next = index + 1 < tr.length ? tr[index + 1] : H;
      const y = e.bays[bay].transoms[index];
      const xa = X(e.mullions[bay]);
      const xb = X(e.mullions[bay + 1]);
      const xr = xb + px(fwM) / 2 + 24;
      dragEls.push(
        <g key="dzt" pointerEvents="none">
          <rect x={xa} y={Y(r.lo)} width={xb - xa} height={Math.max(0, Y(prev) - Y(r.lo))} fill="url(#hatch-forbidden)" />
          <rect x={xa} y={Y(next)} width={xb - xa} height={Math.max(0, Y(r.hi) - Y(next))} fill="url(#hatch-forbidden)" />
          <line x1={xa - 30} y1={Y(y)} x2={xb + 30} y2={Y(y)} stroke="var(--cad-select)" strokeWidth={1} strokeDasharray="6 4" />
          <DimV y0={Y(prev)} y1={Y(y)} x={xr} refX={xb} value={y - prev} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)', emphasis: true }} />
          <DimV y0={Y(y)} y1={Y(next)} x={xr} refX={xb} value={next - y} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)', emphasis: true }} />
          <Tag x={xr + 14} y={Y(y) + 4} anchor="start" text={`y = ${fmtDim(y)}${dragFeedback?.clamped ? '  LIMIT' : dragFeedback?.snapped === 'member' ? '  ⌖ aligned' : ''}`} tone={dragFeedback?.clamped ? 'warn' : 'accent'} />
        </g>,
      );
    }
  }

  // tool ghosts
  const ghostEls: JSX.Element[] = [];
  if (world && !pd && !panning && (ed.tool === 'mullion' || ed.tool === 'transom')) {
    if (ed.tool === 'mullion' && world.x > 0 && world.x < W) {
      const { value, kind } = snapX(world.x, []);
      const why = checkAddMullion(e, value, minF.minW);
      const b = bayAt(e, value);
      const yTop = Y(H) - px(fwTmax) / 2;
      ghostEls.push(
        <g key="gm" pointerEvents="none" data-testid="ghost-mullion">
          <rect x={X(value) - px(fwM, 2) / 2} y={Y(H)} width={px(fwM, 2)} height={Y(0) - Y(H)} fill={why ? 'var(--cad-error)' : 'var(--cad-select)'} opacity={0.25} />
          <line x1={X(value)} y1={Y(H) - 36} x2={X(value)} y2={Y(0) + 36} stroke={why ? 'var(--cad-error)' : 'var(--cad-select)'} strokeWidth={1} strokeDasharray="6 4" />
          {b >= 0 && !why && (
            <>
              <DimH x0={X(e.mullions[b])} x1={X(value)} y={yTop - 22} refY={yTop} value={value - e.mullions[b]} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)' }} />
              <DimH x0={X(value)} x1={X(e.mullions[b + 1])} y={yTop - 22} refY={yTop} value={e.mullions[b + 1] - value} style={{ color: 'var(--cad-select)', textColor: 'var(--cad-select)' }} />
            </>
          )}
          <Tag x={X(value)} y={yTop - 44} text={why ? 'too close' : `x = ${fmtDim(value)}${kind === 'grid' ? '' : ''}`} tone={why ? 'err' : 'accent'} />
        </g>,
      );
    }
    if (ed.tool === 'transom' && world.y > 0 && world.y < H) {
      const b = bayAt(e, world.x);
      if (b >= 0) {
        const { value } = snapY(world.y, transomTargets(e, b));
        const bays = ed.transomAllBays ? e.bays.map((_, i) => i) : [b];
        const why = bays.map((bi) => checkAddTransom(e, bi, value, minF.minH)).find((x) => x && !/already/.test(x)) ?? null;
        const xa = X(e.mullions[bays[0]]);
        const xb = X(e.mullions[bays[bays.length - 1] + 1]);
        ghostEls.push(
          <g key="gt" pointerEvents="none" data-testid="ghost-transom">
            <rect x={xa} y={Y(value) - px(fw.transomByBay[b] ?? 50, 2) / 2} width={xb - xa} height={px(fw.transomByBay[b] ?? 50, 2)} fill={why ? 'var(--cad-error)' : 'var(--cad-select)'} opacity={0.25} />
            <line x1={xa - 30} y1={Y(value)} x2={xb + 30} y2={Y(value)} stroke={why ? 'var(--cad-error)' : 'var(--cad-select)'} strokeWidth={1} strokeDasharray="6 4" />
            <Tag x={xb + px(fwM) / 2 + 12} y={Y(value) + 4} anchor="start" text={why ? 'too close' : `y = ${fmtDim(value)}`} tone={why ? 'err' : 'accent'} />
          </g>,
        );
      }
    }
  }

  const series = getSeries(cat, e.system_id);
  const cursorCls = panning ? 'cursor-grabbing' : space || ed.tool === 'hand' ? 'cursor-grab' : ed.tool === 'select' ? 'cursor-default' : 'cursor-crosshair';

  return (
    <div ref={wrapRef} className={clsx('relative h-full w-full overflow-hidden', isLight && 'cad-light')} style={{ background: 'var(--cad-bg)' }}>
      <svg
        ref={svgRef}
        data-testid="cad-canvas"
        className={clsx('cad-canvas block select-none', cursorCls)}
        width={vw}
        height={vh}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(ev) => ev.preventDefault()}
        onAuxClick={(ev) => ev.preventDefault()}
      >
        <defs>
          <pattern id="hatch-spandrel" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--cad-spandrel)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--cad-hatch)" strokeWidth="1" />
          </pattern>
          <pattern id="hatch-forbidden" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="6" height="6" fill="rgba(248,113,113,0.07)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(248,113,113,0.35)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={vw} height={vh} fill="var(--cad-bg)" />
        <g className="grid">{gridLines}</g>
        <rect x={6.5} y={6.5} width={Math.max(0, vw - 13)} height={Math.max(0, vh - 13)} fill="none" stroke="var(--cad-grid-major)" strokeWidth={1} />
        {archEl}
        <g className="fields">{fieldEls}</g>
        <g className="axes">{axisEls}</g>
        <g className="members">{memberEls}</g>
        <g className="anchors">{anchorEls}</g>
        <g className="dims">{dimEls}</g>
        <g className="hits">
          {fieldHits}
          {memberHits}
        </g>
        <g className="overlays no-export" pointerEvents="none">
          {fieldOverlays}
          {memberOverlays}
        </g>
        <g className="no-export">
          {dragEls}
          {ghostEls}
        </g>
        {/* title block */}
        <g pointerEvents="none" transform={`translate(${vw - 352} ${vh - 84})`}>
          <rect width={340} height={72} fill="var(--cad-bg)" fillOpacity={0.88} stroke="var(--cad-grid-major)" />
          <line x1={0} y1={22} x2={340} y2={22} stroke="var(--cad-grid-major)" />
          <line x1={196} y1={22} x2={196} y2={72} stroke="var(--cad-grid-major)" />
          <text x={8} y={15} fontSize={13} fill="var(--cad-dim-text)" fontWeight={600}>
            {e.name.slice(0, 38)}
          </text>
          <text x={8} y={38} fontSize={11.5} fill="var(--cad-label)">
            {`${fmtDim(W)} × ${fmtDim(H)} mm · qty ${e.quantity}`}
          </text>
          <text x={8} y={54} fontSize={11.5} fill="var(--cad-label)">
            {series ? series.code : 'no series'}
          </text>
          <text x={204} y={38} fontSize={11.5} fill="var(--cad-label)">
            {`scale ≈ ${drawingScaleLabel(s)}`}
          </text>
          <text x={204} y={54} fontSize={11.5} fill="#f5b428">
            DEMO · PROVISIONAL
          </text>
          <text x={8} y={67} fontSize={10} fill="var(--cad-label)" opacity={0.7}>
            axis dimensions in mm
          </text>
        </g>
      </svg>
    </div>
  );
}
