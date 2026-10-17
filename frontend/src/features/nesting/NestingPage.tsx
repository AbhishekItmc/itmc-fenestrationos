import { Calculator, ClipboardPaste, Database, Eraser, FileDown, FileSpreadsheet, FileUp, PackagePlus, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import type { EdgeTrim, Nesting2DRequest, Piece2D } from '../../api/types';
import { parseTsv } from '../../lib/download';
import { fmtArea, fmtMm, fmtNum, fmtPct } from '../../lib/format';
import { seriesColor } from '../../lib/palette';
import { useWidth } from '../../lib/useWidth';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { ValidationStatusBadge, ValidatorBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Toggle } from '../../ui/Field';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, IssueList, Kpi, OfflineEngineLabel, PageHeader, Tabs } from '../../ui/Misc';
import { useCalc } from '../calc/store';
import { fillGroupsInResult, nestingDraftFromCalc } from '../calc/transfer';
import { SheetView } from './SheetView';
import { demoNestingDraft, emptyNestingDraft, useNesting, type NestingDraft, type SheetRow } from './store';

export function piecesFromTsv2D(text: string): Piece2D[] {
  const out: Piece2D[] = [];
  for (const r of parseTsv(text)) {
    if (r.length < 4) continue;
    const w = Number(r[1].replace(',', '.'));
    const h = Number(r[2].replace(',', '.'));
    const q = Number(r[3]);
    if (!(w > 0) || !(h > 0) || !Number.isInteger(q) || q < 1) continue;
    const rot = (r[4] ?? '').toLowerCase();
    out.push({ id: r[0] || `Q${out.length + 1}`, width: w, height: h, quantity: q, can_rotate: !['0', 'no', 'n', 'false'].includes(rot), label: r[5] || null });
  }
  return out;
}

function errorsOf(d: NestingDraft): string[] {
  const e: string[] = [];
  if (!d.sheets.length) e.push('Add at least one sheet');
  if (!d.pieces.length) e.push('Add at least one piece');
  d.sheets.forEach((s, i) => {
    if (!(s.width > 0 && s.height > 0)) e.push(`Sheet row ${i + 1}: size must be > 0`);
  });
  d.pieces.forEach((p, i) => {
    if (!p.id.trim()) e.push(`Piece row ${i + 1}: id required`);
    if (!(p.width > 0 && p.height > 0)) e.push(`Piece ${p.id}: size must be > 0`);
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push(`Piece ${p.id}: quantity must be ≥ 1`);
  });
  return e;
}

function toRequest(d: NestingDraft): Nesting2DRequest {
  return {
    units: 'mm',
    kerf: d.kerf,
    edge_trim: d.edge_trim,
    guillotine: d.guillotine,
    min_residual_width: d.min_residual_width,
    min_residual_height: d.min_residual_height,
    prefer_residuals: true,
    sheets: d.sheets.map((s) => ({ id: s.id, label: s.label ?? null, width: s.width, height: s.height, quantity: s.unlimited ? null : (s.quantity ?? 0), material: s.material || null, thickness: s.thickness ?? null, is_residual: !!s.is_residual })),
    pieces: d.pieces.map((p) => ({ ...p, id: p.id.trim(), material: p.material || null })),
  };
}

type Tab = 'layouts' | 'list' | 'issues';

