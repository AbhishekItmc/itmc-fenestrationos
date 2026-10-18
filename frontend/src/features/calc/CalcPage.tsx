import { Calculator, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { CalcRun, ElevationRecord } from '../../api/types';
import { fmtDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { ValidationStatusBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState, LoadingBlock, PageHeader } from '../../ui/Misc';
import { CalcResultsView } from './CalcResultsView';
import { useCalc } from './store';

export default function CalcPage() {
  const be = useBackend();
  const nav = useNavigate();
  const { projectId, elevations, projects, user } = useApp();
  const last = useCalc((s) => s.last);
  const runs = useAsync(() => (projectId ? be.listCalcRuns(projectId) : Promise.resolve([] as CalcRun[])), [be, projectId, last?.runId]);
  const [busy, setBusy] = useState<number | null>(null);
  const project = projects.find((p) => p.id === projectId);
  const eng = canWrite(user, 'engineering');

  const runFor = async (e: ElevationRecord) => {
    setBusy(e.id);
    try {
      const run = await be.calculateElevation(e.id);
      const result = run.result ?? (await be.getCalcRun(run.id)).result;
      useCalc.getState().setLast({ result, runId: run.id, elevationId: e.id, projectId: e.project_id, elevationName: e.name, at: new Date().toISOString(), engine: be.mode });
      toast.success('Calculation run stored', `${e.name} · run #${run.id}`);
    } catch (err) {
      toast.error('Calculation failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const openRun = async (r: CalcRun) => {
    try {
      const full = r.result ? r : await be.getCalcRun(r.id);
      const el = elevations.find((x) => x.id === full.elevation_id);
      useCalc.getState().setLast({ result: full.result, runId: full.id, elevationId: full.elevation_id ?? null, projectId: full.project_id ?? null, elevationName: el?.name ?? full.result.elevation.name, at: full.created_at ?? new Date().toISOString(), engine: be.mode });
    } catch (err) {
      toast.error('Could not open run', errorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="calc-page">
      <PageHeader title="Calculation / BOM" subtitle={project ? `${project.code} · ${project.name}` : 'Select a project in the top bar to run persisted calculations'} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[300px] shrink-0 overflow-auto border-r border-line bg-panel">
          <div className="panel-head h-8 text-xs">Elevations</div>
          {!projectId ? (
            <div className="p-3 text-xs text-faint">No project selected.</div>
          ) : !elevations.length ? (
            <div className="p-3 text-xs text-faint">This project has no elevations.</div>
          ) : (
            elevations.map((e) => (
              <div key={e.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{e.name}</div>
                  <div className="font-mono text-2xs text-faint">v{e.version}</div>
                </div>
                <Button size="sm" iconOnly icon={<FolderOpen className="h-3.5 w-3.5" />} tip="Open in editor" onClick={() => nav(`/app/editor/${e.id}`)} />
                <Button size="sm" variant="primary" icon={<Calculator className="h-3.5 w-3.5" />} loading={busy === e.id} disabled={!eng} tip={eng ? 'Persisted calculation run' : 'Requires engineer role'} onClick={() => void runFor(e)} data-testid={`calc-run-${e.id}`}>
                  Run
                </Button>
              </div>
            ))
          )}
          <div className="panel-head h-8 border-t text-xs">Calc runs</div>
          {runs.loading ? (
            <LoadingBlock />
          ) : !runs.data?.length ? (
            <div className="p-3 text-xs text-faint">No stored runs yet.</div>
          ) : (
            runs.data.map((r) => (
              <button key={r.id} className={`flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left hover:bg-hover ${last?.runId === r.id ? 'bg-accent/10' : ''}`} onClick={() => void openRun(r)}>
                <span className="font-mono text-xs text-muted">#{r.id}</span>
                <span className="min-w-0 flex-1 truncate text-xs">{elevations.find((e) => e.id === r.elevation_id)?.name ?? `elevation ${r.elevation_id ?? '—'}`}</span>
                <ValidationStatusBadge status={r.validation_status ?? r.result?.validation_status} />
                <span className="font-mono text-2xs text-faint">{fmtDateTime(r.created_at)}</span>
              </button>
            ))
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {last ? (
            <CalcResultsView entry={last} />
          ) : (
            <EmptyState icon={<Calculator className="h-5 w-5" />} title="No calculation yet" detail="Run a calculation for an elevation on the left, or press Calculate in the elevation editor." />
          )}
        </div>
      </div>
    </div>
  );
}
