import clsx from 'clsx';
import { ChevronDown, Cloud, CloudOff, LogOut, RotateCcw, ServerCog, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pingHealth } from '../api/client';
import { resetOfflineData } from '../services/offlineBackend';
import { useApp } from '../store/app';
import { toast } from '../store/toast';

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-2">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.4" />
        <path d="M16 3v26M3 16h13" stroke="rgb(var(--accent))" strokeWidth="2.4" />
        <rect x="18.5" y="18.5" width="8" height="8" fill="rgb(var(--accent) / 0.25)" />
      </svg>
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-tight">
          FenestrationOS
        </div>
        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-faint">ITMC · Engineering</div>
      </div>
    </div>
  );
}

export function TopBar() {
  const { mode, user, projects, elevations, projectId, elevationId, selectProject, selectElevation, logout, catalogue } = useApp();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [menu]);

  const tryServer = async () => {
    setMenu(false);
    if (await pingHealth()) {
      try {
        sessionStorage.removeItem('fos.mode');
      } catch {
        /* ignore */
      }
      window.location.reload();
    } else toast.warning('Server still unreachable', 'Continuing in offline demo mode.');
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Logo />
      <div className="h-6 w-px bg-line" />
      <div className="flex items-center gap-1.5">
        <span className="section-title">Project</span>
        <select
          data-testid="project-select"
          className="input h-7 w-[260px] text-sm"
          value={projectId ?? ''}
          onChange={(e) => selectProject(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— select project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="section-title">Elevation</span>
        <select
          data-testid="elevation-select"
          className="input h-7 w-[220px] text-sm"
          value={elevationId ?? ''}
          disabled={!projectId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            selectElevation(id);
            if (id) nav(`/editor/${id}`);
          }}
        >
          <option value="">{projectId ? (elevations.length ? '— select elevation —' : 'no elevations yet') : '—'}</option>
          {elevations.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1" />
      <div
        data-testid="mode-indicator"
        data-tip={mode === 'server' ? 'Connected to the FenestrationOS server — results are authoritative' : 'Offline demo mode — in-browser heuristic engines, data kept in this browser only'}
        data-tip-pos="left"
        className={clsx('flex h-7 items-center gap-1.5 rounded-sm border px-2 text-xs font-semibold', mode === 'server' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-info/45 bg-info/10 text-info')}
      >
        {mode === 'server' ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {mode === 'server' ? 'SERVER' : 'OFFLINE DEMO'}
      </div>
      <div className="hidden font-mono text-2xs text-faint xl:block" data-tip="Active catalogue version (DEMO data)" data-tip-pos="left">
        {catalogue.catalogue_version}
      </div>
      <div className="relative" ref={menuRef}>
        <button data-testid="user-menu" className="flex h-7 items-center gap-2 rounded px-1.5 hover:bg-hover" onClick={() => setMenu(!menu)}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-raised text-2xs font-semibold text-muted">
            {(user?.name || user?.email || '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden text-left leading-none lg:block">
            <span className="block text-xs">{user?.name || user?.email}</span>
            <span className="block text-2xs uppercase tracking-wide text-faint">{user?.role}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-faint" />
        </button>
        {menu && (
          <div className="absolute right-0 top-9 z-50 w-60 rounded border border-line-strong bg-panel py-1 shadow-pop">
            <div className="border-b border-line px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <UserRound className="h-3.5 w-3.5 text-faint" />
                {user?.email}
              </div>
              <div className="mt-0.5 text-faint">Role: {user?.role}</div>
            </div>
            {mode === 'offline' && (
              <>
                <button
                  className="flex h-8 w-full items-center gap-2 px-3 text-sm hover:bg-hover"
                  onClick={() => {
                    resetOfflineData();
                    setMenu(false);
                    toast.success('Offline demo data reset');
                    window.location.reload();
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-faint" /> Reset offline demo data
                </button>
                <button className="flex h-8 w-full items-center gap-2 px-3 text-sm hover:bg-hover" onClick={tryServer}>
                  <ServerCog className="h-3.5 w-3.5 text-faint" /> Try connecting to server
                </button>
              </>
            )}
            <button
              data-testid="sign-out"
              className="flex h-8 w-full items-center gap-2 px-3 text-sm hover:bg-hover"
              onClick={() => {
                setMenu(false);
                logout();
              }}
            >
              <LogOut className="h-3.5 w-3.5 text-faint" /> {mode === 'server' ? 'Sign out' : 'Leave offline mode'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