export default function NestingPage() {
  const be = useBackend();
  const { catalogue: cat, projectId, user, mode } = useApp();
  const { draft, result: r, jobId, setDraft, replaceDraft, setResult } = useNesting();
  const lastCalc = useCalc((s) => s.last);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('layouts');
  const [paste, setPaste] = useState<string | null>(null);
  const [fromCalc, setFromCalc] = useState(false);
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const errs = errorsOf(draft);
  const eng = canWrite(user, 'engineering');
  const colorIndex = useMemo(() => new Map((r?.request.pieces ?? draft.pieces).map((p, i) => [p.id, i] as const)), [r, draft.pieces]);
  const setSheet = (i: number, p: Partial<SheetRow>) => setDraft({ sheets: draft.sheets.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setPiece = (i: number, p: Partial<Piece2D>) => setDraft({ pieces: draft.pieces.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setTrim = (p: Partial<EdgeTrim>) => setDraft({ edge_trim: { ...draft.edge_trim, ...p } });

  const run = async () => {
    if (errs.length) return toast.error('Fix the inputs first', errs[0]);
    setBusy(true);
    try {
      const res = await be.optimize2D(toRequest(draft));
      setResult(res);
      setTab(res.validation.passed ? 'layouts' : 'issues');
      if (!res.validation.passed) toast.error('Independent validator FAILED', 'Export and release are blocked.');
      else toast.success(`${res.summary.sheets_used} sheet(s) · ${fmtPct(res.summary.utilization)}`, res.unplaced.length ? `${res.unplaced.reduce((a, u) => a + u.quantity, 0)} piece(s) unplaced` : undefined);
    } catch (e) {
      toast.error('Nesting failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const saveJob = async () => {
    if (!r) return;
    setSaving(true);
    try {
      const job = await be.createNestingJob(projectId ?? null, draft.name || 'Nesting job', r.request);
      setResult(job.result ?? r, job.id);
      toast.success(`Nesting job #${job.id} saved`);
    } catch (e) {
      toast.error('Save failed', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const importExcel = async (file: File) => {
    try {
      const res = await be.importNestingExcel(file);
      const sheets = res.sheets.map((s) => ({ ...s, unlimited: s.quantity == null }));
      setDraft({ pieces: res.pieces, ...(sheets.length ? { sheets } : {}) });
      const n = res.issues.filter((i) => i.severity === 'error').length;
      if (n) toast.warning(`Imported with ${n} error(s)`, res.issues[0]?.message);
      else toast.success('Excel imported', `${res.pieces.length} pieces, ${sheets.length} sheets`);
    } catch (e) {
      toast.error('Excel import failed', errorMessage(e));
    }
  };

  const commonScale = r && r.layouts.length ? Math.min(...r.layouts.map((l) => Math.min((Math.max(300, wrapW - 26) - 8) / l.width, 392 / l.height))) : 0.1;
  const groups = lastCalc && lastCalc.result.validation_status !== 'INVALID' ? fillGroupsInResult(lastCalc.result, cat) : [];

  return (
    <div className="flex h-full flex-col" data-testid="nesting-page">
      <PageHeader
        title="2D Nesting"
        subtitle={draft.source ? `Source: ${draft.source}` : 'Glass / ACP / sheet nesting — guillotine or free rectangle packing with an independent validator (ARCHITECTURE §4)'}
        actions={
          <>
            <Button icon={<Calculator className="h-3.5 w-3.5" />} onClick={() => setFromCalc(true)} disabled={!groups.length} tip={groups.length ? 'Load a glass/panel group from the last calculation' : 'Calculate an elevation first'}>
              From calculation
            </Button>
            <Button icon={<Database className="h-3.5 w-3.5" />} onClick={() => replaceDraft(demoNestingDraft())} data-testid="load-demo-nesting">
              Load demo
            </Button>
            <Button variant="ghost" icon={<Eraser className="h-3.5 w-3.5" />} onClick={() => replaceDraft(emptyNestingDraft())}>
              Clear
            </Button>
            <Button variant="solid" icon={<Play className="h-3.5 w-3.5" />} loading={busy} onClick={() => void run()} disabled={errs.length > 0} tip={errs[0]} data-testid="run-nesting">
              Run nesting
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[500px] shrink-0 overflow-auto border-r border-line bg-panel">
          <div className="space-y-3 border-b border-line p-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Job name" className="col-span-2">
                <input className="input" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
              </Field>
              <Field label="Kerf">
                <input className="input input-num" type="number" min={0} step="any" value={draft.kerf} onChange={(e) => setDraft({ kerf: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
                <Field key={k} label={`Trim ${k}`}>
                  <input className="input input-num" type="number" min={0} value={draft.edge_trim[k]} onChange={(e) => setTrim({ [k]: Number(e.target.value) })} />
                </Field>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="Min residual W">
                <input className="input input-num" type="number" min={0} value={draft.min_residual_width} onChange={(e) => setDraft({ min_residual_width: Number(e.target.value) })} />
              </Field>
              <Field label="Min residual H">
                <input className="input input-num" type="number" min={0} value={draft.min_residual_height} onChange={(e) => setDraft({ min_residual_height: Number(e.target.value) })} />
              </Field>
              <div className="pb-1">
                <Toggle checked={draft.guillotine} onChange={(v) => setDraft({ guillotine: v })} label={<span className="text-xs">Guillotine</span>} tip="Edge-to-edge cuts only (glass scoring). Off allows MaxRects free packing (ACP routing)." />
              </div>
            </div>
          </div>
          <div className="border-b border-line">
            <div className="panel-head h-8 text-xs">
              Sheets
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft({ sheets: [...draft.sheets, { id: `SH${draft.sheets.length + 1}`, label: null, width: 3210, height: 2250, quantity: null, unlimited: true, is_residual: false }] })}>
                Add
              </Button>
            </div>
            <table className="dense">
              <thead>
                <tr>
                  <th>Id</th>
                  <th className="num">W</th>
                  <th className="num">H</th>
                  <th className="num">Qty</th>
                  <th>∞</th>
                  <th>Resid.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.sheets.map((s, i) => (
                  <tr key={i} title={s.label ?? undefined}>
                    <td>
                      <input className="input h-6 w-[90px] font-mono" value={s.id} onChange={(e) => setSheet(i, { id: e.target.value })} />
                    </td>
                    <td>
                      <input className="input input-num h-6 w-[70px]" type="number" value={s.width} onChange={(e) => setSheet(i, { width: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input input-num h-6 w-[70px]" type="number" value={s.height} onChange={(e) => setSheet(i, { height: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input input-num h-6 w-[52px]" type="number" disabled={s.unlimited} placeholder="∞" value={s.unlimited ? '' : (s.quantity ?? 0)} onChange={(e) => setSheet(i, { quantity: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="checkbox" checked={s.unlimited} onChange={(e) => setSheet(i, { unlimited: e.target.checked, quantity: e.target.checked ? null : 1 })} aria-label="Unlimited" />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!s.is_residual} onChange={(e) => setSheet(i, { is_residual: e.target.checked })} aria-label="Residual sheet" />
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 className="h-3.5 w-3.5" />} tip="Remove" onClick={() => setDraft({ sheets: draft.sheets.filter((_, k) => k !== i) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="panel-head h-8 text-xs">
              Pieces <span className="font-mono text-2xs font-normal text-faint">{draft.pieces.reduce((a, p) => a + (p.quantity || 0), 0)} pcs</span>
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" icon={<ClipboardPaste className="h-3.5 w-3.5" />} onClick={() => setPaste('')}>
                Paste
              </Button>
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft({ pieces: [...draft.pieces, { id: `Q${draft.pieces.length + 1}`, width: 1000, height: 800, quantity: 1, can_rotate: true }] })}>
                Add
              </Button>
            </div>
            {!draft.pieces.length ? (
              <EmptyState className="py-6" title="No pieces" detail="Load the demo, send a glass list from a calculation, paste from Excel or import a workbook." />
            ) : (
              <table className="dense" data-testid="nesting-pieces">
                <thead>
                  <tr>
                    <th />
                    <th>Id</th>
                    <th className="num">W</th>
                    <th className="num">H</th>
                    <th className="num">Qty</th>
                    <th>Rotate</th>
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
                        <input className="input h-6 w-[84px] font-mono" value={p.id} onChange={(e) => setPiece(i, { id: e.target.value })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[70px]" type="number" step="any" value={p.width} onChange={(e) => setPiece(i, { width: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[70px]" type="number" step="any" value={p.height} onChange={(e) => setPiece(i, { height: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input input-num h-6 w-[52px]" type="number" value={p.quantity} onChange={(e) => setPiece(i, { quantity: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={p.can_rotate !== false} onChange={(e) => setPiece(i, { can_rotate: e.target.checked })} aria-label="Can rotate" />
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
                  <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => void be.downloadTemplate('nesting').catch((e) => toast.error('Download failed', errorMessage(e)))}>
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
            </div>
            {errs.length > 0 && (
              <div className="mx-3 mb-3 rounded border border-err/40 bg-err/10 px-3 py-2 text-xs text-err">
                {errs.slice(0, 5).map((m) => (
                  <div key={m}>{m}</div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" data-testid="nesting-results">
          {!r ? (
            <EmptyState className="flex-1" icon={<Play className="h-5 w-5" />} title="No nesting run yet" detail="Load the demo dataset or send a glass list from a calculation, then press Run nesting." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                <ValidationStatusBadge status={r.validation_status} />
                <ValidatorBadge report={r.validation} />
                {mode === 'offline' && <OfflineEngineLabel />}
                <span className="ml-auto truncate font-mono text-2xs text-faint">
                  {r.engine_version} · {r.method} · {fmtNum(r.runtime_ms, 0)} ms
                </span>
              </div>
              <div className="flex border-b border-line" data-testid="nesting-kpis">
                <Kpi label="Sheets used" value={r.summary.sheets_used} sub={`${r.layouts.length} distinct layouts`} />
                <Kpi label="Utilisation" value={fmtPct(r.summary.utilization)} sub="Σ piece area / Σ sheet area" tone="accent" />
                <Kpi label="Piece area" value={fmtArea(r.summary.total_piece_area_m2)} sub={`of ${fmtArea(r.summary.total_sheet_area_m2)}`} />
                <Kpi label="Reusable residual" value={fmtArea(r.summary.reusable_residual_area_m2)} sub={`≥ ${r.request.min_residual_width}×${r.request.min_residual_height}`} tone="ok" />
                <Kpi label="Waste" value={fmtArea(r.summary.waste_area_m2)} tone="warn" />
                <Kpi label="Lower bound" value={r.lower_bound_sheets ?? '—'} sub={r.validation_status === 'OPTIMAL_PROVEN' ? 'proven: = area bound' : 'area bound'} />
              </div>
              <Tabs
                className="px-3"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'layouts', label: 'Sheet layouts', count: r.layouts.length },
                  { value: 'list', label: 'Placements', count: r.layouts.reduce((a, l) => a + l.placements.length, 0) },
                  { value: 'issues', label: 'Issues & unplaced', count: r.issues.length + r.unplaced.length + r.validation.errors.length },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {tab === 'layouts' && (
                  <div ref={wrapRef} className="grid gap-4 p-4" data-testid="sheet-layouts">
                    {r.layouts.map((lay) => (
                      <div key={lay.layout_id} className="panel p-3" data-testid="sheet-layout">
                        <div className="mb-2 flex items-baseline gap-2 text-xs">
                          <span className="font-mono font-semibold">{lay.layout_id}</span>
                          <span className="rounded-sm bg-raised px-1.5 font-mono text-accent">× {lay.count}</span>
                          <span className="text-muted">
                            {lay.sheet_label ?? lay.sheet_id} · {fmtMm(lay.width)} × {fmtMm(lay.height)}
                            {lay.is_residual_sheet ? ' · residual sheet' : ''}
                          </span>
                          <span className="ml-auto font-mono text-muted">
                            {lay.placements.length} pcs · util <span className="text-fg">{fmtPct(lay.utilization)}</span>
                          </span>
                        </div>
                        <SheetView lay={lay} trim={r.request.edge_trim ?? { left: 0, right: 0, top: 0, bottom: 0 }} colorOf={(id) => colorIndex.get(id) ?? -1} scale={commonScale} />
                      </div>
                    ))}
                    {!r.layouts.length && <div className="text-sm text-faint">No layouts produced.</div>}
                  </div>
                )}
                {tab === 'list' && (
                  <table className="dense">
                    <thead>
                      <tr>
                        <th>Layout</th>
                        <th>Piece</th>
                        <th className="num">x</th>
                        <th className="num">y</th>
                        <th className="num">W</th>
                        <th className="num">H</th>
                        <th>Rotated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.layouts.flatMap((l) =>
                        l.placements.map((p, i) => (
                          <tr key={`${l.layout_id}-${i}`}>
                            <td className="font-mono">{i === 0 ? `${l.layout_id} ×${l.count}` : ''}</td>
                            <td className="font-mono">{p.piece_id}</td>
                            <td className="num">{fmtMm(p.x)}</td>
                            <td className="num">{fmtMm(p.y)}</td>
                            <td className="num">{fmtMm(p.width)}</td>
                            <td className="num">{fmtMm(p.height)}</td>
                            <td>{p.rotated ? '↻ 90°' : '—'}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                )}
                {tab === 'issues' && (
                  <div>
                    {r.unplaced.length > 0 && (
                      <>
                        <div className="section-title px-3 pt-3">Unplaced pieces</div>
                        <table className="dense" data-testid="unplaced">
                          <tbody>
                            {r.unplaced.map((u) => (
                              <tr key={u.id}>
                                <td className="font-mono">{u.id}</td>
                                <td className="num">
                                  {fmtMm(u.width)} × {fmtMm(u.height)}
                                </td>
                                <td className="num">{u.quantity} pcs</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                    {r.validation.errors.length > 0 && <IssueList issues={r.validation.errors} />}
                    <div className="section-title px-3 pt-3">Optimiser issues</div>
                    <IssueList issues={r.issues} empty="No issues" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                <Button icon={<Save className="h-3.5 w-3.5" />} loading={saving} disabled={!eng || !!jobId || !r.validation.passed} onClick={() => void saveJob()} data-testid="save-nesting-job">
                  {jobId ? `Saved · job #${jobId}` : 'Save job'}
                </Button>
                {be.reportsAvailable ? (
                  <>
                    <Button icon={<FileDown className="h-3.5 w-3.5" />} disabled={!jobId || !r.validation.passed} tip={!jobId ? 'Save the job first' : undefined} onClick={() => void be.downloadReport('nesting', jobId!, 'pdf').catch((e) => toast.error('Download failed', errorMessage(e)))}>
                      PDF
                    </Button>
                    <Button icon={<FileDown className="h-3.5 w-3.5" />} disabled={!jobId || !r.validation.passed} tip={!jobId ? 'Save the job first' : undefined} onClick={() => void be.downloadReport('nesting', jobId!, 'xlsx').catch((e) => toast.error('Download failed', errorMessage(e)))}>
                      XLSX
                    </Button>
                  </>
                ) : (
                  <>
                    <ServerOnlyButton icon={<FileDown className="h-3.5 w-3.5" />}>PDF</ServerOnlyButton>
                    <ServerOnlyButton icon={<FileDown className="h-3.5 w-3.5" />}>XLSX</ServerOnlyButton>
                  </>
                )}
                <Button
                  icon={<PackagePlus className="h-3.5 w-3.5" />}
                  disabled={!jobId || !r.validation.passed || r.summary.reusable_residual_area_m2 <= 0}
                  tip={!jobId ? 'Save the job first' : 'Add reusable residuals to inventory'}
                  onClick={() =>
                    void be
                      .residualsFromNesting(jobId!)
                      .then((items) => toast.success(`${items.length} residual line(s) added to inventory`))
                      .catch((e) => toast.error('Could not return residuals', errorMessage(e)))
                  }
                >
                  Return residuals to inventory
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
      <Dialog
        open={paste !== null}
        onClose={() => setPaste(null)}
        title="Paste pieces from Excel"
        subtitle="Columns: id, width, height, qty, [rotate yes/no], [label]"
        width={600}
        footer={
          <>
            <Button onClick={() => setPaste(null)}>Cancel</Button>
            <Button
              variant="solid"
              onClick={() => {
                const pieces = piecesFromTsv2D(paste ?? '');
                if (!pieces.length) return toast.warning('No valid rows found');
                setDraft({ pieces: [...draft.pieces, ...pieces] });
                setPaste(null);
                toast.success(`${pieces.length} row(s) added`);
              }}
            >
              Append rows
            </Button>
          </>
        }
      >
        <textarea className="input h-56 py-2 font-mono text-xs" value={paste ?? ''} onChange={(e) => setPaste(e.target.value)} placeholder={'G1\t1480\t1780\t6\tyes'} />
      </Dialog>
      <Dialog open={fromCalc} onClose={() => setFromCalc(false)} title="Nest fills from the last calculation" subtitle={lastCalc ? `${lastCalc.elevationName} · ${lastCalc.result.glass_items.length} fill items` : undefined} footer={<Button onClick={() => setFromCalc(false)}>Close</Button>}>
        <div className="space-y-1">
          {groups.map((g) => (
            <button
              key={g.key}
              className="flex w-full items-center gap-2 rounded border border-line px-3 py-2 text-left hover:border-accent/50 hover:bg-hover"
              onClick={() => {
                replaceDraft(nestingDraftFromCalc(lastCalc!.result, g.key, cat, lastCalc!.elevationName));
                setFromCalc(false);
              }}
            >
              <span className="font-mono text-xs text-accent">{g.label}</span>
              <span className="text-sm text-muted">{g.count} pcs</span>
              <span className="ml-auto font-mono text-2xs text-faint">{g.thickness ?? '?'} mm</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
