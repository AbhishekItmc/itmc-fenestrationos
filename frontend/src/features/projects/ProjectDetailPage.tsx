import { ArrowLeft, Camera, ExternalLink, FilePlus2, History, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { ElevationRecord } from '../../api/types';
import { validateElevation } from '../../engine/elevation';
import { refreshProjects } from '../../layout/Shell';
import { fmtDate, fmtDateTime, fmtDim, fmtPct } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip, ProjectStatusChip, ValidationStatusBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field } from '../../ui/Field';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../ui/Misc';
import { useEditor } from '../editor/store';
import { ProjectDialog } from './dialogs';

function Card({ title, actions, children, testId }: { title: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="panel flex min-h-0 flex-col" data-testid={testId}>
      <div className="panel-head">
        <span className="flex-1">{title}</span>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

const ROLE_MATRIX: [string, string, string, string, string][] = [
  ['Edit project & customers', '✓', '✓', '✓', '—'],
  ['Edit elevations / revisions', '✓', '✓', '—', '—'],
  ['Calculate & optimise (persisted)', '✓', '✓', '—', '—'],
  ['Create quotations', '✓', '—', '✓', '—'],
  ['Edit catalogue / users / audit', '✓', '—', '—', '—'],
  ['View everything', '✓', '✓', '✓', '✓'],
];

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const be = useBackend();
  const nav = useNavigate();
  const { user, catalogue, selectProject, selectElevation } = useApp();
  const proj = useAsync(() => be.getProject(id), [be, id]);
  const elevs = useAsync(() => be.listElevations(id), [be, id]);
  const revs = useAsync(() => be.listRevisions(id), [be, id]);
  const members = useAsync(() => be.listMembers(id), [be, id]);
  const runs = useAsync(() => be.listCalcRuns(id), [be, id]);
  const cjobs = useAsync(() => be.listCuttingJobs(id), [be, id]);
  const njobs = useAsync(() => be.listNestingJobs(id), [be, id]);
  const [edit, setEdit] = useState(false);
  const [revDlg, setRevDlg] = useState(false);
  const [revLabel, setRevLabel] = useState('');
  const [revNote, setRevNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<ElevationRecord | null>(null);
  const [delProject, setDelProject] = useState(false);
  const eng = canWrite(user, 'engineering');
  const writable = canWrite(user, 'project');

  if (proj.loading) return <LoadingBlock label="Loading project…" />;
  if (proj.error || !proj.data) return <ErrorBlock message={proj.error ?? 'Project not found'} onRetry={proj.reload} />;
  const p = proj.data;

  const openElevation = (e: ElevationRecord) => {
    selectProject(p.id);
    selectElevation(e.id);
    nav(`/app/editor/${e.id}`);
  };
  const newElevation = () => {
    selectProject(p.id);
    selectElevation(null);
    useEditor.getState().clear();
    nav('/app/editor');
  };
  const createRevision = async () => {
    setBusy(true);
    try {
      const r = await be.createRevision(p.id, revLabel.trim(), revNote.trim());
      toast.success(`Revision ${r.label} created`, `Immutable snapshot of ${elevs.data?.length ?? 0} elevation(s)`);
      setRevDlg(false);
      setRevLabel('');
      setRevNote('');
      revs.reload();
    } catch (e) {
      toast.error('Could not create revision', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const deleteElevation = async () => {
    if (!del) return;
    try {
      await be.deleteElevation(del.id);
      toast.success('Elevation deleted', del.name);
      if (useEditor.getState().record?.id === del.id) useEditor.getState().clear();
      setDel(null);
      elevs.reload();
    } catch (e) {
      toast.error('Delete failed', errorMessage(e));
    }
  };
  const deleteProject = async () => {
    try {
      await be.deleteProject(p.id);
      toast.success('Project deleted', p.code);
      selectProject(null);
      await refreshProjects();
      nav('/app/projects');
    } catch (e) {
      toast.error('Delete failed', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="project-detail">
      <div className="border-b border-line bg-panel/60 px-5 pb-3 pt-3">
        <button className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => nav('/app/projects')}>
          <ArrowLeft className="h-3.5 w-3.5" /> All projects
        </button>
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-accent">{p.code}</span>
              <ProjectStatusChip status={p.status} />
              {p.demo && <Chip tone="prov">Demo project — fictitious</Chip>}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{p.name}</h1>
            <div className="mt-0.5 text-sm text-muted">
              {p.customer_name ?? 'No customer'} · {p.site ?? 'no site'} · created {fmtDate(p.created_at)}
            </div>
          </div>
          <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(true)} disabled={!writable}>
            Edit
          </Button>
          <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelProject(true)} disabled={!writable}>
            Delete
          </Button>
        </div>
        {p.description && <p className="mt-2 max-w-4xl text-sm text-muted">{p.description}</p>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] grid-rows-[1fr_1fr] gap-3 overflow-hidden p-3">
        <Card
          title={`Elevations (${elevs.data?.length ?? 0})`}
          testId="project-elevations"
          actions={
            <Button size="sm" variant="primary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={newElevation} disabled={!eng}>
              New elevation
            </Button>
          }
        >
          {elevs.loading ? (
            <LoadingBlock />
          ) : elevs.error ? (
            <ErrorBlock message={elevs.error} onRetry={elevs.reload} />
          ) : !elevs.data?.length ? (
            <EmptyState title="No elevations yet" detail="Open the CAD editor to draw the first elevation." />
          ) : (
            <table className="dense">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">W × H</th>
                  <th className="num">Bays</th>
                  <th className="num">Qty</th>
                  <th>Validation</th>
                  <th className="num">Ver</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {elevs.data.map((e) => {
                  const iss = validateElevation(e.data, catalogue);
                  const ne = iss.filter((i) => i.severity === 'error').length;
                  const nw = iss.filter((i) => i.severity === 'warning').length;
                  return (
                    <tr key={e.id} className="cursor-pointer" onClick={() => openElevation(e)}>
                      <td className="font-medium">{e.name}</td>
                      <td className="num">
                        {fmtDim(e.data.width)} × {fmtDim(e.data.height)}
                      </td>
                      <td className="num">{e.data.bays.length}</td>
                      <td className="num">{e.data.quantity}</td>
                      <td>{ne ? <Chip tone="err">{ne} error</Chip> : nw ? <Chip tone="warn">{nw} warn</Chip> : <Chip tone="ok">ok</Chip>}</td>
                      <td className="num">{e.version}</td>
                      <td className="font-mono text-xs text-muted">{fmtDateTime(e.updated_at)}</td>
                      <td className="text-right" onClick={(ev) => ev.stopPropagation()}>
                        <Button size="sm" variant="ghost" iconOnly icon={<ExternalLink className="h-3.5 w-3.5" />} tip="Open in CAD editor" onClick={() => openElevation(e)} />
                        <Button size="sm" variant="ghost" iconOnly icon={<Trash2 className="h-3.5 w-3.5" />} tip="Delete elevation" disabled={!eng} onClick={() => setDel(e)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card
          title="Revisions"
          testId="project-revisions"
          actions={
            <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} onClick={() => setRevDlg(true)} disabled={!eng} data-testid="create-revision">
              Create snapshot
            </Button>
          }
        >
          {revs.loading ? (
            <LoadingBlock />
          ) : revs.error ? (
            <ErrorBlock message={revs.error} onRetry={revs.reload} />
          ) : !revs.data?.length ? (
            <EmptyState icon={<History className="h-5 w-5" />} title="No revisions" detail="Snapshots are immutable copies of all elevations — create one before issuing drawings or quotes." />
          ) : (
            <table className="dense">
              <thead>
                <tr>
                  <th className="num">Rev</th>
                  <th>Label</th>
                  <th>Note</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {[...revs.data].reverse().map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.rev_no}</td>
                    <td className="font-medium">{r.label}</td>
                    <td className="max-w-[220px] truncate text-muted">{r.note ?? '—'}</td>
                    <td className="font-mono text-xs text-muted">{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Recent engineering jobs" testId="project-jobs">
          <table className="dense">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name / elevation</th>
                <th>Status</th>
                <th className="num">Result</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).slice(0, 8).map((r) => (
                <tr key={`c${r.id}`}>
                  <td className="text-muted">Calc run #{r.id}</td>
                  <td>{elevs.data?.find((e) => e.id === r.elevation_id)?.name ?? `elevation ${r.elevation_id ?? '—'}`}</td>
                  <td>
                    <ValidationStatusBadge status={r.validation_status ?? r.result?.validation_status} />
                  </td>
                  <td className="num">—</td>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
              {(cjobs.data ?? []).slice(0, 8).map((j) => (
                <tr key={`j${j.id}`}>
                  <td className="text-muted">1D cutting #{j.id}</td>
                  <td>{j.name}</td>
                  <td>
                    <ValidationStatusBadge status={j.validation_status} />
                  </td>
                  <td className="num">{typeof j.summary?.bars_used === 'number' ? `${j.summary.bars_used} bars · ${fmtPct(Number(j.summary.utilization))}` : '—'}</td>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(j.created_at)}</td>
                </tr>
              ))}
              {(njobs.data ?? []).slice(0, 8).map((j) => (
                <tr key={`n${j.id}`}>
                  <td className="text-muted">2D nesting #{j.id}</td>
                  <td>{j.name}</td>
                  <td>
                    <ValidationStatusBadge status={j.validation_status} />
                  </td>
                  <td className="num">{typeof j.summary?.sheets_used === 'number' ? `${j.summary.sheets_used} sheets · ${fmtPct(Number(j.summary.utilization))}` : '—'}</td>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(j.created_at)}</td>
                </tr>
              ))}
              {!runs.data?.length && !cjobs.data?.length && !njobs.data?.length && (
                <tr>
                  <td colSpan={5} className="text-center text-faint">
                    {runs.loading || cjobs.loading ? 'Loading…' : 'No calc runs or optimisation jobs yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-faint" /> Members & permissions <span className="text-2xs font-normal text-faint">(read-only)</span></span>} testId="project-members">
          <div className="px-3 py-2 text-xs text-muted">
            {members.loading ? 'Loading members…' : members.error ? `Members unavailable: ${members.error}` : members.data?.length ? `${members.data.length} explicit member(s); all other users act by their global role.` : 'No explicit members — access follows global roles.'}
          </div>
          {!!members.data?.length && (
            <table className="dense">
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.user_id}>
                    <td className="font-mono text-xs">{m.email ?? `user #${m.user_id}`}</td>
                    <td>
                      <Chip>{m.role}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <table className="dense mt-1">
            <thead>
              <tr>
                <th>Capability</th>
                <th className="text-center">admin</th>
                <th className="text-center">engineer</th>
                <th className="text-center">estimator</th>
                <th className="text-center">viewer</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_MATRIX.map(([cap, ...cells]) => (
                <tr key={cap}>
                  <td className="text-muted">{cap}</td>
                  {cells.map((c, i) => (
                    <td key={i} className={`text-center font-mono ${c === '✓' ? 'text-ok' : 'text-faint'}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 text-2xs text-faint">Your role: {user?.role}. Membership editing is admin-only (API).</div>
        </Card>
      </div>
      <ProjectDialog open={edit} project={p} onClose={() => setEdit(false)} onSaved={() => { proj.reload(); void refreshProjects(); }} />
      <Dialog
        open={revDlg}
        onClose={() => setRevDlg(false)}
        title="Create revision snapshot"
        subtitle="An immutable copy of the project and all its elevations."
        footer={
          <>
            <Button onClick={() => setRevDlg(false)}>Cancel</Button>
            <Button variant="solid" loading={busy} onClick={() => void createRevision()} data-testid="revision-save">
              Create snapshot
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Label" hint="Leave empty for automatic R{n}">
            <input className="input" value={revLabel} onChange={(e) => setRevLabel(e.target.value)} placeholder={`R${(revs.data?.length ?? 0) + 1}`} />
          </Field>
          <Field label="Note">
            <textarea className="input h-20 py-1.5" value={revNote} onChange={(e) => setRevNote(e.target.value)} placeholder="e.g. Issued for tender" />
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={del !== null}
        onClose={() => setDel(null)}
        title="Delete elevation?"
        footer={
          <>
            <Button onClick={() => setDel(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void deleteElevation()}>
              Delete
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">“{del?.name}” will be deleted. Existing revisions keep their snapshot copy.</div>
      </Dialog>
      <Dialog
        open={delProject}
        onClose={() => setDelProject(false)}
        title={`Delete project ${p.code}?`}
        footer={
          <>
            <Button onClick={() => setDelProject(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void deleteProject()}>
              Delete project
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">All elevations, revisions, calc runs, jobs and quotations of this project are deleted. This cannot be undone.</div>
      </Dialog>
    </div>
  );
}
