import { ClipboardPaste, Database, Eraser, FileDown, FileSpreadsheet, FileUp, PackagePlus, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import type { Cutting1DRequest, Piece1D, Strategy1D } from '../../api/types';
import { parseTsv } from '../../lib/download';
import { fmtM, fmtMm, fmtNum, fmtPct } from '../../lib/format';
import { seriesColor } from '../../lib/palette';
import { useWidth } from '../../lib/useWidth';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { ValidationStatusBadge, ValidatorBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Segmented, Toggle } from '../../ui/Field';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, IssueList, Kpi, OfflineEngineLabel, PageHeader, Tabs } from '../../ui/Misc';
import { BarDiagram } from './BarDiagram';
import { demoCuttingDraft, emptyCuttingDraft, useCutting, type CuttingDraft, type StockRow } from './store';

function num(v: string): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Parse Excel rows: mark, length, qty[, angle_start, angle_end, label]. Header rows are skipped. */
export function piecesFromTsv(text: string): { pieces: Piece1D[]; skipped: number } {
  const rows = parseTsv(text);
  const pieces: Piece1D[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.length < 3) {
      skipped++;
      continue;
    }
    const length = Number(r[1].replace(',', '.'));
    const qty = Number(r[2]);
    if (!Number.isFinite(length) || length <= 0 || !Number.isInteger(qty) || qty < 1) {
      skipped++;
      continue;
    }
    pieces.push({ id: r[0] || `P${pieces.length + 1}`, length, quantity: qty, angle_start: r[3] ? num(r[3]) || 90 : 90, angle_end: r[4] ? num(r[4]) || 90 : 90, label: r[5] || null });
  }
  return { pieces, skipped };
}

function draftErrors(d: CuttingDraft): string[] {
  const errs: string[] = [];
  if (!d.stocks.length) errs.push('Add at least one stock length');
  if (!d.pieces.length) errs.push('Add at least one piece');
  d.stocks.forEach((s, i) => {
    if (!(s.length > 0)) errs.push(`Stock row ${i + 1}: length must be > 0`);
    if (!s.unlimited && !(Number.isInteger(s.quantity) && (s.quantity ?? -1) >= 0)) errs.push(`Stock row ${i + 1}: quantity must be a whole number`);
  });
  const ids = new Map<string, number>();
  d.pieces.forEach((p, i) => {
    if (!p.id.trim()) errs.push(`Piece row ${i + 1}: mark is required`);
    if (!(p.length > 0)) errs.push(`Piece ${p.id || i + 1}: length must be > 0`);
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) errs.push(`Piece ${p.id || i + 1}: quantity must be ≥ 1`);
    if (ids.has(p.id) && ids.get(p.id) !== p.length) errs.push(`Mark ${p.id} used with different lengths`);
    ids.set(p.id, p.length);
  });
  if ([d.kerf, d.trim_start, d.trim_end, d.min_reusable_offcut].some((v) => !(v >= 0))) errs.push('Kerf, trims and min offcut must be ≥ 0');
  return errs;
}

export function toRequest(d: CuttingDraft, extraStocks: StockRow[] = []): Cutting1DRequest {
  return {
    units: 'mm',
    material: d.material || null,
    kerf: d.kerf,
    trim_start: d.trim_start,
    trim_end: d.trim_end,
    min_reusable_offcut: d.min_reusable_offcut,
    strategy: d.strategy,
    prefer_offcuts: true,
    stocks: [...extraStocks, ...d.stocks].map((s) => ({ id: s.id, label: s.label ?? null, length: s.length, quantity: s.unlimited ? null : (s.quantity ?? 0), is_offcut: !!s.is_offcut, priority: s.priority ?? 0, cost_per_bar: s.cost_per_bar ?? null })),
    pieces: d.pieces.map((p) => ({ ...p, id: p.id.trim() })),
  };
}

type ResTab = 'bars' | 'list' | 'issues';

