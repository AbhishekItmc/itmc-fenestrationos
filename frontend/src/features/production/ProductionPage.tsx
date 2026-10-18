import clsx from 'clsx';
import { ArrowLeft, Calculator, ChevronDown, Factory, FileDown, Plus, Printer, QrCode, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { CalcRun, LabelLayout, Part, PartDetail, PartKind, PartStatus, ProductionOrder, ProductionStatus } from '../../api/types';
import { fmtPartSize, pctComplete, stationLabel, STATIONS } from '../../engine/production';
import { fmtDate, fmtDateTime, fmtNum } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog, Drawer } from '../../ui/Dialog';
import { Field } from '../../ui/Field';
import { ServerOnlyButton } from '../../ui/InDev';
import { Menu } from '../../ui/Menu';
import { EmptyState, ErrorBlock, Kpi, LoadingBlock, PageHeader, Tabs } from '../../ui/Misc';
import { OrderStatusChip, PartStatusChip, statusDot } from './common';
import { LABEL_LAYOUTS } from './labels';
import { kindIcon, PartPanel } from './PartPanel';


export function ProgressBar({ value, className, testId }: { value: number; className?: string; testId?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-raised', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} data-testid={testId}>
      <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ProductionPage() {
  const be = useBackend();
  const nav = useNavigate();
  const params = useParams();
  const orderId = params.orderId ? Number(params.orderId) : null;
  const { projectId, projects, user } = useApp();
  const project = projects.find((p) => p.id === projectId);
  const orders = useAsync(() => (projectId ? be.listProductionOrders(projectId) : Promise.resolve([] as ProductionOrder[])), [be, projectId]);
  const [creating, setCreating] = useState(false);
  const writable = canWrite(user, 'production');

  // select the first order when none in the URL (wide screens)
  useEffect(() => {
    if (!orderId && orders.data?.length && window.matchMedia('(min-width: 1024px)').matches) nav(`/production/${orders.data[0].id}`, { replace: true });
  }, [orderId, orders.data, nav]);

  if (!projectId) return <EmptyState className="h-full" icon={<Factory className="h-5 w-5" />} title="Select a project" detail="Work orders are created per project from stored calculation runs." />;

  return (
    <div className="flex h-full flex-col" data-testid="production-page">
      <PageHeader
        title="Production"
        subtitle={`${project?.code ?? ''} · ${project?.name ?? ''} — work orders, part tracking and QR labels`}
        actions={
          <Button variant="solid" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)} disabled={!writable} tip={!writable ? 'Requires admin or engineer role' : undefined} data-testid="new-work-order">
            New work order
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className={clsx('w-full shrink-0 overflow-auto border-r border-line bg-panel lg:w-[300px]', orderId ? 'hidden lg:block' : 'block')} data-testid="work-order-list">
          <div className="panel-head h-8 text-xs">
            Work orders <span className="ml-auto font-mono text-2xs font-normal text-faint">{orders.data?.length ?? 0}</span>
          </div>
          {orders.loading && !orders.data ? (
            <LoadingBlock />
          ) : orders.error ? (
            <ErrorBlock message={orders.error} onRetry={orders.reload} />
          ) : !orders.data?.length ? (
            <div className="p-4 text-sm text-muted">No work orders yet. Create one from calculation runs to explode the elevation into individually tracked parts.</div>
          ) : (
            orders.data.map((o) => (
              <button
                key={o.id}
                className={clsx('block w-full border-b border-line/60 px-3 py-2.5 text-left hover:bg-hover', o.id === orderId && 'bg-accent/10 shadow-[inset_2px_0_0_rgb(var(--accent))]')}
                onClick={() => nav(`/production/${o.id}`)}
                data-testid={`wo-${o.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-accent">{o.number}</span>
                  <OrderStatusChip status={o.status} />
                  <span className="ml-auto font-mono text-2xs text-faint">{Math.round(pctComplete(o.counts) * 100)}%</span>
                </div>
                <div className="mt-0.5 truncate text-sm">{o.name}</div>
                <ProgressBar value={pctComplete(o.counts)} className="mt-1.5 h-1" />
                <div className="mt-1 flex gap-3 font-mono text-2xs text-faint">
                  <span>{o.counts.total} parts</span>
                  {o.counts.blocked > 0 && <span className="text-err">{o.counts.blocked} blocked</span>}
                  {o.due_date && <span className="ml-auto">due {fmtDate(o.due_date)}</span>}
                </div>
              </button>
            ))
          )}
        </aside>
        <section className={clsx('min-w-0 flex-1 overflow-auto', !orderId && 'hidden lg:block')}>
          {orderId ? (
            <OrderDetail key={orderId} orderId={orderId} onChanged={orders.reload} />
          ) : (
            <EmptyState className="h-full" icon={<Factory className="h-5 w-5" />} title="No work order selected" detail="Pick a work order on the left, or create one from calculation runs." />
          )}
        </section>
      </div>
      <NewWorkOrderDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(o) => {
          setCreating(false);
          orders.reload();
          nav(`/production/${o.id}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function OrderDetail({ orderId, onChanged }: { orderId: number; onChanged: () => void }) {
  const be = useBackend();
  const nav = useNavigate();
  const { user, mode } = useApp();
  const [tick, setTick] = useState(0);
  const data = useAsync(async () => {
    const [order, board, parts] = await Promise.all([be.getProductionOrder(orderId), be.getBoard(orderId), be.listParts(orderId)]);
    return { order, board, parts };
  }, [be, orderId, tick]);
  const [tab, setTab] = useState<'board' | 'parts'>('board');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [stationFilter, setStationFilter] = useState('');
  const writable = canWrite(user, 'production');
  const reload = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  if (data.loading && !data.data) return <LoadingBlock />;
  if (data.error || !data.data) return <ErrorBlock message={data.error ?? 'Not found'} onRetry={data.reload} />;
  const { order, board, parts } = data.data;
  const c = order.counts;

  const setStatus = async (status: ProductionStatus) => {
    try {
      await be.updateProductionOrder(order.id, { status });
      toast.success(`${order.number} → ${status.replace('_', ' ')}`);
      reload();
    } catch (e) {
      toast.error('Status change refused', errorMessage(e));
    }
  };
  const pdf = (kind: 'labels' | 'production', layout?: LabelLayout) => be.downloadReport(kind, order.id, 'pdf', layout ? { layout } : undefined).catch((e) => toast.error('Download failed', errorMessage(e)));

  return (
    <div className="space-y-3 p-4" data-testid="order-detail">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => nav('/production')} aria-label="Back to work orders">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="font-mono text-lg font-semibold" data-testid="order-number">
          {order.number}
        </h2>
        <OrderStatusChip status={order.status} />
        <span className="min-w-0 truncate text-md">{order.name}</span>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {writable && order.status === 'planned' && (
            <Button size="sm" variant="primary" onClick={() => void setStatus('released')} data-testid="release-order">
              Release to shop floor
            </Button>
          )}
          {writable && order.status === 'released' && (
            <Button size="sm" onClick={() => void setStatus('planned')}>
              Back to planned
            </Button>
          )}
          {writable && !['done', 'cancelled'].includes(order.status) && (
            <Button size="sm" variant="ghost" onClick={() => window.confirm(`Cancel ${order.number}? Parts can no longer be scanned.`) && void setStatus('cancelled')}>
              Cancel order
            </Button>
          )}
          <Menu
            align="right"
            testId="labels-menu"
            trigger={(_o, toggle) => (
              <Button size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={toggle} data-testid="print-labels">
                Print labels <ChevronDown className="h-3 w-3" />
              </Button>
            )}
            items={[
              ...LABEL_LAYOUTS.map((l) => ({ label: l.label, hint: <span className="text-2xs text-faint">{l.detail}</span>, icon: <QrCode className="h-3.5 w-3.5" />, onClick: () => nav(`/production/${order.id}/labels?layout=${l.value}`), testId: `labels-${l.value}` })),
              ...(mode === 'server' ? LABEL_LAYOUTS.map((l) => ({ label: `PDF · ${l.label}`, icon: <FileDown className="h-3.5 w-3.5" />, onClick: () => void pdf('labels', l.value) })) : []),
            ]}
          />
          {be.reportsAvailable ? (
            <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void pdf('production')} data-testid="wo-pdf">
              Work order PDF
            </Button>
          ) : (
            <ServerOnlyButton size="sm" icon={<FileDown className="h-3.5 w-3.5" />}>
              Work order PDF
            </ServerOnlyButton>
          )}
        </div>
      </div>
      <div className="text-xs text-muted">
        Calc runs {order.calc_run_ids.map((i) => `#${i}`).join(', ')} · created {fmtDateTime(order.created_at)}
        {order.due_date ? ` · due ${fmtDate(order.due_date)}` : ''}
        {order.notes ? ` · ${order.notes}` : ''}
      </div>

      <div className="panel" data-testid="order-kpis">
        <div className="flex flex-wrap">
          <Kpi label="Total parts" value={fmtNum(c.total)} testId="kpi-total" />
          <Kpi label="Pending" value={fmtNum(c.pending)} testId="kpi-pending" />
          <Kpi label="In progress" value={fmtNum(c.in_progress)} tone={c.in_progress ? 'accent' : 'neutral'} testId="kpi-in-progress" />
          <Kpi label="Done" value={fmtNum(c.done)} tone={c.done ? 'ok' : 'neutral'} testId="kpi-done" />
          <Kpi label="Blocked" value={fmtNum(c.blocked)} tone={c.blocked ? 'err' : 'neutral'} testId="kpi-blocked" />
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
          <span className="section-title">Complete</span>
          <ProgressBar value={pctComplete(c)} testId="order-progress" />
          <span className="w-14 text-right font-mono text-sm font-semibold" data-testid="order-pct">
            {(pctComplete(c) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'board', label: 'Station board' },
          { value: 'parts', label: 'Parts', count: parts.length },
        ]}
      />
      {tab === 'board' ? (
        <StationBoard
          board={board.stations}
          parts={parts}
          onOpen={setOpenCode}
          onMore={(sid) => {
            setStationFilter(sid);
            setTab('parts');
          }}
        />
      ) : (
        <PartsTable parts={parts} onOpen={setOpenCode} initialStation={stationFilter} />
      )}
      <PartDrawer code={openCode} onClose={() => setOpenCode(null)} onChanged={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
const statusOrder: Record<PartStatus, number> = { blocked: 0, in_progress: 1, pending: 2, done: 3 };
const CHIP_LIMIT = 60;
/** Shop-floor order of cut marks: mullions, transoms/sills/heads, pressure plates, cover caps, then fills. */
const markOrder = (mark: string) => {
  const p = /^[A-Z]+/.exec(mark)?.[0] ?? '';
  return ({ M: 0, S: 1, T: 2, H: 3, PP: 4, CC: 5, G: 6, SP: 7, P: 8 } as Record<string, number>)[p] ?? 9;
};

function StationBoard({ board, parts, onOpen, onMore }: { board: { id: string; label: string; pending: number; in_progress: number; done_here: number; blocked: number }[]; parts: Part[]; onOpen: (code: string) => void; onMore: (station: string) => void }) {
  const byStation = useMemo(() => {
    const m = new Map<string, Part[]>();
    for (const p of parts) if (p.current_station) m.set(p.current_station, [...(m.get(p.current_station) ?? []), p]);
    for (const l of m.values()) l.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || markOrder(a.mark) - markOrder(b.mark) || a.mark.localeCompare(b.mark, undefined, { numeric: true }) || a.seq - b.seq);
    return m;
  }, [parts]);
  const done = parts.filter((p) => p.status === 'done').length;
  return (
    <div className="grid auto-cols-[minmax(176px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-2" data-testid="station-board">
      {board.map((s) => {
        const here = byStation.get(s.id) ?? [];
        return (
          <div key={s.id} className="flex min-h-[260px] flex-col rounded border border-line bg-panel" data-testid={`board-${s.id}`}>
            <div className="border-b border-line px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="ml-auto font-mono text-xs text-muted" data-tip="Parts at this station now">
                  {s.pending + s.in_progress + s.blocked}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-2xs">
                <span className="text-muted" data-testid={`board-${s.id}-pending`}>
                  {s.pending} waiting
                </span>
                <span className={s.in_progress ? 'text-info' : 'text-faint'}>{s.in_progress} working</span>
                <span className={s.blocked ? 'text-err' : 'text-faint'}>{s.blocked} blocked</span>
                <span className="text-ok" data-tip="Parts that have passed this station">
                  {s.done_here} passed
                </span>
              </div>
            </div>
            <div className="flex flex-1 flex-wrap content-start gap-1 p-2">
              {here.slice(0, CHIP_LIMIT).map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.code)}
                  data-testid={`chip-${p.code}`}
                  title={`${p.code} · ${p.mark}·${p.seq} · ${p.description} · ${fmtPartSize(p)} · ${p.status}`}
                  className={clsx(
                    'flex h-6 items-center gap-1 rounded-sm border px-1.5 font-mono text-2xs transition-colors hover:border-accent hover:bg-accent/10',
                    p.status === 'blocked' ? 'border-err/60 bg-err/10 text-err' : p.status === 'in_progress' ? 'border-info/60 bg-info/10 text-info' : 'border-line-strong bg-raised text-fg',
                  )}
                >
                  <span className={clsx('h-1.5 w-1.5 rounded-full', statusDot[p.status])} />
                  {p.mark}
                  <span className="opacity-60">·{p.seq}</span>
                </button>
              ))}
              {here.length > CHIP_LIMIT && (
                <button className="h-6 rounded-sm px-1.5 text-2xs text-accent hover:underline" onClick={() => onMore(s.id)}>
                  +{here.length - CHIP_LIMIT} more…
                </button>
              )}
              {!here.length && <div className="w-full py-6 text-center text-xs text-faint">No parts here</div>}
            </div>
          </div>
        );
      })}
      <div className="flex min-h-[260px] flex-col rounded border border-ok/30 bg-ok/5" data-testid="board-done">
        <div className="border-b border-ok/30 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ok">Done</span>
            <span className="ml-auto font-mono text-xs text-ok">{done}</span>
          </div>
          <div className="mt-1 font-mono text-2xs text-muted">all stations complete</div>
        </div>
        <div className="flex flex-1 flex-wrap content-start gap-1 p-2">
          {parts
            .filter((p) => p.status === 'done')
            .slice(0, CHIP_LIMIT)
            .map((p) => (
              <button key={p.id} onClick={() => onOpen(p.code)} className="flex h-6 items-center gap-1 rounded-sm border border-ok/50 bg-ok/10 px-1.5 font-mono text-2xs text-ok hover:border-ok">
                {p.mark}
                <span className="opacity-60">·{p.seq}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function PartsTable({ parts, onOpen, initialStation }: { parts: Part[]; onOpen: (code: string) => void; initialStation?: string }) {
  const [status, setStatus] = useState<PartStatus | ''>('');
  const [station, setStation] = useState(initialStation ?? '');
  const [kind, setKind] = useState<PartKind | ''>('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return parts.filter(
      (p) =>
        (!status || p.status === status) &&
        (!station || p.current_station === station) &&
        (!kind || p.kind === kind) &&
        (!s || p.code.toLowerCase().includes(s) || p.mark.toLowerCase().includes(s) || p.description.toLowerCase().includes(s) || (p.elevation_name ?? '').toLowerCase().includes(s)),
    );
  }, [parts, status, station, kind, q]);
  return (
    <div className="panel overflow-hidden" data-testid="parts-table">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input className="input pl-7" placeholder="Search code, mark, description…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="parts-search" />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as PartStatus | '')} data-testid="parts-filter-status" aria-label="Status filter">
          <option value="">All statuses</option>
          {(['pending', 'in_progress', 'blocked', 'done'] as const).map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={station} onChange={(e) => setStation(e.target.value)} data-testid="parts-filter-station" aria-label="Station filter">
          <option value="">All stations</option>
          {STATIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as PartKind | '')} data-testid="parts-filter-kind" aria-label="Kind filter">
          <option value="">All kinds</option>
          <option value="profile">Profiles</option>
          <option value="glass">Glass</option>
          <option value="panel">Panels</option>
        </select>
        <span className="font-mono text-2xs text-faint">
          {rows.length} / {parts.length}
        </span>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="dense">
          <thead>
            <tr>
              <th>Code</th>
              <th>Mark</th>
              <th>Description</th>
              <th className="num">Size</th>
              <th>Elevation</th>
              <th>Station</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((p) => (
              <tr key={p.id} className="cursor-pointer" onClick={() => onOpen(p.code)} data-testid={`part-row-${p.code}`}>
                <td className="font-mono text-xs font-semibold text-accent">{p.code}</td>
                <td className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    {kindIcon(p.kind, 'h-3.5 w-3.5')}
                    <span className="text-fg">{p.mark}</span>·{p.seq}
                  </span>
                </td>
                <td className="max-w-[280px] truncate" title={p.description}>
                  {p.description}
                </td>
                <td className="num text-xs">{fmtPartSize(p)}</td>
                <td className="max-w-[180px] truncate text-muted">{p.elevation_name ?? '—'}</td>
                <td>{p.status === 'done' ? <span className="text-faint">—</span> : stationLabel(p.current_station)}</td>
                <td>
                  <PartStatusChip status={p.status} />
                </td>
                <td className="font-mono text-2xs text-muted">{fmtDateTime(p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && <div className="p-2 text-center text-xs text-faint">Showing the first 500 parts — refine the filters.</div>}
        {!rows.length && <div className="p-6 text-center text-sm text-faint">No parts match the filters.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
export function PartDrawer({ code, onClose, onChanged }: { code: string | null; onClose: () => void; onChanged?: () => void }) {
  const be = useBackend();
  const user = useApp((s) => s.user);
  const [tick, setTick] = useState(0);
  const d = useAsync(() => (code ? be.getPart(code) : Promise.resolve(null as PartDetail | null)), [be, code, tick]);
  return (
    <Drawer open={!!code} onClose={onClose} title={code ? `Part ${code}` : ''} subtitle={d.data ? `${d.data.order.number} · ${d.data.project.code}` : undefined} width={480} testId="part-drawer">
      <div className="p-4">
        {d.loading && !d.data ? (
          <LoadingBlock />
        ) : d.error ? (
          <ErrorBlock message={d.error} />
        ) : d.data ? (
          <PartPanel
            detail={d.data}
            station={d.data.part.current_station}
            canAct={canWrite(user, 'operate')}
            onChanged={() => {
              setTick((t) => t + 1);
              onChanged?.();
            }}
          />
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function NewWorkOrderDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (o: ProductionOrder) => void }) {
  const be = useBackend();
  const { projectId, projects, elevations } = useApp();
  const project = projects.find((p) => p.id === projectId);
  const runs = useAsync(() => (open && projectId ? be.listCalcRuns(projectId) : Promise.resolve([] as CalcRun[])), [be, projectId, open]);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [calcBusy, setCalcBusy] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setSelected([]);
      setName(project ? `${project.code} — production batch` : 'Production batch');
      setDue('');
      setNotes('');
    }
  }, [open, project]);

  const usable = (runs.data ?? []).filter((r) => (r.validation_status ?? r.result?.validation_status) !== 'INVALID');
  // latest run per elevation first
  const seen = new Set<number>();
  const latest = usable.filter((r) => {
    const k = Number(r.elevation_id ?? -r.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const older = usable.filter((r) => !latest.includes(r));
  const withoutRun = elevations.filter((e) => !usable.some((r) => r.elevation_id === e.id));
  const pieceCount = (r: CalcRun) => r.result.profile_cuts.reduce((a, c) => a + c.quantity, 0) + r.result.glass_items.reduce((a, g) => a + g.quantity, 0);
  const total = usable.filter((r) => selected.includes(r.id)).reduce((a, r) => a + pieceCount(r), 0);

  const calcNow = async (eid: number) => {
    setCalcBusy(eid);
    try {
      const run = await be.calculateElevation(eid);
      if ((run.validation_status ?? run.result.validation_status) === 'INVALID') toast.warning('Calculation is INVALID', 'Fix the elevation in the editor before production.');
      else setSelected((s) => [...s, run.id]);
      runs.reload();
    } catch (e) {
      toast.error('Calculation failed', errorMessage(e));
    } finally {
      setCalcBusy(null);
    }
  };

  const create = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const o = await be.createProductionOrder({ project_id: projectId, name: name.trim(), calc_run_ids: selected, due_date: due || null, notes: notes || null });
      toast.success(`Work order ${o.number} created`, `${o.counts.total} parts with QR codes`);
      onCreated(o);
    } catch (e) {
      toast.error('Could not create work order', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runRow = (r: CalcRun) => (
    <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded border border-line px-2.5 py-2 text-sm hover:bg-hover">
      <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} data-testid={`wo-run-${r.id}`} />
      <span className="font-mono text-xs text-faint">#{r.id}</span>
      <span className="min-w-0 flex-1 truncate">{elevations.find((e) => e.id === r.elevation_id)?.name ?? r.result.elevation.name}</span>
      <span className="font-mono text-2xs text-muted">{pieceCount(r)} pcs</span>
      <span className="hidden font-mono text-2xs text-faint sm:inline">{fmtDateTime(r.created_at)}</span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New work order"
      subtitle="Explodes calc runs into individually tracked parts — one per physical piece, each with a QR code."
      width={620}
      testId="new-wo-dialog"
      footer={
        <>
          <span className="mr-auto font-mono text-xs text-muted" data-testid="wo-part-estimate">
            {total ? `${total} parts` : ''}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" loading={busy} disabled={!selected.length || !name.trim()} onClick={() => void create()} data-testid="create-work-order">
            Create work order
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="wo-name" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Due date (optional)">
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="label">Calculation runs</div>
          {runs.loading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-1">
              {latest.map(runRow)}
              {older.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer py-1 text-muted">Older runs ({older.length})</summary>
                  <div className="space-y-1">{older.map(runRow)}</div>
                </details>
              )}
              {!usable.length && <div className="rounded border border-dashed border-line-strong p-3 text-sm text-muted">No valid calculation runs in this project yet.</div>}
            </div>
          )}
        </div>
        {withoutRun.length > 0 && (
          <div>
            <div className="label">Saved elevations without a calc run</div>
            <div className="space-y-1">
              {withoutRun.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded border border-dashed border-line-strong px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-muted">{e.name}</span>
                  <Button size="sm" icon={<Calculator className="h-3.5 w-3.5" />} loading={calcBusy === e.id} onClick={() => void calcNow(e.id)} data-testid={`wo-calc-${e.id}`}>
                    Calculate
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-2xs text-faint">
          <Chip tone="prov">Demo</Chip> Parts come from the PROVISIONAL demo rule set — not for fabrication.
        </div>
      </div>
    </Dialog>
  );
}
