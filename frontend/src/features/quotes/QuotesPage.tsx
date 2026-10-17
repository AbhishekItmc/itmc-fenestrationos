import { FileDown, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { CalcRun, Quote } from '../../api/types';
import { fmtDateTime, fmtMoney, fmtNum } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip, ValidationStatusBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, IssueList, LoadingBlock, PageHeader, ProvisionalBanner } from '../../ui/Misc';

export default function QuotesPage() {
  const be = useBackend();
  const { projectId, projects, elevations, user } = useApp();
  const project = projects.find((p) => p.id === projectId);
  const runs = useAsync(() => (projectId ? be.listCalcRuns(projectId) : Promise.resolve([] as CalcRun[])), [be, projectId]);
  const quotes = useAsync(() => (projectId ? be.listQuotes(projectId) : Promise.resolve([] as Quote[])), [be, projectId]);
  const [selected, setSelected] = useState<number[]>([]);
  const [margin, setMargin] = useState(12);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Quote | null>(null);
  const writable = canWrite(user, 'quote');
  const usable = (runs.data ?? []).filter((r) => (r.validation_status ?? r.result?.validation_status) !== 'INVALID');

  const create = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const q = await be.createQuote(projectId, selected, margin, notes);
      toast.success(`Quotation ${q.number} created`, `Total ${fmtMoney(q.total, q.currency)} (demo prices)`);
      setOpen(q);
      setSelected([]);
      quotes.reload();
    } catch (e) {
      toast.error('Could not create quotation', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return <EmptyState className="h-full" icon={<ReceiptText className="h-5 w-5" />} title="Select a project" detail="Quotations are created per project from stored calculation runs." />;

  const q = open ?? quotes.data?.[0] ?? null;
  return (
    <div className="flex h-full flex-col" data-testid="quotes-page">
      <PageHeader title="Quotations" subtitle={`${project?.code} · ${project?.name}`} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[340px] shrink-0 overflow-auto border-r border-line bg-panel">
          <div className="panel-head h-8 text-xs">New quotation from calc runs</div>
          <div className="space-y-3 p-3">
            {runs.loading ? (
              <LoadingBlock />
            ) : !usable.length ? (
              <div className="text-xs text-faint">No valid calc runs. Run calculations on the Calculation / BOM page (saved elevations).</div>
            ) : (
              <div className="space-y-1">
                {usable.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded border border-line px-2 py-1.5 text-xs hover:bg-hover">
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} data-testid={`quote-run-${r.id}`} />
                    <span className="font-mono text-faint">#{r.id}</span>
                    <span className="min-w-0 flex-1 truncate">{elevations.find((e) => e.id === r.elevation_id)?.name ?? `elevation ${r.elevation_id}`}</span>
                    <span className="font-mono text-2xs text-faint">{fmtDateTime(r.created_at)}</span>
                  </label>
                ))}
              </div>
            )}
            <Field label="Margin %">
              <input className="input input-num w-28" type="number" min={0} max={500} step={0.5} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
            </Field>
            <Field label="Notes">
              <textarea className="input h-16 py-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button variant="solid" className="w-full justify-center" loading={busy} disabled={!selected.length || !writable || !(margin >= 0 && margin <= 500)} tip={!writable ? 'Requires admin or estimator role' : undefined} onClick={() => void create()} data-testid="create-quote">
              Create quotation
            </Button>
          </div>
          <div className="panel-head h-8 border-t text-xs">Quotations</div>
          {quotes.loading ? (
            <LoadingBlock />
          ) : !quotes.data?.length ? (
            <div className="p-3 text-xs text-faint">None yet.</div>
          ) : (
            quotes.data.map((x) => (
              <button key={x.id} className={`flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-hover ${q?.id === x.id ? 'bg-accent/10' : ''}`} onClick={() => setOpen(x)}>
                <span className="font-mono text-xs text-accent">{x.number}</span>
                <span className="ml-auto font-mono text-xs">{fmtMoney(x.total, x.currency)}</span>
              </button>
            ))
          )}
        </aside>
        <section className="min-w-0 flex-1 overflow-auto">
          {!q ? (
            <EmptyState icon={<ReceiptText className="h-5 w-5" />} title="No quotation selected" detail="Select calc runs on the left and create a quotation." />
          ) : (
            <div className="space-y-3 p-4" data-testid="quote-view">
              <ProvisionalBanner />
              <div className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">Demo prices — not a commercial offer</div>
              <div className="flex items-center gap-3">
                <h2 className="font-mono text-lg">{q.number}</h2>
                <Chip>{q.status}</Chip>
                <ValidationStatusBadge status={q.validation_status} />
                <div className="flex-1" />
                {be.reportsAvailable ? (
                  <Button icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void be.downloadReport('quote', q.id, 'pdf').catch((e) => toast.error('Download failed', errorMessage(e)))}>
                    PDF
                  </Button>
                ) : (
                  <ServerOnlyButton icon={<FileDown className="h-3.5 w-3.5" />}>PDF</ServerOnlyButton>
                )}
              </div>
              <div className="text-xs text-muted">
                Calc runs {q.calc_run_ids.map((i) => `#${i}`).join(', ')} · catalogue {q.catalogue_version} · {fmtDateTime(q.created_at)}
              </div>
              <div className="panel overflow-hidden">
                <table className="dense">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Description</th>
                      <th className="num">Qty</th>
                      <th>Unit</th>
                      <th className="num">Unit price</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{l.code}</td>
                        <td className="max-w-[380px] truncate" title={l.description}>
                          {l.description}
                        </td>
                        <td className="num">{fmtNum(l.quantity, l.unit === 'pcs' ? 0 : 2)}</td>
                        <td className="text-muted">{l.unit === 'm2' ? 'm²' : l.unit}</td>
                        <td className="num">{fmtMoney(l.unit_price ?? 0, q.currency)}</td>
                        <td className="num">{fmtMoney(l.amount, q.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="h-7 border-t border-line px-2.5 text-right text-muted">Subtotal</td>
                      <td className="num border-t border-line px-2.5">{fmtMoney(q.subtotal, q.currency)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="h-7 px-2.5 text-right text-muted">Margin {q.margin_pct}%</td>
                      <td className="num px-2.5">{fmtMoney(q.margin_amount, q.currency)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="h-8 px-2.5 text-right font-semibold">Total (demo)</td>
                      <td className="num px-2.5 text-md font-semibold text-accent" data-testid="quote-total">{fmtMoney(q.total, q.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {q.issues.length > 0 && (
                <div className="panel">
                  <div className="panel-head h-8 text-xs">Pricing issues</div>
                  <IssueList issues={q.issues} />
                </div>
              )}
              {q.notes && <div className="text-sm text-muted">{q.notes}</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
