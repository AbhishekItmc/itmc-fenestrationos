import { ArrowDownUp, Building2, FolderPlus, Pencil, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Customer, Project, ProjectStatus } from '../../api/types';
import { PROJECT_STATUSES } from '../../api/types';
import { refreshProjects } from '../../layout/Shell';
import { fmtDate } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { Chip, ProjectStatusChip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Dialog';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../../ui/Misc';
import { CustomerDialog, ProjectDialog } from './dialogs';

type SortKey = 'code' | 'name' | 'customer' | 'status' | 'created';

export default function ProjectsPage() {
  const be = useBackend();
  const user = useApp((s) => s.user);
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => be.listProjects(), [be]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const [dlg, setDlg] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [custDrawer, setCustDrawer] = useState(false);
  const writable = canWrite(user, 'project');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (data ?? []).filter(
      (p) => (status === 'all' || p.status === status) && (!s || [p.code, p.name, p.customer_name ?? '', p.site ?? ''].some((x) => x.toLowerCase().includes(s))),
    );
    const val = (p: Project) => (sort.key === 'customer' ? (p.customer_name ?? '') : sort.key === 'created' ? (p.created_at ?? '') : String(p[sort.key] ?? ''));
    return [...list].sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [data, q, status, sort]);

  const th = (key: SortKey, label: string) => (
    <th>
      <button className="inline-flex items-center gap-1 uppercase hover:text-fg" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 })}>
        {label}
        <ArrowDownUp className={`h-3 w-3 ${sort.key === key ? 'text-accent' : 'opacity-40'}`} />
      </button>
    </th>
  );

  return (
    <div className="flex h-full flex-col" data-testid="projects-page">
      <PageHeader
        title="Projects"
        subtitle="Facade packages, elevations, revisions and engineering jobs"
        actions={
          <>
            <Button icon={<Users className="h-3.5 w-3.5" />} onClick={() => setCustDrawer(true)}>
              Customers
            </Button>
            <Button variant="solid" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => setDlg({ open: true, project: null })} disabled={!writable} tip={writable ? undefined : 'Your role cannot create projects'} data-testid="new-project">
              New project
            </Button>
          </>
        }
      >
        <div className="mt-3 flex items-center gap-2">
          <div className="relative w-[320px]">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input className="input pl-7" placeholder="Search code, name, customer, site…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="project-search" />
          </div>
          <div className="seg">
            {(['all', ...PROJECT_STATUSES] as const).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)} className="capitalize">
                {s}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="font-mono text-2xs text-faint">
            {rows.length} / {data?.length ?? 0} projects
          </span>
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock label="Loading projects…" />
        ) : error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !rows.length ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title={data?.length ? 'No projects match the filter' : 'No projects yet'}
            detail={data?.length ? 'Change the search or status filter.' : 'Create your first project to start drawing elevations.'}
            action={!data?.length && writable ? <Button variant="primary" onClick={() => setDlg({ open: true, project: null })}>New project</Button> : undefined}
          />
        ) : (
          <table className="dense" data-testid="projects-table">
            <thead>
              <tr>
                {th('code', 'Code')}
                {th('name', 'Project')}
                {th('customer', 'Customer')}
                <th>Site</th>
                {th('status', 'Status')}
                {th('created', 'Created')}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/app/projects/${p.id}`)}>
                  <td className="font-mono text-xs font-medium text-accent">{p.code}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="max-w-[360px] truncate font-medium">{p.name}</span>
                      {p.demo && (
                        <Chip tone="prov" tip="Demo project — fictitious">
                          demo
                        </Chip>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[240px] truncate text-muted">{p.customer_name ?? '—'}</td>
                  <td className="max-w-[200px] truncate text-muted">{p.site ?? '—'}</td>
                  <td>
                    <ProjectStatusChip status={p.status} />
                  </td>
                  <td className="font-mono text-xs text-muted">{fmtDate(p.created_at)}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil className="h-3.5 w-3.5" />} tip="Edit project" disabled={!writable} onClick={() => setDlg({ open: true, project: p })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ProjectDialog
        open={dlg.open}
        project={dlg.project}
        onClose={() => setDlg({ open: false, project: null })}
        onSaved={() => {
          reload();
          void refreshProjects();
        }}
      />
      <CustomersDrawer open={custDrawer} onClose={() => setCustDrawer(false)} writable={writable} />
    </div>
  );
}

function CustomersDrawer({ open, onClose, writable }: { open: boolean; onClose: () => void; writable: boolean }) {
  const be = useBackend();
  const { data, loading, error, reload } = useAsync(() => (open ? be.listCustomers() : Promise.resolve([] as Customer[])), [be, open]);
  const [dlg, setDlg] = useState<{ open: boolean; c: Customer | null }>({ open: false, c: null });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Customers"
      subtitle="Demo records are fictitious"
      width={620}
      actions={
        <Button size="sm" variant="primary" disabled={!writable} onClick={() => setDlg({ open: true, c: null })}>
          New customer
        </Button>
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="No customers" />
      ) : (
        <table className="dense">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>E-mail</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  {c.name} {c.demo && <Chip tone="prov">demo</Chip>}
                </td>
                <td className="text-muted">{c.contact_name ?? '—'}</td>
                <td className="text-muted">{c.email ?? '—'}</td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" iconOnly icon={<Pencil className="h-3.5 w-3.5" />} tip="Edit" disabled={!writable} onClick={() => setDlg({ open: true, c })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CustomerDialog open={dlg.open} customer={dlg.c} onClose={() => setDlg({ open: false, c: null })} onSaved={() => reload()} />
    </Drawer>
  );
}