export default function CuttingPage() {
  const be = useBackend();
  const { catalogue: cat, projectId, user, mode } = useApp();
  const { draft, result, jobId, setDraft, replaceDraft, setResult } = useCutting();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [tab, setTab] = useState<ResTab>('bars');
  const [barsRef, barsWidth] = useWidth<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const errs = draftErrors(draft);
  const eng = canWrite(user, 'engineering');
  const profileCodes = cat.profiles.map((p) => p.code);

  const colorIndex = useMemo(() => {
    const m = new Map<string, number>();
    (result?.request.pieces ?? draft.pieces).forEach((p, i) => m.set(p.id, i));
    return m;
  }, [result, draft.pieces]);

  const setStock = (i: number, p: Partial<StockRow>) => setDraft({ stocks: draft.stocks.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setPiece = (i: number, p: Partial<Piece1D>) => setDraft({ pieces: draft.pieces.map((s, k) => (k === i ? { ...s, ...p } : s)) });

  const run = async () => {
    if (errs.length) return toast.error('Fix the inputs first', errs[0]);
    setBusy(true);
    try {
      let extra: StockRow[] = [];
      if (draft.useInventory) {
        if (!draft.material) toast.warning('No material set', 'Inventory stock is matched by material / profile code.');
        else extra = (await be.inventoryAsBarStock(draft.material)).map((s) => ({ ...s, unlimited: false }));
        if (extra.length) toast.info(`Using ${extra.length} inventory stock line(s)`, 'Offcuts are consumed first (prefer_offcuts).');
      }
      const r = await be.optimize1D(toRequest(draft, extra));
      setResult(r);
      setTab(r.validation.passed ? 'bars' : 'issues');
      if (!r.validation.passed) toast.error('Independent validator FAILED', 'Export and release are blocked.');
      else toast.success(`${r.summary.bars_used} bars · ${fmtPct(r.summary.utilization)}`, r.validation_status === 'OPTIMAL_PROVEN' ? 'Optimal (proven)' : 'Feasible heuristic — optimality not proven');
    } catch (e) {
      toast.error('Optimisation failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveJob = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const job = await be.createCuttingJob(projectId ?? null, draft.name || 'Cutting job', result.request, draft.useInventory);
      setResult(job.result ?? result, job.id);
      toast.success(`Cutting job #${job.id} saved`, mode === 'server' ? 'Re-optimised and validated on the server' : 'Stored in this browser');
    } catch (e) {
      toast.error('Save failed', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const returnOffcuts = async () => {
    if (!jobId) return;
    try {
      const items = await be.residualsFromCutting(jobId);
      toast.success(`${items.length} offcut line(s) added to inventory`, items.map((i) => `${i.quantity}× ${fmtMm(i.length ?? 0)}`).join(', ') || 'no reusable offcuts');
    } catch (e) {
      toast.error('Could not return offcuts', errorMessage(e));
    }
  };

  const download = async (fmt: 'pdf' | 'xlsx') => {
    if (!jobId) return;
    try {
      await be.downloadReport('cutting', jobId, fmt);
    } catch (e) {
      toast.error('Download failed', errorMessage(e));
    }
  };

  const importExcel = async (file: File) => {
    try {
      const r = await be.importCuttingExcel(file);
      const pieces = (r.pieces as Piece1D[]).map((p) => ({ angle_start: 90, angle_end: 90, ...p }));
      const stocks = (r.stocks as StockRow[]).map((s) => ({ ...s, unlimited: s.quantity == null }));
      setDraft({ pieces, ...(stocks.length ? { stocks } : {}) });
      const errsN = r.issues.filter((i) => i.severity === 'error').length;
      if (errsN) toast.warning(`Imported with ${errsN} error(s)`, r.issues[0]?.message);
      else toast.success('Excel imported', `${pieces.length} piece rows, ${stocks.length} stock rows`);
    } catch (e) {
      toast.error('Excel import failed', errorMessage(e));
    }
  };

  const onPasteTable = (ev: React.ClipboardEvent) => {
    const text = ev.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    ev.preventDefault();
    const { pieces, skipped } = piecesFromTsv(text);
    if (!pieces.length) return toast.warning('Nothing pasted', 'Expected columns: mark, length, qty[, angle start, angle end, label]');
    setDraft({ pieces: [...draft.pieces.filter((p) => p.id || p.length), ...pieces] });
    toast.success(`${pieces.length} piece row(s) pasted`, skipped ? `${skipped} row(s) skipped (header or invalid)` : undefined);
  };

  const r = result;
  const usedStocks = new Set(r?.patterns.map((p) => p.stock_id));
  const totalPieces = draft.pieces.reduce((a, p) => a + (p.quantity || 0), 0);

  return (
    <div className="flex h-full flex-col" data-testid="cutting-page">
      <PageHeader
        title="1D Cutting optimiser"
        subtitle={draft.source ? `Source: ${draft.source}` : 'Profile bar cutting — FFD/BFD heuristics with an independent validator (ARCHITECTURE §3)'}
        actions={
          <>
            <Button icon={<Database className="h-3.5 w-3.5" />} onClick={() => replaceDraft(demoCuttingDraft())} data-testid="load-demo-cutting">
              Load demo: mullions &amp; transoms
            </Button>
            <Button variant="ghost" icon={<Eraser className="h-3.5 w-3.5" />} onClick={() => replaceDraft(emptyCuttingDraft())}>
              Clear
            </Button>
            <Button variant="solid" icon={<Play className="h-3.5 w-3.5" />} loading={busy} onClick={() => void run()} disabled={errs.length > 0} tip={errs[0]} data-testid="run-cutting">
              Run optimisation
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* ---------------- inputs ---------------- */}
        <aside className="w-[500px] shrink-0 overflow-auto border-r border-line bg-panel">
          <div className="space-y-3 border-b border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Job name">
                <input className="input" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
              </Field>
              <Field label="Material / profile">
                <input className="input font-mono" list="profile-codes" value={draft.material} onChange={(e) => setDraft({ material: e.target.value })} placeholder="e.g. DEMO-CW50-M150" data-testid="cutting-material" />
                <datalist id="profile-codes">
                  {profileCodes.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ['kerf', 'Kerf'],
                  ['trim_start', 'Trim start'],
                  ['trim_end', 'Trim end'],
                  ['min_reusable_offcut', 'Min offcut'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <input className="input input-num" type="number" min={0} step="any" value={draft[k]} onChange={(e) => setDraft({ [k]: Number(e.target.value) } as Partial<CuttingDraft>)} data-testid={`cutting-${k}`} />
                </Field>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="label mb-0">Strategy</span>
              <Segmented<Strategy1D>
                value={draft.strategy}
                onChange={(v) => setDraft({ strategy: v })}
                options={[
                  { value: 'auto', label: 'Auto', tip: 'Heuristic, then exact solver when worthwhile (server)' },
                  { value: 'heuristic', label: 'Heuristic' },
                  { value: 'exact', label: 'Exact', disabled: mode !== 'server', tip: mode === 'server' ? 'CP-SAT exact solver (≤150 pieces)' : 'Exact solver: server mode only' },
                ]}
              />
              <div className="flex-1" />
              <Toggle checked={draft.useInventory} onChange={(v) => setDraft({ useInventory: v })} label={<span className="text-xs">Use inventory stock</span>} tip="Prepend available inventory bars/offcuts of this material" />
            </div>
            <div className="text-2xs text-faint">Semantics: used = trim start + Σ pieces + n·kerf; mitre angles recorded, no mitre allowance added (warning).</div>
          </div>

          <div className="border-b border-line">
            <div className="panel-head h-8 text-xs">
              Stock lengths
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft({ stocks: [...draft.stocks, { id: `S${draft.stocks.length + 1}`, label: null, length: 6500, quantity: null, unlimited: true, is_offcut: false }] })}>
                Add
              </Button>
            </div>
            <table className="dense">
              <thead>
                <tr>
                  <th>Id</th>
                  <th className="num">Length</th>
                  <th className="num">Qty</th>
                  <th>∞</th>
                  <th>Offcut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.stocks.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <input className="input h-6 w-[90px] font-mono" value={s.id} onChange={(e) => setStock(i, { id: e.target.value })} />
                    </td>
                    <td>
                      <input className="input input-num h-6 w-[80px]" type="number" value={s.length} onChange={(e) => setStock(i, { length: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input input-num h-6 w-[60px]" type="number" disabled={s.unlimited} value={s.unlimited ? '' : (s.quantity ?? 0)} placeholder="∞" onChange={(e) => setStock(i, { quantity: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="checkbox" checked={s.unlimited} onChange={(e) => setStock(i, { unlimited: e.target.checked, quantity: e.target.checked ? null : (s.quantity ?? 1) })} aria-label="Unlimited" />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!s.is_offcut} onChange={(e) => setStock(i, { is_offcut: e.target.checked })} aria-label="Offcut" />
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 className="h-3.5 w-3.5" />} tip="Remove" onClick={() => setDraft({ stocks: draft.stocks.filter((_, k) => k !== i) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="panel-head h-8 text-xs">
              Pieces <span className="font-mono text-2xs font-normal text-faint">{draft.pieces.length} types · {totalPieces} pcs</span>
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" icon={<ClipboardPaste className="h-3.5 w-3.5" />} onClick={() => setPaste('')} data-testid="paste-pieces">
                Paste
              </Button>
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft({ pieces: [...draft.pieces, { id: `P${draft.pieces.length + 1}`, length: 1000, quantity: 1, angle_start: 90, angle_end: 90 }] })} data-testid="add-piece">
                Add
              </Button>
            </div>
            {!draft.pieces.length ? (
              <EmptyState className="py-6" title="No pieces" detail="Add rows, paste from Excel (mark, length, qty, angles), import a workbook, or send a profile from a calculation." />
            ) : (
              <table className="dense" onPaste={onPasteTable} data-testid="pieces-table">
                <thead>
                  <tr>
                    <th />
                    <th>Mark</th>
                    <th className="num">Length</th>
                    <th className="num">Qty</th>
                    <th className="num">∠ start</th>
                    <th className="num">∠ end</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.pieces.map((p, i) => (
                    <tr key={i} title={p.label ?? undefined}>
                      <td className="w-3 pr-0">
                        <span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: seriesColor(colorIndex.get(p.id) ?? i) }} />
                      </td>
                      <td>
                        <input className="input h-6 w-[80px] font-mono" value={p.id} onChange={(e) => setPiece(i, { id: e.target.value })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[84px]" type="number" step="any" value={p.length} onChange={(e) => setPiece(i, { length: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[56px]" type="number" value={p.quantity} onChange={(e) => setPiece(i, { quantity: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[52px]" type="number" value={p.angle_start ?? 90} onChange={(e) => setPiece(i, { angle_start: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[52px]" type="number" value={p.angle_end ?? 90} onChange={(e) => setPiece(i, { angle_end: Number(e.target.value) })} />
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" iconOnly icon={<Trash2 className="h-3.5 w-3.5" />} tip="Remove" onClick={() => setDraft({ pieces: draft.pieces.filter((_, k) => k !== i) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
              {mode === 'server' ? (
                <>
                  <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => void be.downloadTemplate('cutting').catch((e) => toast.error('Download failed', errorMessage(e)))}>
                    Excel template
                  </Button>
                  <Button size="sm" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
                    Import Excel
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importExcel(f);
                      e.target.value = '';
                    }}
                  />
                </>
              ) : (
                <>
                  <ServerOnlyButton size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
                    Excel template
                  </ServerOnlyButton>
                  <ServerOnlyButton size="sm" icon={<FileUp className="h-3.5 w-3.5" />}>
                    Import Excel
                  </ServerOnlyButton>
                </>
              )}
              <span className="text-2xs text-faint">Tip: paste Excel rows straight into the table.</span>
            </div>
            {errs.length > 0 && (
              <div className="mx-3 mb-3 rounded border border-err/40 bg-err/10 px-3 py-2 text-xs text-err" data-testid="cutting-input-errors">
                {errs.slice(0, 5).map((m) => (
                  <div key={m}>{m}</div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ---------------- results ---------------- */}
        <section className="flex min-w-0 flex-1 flex-col" data-testid="cutting-results">
          {!r ? (
            <EmptyState className="flex-1" icon={<Play className="h-5 w-5" />} title="No optimisation run yet" detail="Load the demo dataset or enter stock and pieces, then press Run optimisation." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                <ValidationStatusBadge status={r.validation_status} />
                <ValidatorBadge report={r.validation} />
                {mode === 'offline' && <OfflineEngineLabel />}
                <span className="ml-auto truncate font-mono text-2xs text-faint" title={r.method}>
                  {r.engine_version} · {r.method} · {fmtNum(r.runtime_ms, 0)} ms
                </span>
              </div>
              <div className="flex border-b border-line" data-testid="cutting-kpis">
                <Kpi label="Bars used" value={r.summary.bars_used} sub={`${r.patterns.length} patterns · ${fmtM(r.summary.total_stock_length)}`} testId="kpi-bars" />
                <Kpi label="Utilisation" value={fmtPct(r.summary.utilization)} sub="Σ pieces / Σ stock" tone="accent" />
                <Kpi label="Waste" value={fmtM(r.summary.waste_length)} sub={`kerf ${fmtM(r.summary.total_kerf_loss)} · trim ${fmtM(r.summary.total_trim_loss)}`} tone={r.summary.waste_length > 0 ? 'warn' : 'neutral'} />
                <Kpi label="Reusable offcut" value={fmtM(r.summary.reusable_offcut_length)} sub={`≥ ${fmtMm(r.request.min_reusable_offcut ?? 500)} mm`} tone="ok" />
                <Kpi
                  label="Lower bound · proof"
                  value={
                    <span>
                      {r.proof?.lower_bound_bars ?? '—'}
                      <span className="text-sm text-faint"> LB · gap {r.proof?.gap_bars ?? '—'}</span>
                    </span>
                  }
                  sub={<span className={r.validation_status === 'OPTIMAL_PROVEN' ? 'font-semibold text-ok' : 'font-semibold text-info'}>{r.validation_status === 'OPTIMAL_PROVEN' ? 'OPTIMAL_PROVEN' : 'FEASIBLE_HEURISTIC'}</span>}
                  testId="kpi-status"
                />
              </div>
              {r.proof && <div className="border-b border-line px-4 py-1.5 text-2xs text-muted">{r.proof.note}</div>}
              <Tabs
                className="px-3"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'bars', label: 'Bar diagrams', count: r.patterns.length },
                  { value: 'list', label: 'Cut list', count: r.patterns.reduce((a, p) => a + p.cuts.length, 0) },
                  { value: 'issues', label: 'Issues', count: r.issues.length + r.validation.errors.length + (r.unplaced.length ? 1 : 0) },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {tab === 'bars' && (
                  <div className="space-y-3 p-4" ref={barsRef} data-testid="bar-diagrams">
                    <div className="flex flex-wrap items-center gap-3 text-2xs text-muted">
                      {r.request.pieces.map((p, i) => (
                        <span key={p.id} className="inline-flex items-center gap-1">
                          <span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: seriesColor(i) }} />
                          <span className="font-mono">{p.id}</span> {fmtMm(p.length)}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 border border-ok bg-ok/15" /> reusable offcut</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 border border-dashed border-err bg-err/15" /> waste</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 border border-faint bg-[repeating-linear-gradient(45deg,#6b7685_0_1px,#1e252e_1px_4px)]" /> trim</span>
                    </div>
                    {r.patterns.map((p) => (
                      <div key={p.pattern_id} data-testid="bar-pattern">
                        <div className="mb-1 flex items-baseline gap-2 text-xs">
                          <span className="font-mono font-semibold">{p.pattern_id}</span>
                          <span className="rounded-sm bg-raised px-1.5 font-mono text-accent">× {p.count}</span>
                          <span className="text-muted">
                            stock {fmtMm(p.stock_length)} ({p.stock_id}){p.is_offcut_stock ? ' · offcut' : ''}
                          </span>
                          <span className="ml-auto font-mono text-2xs text-faint">
                            used {fmtMm(p.used_length)} · rem {fmtMm(p.remainder)} {p.offcut_reusable ? '(reusable)' : p.remainder > 0 ? '(waste)' : ''}
                          </span>
                        </div>
                        <BarDiagram p={p} kerf={r.request.kerf ?? 4} trimStart={r.request.trim_start ?? 10} trimEnd={r.request.trim_end ?? 0} colorOf={(id) => colorIndex.get(id) ?? -1} width={Math.max(300, barsWidth - 2)} />
                      </div>
                    ))}
                    {!r.patterns.length && <div className="text-sm text-faint">No bars could be cut.</div>}
                  </div>
                )}
                {tab === 'list' && (
                  <table className="dense" data-testid="cut-list-table">
                    <thead>
                      <tr>
                        <th>Pattern</th>
                        <th className="num">× bars</th>
                        <th>Stock</th>
                        <th className="num">#</th>
                        <th>Mark</th>
                        <th className="num">Length</th>
                        <th className="num">Offset</th>
                        <th>Angles</th>
                        <th>Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.patterns.flatMap((p) =>
                        p.cuts.map((c, i) => (
                          <tr key={`${p.pattern_id}-${i}`}>
                            <td className="font-mono">{i === 0 ? p.pattern_id : ''}</td>
                            <td className="num">{i === 0 ? p.count : ''}</td>
                            <td className="font-mono text-xs text-muted">{i === 0 ? `${p.stock_id} · ${fmtMm(p.stock_length)}` : ''}</td>
                            <td className="num text-faint">{i + 1}</td>
                            <td className="font-mono">{c.piece_id}</td>
                            <td className="num">{fmtMm(c.length, 2)}</td>
                            <td className="num text-muted">{fmtMm(c.offset, 2)}</td>
                            <td className="font-mono text-xs text-muted">
                              {c.angle_start}°/{c.angle_end}°
                            </td>
                            <td className="max-w-[260px] truncate text-xs text-faint">{c.label}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                )}
                {tab === 'issues' && (
                  <div>
                    {r.unplaced.length > 0 && (
                      <div className="m-3 rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
                        Unplaced: {r.unplaced.map((u) => `${u.quantity}× ${u.id} (${fmtMm(u.length)})`).join(', ')}
                      </div>
                    )}
                    {r.validation.errors.length > 0 && (
                      <>
                        <div className="section-title px-3 pt-2">Validator errors</div>
                        <IssueList issues={r.validation.errors} />
                      </>
                    )}
                    <div className="section-title px-3 pt-2">Optimiser issues</div>
                    <IssueList issues={r.issues} empty="No issues" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                <Button icon={<Save className="h-3.5 w-3.5" />} loading={saving} disabled={!eng || !!jobId || !r.validation.passed} onClick={() => void saveJob()} tip={!eng ? 'Requires engineer role' : jobId ? `Saved as job #${jobId}` : 'Persist this job (required for reports & offcut return)'} data-testid="save-cutting-job">
                  {jobId ? `Saved · job #${jobId}` : 'Save job'}
                </Button>
                {be.reportsAvailable ? (
                  <>
                    <Button icon={<FileDown className="h-3.5 w-3.5" />} disabled={!jobId || !r.validation.passed} tip={!jobId ? 'Save the job first' : 'Bar diagrams PDF'} onClick={() => void download('pdf')}>
                      PDF
                    </Button>
                    <Button icon={<FileDown className="h-3.5 w-3.5" />} disabled={!jobId || !r.validation.passed} tip={!jobId ? 'Save the job first' : 'Workshop cut list XLSX'} onClick={() => void download('xlsx')}>
                      XLSX
                    </Button>
                  </>
                ) : (
                  <>
                    <ServerOnlyButton icon={<FileDown className="h-3.5 w-3.5" />}>PDF</ServerOnlyButton>
                    <ServerOnlyButton icon={<FileDown className="h-3.5 w-3.5" />}>XLSX</ServerOnlyButton>
                  </>
                )}
                <Button icon={<PackagePlus className="h-3.5 w-3.5" />} disabled={!jobId || !r.validation.passed || r.summary.reusable_offcut_length <= 0} tip={!jobId ? 'Save the job first' : 'Add reusable offcuts to inventory'} onClick={() => void returnOffcuts()} data-testid="return-offcuts">
                  Return offcuts to inventory
                </Button>
                <div className="flex-1" />
                <span className="text-2xs text-faint">{usedStocks.size} stock class(es) used</span>
              </div>
            </>
          )}
        </section>
      </div>
      <Dialog
        open={paste !== null}
        onClose={() => setPaste(null)}
        title="Paste pieces from Excel"
        subtitle="Columns (tab separated): mark, length, qty, [angle start], [angle end], [label]. Header rows are skipped."
        width={620}
        footer={
          <>
            <Button onClick={() => setPaste(null)}>Cancel</Button>
            <Button
              variant="solid"
              data-testid="paste-apply"
              onClick={() => {
                const { pieces, skipped } = piecesFromTsv(paste ?? '');
                if (!pieces.length) return toast.warning('No valid rows found');
                setDraft({ pieces: [...draft.pieces, ...pieces] });
                setPaste(null);
                toast.success(`${pieces.length} row(s) added`, skipped ? `${skipped} skipped` : undefined);
              }}
            >
              Append rows
            </Button>
          </>
        }
      >
        <textarea className="input h-56 py-2 font-mono text-xs" value={paste ?? ''} onChange={(e) => setPaste(e.target.value)} placeholder={'M1\t4300\t6\nT1\t1449\t12\t90\t90\tTransom bay A'} data-testid="paste-text" />
      </Dialog>
    </div>
  );
}
