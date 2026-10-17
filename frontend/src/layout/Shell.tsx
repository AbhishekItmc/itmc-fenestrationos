import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { backend, useApp, useBackend } from '../store/app';
import { useStatus } from '../store/status';
import { toast } from '../store/toast';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

/** Keeps project / elevation lists and the catalogue in sync with the selected context. */
function useContextSync() {
  const be = useBackend();
  const { projectId, setProjects, setElevations, setCatalogue, mode } = useApp();
  useEffect(() => {
    be.listProjects()
      .then((ps) => {
        setProjects(ps);
        const cur = useApp.getState().projectId;
        if (cur && !ps.some((p) => p.id === cur)) useApp.getState().selectProject(ps[0]?.id ?? null);
        else if (!cur && ps.length) useApp.getState().selectProject(ps[0].id);
      })
      .catch((e) => toast.error('Could not load projects', errorMessage(e)));
    if (mode === 'server')
      be.getCatalogue()
        .then((c) => setCatalogue(c, 'server'))
        .catch((e) => toast.warning('Using bundled demo catalogue', errorMessage(e)));
  }, [be, mode, setProjects, setCatalogue]);
  useEffect(() => {
    if (!projectId) {
      setElevations([]);
      return;
    }
    be.listElevations(projectId)
      .then(setElevations)
      .catch((e) => toast.error('Could not load elevations', errorMessage(e)));
  }, [be, projectId, setElevations]);
}

export function Shell() {
  useContextSync();
  const loc = useLocation();
  const reset = useStatus((s) => s.reset);
  useEffect(() => {
    if (!loc.pathname.startsWith('/editor')) reset();
  }, [loc.pathname, reset]);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

/** Reload the elevation list of the current project (after create/delete/save). */
export async function refreshElevations(): Promise<void> {
  const { projectId, setElevations } = useApp.getState();
  if (!projectId) return;
  setElevations(await backend().listElevations(projectId));
}

export async function refreshProjects(): Promise<void> {
  useApp.getState().setProjects(await backend().listProjects());
}
