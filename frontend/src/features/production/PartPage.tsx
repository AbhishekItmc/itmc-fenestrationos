import { LogIn, ScanLine, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { PartDetail } from '../../api/types';
import { parseScan } from '../../engine/production';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import { Button } from '../../ui/Button';
import { EmptyState, LoadingBlock } from '../../ui/Misc';
import { PartPanel } from './PartPanel';

/**
 * What a label's QR code opens: `/p/:code`. Mobile-first part card.
 * `publicView`: rendered outside the app shell when the server asks for sign-in — read-only if the server
 * allows anonymous reads, otherwise a sign-in prompt.
 */
export default function PartPage({ publicView, onSignIn }: { publicView?: boolean; onSignIn?: () => void }) {
  const be = useBackend();
  const user = useApp((s) => s.user);
  const params = useParams();
  const code = parseScan(publicView ? (window.location.pathname.split('/p/')[1] ?? '') : (params.code ?? '')) ?? '';
  const [tick, setTick] = useState(0);
  const d = useAsync(async (): Promise<PartDetail | null> => {
    if (!code) return null;
    if (publicView) return api.get<PartDetail>(`/parts/${encodeURIComponent(code)}`, { noAuthRedirect: true });
    return be.getPart(code);
  }, [be, code, tick, publicView]);
  const notFound = d.error && /not found|404/i.test(d.error);
  const needsLogin = publicView && d.error && /sign in|session|401|credentials|authenticated/i.test(d.error);

  return (
    <div className="h-full overflow-auto bg-bg" data-testid="part-page">
      <div className="mx-auto w-full max-w-[560px] px-4 py-4 sm:py-6">
        <div className="mb-3 flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">Part tracking</span>
          <span className="ml-auto font-mono text-xs text-muted">{code || '—'}</span>
        </div>
        <div className="rounded-md border border-line bg-panel p-4 shadow-pop">
          {d.loading && !d.data ? (
            <LoadingBlock label="Loading part…" />
          ) : needsLogin ? (
            <EmptyState
              icon={<LogIn className="h-5 w-5" />}
              title="Sign in to view this part"
              detail="Part records are visible to signed-in users of FenestrationOS."
              action={
                <Button variant="solid" icon={<LogIn className="h-4 w-4" />} onClick={onSignIn} data-testid="part-sign-in">
                  Sign in
                </Button>
              }
            />
          ) : notFound || !code || (!d.loading && !d.data && !d.error) ? (
            <EmptyState
              icon={<SearchX className="h-5 w-5" />}
              title="Unknown part code"
              detail={
                <>
                  No part with code <span className="font-mono font-semibold text-fg">{code || '(empty)'}</span> exists{be.mode === 'offline' && !publicView ? ' in this browser’s offline demo data' : ''}. Check the label, or the code may belong to a cancelled work order.
                </>
              }
              action={
                !publicView ? (
                  <Link to="/station" className="btn btn-primary">
                    <ScanLine className="h-3.5 w-3.5" /> Open workstation
                  </Link>
                ) : undefined
              }
            />
          ) : d.error ? (
            <EmptyState icon={<SearchX className="h-5 w-5 text-err" />} title="Could not load part" detail={d.error} action={<Button onClick={d.reload}>Retry</Button>} />
          ) : d.data ? (
            <>
              <PartPanel detail={d.data} station={d.data.part.current_station} canAct={!publicView && canWrite(user, 'operate')} onChanged={() => setTick((t) => t + 1)} />
              {publicView && (
                <div className="mt-4 border-t border-line pt-3">
                  <Button className="w-full justify-center" icon={<LogIn className="h-4 w-4" />} onClick={onSignIn} data-testid="part-sign-in">
                    Sign in for operator actions
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
