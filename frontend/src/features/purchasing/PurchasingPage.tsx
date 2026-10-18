import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, FileDown, FileSpreadsheet, PackageCheck, Save, Send, ShoppingCart, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { CalcRun, PurchaseOrder, PurchaseOrderLine, PurchaseStatus } from '../../api/types';
import { ESTIMATE_NOTE, purchaseOrderCsv } from '../../engine/purchasing';
import { downloadText, safeFilename } from '../../lib/download';
import { fmtDateTime, fmtMoney, fmtNum } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import type { JobSummary } from '../../services/backend';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Toggle } from '../../ui/Field';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../../ui/Misc';

const statusTone: Record<PurchaseStatus, 'neutral' | 'info' | 'ok' | 'err'> = { draft: 'neutral', sent: 'info', received: 'ok', cancelled: 'err' };
export function PoStatusChip({ status }: { status: PurchaseStatus }) {
  return <Chip tone={statusTone[status] ?? 'neutral'}>{status}</Chip>;
}

const unitLabel = (u: string) => (u === 'm2' ? 'm²' : u);
const qtyFmt = (v: number, u: string) => fmtNum(v, u === 'bar' || u === 'pcs' ? 0 : 2);

export default function PurchasingPage() {
  const be = useBackend();
  const { projectId, projects, user } = useApp();
  const project = projects.find((p) => p.id === projectId);
  const list = useAsync(() => (projectId ? be.listPurchaseOrders(projectId) : Promise.resolve([] as PurchaseOrder[])), [be, projectId]);
  const [selId, setSelId] = useState<number | null>(null);
  const [gen, setGen] = useState(false);
  const writable = canWrite(user, 'purchase');
  const sel = list.data?.find((p) => p.id === selId) ?? null;

  useEffect(() => {
    if (selId === null && list.data?.length && window.matchMedia('(min-width: 1024px)').matches) setSelId(list.data[0].id);
  }, [selId, list.data]);

  if (!projectId) return <EmptyState className="h-full" icon={<ShoppingCart className="h-5 w-5" />} title="Select a project" detail="Purchase orders are generated per project from calculation runs." />;

  return (
    <div className="flex h-full flex-col" data-testid="purchasing-page">
      <PageHeader
        title="Purchasing"
        subtitle={`${project?.code ?? ''} · ${project?.name ?? ''} — material requirements against stock`}
        actions={
          <Button variant="solid" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={!writable} tip={!writable ? 'Requires admin, engineer or estimator role' : undefined} onClick={() => setGen(true)} data-testid="generate-po">
            Generate from calculation
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className={clsx('w-full shrink-0 overflow-auto border-r border-line bg-panel lg:w-[320px]', sel ? 'hidden lg:block' : 'block')} data-testid="po-list">
          <div className="panel-head h-8 text-xs">
            Purchase orders <span className="ml-auto font-mono text-2xs font-normal text-faint">{list.data?.length ?? 0}</span>
          </div>
          {list.loading && !list.data ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorBlock message={list.error} onRetry={list.reload} />
          ) : !list.data?.length ? (
            <div className="p-4 text-sm text-muted">No purchase orders yet. Generate them from calculation runs — profiles in bars, glass and panels in m², accessories in their unit, net of available stock.</div>
          ) : (
            list.data.map((p) => (
              <button key={p.id} className={clsx('block w-full border-b border-line/60 px-3 py-2.5 text-left hover:bg-hover', p.id === selId && 'bg-accent/10 shadow-[inset_2px_0_0_rgb(var(--accent))]')} onClick={() => setSelId(p.id)} data-testid={`po-${p.id}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-accent">{p.number}</span>
                  <PoStatusChip status={p.status} />
                  <span className="ml-auto font-mono text-xs">{fmtMoney(p.total, p.currency)}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <span className="shrink-0 capitalize">{p.category}</span>
                  <span className="shrink-0 text-faint">·</span>
                  <span className="min-w-0 truncate">{p.supplier}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-2xs text-faint">{p.lines.length} lines</span>
                </div>
              </button>
            ))
          )}
        </aside>
        <section className={clsx('min-w-0 flex-1 overflow-auto', !sel && 'hidden lg:block')}>
          {sel ? (
            <PoDetail key={`${sel.id}-${sel.updated_at}`} po={sel} writable={writable} onBack={() => setSelId(null)} onSaved={list.reload} />
          ) : (
            <EmptyState className="h-full" icon={<ShoppingCart className="h-5 w-5" />} title="No purchase order selected" detail="Generate purchase orders from calculation runs, then edit suppliers and quantities." />
          )}
        </section>
      </div>
      <GenerateDialog
        open={gen}
        onClose={() => setGen(false)}
        onCreated={(pos) => {
          setGen(false);
          list.reload();
          setSelId(pos[0]?.id ?? null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function PoDetail({ po, writable, onBack, onSaved }: { po: PurchaseOrder; writable: boolean; onBack: () => void; onSaved: () => void }) {
  const be = useBackend();
  const nav = useNavigate();
  const [supplier, setSupplier] = useState(po.supplier);
  const [notes, setNotes] = useState(po.notes ?? '');
  const [lines, setLines] = useState<PurchaseOrderLine[]>(po.lines);
  const [busy, setBusy] = useState<string | null>(null);
  const editable = writable && po.status === 'draft';
  const headerEditable = writable && (po.status === 'draft' || po.status === 'sent');
  const dirty = supplier !== po.supplier || notes !== (po.notes ?? '') || lines.some((l, i) => l.qty_to_order !== po.lines[i]?.qty_to_order);
  const headerChanges = () => ({ ...(supplier !== po.supplier ? { supplier } : {}), ...(notesChanged ? { notes } : {}), ...(editable && lines.some((l, i) => l.qty_to_order !== po.lines[i]?.qty_to_order) ? { lines } : {}) });
  const total = useMemo(() => Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100, [lines]);
  const estimate = lines.some((l) => l.note?.startsWith(ESTIMATE_NOTE));

  const setQty = (i: number, v: number) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, qty_to_order: v, amount: Math.round(v * l.unit_price * 100) / 100 } : l)));
  const notesChanged = notes !== (po.notes ?? '');

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, detail?: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok, detail);
      onSaved();
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const save = () => run('save', () => be.updatePurchaseOrder(po.id, headerChanges()), `${po.number} saved`);
  const setStatus = (status: PurchaseStatus) =>
    run(
      status,
      async () => {
        if (dirty) await be.updatePurchaseOrder(po.id, headerChanges());
        return be.updatePurchaseOrder(po.id, { status });
      },
      `${po.number} → ${status}`,
    );
  const receive = () => {
    const n = po.lines.filter((l) => l.qty_to_order > 0).length;
    if (!window.confirm(`Mark ${po.number} as received and book ${n} line(s) into inventory?`)) return;
    void run(
      'receive',
      async () => {
        if (dirty) await be.updatePurchaseOrder(po.id, headerChanges());
        return be.receivePurchaseOrder(po.id);
      },
      `${po.number} received`,
      `${n} line(s) added to inventory`,
    );
  };

  return (
    <div className="space-y-3 p-4" data-testid="po-detail">
      <div className="flex items-center gap-2 rounded border border-warn/50 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn" data-testid="po-demo-banner">
        <AlertTriangle className="h-4 w-4 shrink-0" /> Demo prices — not a commercial offer
        <span className="hidden font-normal text-warn/80 sm:inline">· provisional quantities from DEMO rules</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button className="btn btn-ghost btn-icon lg:hidden" onClick={onBack} aria-label="Back to purchase orders">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="font-mono text-lg font-semibold" data-testid="po-number">
          {po.number}
        </h2>
        <PoStatusChip status={po.status} />
        <Chip tone="accent">{po.category}</Chip>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2">
          {writable && po.status !== 'cancelled' && (
            <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={busy === 'save'} onClick={() => void save()} data-testid="po-save">
              Save
            </Button>
          )}
          {writable && po.status === 'draft' && (
            <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} loading={busy === 'sent'} onClick={() => void setStatus('sent')} data-testid="po-mark-sent">
              Mark sent
            </Button>
          )}
          {writable && (po.status === 'draft' || po.status === 'sent') && (
            <Button size="sm" variant="solid" icon={<PackageCheck className="h-3.5 w-3.5" />} loading={busy === 'receive'} onClick={receive} data-testid="po-mark-received">
              Mark received
            </Button>
          )}
          {writable && (po.status === 'draft' || po.status === 'sent') && (
            <Button size="sm" variant="ghost" icon={<XCircle className="h-3.5 w-3.5" />} loading={busy === 'cancelled'} onClick={() => window.confirm(`Cancel ${po.number}?`) && void setStatus('cancelled')}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {be.reportsAvailable ? (
          <>
            <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void be.downloadReport('purchase-order', po.id, 'pdf').catch((e) => toast.error('Download failed', errorMessage(e)))}>
              PDF
            </Button>
            <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => void be.downloadReport('purchase-order', po.id, 'xlsx').catch((e) => toast.error('Download failed', errorMessage(e)))}>
              XLSX
            </Button>
          </>
        ) : (
          <>
            <ServerOnlyButton size="sm" icon={<FileDown className="h-3.5 w-3.5" />}>
              PDF
            </ServerOnlyButton>
            <ServerOnlyButton size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
              XLSX
            </ServerOnlyButton>
          </>
        )}
        <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => downloadText(purchaseOrderCsv({ ...po, supplier, lines, total }), `${safeFilename(po.number)}.csv`, 'text/csv')} data-testid="po-csv">
          CSV
        </Button>
        {po.status === 'received' && (
          <Button size="sm" variant="ghost" onClick={() => nav('/inventory')}>
            View inventory →
          </Button>
        )}
        <span className="ml-auto text-xs text-muted">
          Calc runs {(po.calc_run_ids ?? []).map((i) => `#${i}`).join(', ') || '—'}
          {po.cutting_job_ids?.length ? ` · cutting jobs ${po.cutting_job_ids.map((i) => `#${i}`).join(', ')}` : ''} · {fmtDateTime(po.created_at)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          <input className="input" value={supplier} disabled={!headerEditable} onChange={(e) => setSupplier(e.target.value)} data-testid="po-supplier" />
        </Field>
        <Field label="Notes">
          <input className="input" value={notes} disabled={!writable || po.status === 'cancelled'} onChange={(e) => setNotes(e.target.value)} data-testid="po-notes" />
        </Field>
      </div>
      {estimate && (
        <div className="rounded border border-info/40 bg-info/10 px-3 py-1.5 text-xs text-info">Some profile bar counts are estimates (total length ÷ longest stock length). Generate with cutting jobs for exact bars.</div>
      )}
      <div className="panel overflow-x-auto">
        <table className="dense" data-testid="po-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Required</th>
              <th className="num">In stock</th>
              <th className="num">To order</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.item_type}-${l.item_id}-${l.stock_length ?? ''}-${i}`}>
                <td className="py-1">
                  <div className="flex max-w-[360px] items-baseline gap-2 leading-5">
                    <span className="shrink-0 font-mono text-xs font-medium">{l.code}</span>
                    <span className="min-w-0 truncate text-muted" title={l.description}>
                      {l.description}
                    </span>
                  </div>
                  {l.note && (
                    <div className={clsx('max-w-[360px] truncate text-2xs leading-4', l.note.startsWith(ESTIMATE_NOTE) ? 'text-info' : 'text-faint')} title={l.note}>
                      {l.note}
                    </div>
                  )}
                </td>
                <td className="num">
                  {qtyFmt(l.qty_required, l.unit)} <span className="text-2xs text-faint">{unitLabel(l.unit)}</span>
                </td>
                <td className={clsx('num', l.qty_in_stock > 0 ? 'text-ok' : 'text-faint')}>{qtyFmt(l.qty_in_stock, l.unit)}</td>
                <td className="num">
                  {editable ? (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="input input-num h-6 w-20"
                      value={l.qty_to_order}
                      onChange={(e) => setQty(i, Math.max(0, Number(e.target.value) || 0))}
                      data-testid={`po-qty-${i}`}
                      aria-label={`Quantity to order for ${l.code}`}
                    />
                  ) : (
                    <span className="font-semibold">{qtyFmt(l.qty_to_order, l.unit)}</span>
                  )}
                </td>
                <td className="num whitespace-nowrap">
                  {fmtMoney(l.unit_price, po.currency)}
                  {l.unit !== 'bar' && <span className="text-2xs text-faint">/{unitLabel(l.unit)}</span>}
                </td>
                <td className="num">{fmtMoney(l.amount, po.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="h-9 border-t border-line px-2.5 text-right font-semibold">
                Total (demo prices)
              </td>
              <td className="num border-t border-line px-2.5 text-md font-semibold text-accent" data-testid="po-total">
                {fmtMoney(total, po.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function GenerateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: PurchaseOrder[]) => void }) {
  const be = useBackend();
  const { projectId, elevations } = useApp();
  const runs = useAsync(() => (open && projectId ? be.listCalcRuns(projectId) : Promise.resolve([] as CalcRun[])), [be, projectId, open]);
  const jobs = useAsync(() => (open && projectId ? be.listCuttingJobs(projectId) : Promise.resolve([] as JobSummary[])), [be, projectId, open]);
  const [selRuns, setSelRuns] = useState<number[]>([]);
  const [selJobs, setSelJobs] = useState<number[]>([]);
  const [split, setSplit] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setSelRuns([]);
      setSelJobs([]);
      setSplit(true);
    }
  }, [open]);
  const usable = (runs.data ?? []).filter((r) => (r.validation_status ?? r.result?.validation_status) !== 'INVALID');
  const usableJobs = (jobs.data ?? []).filter((j) => j.validation_status !== 'INVALID');

  const create = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const pos = await be.purchaseOrdersFromCalc(projectId, { calc_run_ids: selRuns, cutting_job_ids: selJobs, split_by_category: split });
      toast.success(`${pos.length} purchase order(s) created`, pos.map((p) => p.number).join(', '));
      onCreated(pos);
    } catch (e) {
      toast.error('Could not generate purchase orders', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const check = (sel: number[], set: (v: number[]) => void, id: number, on: boolean) => set(on ? [...sel, id] : sel.filter((x) => x !== id));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Generate purchase orders"
      subtitle="Required quantities from calculation runs, net of available (non-residual) inventory."
      width={600}
      testId="generate-po-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" loading={busy} disabled={!selRuns.length} onClick={() => void create()} data-testid="create-po">
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="label">Calculation runs</div>
          {runs.loading ? (
            <LoadingBlock />
          ) : !usable.length ? (
            <div className="rounded border border-dashed border-line-strong p-3 text-sm text-muted">No valid calc runs — calculate a saved elevation first (Calculation / BOM or the editor).</div>
          ) : (
            <div className="space-y-1">
              {usable.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded border border-line px-2.5 py-2 text-sm hover:bg-hover">
                  <input type="checkbox" checked={selRuns.includes(r.id)} onChange={(e) => check(selRuns, setSelRuns, r.id, e.target.checked)} data-testid={`po-run-${r.id}`} />
                  <span className="font-mono text-xs text-faint">#{r.id}</span>
                  <span className="min-w-0 flex-1 truncate">{elevations.find((e) => e.id === r.elevation_id)?.name ?? r.result.elevation.name}</span>
                  <span className="font-mono text-2xs text-faint">{fmtDateTime(r.created_at)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="label">Cutting jobs (optional — exact bar counts)</div>
          {jobs.loading ? (
            <LoadingBlock />
          ) : !usableJobs.length ? (
            <div className="text-xs text-faint">No saved cutting jobs in this project. Without them, bars are estimated from total length.</div>
          ) : (
            <div className="space-y-1">
              {usableJobs.map((j) => (
                <label key={j.id} className="flex cursor-pointer items-center gap-2 rounded border border-line px-2.5 py-2 text-sm hover:bg-hover">
                  <input type="checkbox" checked={selJobs.includes(j.id)} onChange={(e) => check(selJobs, setSelJobs, j.id, e.target.checked)} data-testid={`po-job-${j.id}`} />
                  <span className="font-mono text-xs text-faint">#{j.id}</span>
                  <span className="min-w-0 flex-1 truncate">{j.name}</span>
                  {j.summary && typeof j.summary.bars_used === 'number' && <span className="font-mono text-2xs text-muted">{j.summary.bars_used} bars</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <Toggle checked={split} onChange={setSplit} label="Split by category (profiles · glass & panels · accessories)" testId="po-split" />
      </div>
    </Dialog>
  );
}
