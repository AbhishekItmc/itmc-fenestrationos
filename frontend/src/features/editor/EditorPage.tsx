import clsx from 'clsx';
import { useTheme } from '../../store/theme';
import {
  AlertTriangle,
  Calculator,
  Columns2,
  Crosshair,
  Eraser,
  FileDown,
  FileJson,
  FilePlus2,
  FileUp,
  Grid2x2,
  Grid3x3,
  Hand,
  Image,
  Keyboard,
  Magnet,
  Maximize,
  Moon,
  MousePointer2,
  PaintBucket,
  PenTool,
  Redo2,
  Rows2,
  Ruler,
  Save,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import type { Elevation, FieldFill, FillType, Issue } from '../../api/types';
import { glassTypesForSeries } from '../../engine/catalogue';
import { moveMullion, moveTransom, parseElevationJson, parseFillKey, removeMullion, removeTransom, resolveFill, setFill, validateElevation } from '../../engine/elevation';
import { downloadText, readFileText, safeFilename } from '../../lib/download';
import { refreshElevations } from '../../layout/Shell';
import { useApp, useBackend } from '../../store/app';
import { useStatus } from '../../store/status';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Dialog, Drawer } from '../../ui/Dialog';
import { Segmented, Select, Toggle } from '../../ui/Field';
import { InDevTag } from '../../ui/InDev';
import { Menu } from '../../ui/Menu';
import { EmptyState, IssueList, LoadingBlock } from '../../ui/Misc';
import { CalcResultsView } from '../calc/CalcResultsView';
import { useCalc } from '../calc/store';
import { CadCanvas } from './CadCanvas';
import { exportPng, exportSvg } from './exportDrawing';
import { clamp, minFieldSize, mullionRange, refToElement, selectedFieldKeys, transomRange } from './geometry';
import { NewElevationWizard } from './NewElevationWizard';
import { PropertiesPanel } from './PropertiesPanel';
import { ShortcutsHelp } from './ShortcutsHelp';
import { useEditor, type Tool } from './store';
import { TreePanel } from './TreePanel';
import { drawingScaleLabel, useView } from './view';

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select / move', key: 'V', icon: <MousePointer2 className="h-4 w-4" /> },
  { id: 'mullion', label: 'Add mullion', key: 'M', icon: <Columns2 className="h-4 w-4" /> },
  { id: 'transom', label: 'Add transom', key: 'T', icon: <Rows2 className="h-4 w-4" /> },
  { id: 'delete', label: 'Delete member', key: 'D', icon: <Eraser className="h-4 w-4" /> },
  { id: 'split', label: 'Split field equally', key: 'S', icon: <Grid2x2 className="h-4 w-4" /> },
  { id: 'fill', label: 'Set fill (paint)', key: 'P', icon: <PaintBucket className="h-4 w-4" /> },
  { id: 'hand', label: 'Hand / pan', key: 'H', icon: <Hand className="h-4 w-4" /> },
];

const FILL_KEYS: FillType[] = ['glass', 'spandrel', 'panel', 'none', 'opening'];

function Sep() {
  return <div className="mx-1 h-5 w-px bg-line" />;
}

