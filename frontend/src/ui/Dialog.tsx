import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function Dialog({ open, onClose, title, subtitle, children, footer, width = 520, testId }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(var(--scrim)/0.45)] pt-[10vh] animate-fade-in" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" data-testid={testId} className="flex max-h-[80vh] flex-col rounded-md border border-line-strong bg-panel shadow-pop" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-md font-semibold">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 640, actions, testId }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; actions?: ReactNode; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgb(var(--scrim)/0.25)] animate-fade-in" onMouseDown={onClose}>
      <aside data-testid={testId} className={clsx('flex h-full flex-col border-l border-line-strong bg-panel shadow-pop animate-slide-in')} style={{ width, maxWidth: '96vw' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-semibold">{title}</div>
            {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
          </div>
          {actions}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close drawer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}
