import { FileBarChart2, FileDown, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { CalcRun, ProductionOrder, PurchaseOrder, Quote } from '../../api/types';
import { downloadText, safeFilename } from '../../lib/download';
import { purchaseOrderCsv } from '../../engine/purchasing';
import { fmtDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useApp, useBackend } from '../../store/app';
import type { JobSummary, ReportLink } from '../../services/backend';
import { toast } from '../../store/toast';
import { ValidationStatusBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, LoadingBlock, PageHeader } from '../../ui/Misc';

const KIND_LABEL: Record<ReportLink['kind'], string> = { calc: 'Calculation', cutting: 'Cutting', nesting: 'Nesting', quote: 'Quotation', labels: 'Labels', production: 'Work order', 'purchase-order': 'Purchase order' };

export default function ReportsPage() {
  const be = useBackend();
  const { projectId, projects, elevations, mode } = useApp();
  const project = projects.find((p) => p.id === projectId);
  const data = useAsync(async () => {
    if (!projectId) return { links: [] as ReportLink[], pos: new Map<number, PurchaseOrder>() };
    const [runs, cj, nj, qs, wos, pos] = await Promise.all([
      be.listCalcRuns(projectId).catch(() => [] as CalcRun[]),
      be.listCuttingJobs(projectId).catch(() => [] as JobSummary[]),
      be.listNestingJobs(projectId).catch(() => [] as JobSummary[]),
      be.listQuotes(projectId).catch(() => [] as Quote[]),
      be.listProductionOrders(projectId).catch(() => [] as ProductionOrder[]),
      be.listPurchaseOrders(projectId).catch(() => [] as PurchaseOrder[]),
    ]);
    const links: ReportLink[] = [
      ...runs.map((r): ReportLink => ({ key: `c${r.id}`, kind: 'calc', id: r.id, title: `Calculation — ${elevations.find((e) => e.id === r.elevation_id)?.name ?? `elevation ${r.elevation_id}`} (run #${r.id})`, formats: ['pdf', 'xlsx'], status: r.validation_status ?? r.result?.validation_status, created_at: r.created_at })),
      ...cj.map((j): ReportLink => ({ key: `j${j.id}`, kind: 'cutting', id: j.id, title: `Cutting list & bar diagrams — ${j.name}`, formats: ['pdf', 'xlsx'], status: j.validation_status, created_at: j.created_at })),
      ...nj.map((j): ReportLink => ({ key: `n${j.id}`, kind: 'nesting', id: j.id, title: `Sheet layouts — ${j.name}`, formats: ['pdf', 'xlsx'], status: j.validation_status, created_at: j.created_at })),
      ...qs.map((q): ReportLink => ({ key: `q${q.id}`, kind: 'quote', id: q.id, title: `Quotation ${q.number} (demo prices)`, formats: ['pdf'], status: q.validation_status, created_at: q.created_at })),
      ...wos.flatMap((o): ReportLink[] => [
        { key: `w${o.id}`, kind: 'production', id: o.id, title: `Work order sheet ${o.number} — ${o.name}`, formats: ['pdf'], status: o.provisional === false ? 'VALIDATED' : 'PROVISIONAL_DEMO_RULES', created_at: o.created_at },
        { key: `l${o.id}`, kind: 'labels', id: o.id, title: `QR part labels ${o.number} (A4 · 24 per sheet) — ${o.counts.total} labels`, formats: ['pdf'], query: { layout: 'a4-24' }, href: `/production/${o.id}/labels?layout=a4-24`, status: o.provisional === false ? 'VALIDATED' : 'PROVISIONAL_DEMO_RULES', created_at: o.created_at },
      ]),
      ...pos.map((p): ReportLink => ({ key: `p${p.id}`, kind: 'purchase-order', id: p.id, title: `Purchase order ${p.number} · ${p.category} · ${p.supplier} (demo prices)`, formats: ['pdf', 'xlsx'], status: 'PROVISIONAL_DEMO_RULES', created_at: p.created_at })),
    ];
    return { links, pos: new Map(pos.map((p) => [p.id, p])) };
  }, [be, projectId, elevations]);
  const poById = data.data?.pos ?? new Map<number, PurchaseOrder>();
  const [busy, setBusy] = useState<string | null>(null);

  const dl = async (l: ReportLink, fmt: 'pdf' | 'xlsx') => {
    setBusy(`${l.key}${fmt}`);
    try {
      await be.downloadReport(l.kind, l.id, fmt, l.query);
    } catch (e) {
      toast.error('Download failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!projectId) return <EmptyState className="h-full" icon={<FileBarChart2 className="h-5 w-5" />} title="Select a project" detail="Reports are listed per project." />;
  return (
    <div className="flex h-full flex-col" data-testid="reports-page">
      <PageHeader title="Reports" subtitle={`${project?.code} · ${project?.name} — calculations, optimisation, quotations, work orders, QR labels and purchase orders; PDFs carry status and a DEMO watermark when provisional`} />
      {mode === 'offline' && <div className="mx-4 mt-3 rounded border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">PDF/XLSX reports are rendered by the server. In offline demo mode QR labels print from the browser and purchase orders download as CSV; other downloads are disabled.</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {data.loading ? (
          <LoadingBlock />
        ) : !data.data?.links.length ? (
          <EmptyState icon={<FileBarChart2 className="h-5 w-5" />} title="No reports yet" detail="Reports become available after persisted calc runs, saved cutting/nesting jobs, quotations, work orders and purchase orders." />
        ) : (
          <table className="dense" data-testid="reports-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Created</th>
                <th className="text-right">Download</th>
              </tr>
            </thead>
            <tbody>
              {data.data.links.map((l) => (
                <tr key={l.key}>
                  <td className="font-medium">{l.title}</td>
                  <td className="text-muted">{KIND_LABEL[l.kind]}</td>
                  <td>
                    <ValidationStatusBadge status={l.status} />
                  </td>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(l.created_at)}</td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {l.href && (
                      <Link to={l.href} className="btn btn-sm" data-testid={`report-open-${l.key}`}>
                        <Printer className="h-3.5 w-3.5" /> Print
                      </Link>
                    )}
                    {l.kind === 'purchase-order' && poById.get(l.id) && (
                      <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => { const p = poById.get(l.id)!; downloadText(purchaseOrderCsv(p), `${safeFilename(p.number)}.csv`, 'text/csv'); }}>
                        CSV
                      </Button>
                    )}
                    {l.formats.map((f) =>
                      be.reportsAvailable ? (
                        <Button key={f} size="sm" icon={<FileDown className="h-3.5 w-3.5" />} loading={busy === `${l.key}${f}`} disabled={l.status === 'INVALID'} tip={l.status === 'INVALID' ? 'Invalid results cannot be released' : undefined} onClick={() => void dl(l, f)}>
                          {f.toUpperCase()}
                        </Button>
                      ) : (
                        <ServerOnlyButton key={f} size="sm" icon={<FileDown className="h-3.5 w-3.5" />}>
                          {f.toUpperCase()}
                        </ServerOnlyButton>
                      ),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
