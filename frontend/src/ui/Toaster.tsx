import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { useToasts } from '../store/toast';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[70] flex w-[360px] flex-col gap-2" data-testid="toaster">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={clsx('pointer-events-auto flex items-start gap-2.5 rounded border bg-panel px-3 py-2 shadow-pop animate-slide-in', t.kind === 'error' ? 'border-err/50' : t.kind === 'success' ? 'border-ok/40' : t.kind === 'warning' ? 'border-warn/45' : 'border-line-strong')}>
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />}
          {t.kind === 'error' && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-err" />}
          {t.kind === 'warning' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
          {t.kind === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.title}</div>
            {t.detail && <div className="mt-0.5 break-words text-xs text-muted">{t.detail}</div>}
          </div>
          <button className="text-faint hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
