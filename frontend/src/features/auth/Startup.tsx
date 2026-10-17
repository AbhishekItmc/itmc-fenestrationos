import { CloudOff, Loader2, RefreshCw, ServerCrash } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { configureClient, errorMessage, getToken, pingHealth } from '../../api/client';
import { serverBackend } from '../../services/serverBackend';
import { offlineChosen, useApp } from '../../store/app';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';

export function Brand({ big }: { big?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg width={big ? 40 : 28} height={big ? 40 : 28} viewBox="0 0 32 32" aria-hidden>
        <rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" />
        <path d="M16 3v26M3 16h13" stroke="rgb(var(--accent))" strokeWidth="2.2" />
        <rect x="18.5" y="18.5" width="8" height="8" fill="rgb(var(--accent) / 0.25)" />
      </svg>
      <div>
        <div className={big ? 'text-2xl font-semibold tracking-tight' : 'text-lg font-semibold'}>ITMC FenestrationOS</div>
        <div className="text-2xs font-medium uppercase tracking-[0.18em] text-faint">Fenestration CAD · Engineering · Estimation · Manufacturing</div>
      </div>
    </div>
  );
}

/** Startup: ping /health → server (login) or offer offline demo mode. */
export function Startup() {
  const phase = useApp((s) => s.phase);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    if (offlineChosen()) {
      // explicit choice for this browser tab; "Try connecting to server" in the user menu clears it
      useApp.getState().enterOffline();
      return;
    }
    const ok = await pingHealth();
    if (!ok) {
      setChecking(false);
      useApp.setState({ phase: 'choose', serverReachable: false });
      return;
    }
    if (getToken()) {
      try {
        const me = await serverBackend.me();
        useApp.getState().enterServer(me);
        return;
      } catch (e) {
        if (!(e instanceof Error) || !/401|expired/i.test(errorMessage(e))) toast.info('Please sign in', errorMessage(e));
      }
    }
    useApp.getState().enterServer(null);
    setChecking(false);
  }, []);

  useEffect(() => {
    configureClient({
      onUnauthorized: () => {
        if (useApp.getState().mode === 'server') {
          useApp.setState({ phase: 'login', user: null });
          toast.warning('Session expired', 'Please sign in again.');
        }
      },
    });
    void check();
  }, [check]);

  if (phase === 'checking' || checking)
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-5">
          <Brand big />
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> Connecting to server…
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-[520px] rounded-md border border-line bg-panel p-7 shadow-pop">
        <Brand big />
        <div className="mt-6 flex items-start gap-3 rounded border border-warn/40 bg-warn/10 p-3 text-sm">
          <ServerCrash className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <div className="font-medium text-warn">Server not reachable</div>
            <div className="mt-0.5 text-muted">
              <span className="font-mono text-xs">/api/v1/health</span> did not answer. You can retry, or continue in offline demo mode — the elevation editor, calculation and
              optimisers run in your browser with the bundled DEMO catalogue. Data stays in this browser only.
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2">
          <Button variant="solid" icon={<CloudOff className="h-4 w-4" />} onClick={() => useApp.getState().enterOffline()} data-testid="continue-offline">
            Continue in offline demo mode
          </Button>
          <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void check()}>
            Retry connection
          </Button>
        </div>
        <div className="mt-6 border-t border-line pt-3 text-2xs text-faint">
          Offline results are labelled “Offline demo engine — heuristic” and are never authoritative. All catalogue values are DEMO DATA — not manufacturer data.
        </div>
      </div>
    </div>
  );
}