function ToolBtn({ active, onClick, tip, children, testId, disabled }: { active?: boolean; onClick: () => void; tip: string; children: ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-testid={testId}
      aria-pressed={active}
      aria-label={tip}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-accent/70 bg-accent/15 text-accent' : 'border-transparent text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function EditorPage() {
  const params = useParams();
  const nav = useNavigate();
  const be = useBackend();
  const { catalogue: cat, projectId, projects, mode, selectElevation, selectProject } = useApp();
  const ed = useEditor();
  const appTheme = useTheme((s) => s.theme);
  const canvasDark = (ed.canvas === 'auto' ? appTheme : ed.canvas) === 'dark';
  const view = useView();
  const e = ed.elevation;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [importIssues, setImportIssues] = useState<Issue[] | null>(null);
  const [saveTarget, setSaveTarget] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const calc = useCalc((s) => s.last);
  const routeId = params.elevationId ? Number(params.elevationId) : null;

  // ---- load from route --------------------------------------------------------
  useEffect(() => {
    if (routeId === null) {
      const st = useEditor.getState();
      const appEl = useApp.getState().elevationId;
      if (!st.elevation && appEl) nav(`/editor/${appEl}`, { replace: true });
      return;
    }
    const st = useEditor.getState();
    if (st.record?.id === routeId && st.elevation) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    be.getElevation(routeId)
      .then((rec) => {
        if (!alive) return;
        useEditor.getState().load(rec.data, { id: rec.id, projectId: rec.project_id, version: rec.version });
        if (useApp.getState().projectId !== rec.project_id) selectProject(rec.project_id);
        selectElevation(rec.id);
      })
      .catch((err) => alive && setLoadError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [routeId, be, nav, selectElevation, selectProject]);

  // ---- validation -------------------------------------------------------------
  const issues = useMemo(() => (e ? validateElevation(e, cat) : []), [e, cat]);
  const nErr = issues.filter((i) => i.severity === 'error').length;
  const nWarn = issues.filter((i) => i.severity === 'warning').length;
  useEffect(() => {
    useStatus.getState().set({
      validation: e ? { errors: nErr, warnings: nWarn } : null,
      snap: ed.snapGrid || ed.snapMembers ? `${ed.snapGrid ? `grid ${ed.snapStep} mm` : 'grid off'}${ed.snapMembers ? ' · members' : ''}` : 'off',
      selection:
        ed.selection.kind === 'elevation'
          ? e
            ? `elevation ${e.name}`
            : '—'
          : ed.selection.kind === 'mullion'
            ? `mullion M${ed.selection.index + 1}`
            : ed.selection.kind === 'transom'
              ? `transom bay ${ed.selection.bay + 1} · T${ed.selection.index + 1}`
              : `${ed.selection.keys.length} field(s) ${ed.selection.keys.slice(0, 4).join(' ')}`,
    });
  }, [e, nErr, nWarn, ed.snapGrid, ed.snapMembers, ed.snapStep, ed.selection]);

  // ---- unsaved guard ------------------------------------------------------------
  useEffect(() => {
    const h = (ev: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) ev.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const run = useCallback((fn: (el: Elevation) => Elevation, label: string) => {
    const r = useEditor.getState().edit(fn, label);
    if (!r.ok) toast.error(`Cannot ${label}`, r.error);
    return r.ok;
  }, []);

  // ---- save ----------------------------------------------------------------------
  const save = useCallback(
    async (opts: { force?: boolean; asNew?: boolean; targetProject?: number } = {}) => {
      const st = useEditor.getState();
      if (!st.elevation) return;
      const doc = st.elevation;
      setSaving(true);
      try {
        if (st.record?.id && !opts.asNew) {
          let version = st.record.version ?? 1;
          if (opts.force) version = (await be.getElevation(st.record.id)).version;
          const rec = await be.updateElevation(st.record.id, doc, version);
          useEditor.getState().markSaved({ id: rec.id, projectId: rec.project_id, version: rec.version });
          toast.success('Elevation saved', `${rec.name} · version ${rec.version}${mode === 'offline' ? ' · stored in this browser' : ''}`);
        } else {
          const pid = opts.targetProject ?? st.record?.projectId ?? useApp.getState().projectId;
          if (!pid) {
            setSaveTarget(true);
            return;
          }
          const rec = await be.createElevation(pid, opts.asNew ? { ...doc, name: `${doc.name} (copy)` } : doc);
          useEditor.getState().load(rec.data, { id: rec.id, projectId: rec.project_id, version: rec.version });
          if (useApp.getState().projectId !== pid) selectProject(pid);
          selectElevation(rec.id);
          nav(`/editor/${rec.id}`, { replace: true });
          toast.success('Elevation created', `${rec.name} saved to project`);
        }
        await refreshElevations();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) setConflict(err.message);
        else toast.error('Save failed', errorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [be, mode, nav, selectElevation, selectProject],
  );

  const reloadServerVersion = async () => {
    const id = useEditor.getState().record?.id;
    setConflict(null);
    if (!id) return;
    try {
      const rec = await be.getElevation(id);
      useEditor.getState().load(rec.data, { id: rec.id, projectId: rec.project_id, version: rec.version });
      toast.info('Reloaded latest version', `version ${rec.version} — your unsaved changes were discarded`);
    } catch (err) {
      toast.error('Reload failed', errorMessage(err));
    }
  };

  // ---- calculate ------------------------------------------------------------------
  const calculate = useCallback(async () => {
    const st = useEditor.getState();
    if (!st.elevation) return;
    setCalcBusy(true);
    try {
      const persisted = !!st.record?.id && !st.dirty;
      let result;
      let runId = null;
      if (persisted) {
        const runRec = await be.calculateElevation(st.record!.id!);
        result = runRec.result ?? (await be.getCalcRun(runRec.id)).result;
        runId = runRec.id;
      } else result = await be.calcStateless({ elevation: st.elevation });
      useCalc.getState().setLast({
        result,
        runId,
        elevationId: st.record?.id ?? null,
        projectId: st.record?.projectId ?? null,
        elevationName: st.elevation.name,
        at: new Date().toISOString(),
        engine: be.mode,
      });
      setCalcOpen(true);
      if (!persisted) toast.info('Calculated (not persisted)', 'Save the elevation to create a calc run for quotations and reports.');
    } catch (err) {
      toast.error('Calculation failed', errorMessage(err));
    } finally {
      setCalcBusy(false);
    }
  }, [be]);

  // ---- import / export ---------------------------------------------------------------
  const onImport = async (file: File) => {
    try {
      const text = await readFileText(file);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        setImportIssues([{ code: 'JSON_PARSE_ERROR', severity: 'error', message: 'File is not valid JSON', ref: file.name }]);
        return;
      }
      const { elevation, issues: schemaIssues } = parseElevationJson(json);
      if (!elevation) {
        setImportIssues(schemaIssues);
        return;
      }
      const v = validateElevation(elevation, cat);
      if (useEditor.getState().elevation) run(() => ({ ...elevation, id: useEditor.getState().elevation?.id ?? null }), 'import JSON');
      else useEditor.getState().load(elevation, null);
      useView.getState().fit(elevation);
      const errs = v.filter((i) => i.severity === 'error').length;
      if (errs) toast.warning('Imported with validation errors', `${errs} error(s) — see the issues list`);
      else toast.success('Elevation imported', `${elevation.name} — undo (Ctrl+Z) to revert`);
    } catch (err) {
      toast.error('Import failed', errorMessage(err));
    }
  };
  const svgEl = () => document.querySelector('[data-testid="cad-canvas"]') as SVGSVGElement | null;

  // ---- keyboard ------------------------------------------------------------------------
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return;
      if (document.querySelector('[role="dialog"]')) return;
      const st = useEditor.getState();
      const el = st.elevation;
      const ctrl = ev.ctrlKey || ev.metaKey;
      const k = ev.key;
      if (ctrl && (k === 'z' || k === 'Z')) {
        ev.preventDefault();
        if (ev.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (ctrl && (k === 'y' || k === 'Y')) {
        ev.preventDefault();
        st.redo();
        return;
      }
      if (ctrl && (k === 's' || k === 'S')) {
        ev.preventDefault();
        void save();
        return;
      }
      if (ctrl && (k === 'a' || k === 'A') && el) {
        ev.preventDefault();
        st.setSelection({ kind: 'fields', keys: selectedFieldKeys(el) });
        return;
      }
      if (ctrl || ev.altKey) return;
      const toolKey: Record<string, Tool> = { v: 'select', m: 'mullion', t: 'transom', d: 'delete', s: 'split', p: 'fill', h: 'hand' };
      if (toolKey[k.toLowerCase()]) {
        st.setTool(toolKey[k.toLowerCase()]);
        return;
      }
      if (k === '?') return setHelp(true);
      if (k === 'a' || k === 'A') return st.set({ transomAllBays: !st.transomAllBays });
      if (k === 'f' || k === 'F') return el && useView.getState().fit(el);
      if (k === 'g' || k === 'G') return st.setPrefs({ showGrid: !st.showGrid });
      if (k === '+' || k === '=') return useView.getState().zoomCenter(1.25);
      if (k === '-' || k === '_') return useView.getState().zoomCenter(0.8);
      if (k === 'Escape') {
        if (st.dragBase) st.cancelDrag();
        else if (st.tool !== 'select') st.setTool('select');
        else st.setSelection({ kind: 'elevation' });
        return;
      }
      if (!el) return;
      const sel = st.selection;
      if (k === 'Delete' || k === 'Backspace') {
        ev.preventDefault();
        if (sel.kind === 'mullion') {
          if (sel.index === 0 || sel.index === el.mullions.length - 1) toast.warning('Edge mullions cannot be deleted');
          else if (run((x) => removeMullion(x, sel.index), 'delete mullion')) st.setSelection({ kind: 'elevation' });
        } else if (sel.kind === 'transom') {
          if (run((x) => removeTransom(x, sel.bay, sel.index), 'delete transom')) st.setSelection({ kind: 'elevation' });
        } else toast.info('Select a mullion or transom to delete');
        return;
      }
      if (/^[1-5]$/.test(k) && sel.kind === 'fields') {
        const t = FILL_KEYS[Number(k) - 1];
        const glassDefault = el.default_glass_type_id ?? null;
        const spandrel = glassTypesForSeries(cat, el.system_id).find((g) => g.category === 'spandrel')?.id ?? null;
        run(
          (x) =>
            sel.keys.reduce((acc, key) => {
              const [b, f] = parseFillKey(key)!;
              const fill: FieldFill = t === 'glass' ? { type: 'glass', glass_type_id: glassDefault } : t === 'spandrel' ? { type: 'spandrel', glass_type_id: spandrel } : t === 'panel' ? { type: 'panel', panel_type_id: resolveFill(acc, key).panel_type_id ?? cat.panel_types[0]?.id ?? null } : { type: t };
              return setFill(acc, b, f, fill);
            }, x),
          `set fill ${t}`,
        );
        return;
      }
      if (k.startsWith('Arrow') && (sel.kind === 'mullion' || sel.kind === 'transom')) {
        ev.preventDefault();
        const step = (st.snapStep || 10) * (ev.shiftKey ? 10 : 1);
        const minF = minFieldSize(el, cat);
        if (sel.kind === 'mullion' && (k === 'ArrowLeft' || k === 'ArrowRight') && sel.index > 0 && sel.index < el.mullions.length - 1) {
          const r = mullionRange(el, sel.index, minF.minW);
          const v = clamp(el.mullions[sel.index] + (k === 'ArrowRight' ? step : -step), r.lo, r.hi);
          run((x) => moveMullion(x, sel.index, v), 'nudge mullion');
        }
        if (sel.kind === 'transom' && (k === 'ArrowUp' || k === 'ArrowDown')) {
          const r = transomRange(el, sel.bay, sel.index, minF.minH);
          const v = clamp(el.bays[sel.bay].transoms[sel.index] + (k === 'ArrowUp' ? step : -step), r.lo, r.hi);
          run((x) => moveTransom(x, sel.bay, sel.index, v), 'nudge transom');
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cat, run, save]);

  const pickIssue = (i: Issue) => {
    const el = refToElement(i.ref);
    useEditor.getState().set({ highlightRef: i.ref ?? null });
    if (el?.kind === 'field') useEditor.getState().setSelection({ kind: 'fields', keys: [el.key] });
    else if (el?.kind === 'mullion') useEditor.getState().setSelection({ kind: 'mullion', index: el.index });
    else if (el?.kind === 'transom') useEditor.getState().setSelection({ kind: 'transom', bay: el.bay, index: el.index });
    else if (i.ref) useEditor.getState().setSelection({ kind: 'elevation' });
  };

  const createFromWizard = async (el: Elevation, saveNow: boolean) => {
    setWizard(false);
    if (useEditor.getState().dirty && !window.confirm('Discard unsaved changes to the current elevation?')) return;
    useEditor.getState().load(el, null);
    if (saveNow) await save();
    else {
      selectElevation(null);
      nav('/editor', { replace: true });
      toast.info('New elevation created', 'Unsaved — use Save to store it in a project.');
    }
  };

  const brushGlassOpts = e ? glassTypesForSeries(cat, e.system_id) : [];

  // ---- render -----------------------------------------------------------------------
  const toolbar = (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2" data-testid="editor-toolbar">
      {TOOLS.map((t) => (
        <ToolBtn key={t.id} active={ed.tool === t.id} onClick={() => ed.setTool(t.id)} tip={`${t.label}  (${t.key})`} testId={`tool-${t.id}`} disabled={!e}>
          {t.icon}
        </ToolBtn>
      ))}
      <Sep />
      <ToolBtn onClick={ed.undo} tip={`Undo (Ctrl+Z)${ed.past.length ? ` · ${ed.past.length} step(s)` : ''}`} disabled={!ed.past.length} testId="undo">
        <Undo2 className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={ed.redo} tip="Redo (Ctrl+Y)" disabled={!ed.future.length} testId="redo">
        <Redo2 className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn active={ed.snapGrid} onClick={() => ed.setPrefs({ snapGrid: !ed.snapGrid })} tip="Snap to grid increment" testId="snap-grid">
        <Magnet className="h-4 w-4" />
      </ToolBtn>
      <select className="input h-7 w-[78px] font-mono text-xs" value={ed.snapStep} onChange={(ev) => ed.setPrefs({ snapStep: Number(ev.target.value) })} data-tip="Snap increment" data-testid="snap-step">
        {[1, 5, 10, 25, 50, 100].map((v) => (
          <option key={v} value={v}>
            {v} mm
          </option>
        ))}
      </select>
      <ToolBtn active={ed.snapMembers} onClick={() => ed.setPrefs({ snapMembers: !ed.snapMembers })} tip="Snap to members (align transoms across bays, centre mullions)">
        <Crosshair className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn active={ed.showGrid} onClick={() => ed.setPrefs({ showGrid: !ed.showGrid })} tip="Grid (G)">
        <Grid3x3 className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={ed.showDims} onClick={() => ed.setPrefs({ showDims: !ed.showDims })} tip="Dimensions">
        <Ruler className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={() => ed.setPrefs({ canvas: canvasDark ? 'light' : 'dark' })} tip={canvasDark ? 'Light drawing sheet' : 'Dark canvas'} testId="theme-toggle">
        {canvasDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={() => view.zoomCenter(0.8)} tip="Zoom out (−)" disabled={!e}>
        <ZoomOut className="h-4 w-4" />
      </ToolBtn>
      <span className="w-[54px] text-center font-mono text-2xs text-muted" data-tip="Approximate drawing scale on screen">
        {e ? drawingScaleLabel(view.scale) : '—'}
      </span>
      <ToolBtn onClick={() => view.zoomCenter(1.25)} tip="Zoom in (+)" disabled={!e}>
        <ZoomIn className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={() => e && view.fit(e)} tip="Fit to screen (F)" disabled={!e} testId="zoom-fit">
        <Maximize className="h-4 w-4" />
      </ToolBtn>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => setWizard(true)} data-testid="new-elevation">
        New
      </Button>
      <Button size="sm" variant="ghost" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()} tip="Import elevation JSON (validated)">
        Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="import-file"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) void onImport(f);
          ev.target.value = '';
        }}
      />
      <Menu
        align="right"
        testId="export-menu"
        trigger={(_o, toggle) => (
          <Button size="sm" variant="ghost" icon={<FileDown className="h-3.5 w-3.5" />} onClick={toggle} disabled={!e} data-testid="export-button">
            Export
          </Button>
        )}
        items={[
          { label: 'Elevation JSON', icon: <FileJson className="h-3.5 w-3.5" />, onClick: () => e && downloadText(JSON.stringify(e, null, 2), `${safeFilename(e.name)}.json`), testId: 'export-json' },
          { label: 'Drawing SVG', icon: <PenTool className="h-3.5 w-3.5" />, onClick: () => svgEl() && e && exportSvg(svgEl()!, e.name), testId: 'export-svg' },
          { label: 'Drawing PNG (2×)', icon: <Image className="h-3.5 w-3.5" />, onClick: () => svgEl() && e && void exportPng(svgEl()!, e.name).catch((err) => toast.error('PNG export failed', errorMessage(err))), testId: 'export-png' },
          { label: 'DXF (CAD exchange)', icon: <FileDown className="h-3.5 w-3.5" />, disabled: true, hint: <InDevTag /> },
        ]}
      />
      <Sep />
      <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void save()} loading={saving} disabled={!e} tip={`Save (Ctrl+S) — ${mode === 'server' ? 'server, optimistic version check' : 'this browser'}`} data-testid="save">
        Save{ed.dirty ? ' •' : ''}
      </Button>
      <Button size="sm" variant="solid" icon={<Calculator className="h-3.5 w-3.5" />} onClick={() => void calculate()} loading={calcBusy} disabled={!e} data-testid="calculate">
        Calculate
      </Button>
      <ToolBtn onClick={() => setHelp(true)} tip="Keyboard shortcuts (?)" testId="shortcuts">
        <Keyboard className="h-4 w-4" />
      </ToolBtn>
    </div>
  );

  const toolOptions = e && (ed.tool === 'transom' || ed.tool === 'split' || ed.tool === 'fill' || ed.tool === 'mullion' || ed.tool === 'delete') && (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-bg/60 px-3 text-xs text-muted" data-testid="tool-options">
      <span className="font-semibold uppercase tracking-wide text-faint">{TOOLS.find((t) => t.id === ed.tool)?.label}</span>
      {ed.tool === 'mullion' && <span>Click inside the framework to insert a full-height mullion (snapped). Bays narrower than the rule-set minimum are refused.</span>}
      {ed.tool === 'delete' && <span>Click a mullion or transom to delete it. Edge mullions are fixed.</span>}
      {ed.tool === 'transom' && (
        <>
          <span>Click in a bay to insert a transom.</span>
          <Toggle checked={ed.transomAllBays} onChange={(v) => ed.set({ transomAllBays: v })} label="All bays (A)" testId="transom-all-bays" />
        </>
      )}
      {ed.tool === 'split' && (
        <>
          <span>Click a field to split it into</span>
          <input className="input input-num h-6 w-14" type="number" min={2} max={12} value={ed.splitN} onChange={(ev) => ed.set({ splitN: Math.max(2, Math.min(12, Math.round(Number(ev.target.value) || 2))) })} onKeyDown={(ev) => ev.stopPropagation()} data-testid="split-n" />
          <Segmented
            value={ed.splitDir}
            onChange={(v) => ed.set({ splitDir: v })}
            options={[
              { value: 'rows', label: 'rows' },
              { value: 'cols', label: 'columns' },
            ]}
          />
        </>
      )}
      {ed.tool === 'fill' && (
        <>
          <span>Brush</span>
          <Segmented
            value={ed.brush.type}
            onChange={(t) => ed.set({ brush: t === 'panel' ? { type: 'panel', panel_type_id: cat.panel_types[0]?.id ?? null } : t === 'spandrel' ? { type: 'spandrel', glass_type_id: brushGlassOpts.find((g) => g.category === 'spandrel')?.id ?? null } : t === 'glass' ? { type: 'glass', glass_type_id: null } : { type: t } })}
            options={[
              { value: 'glass', label: 'Glass' },
              { value: 'spandrel', label: 'Spandrel' },
              { value: 'panel', label: 'Panel' },
              { value: 'none', label: 'None' },
              { value: 'opening', label: 'Vent' },
            ]}
            testId="brush-type"
          />
          {(ed.brush.type === 'glass' || ed.brush.type === 'spandrel') && (
            <Select
              className="h-6 w-[200px] text-xs"
              value={ed.brush.glass_type_id ?? ''}
              placeholder={ed.brush.type === 'glass' ? 'elevation default glass' : '— select —'}
              options={brushGlassOpts.map((g) => ({ value: g.id, label: g.code }))}
              onChange={(v) => ed.set({ brush: { ...ed.brush, glass_type_id: v || null } })}
            />
          )}
          {ed.brush.type === 'panel' && <Select className="h-6 w-[200px] text-xs" value={ed.brush.panel_type_id ?? ''} options={cat.panel_types.map((p) => ({ value: p.id, label: p.code }))} onChange={(v) => ed.set({ brush: { ...ed.brush, panel_type_id: v } })} />}
        </>
      )}
    </div>
  );

  let body: ReactNode;
  if (loading) body = <LoadingBlock label="Loading elevation…" />;
  else if (loadError)
    body = (
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5 text-err" />}
        title="Could not load elevation"
        detail={loadError}
        action={
          <Button onClick={() => nav('/editor', { replace: true })} variant="primary">
            Back
          </Button>
        }
      />
    );
  else if (!e)
    body = (
      <EmptyState
        icon={<PenTool className="h-5 w-5" />}
        title="No elevation open"
        detail="Create a new elevation from the wizard or a template, open one from the elevation selector in the top bar, or import an elevation JSON file."
        action={
          <div className="flex gap-2">
            <Button variant="solid" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => setWizard(true)} data-testid="empty-new-elevation">
              New elevation
            </Button>
            <Button icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
              Import JSON
            </Button>
          </div>
        }
      />
    );
  else
    body = (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[244px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="panel-head h-8 text-xs">
            Structure
            <span className="ml-auto font-mono text-2xs font-normal text-faint">
              {e.bays.length} bays · {e.bays.reduce((a, b) => a + b.transoms.length + 1, 0)} fields
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TreePanel e={e} />
          </div>
          <div className="panel-head h-8 border-t text-xs" data-testid="issues-head">
            Validation
            <span className={clsx('ml-auto font-mono text-2xs font-normal', nErr ? 'text-err' : nWarn ? 'text-warn' : 'text-ok')}>{nErr || nWarn ? `${nErr} err · ${nWarn} warn` : 'OK'}</span>
          </div>
          <div className="max-h-[38%] min-h-[96px] overflow-auto" data-testid="editor-issues">
            <IssueList issues={issues} onPick={pickIssue} activeRef={ed.highlightRef} empty="No validation issues (demo rule set)" />
          </div>
        </aside>
        <div className="relative min-w-0 flex-1">
          <CadCanvas issues={issues} />
          {e.top_shape?.type === 'arch' && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-sm border border-prov/50 bg-[var(--banner-prov-bg)] px-3 py-1 text-xs font-medium text-prov" data-testid="arch-banner">
              Arch: geometry only — calculation not supported
            </div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
            {ed.dirty && <span className="rounded-sm border border-warn/40 bg-[var(--banner-warn-bg)] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warn">unsaved</span>}
            {!ed.record?.id && <span className="rounded-sm border border-line-strong bg-panel/90 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted">not in a project</span>}
            {ed.lastLabel && ed.past.length > 0 && <span className="rounded-sm bg-panel/80 px-1.5 py-0.5 text-2xs text-faint">last: {ed.lastLabel}</span>}
          </div>
          {calc && calc.elevationName === e.name && !calcOpen && (
            <button className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded border border-line-strong bg-panel/95 px-2.5 py-1 text-xs text-muted hover:text-fg" onClick={() => setCalcOpen(true)}>
              <Calculator className="h-3.5 w-3.5" /> Last calculation results
            </button>
          )}
        </div>
        <aside className="w-[292px] shrink-0 overflow-auto border-l border-line bg-panel">
          <PropertiesPanel />
        </aside>
      </div>
    );

  return (
    <div className="flex h-full flex-col" data-testid="editor-page">
      {toolbar}
      {toolOptions}
      {body}
      <NewElevationWizard open={wizard} onClose={() => setWizard(false)} onCreate={(el, s) => void createFromWizard(el, s)} />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
      <Drawer open={calcOpen && !!calc} onClose={() => setCalcOpen(false)} title={`Calculation — ${calc?.elevationName ?? ''}`} subtitle="Cut list, glass list and BOM from the DEMO rule set" width={860} testId="calc-drawer">
        {calc && <CalcResultsView entry={calc} onPickIssue={(i) => { setCalcOpen(false); pickIssue(i); }} />}
      </Drawer>
      <Dialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="Save conflict"
        subtitle="Someone else saved this elevation after you opened it (optimistic version check)."
        testId="conflict-dialog"
        footer={
          <>
            <Button onClick={() => setConflict(null)}>Cancel</Button>
            <Button onClick={() => void reloadServerVersion()}>Reload theirs (discard mine)</Button>
            <Button onClick={() => { setConflict(null); void save({ asNew: true }); }}>Save mine as copy</Button>
            <Button variant="danger" onClick={() => { setConflict(null); void save({ force: true }); }}>
              Overwrite with mine
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">{conflict}</div>
      </Dialog>
      <Dialog open={importIssues !== null} onClose={() => setImportIssues(null)} title="Import rejected" subtitle="The file does not match the Elevation schema (models.py)." footer={<Button onClick={() => setImportIssues(null)}>Close</Button>}>
        <IssueList issues={importIssues ?? []} />
      </Dialog>
      <Dialog
        open={saveTarget}
        onClose={() => setSaveTarget(false)}
        title="Save to which project?"
        subtitle="New elevations are stored inside a project."
        footer={<Button onClick={() => setSaveTarget(false)}>Cancel</Button>}
      >
        {projects.length ? (
          <div className="space-y-1">
            {projects.map((p) => (
              <button key={p.id} className="flex w-full items-center gap-2 rounded border border-line px-3 py-2 text-left hover:border-accent/50 hover:bg-hover" onClick={() => { setSaveTarget(false); void save({ targetProject: p.id }); }}>
                <span className="font-mono text-xs text-accent">{p.code}</span>
                <span className="text-sm">{p.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted">No projects yet — create one on the Projects page, or export the elevation as JSON.</div>
        )}
        {projectId === null && <div className="mt-2 text-2xs text-faint">Tip: select a project in the top bar to save directly.</div>}
      </Dialog>
    </div>
  );
}
