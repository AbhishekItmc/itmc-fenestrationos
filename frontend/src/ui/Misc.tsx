import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Issue } from '../api/types';
import { useApp } from '../store/app';
import { SeverityIcon } from './Badge';

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2 text-sm text-muted', className)}>
      <Loader2 className="h-4 w-4 animate-spin text-accent" />
      {label}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({ icon, title, detail, action, className }: { icon?: ReactNode; title: string; detail?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-raised text-faint">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <div className="text-md font-semibold">{title}</div>
      {detail && <div className="max-w-md text-sm text-muted">{detail}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-3 flex items-start gap-2 rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Global amber notice shown wherever calculation results appear. */
export function ProvisionalBanner({ className, compact }: { className?: string; compact?: boolean }) {
  const cat = useApp((s) => s.catalogue);
  return (
    <div data-testid="provisional-banner" className={clsx('provisional-stripe flex items-center gap-2 border border-prov/50 text-prov', compact ? 'h-7 rounded-sm px-2 text-xs' : 'rounded px-3 py-1.5 text-sm', className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold tracking-wide">PROVISIONAL — demo catalogue &amp; unapproved rules</span>
      {!compact && <span className="truncate text-prov/80">· {cat.catalogue_version} · not for fabrication or commercial use</span>}
    </div>
  );
}

export function OfflineEngineLabel({ className }: { className?: string }) {
  return (
    <span data-tip="Results computed in the browser by the TS port of the engines. Server results are authoritative." className={clsx('inline-flex h-5 items-center rounded-sm border border-info/40 bg-info/10 px-1.5 text-2xs font-semibold text-info', className)}>
      Offline demo engine — heuristic
    </span>
  );
}

export function IssueList({ issues, onPick, activeRef, empty = 'No issues', testId, tag }: { issues: Issue[]; onPick?: (i: Issue) => void; activeRef?: string | null; empty?: string; testId?: string; tag?: (i: Issue) => ReactNode }) {
  if (!issues.length) return <div className="px-3 py-3 text-sm text-faint">{empty}</div>;
  return (
    <ul data-testid={testId} className="divide-y divide-line/60">
      {issues.map((i, k) => (
        <li key={k}>
          <button
            type="button"
            onClick={() => onPick?.(i)}
            className={clsx('flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover/60', activeRef && i.ref === activeRef && 'bg-accent/10', !onPick && 'cursor-default')}
          >
            <SeverityIcon severity={i.severity} className="mt-[1px]" />
            <span className="min-w-0 flex-1">
              <span className="block text-fg">{i.message}</span>
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {tag?.(i)}
                <span className="font-mono text-2xs text-faint">
                  {i.code}
                  {i.ref ? ` · ${i.ref}` : ''}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line bg-panel/60 px-5 pb-3 pt-4">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, tone = 'neutral', testId }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'accent' | 'prov'; testId?: string }) {
  const toneCls = { neutral: 'text-fg', ok: 'text-ok', warn: 'text-warn', err: 'text-err', accent: 'text-accent', prov: 'text-prov' }[tone];
  return (
    <div data-testid={testId} className="min-w-[120px] flex-1 border-r border-line px-3.5 py-2 last:border-r-0">
      <div className="section-title">{label}</div>
      <div className={clsx('mt-0.5 font-mono text-lg font-medium leading-6', toneCls)}>{value}</div>
      {sub && <div className="truncate text-2xs text-faint">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex items-end gap-0.5 border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx('-mb-px flex h-8 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors', t.value === value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-sm bg-raised px-1 font-mono text-2xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
